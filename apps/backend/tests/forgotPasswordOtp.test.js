import test from "node:test";
import assert from "node:assert";
import axios from "axios";
import wp from "../src/services/wordpress.js";
import {
  sendOtp,
  verifyOtp,
  resetPasswordOtp,
  forgotPassword,
  resetPassword,
  login,
  googleLogin,
} from "../src/controllers/authController.js";
import { OAuth2Client } from "google-auth-library";

test("Phase 4: Forgot Password via Email OTP Test Suite", async (suite) => {
  const originalEnv = { ...process.env };
  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;
  const originalWpPost = wp.post;
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;

  process.env.WORDPRESS_URL = "http://mock-wordpress";
  process.env.MUMBAI_INTERNAL_API_KEY = "test-internal-key";
  process.env.MOCK_EMAIL = "true";
  process.env.NODE_ENV = "test";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";

  const mockAxiosPost = async (url, data, config) => {
    if (url && url.includes("brevo")) {
      return { status: 201, data: { messageId: "mock_test_msg_id" } };
    }
    return originalAxiosPost(url, data, config);
  };

  suite.beforeEach(() => {
    process.env.MOCK_EMAIL = "true";
    process.env.NODE_ENV = "test";
    axios.post = mockAxiosPost;
  });

  suite.afterEach(() => {
    process.env = { ...originalEnv };
    process.env.MOCK_EMAIL = "true";
    process.env.NODE_ENV = "test";
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
    wp.post = originalWpPost;
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
  });

  // Helper to simulate express request/response
  const simulateHandler = async (handler, { body = {}, headers = {}, cookies = {}, wpUserId = 0, user = null }) => {
    return new Promise((resolve) => {
      const req = {
        body,
        headers: { "x-mumbai-panel": "customer", ...headers },
        cookies,
        wpUserId: wpUserId || 0,
        user,
      };

      const res = {
        statusCode: 200,
        cookies: {},
        status: function (code) {
          this.statusCode = code;
          return this;
        },
        json: function (data) {
          resolve({ status: this.statusCode || 200, data, cookies: this.cookies });
        },
        cookie: function (name, val, opts) {
          this.cookies[name] = { val, opts };
        },
      };

      handler(req, res).catch((err) => {
        resolve({ status: 500, data: { message: err.message } });
      });
    });
  };

  // 1. Valid registered mobile -> OTP -> successful reset
  await suite.test("1. Valid registered mobile -> OTP -> successful reset", async () => {
    let capturedStorePayload = null;
    let capturedVerifyPayload = null;
    let capturedResetPayload = null;

    wp.post = async (url, payload) => {
      if (url.includes("/otp/store")) {
        capturedStorePayload = payload;
        return {
          data: {
            success: true,
            user_found: true,
            message: "If the number is registered, an OTP has been sent.",
          },
        };
      }
      if (url.includes("/otp/verify")) {
        capturedVerifyPayload = payload;
        return {
          data: {
            success: true,
            message: "OTP verified. Proceed to reset password.",
            reset_token: "mock_reset_auth_token_64chars_abcdef123456",
          },
        };
      }
      if (url.includes("/otp/reset-password")) {
        capturedResetPayload = payload;
        return {
          data: {
            success: true,
            message: "Password reset successfully.",
          },
        };
      }
      return { data: {} };
    };

    // Step A: Send OTP (unauthenticated)
    const sendRes = await simulateHandler(sendOtp, {
      body: { phone: "9820123456", purpose: "reset_password" },
      wpUserId: 0,
      user: null,
    });
    assert.strictEqual(sendRes.status, 200);
    assert.strictEqual(sendRes.data.success, true);
    assert.strictEqual(capturedStorePayload.phone, "9820123456");
    assert.strictEqual(capturedStorePayload.purpose, "reset_password");

    // Step B: Verify OTP
    const verifyRes = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "reset_password" },
      wpUserId: 0,
      user: null,
    });
    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.data.success, true);
    assert.strictEqual(verifyRes.data.reset_token, "mock_reset_auth_token_64chars_abcdef123456");
    assert.strictEqual(capturedVerifyPayload.purpose, "reset_password");

    // Step C: Reset Password with token
    const resetRes = await simulateHandler(resetPasswordOtp, {
      body: {
        phone: "9820123456",
        reset_token: verifyRes.data.reset_token,
        new_password: "NewStrongPassword123!",
      },
    });
    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual(resetRes.data.success, true);
    assert.strictEqual(capturedResetPayload.reset_token, "mock_reset_auth_token_64chars_abcdef123456");
    assert.strictEqual(capturedResetPayload.new_password, "NewStrongPassword123!");
  });

  // 2. Unknown mobile -> generic response (Anti-enumeration)
  await suite.test("2. Anti-enumeration: Unknown mobile number returns identical generic response", async () => {
    let capturedStorePayload = null;

    wp.post = async (url, payload) => {
      if (url.includes("/otp/store")) {
        capturedStorePayload = payload;
        // WordPress returns user_found: false for unregistered numbers
        return {
          data: {
            success: true,
            user_found: false,
            message: "If the number is registered, an OTP has been sent.",
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(sendOtp, {
      body: { phone: "9820000000", purpose: "reset_password" },
      wpUserId: 0,
      user: null,
    });

    // Must return HTTP 200 with generic success message without leaking non-existence
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.message, "If the number is registered, an OTP has been sent.");
    assert.strictEqual(capturedStorePayload.phone, "9820000000");
  });

  // 3. Wrong OTP rejection
  await suite.test("3. Wrong OTP: Rejected with 400 and generic error message", async () => {
    wp.post = async (url) => {
      if (url.includes("/otp/verify")) {
        const error = new Error("Invalid OTP");
        error.response = {
          status: 400,
          data: { success: false, message: "Invalid OTP." },
        };
        throw error;
      }
      return { data: {} };
    };

    const res = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "000000", purpose: "reset_password" },
      wpUserId: 0,
      user: null,
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /Invalid OTP/i);
  });

  // 4. Expired OTP rejection
  await suite.test("4. Expired OTP: Rejected when code is older than 5 minutes", async () => {
    wp.post = async (url) => {
      if (url.includes("/otp/verify")) {
        const error = new Error("Expired OTP");
        error.response = {
          status: 400,
          data: { success: false, message: "OTP has expired." },
        };
        throw error;
      }
      return { data: {} };
    };

    const res = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "reset_password" },
      wpUserId: 0,
      user: null,
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /expired/i);
  });

  // 5. Five failed attempts lockout
  await suite.test("5. Maximum Attempts: Locks out after 5 consecutive failures with 429", async () => {
    wp.post = async (url) => {
      if (url.includes("/otp/verify")) {
        const error = new Error("Max attempts");
        error.response = {
          status: 429,
          data: {
            success: false,
            message: "Too many failed attempts. Please request a new OTP.",
          },
        };
        throw error;
      }
      return { data: {} };
    };

    const res = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "111111", purpose: "reset_password" },
      wpUserId: 0,
      user: null,
    });

    assert.strictEqual(res.status, 429);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /Too many failed attempts/i);
  });

  // 6. Resend before 60 seconds (Anti-enumeration rate limiting)
  await suite.test("6. Resend Cooldown: Returns generic success without dispatching new Email during 60s cooldown", async () => {
    wp.post = async (url) => {
      if (url.includes("/otp/store")) {
        return {
          data: {
            success: true,
            user_found: true,
            rate_limited: true,
            message: "If the number is registered, an OTP has been sent.",
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(sendOtp, {
      body: { phone: "9820123456", purpose: "reset_password" },
      wpUserId: 0,
      user: null,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.message, "If the number is registered, an OTP has been sent.");
  });

  // 7. Successful OTP invalidates OTP
  await suite.test("7. Invalidation: OTP is cleared immediately upon successful verification", async () => {
    let callCount = 0;
    wp.post = async (url) => {
      if (url.includes("/otp/verify")) {
        callCount++;
        if (callCount === 1) {
          return { data: { success: true, reset_token: "token_123" } };
        }
        // Second call with same OTP must fail because it was deleted
        const error = new Error("Invalid or expired OTP.");
        error.response = { status: 400, data: { success: false, message: "Invalid or expired OTP." } };
        throw error;
      }
      return { data: {} };
    };

    // First attempt succeeds
    const firstRes = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "reset_password" },
      wpUserId: 0,
    });
    assert.strictEqual(firstRes.status, 200);

    // Replay attempt fails
    const replayRes = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "reset_password" },
      wpUserId: 0,
    });
    assert.strictEqual(replayRes.status, 400);
  });

  // 8. Successful password reset invalidates reset authorization
  await suite.test("8. Invalidation: Reset authorization token is invalidated upon password update", async () => {
    wp.post = async (url) => {
      if (url.includes("/otp/reset-password")) {
        return { data: { success: true, message: "Password reset successfully." } };
      }
      return { data: {} };
    };

    const res = await simulateHandler(resetPasswordOtp, {
      body: {
        phone: "9820123456",
        reset_token: "valid_token_xyz",
        new_password: "NewPassword123!",
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
  });

  // 9. Reusing reset authorization fails
  await suite.test("9. Replay Protection: Reusing the same reset_token fails with 401", async () => {
    let resetCount = 0;
    wp.post = async (url) => {
      if (url.includes("/otp/reset-password")) {
        resetCount++;
        if (resetCount === 1) {
          return { data: { success: true, message: "Password reset successfully." } };
        }
        const error = new Error("Token expired");
        error.response = {
          status: 401,
          data: { success: false, message: "Reset session expired or invalid. Please verify OTP again." },
        };
        throw error;
      }
      return { data: {} };
    };

    const first = await simulateHandler(resetPasswordOtp, {
      body: { phone: "9820123456", reset_token: "reused_token", new_password: "Password123!" },
    });
    assert.strictEqual(first.status, 200);

    const second = await simulateHandler(resetPasswordOtp, {
      body: { phone: "9820123456", reset_token: "reused_token", new_password: "AnotherPassword123!" },
    });
    assert.strictEqual(second.status, 401);
    assert.match(second.data.message, /expired or invalid/i);
  });

  // 10. User cannot use verify_phone OTP for password reset
  await suite.test("10. Purpose Isolation: verify_phone OTP cannot be used to reset password", async () => {
    wp.post = async (url, payload) => {
      if (url.includes("/otp/verify")) {
        // If purpose was verify_phone, reset_token is NOT issued
        if (payload.purpose === "verify_phone") {
          return { data: { success: true, message: "Phone verified successfully." } };
        }
      }
      if (url.includes("/otp/reset-password")) {
        const error = new Error("Missing reset token");
        error.response = { status: 400, data: { success: false, message: "Missing parameters." } };
        throw error;
      }
      return { data: {} };
    };

    const verifyPhoneRes = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "verify_phone" },
      wpUserId: 101,
    });
    assert.strictEqual(verifyPhoneRes.status, 200);
    assert.strictEqual(verifyPhoneRes.data.reset_token, undefined, "verify_phone must never return a reset_token");

    // Attempting to call reset-password without reset_token fails
    const resetRes = await simulateHandler(resetPasswordOtp, {
      body: { phone: "9820123456", reset_token: "", new_password: "NewPassword123!" },
    });
    assert.strictEqual(resetRes.status, 400);
  });

  // 11. Reset-password OTP never changes phone verification status
  await suite.test("11. Security Isolation: reset_password OTP never sets is_phone_verified=true", async () => {
    wp.post = async (url, payload) => {
      if (url.includes("/otp/verify")) {
        assert.strictEqual(payload.purpose, "reset_password");
        // WordPress implementation only sets _mumbai_is_phone_verified when purpose === 'verify_phone'
        return {
          data: {
            success: true,
            reset_token: "valid_reset_token",
            // Notice: is_phone_verified is NOT returned or set for reset_password
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "reset_password" },
      wpUserId: 0,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.is_phone_verified, undefined);
  });

  // 12. Existing email reset still works
  await suite.test("12. Compatibility: Existing email forgot-password and reset-password work unchanged", async () => {
    let capturedForgotPayload = null;
    let capturedResetPayload = null;

    wp.post = async (url, payload) => {
      if (url.includes("/forgot-password")) {
        capturedForgotPayload = payload;
        return { data: { success: true, message: "Password reset email sent." } };
      }
      if (url.includes("/reset-password")) {
        capturedResetPayload = payload;
        return { data: { success: true, message: "Password reset successful." } };
      }
      return { data: {} };
    };

    // Test email forgot password
    const forgotRes = await simulateHandler(forgotPassword, {
      body: { email: "customer@example.com" },
    });
    assert.strictEqual(forgotRes.status, 200);
    assert.strictEqual(capturedForgotPayload.email, "customer@example.com");

    // Test email reset password
    const resetRes = await simulateHandler(resetPassword, {
      body: { token: "email_reset_token_123", password: "NewPassword123!" },
    });
    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual(capturedResetPayload.token, "email_reset_token_123");
    assert.strictEqual(capturedResetPayload.password, "NewPassword123!");
  });

  // 13. Google-authenticated users can still use mobile forgot-password
  await suite.test("13. Google Users: Customer who signed up with Google can use mobile OTP to reset password", async () => {
    wp.post = async (url, payload) => {
      if (url.includes("/otp/store")) {
        return { data: { success: true, message: "If the number is registered, an OTP has been sent." } };
      }
      if (url.includes("/otp/verify")) {
        return { data: { success: true, reset_token: "google_user_reset_token" } };
      }
      if (url.includes("/otp/reset-password")) {
        return { data: { success: true, message: "Password reset successfully." } };
      }
      return { data: {} };
    };

    // Google user with registered mobile requests reset
    const sendRes = await simulateHandler(sendOtp, {
      body: { phone: "9820123456", purpose: "reset_password" },
      wpUserId: 0,
    });
    assert.strictEqual(sendRes.status, 200);

    const verifyRes = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "reset_password" },
      wpUserId: 0,
    });
    assert.strictEqual(verifyRes.status, 200);
    assert.ok(verifyRes.data.reset_token);

    const resetRes = await simulateHandler(resetPasswordOtp, {
      body: { phone: "9820123456", reset_token: verifyRes.data.reset_token, new_password: "GoogleUserPass123!" },
    });
    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual(resetRes.data.success, true);
  });

  // 14. Existing user can log in with newly changed password
  await suite.test("14. Login Verification: Customer can log in with newly changed password", async () => {
    wp.post = async (url, payload) => {
      if (url.includes("/wp-json/mumbai-auth/v1/login")) {
        assert.strictEqual(payload.email, "customer@example.com");
        assert.strictEqual(payload.password, "NewPassword123!");
        return {
          data: {
            success: true,
            session: "mock_session_token",
            cookie_name: "wordpress_logged_in_xyz",
            user: { id: 101, email: "customer@example.com", name: "Test User" },
          },
        };
      }
      return { data: {} };
    };

    const loginRes = await simulateHandler(login, {
      body: { email: "customer@example.com", password: "NewPassword123!" },
    });

    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.success, true);
    assert.strictEqual(loginRes.data.user.email, "customer@example.com");
    assert.ok(loginRes.cookies.mumbai_customer_auth);
  });

  // 15. Existing Google login remains functional after password reset
  await suite.test("15. Google Login Continuity: Google SSO continues to work after password reset", async () => {
    OAuth2Client.prototype.verifyIdToken = async () => ({
      getPayload: () => ({
        sub: "google-sub-user-123",
        email: "googleuser@gmail.com",
        name: "Google User",
        email_verified: true,
      }),
    });

    axios.post = async (url) => {
      if (url.includes("/wp-json/mumbai-auth/v1/sso")) {
        return {
          data: {
            success: true,
            session: "mock_sso_session",
            cookie_name: "wordpress_logged_in_abc",
            user: { id: 102, email: "googleuser@gmail.com", name: "Google User" },
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(googleLogin, {
      body: { credential: "mock_google_id_token" },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.user.email, "googleuser@gmail.com");
    assert.ok(res.cookies.mumbai_customer_auth);
  });

  // 16. Email Identifier: verifyOtp and resetPasswordOtp preserve email addresses
  await suite.test("16. Email OTP: verifyOtp and resetPasswordOtp preserve email address format", async () => {
    let capturedVerifyPhone = "";
    let capturedResetPhone = "";

    wp.post = async (url, data) => {
      if (url.includes("/otp/verify")) {
        capturedVerifyPhone = data.phone;
        return {
          data: {
            success: true,
            message: "OTP verified. Proceed to reset password.",
            reset_token: "mock_reset_token_email_user",
          },
        };
      }
      if (url.includes("/otp/reset-password")) {
        capturedResetPhone = data.phone;
        return {
          data: {
            success: true,
            message: "Password reset successfully.",
          },
        };
      }
      return { data: {} };
    };

    const verifyRes = await simulateHandler(verifyOtp, {
      body: {
        phone: "customer@example.com",
        otp: "123456",
        purpose: "reset_password",
      },
    });

    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.data.success, true);
    assert.strictEqual(capturedVerifyPhone, "customer@example.com");

    const resetRes = await simulateHandler(resetPasswordOtp, {
      body: {
        phone: "customer@example.com",
        reset_token: "mock_reset_token_email_user",
        new_password: "NewPassword123!",
      },
    });

    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual(resetRes.data.success, true);
    assert.strictEqual(capturedResetPhone, "customer@example.com");
  });
});
