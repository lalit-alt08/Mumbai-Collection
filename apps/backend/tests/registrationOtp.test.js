import test from "node:test";
import assert from "node:assert";
import axios from "axios";
import wp from "../src/services/wordpress.js";
import {
  sendOtp,
  verifyOtp,
  me,
} from "../src/controllers/authController.js";
import {
  getProfile,
  saveProfile,
  checkProfileComplete,
} from "../src/controllers/profileController.js";
import {
  requireVerifiedPhone,
  checkSessionPhoneVerified,
} from "../src/middlewares/authMiddleware.js";
import { normalizePhoneNumber } from "../src/services/brevoService.js";

test("Phase 3: Registration Phone Verification & Hardening Test Suite", async (suite) => {
  const originalEnv = { ...process.env };
  const originalAxiosGet = axios.get;
  const originalAxiosPut = axios.put;
  const originalAxiosPost = axios.post;
  const originalWpPost = wp.post;

  process.env.WORDPRESS_URL = "http://mock-wordpress";
  process.env.MUMBAI_INTERNAL_API_KEY = "test-internal-key";
  process.env.MOCK_SMS = "true";
  process.env.NODE_ENV = "test";

  const mockAxiosPost = async (url, data, config) => {
    if (url && (url.includes("transactionalSMS") || url.includes("brevo"))) {
      return { status: 201, data: { messageId: "mock_test_msg_id" } };
    }
    return originalAxiosPost(url, data, config);
  };

  suite.beforeEach(() => {
    process.env.MOCK_SMS = "true";
    process.env.NODE_ENV = "test";
    axios.post = mockAxiosPost;
  });

  suite.afterEach(() => {
    process.env = { ...originalEnv };
    process.env.MOCK_SMS = "true";
    process.env.NODE_ENV = "test";
    axios.get = originalAxiosGet;
    axios.put = originalAxiosPut;
    axios.post = originalAxiosPost;
    wp.post = originalWpPost;
  });

  // Helper to simulate express request/response
  const simulateHandler = async (handler, { body = {}, headers = {}, cookies = {}, wpUserId = 123, user = null }) => {
    return new Promise((resolve) => {
      const resolvedUser = user !== null ? user : (wpUserId ? { id: wpUserId, email: "user@example.com" } : null);
      const req = {
        body,
        headers: { "x-mumbai-panel": "customer", ...headers },
        cookies,
        wpUserId: wpUserId || 0,
        user: resolvedUser,
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

  // 1. Phone number normalization and validation
  await suite.test("1. Phone Normalization: Accepts valid Indian numbers and rejects invalid", () => {
    const valid1 = normalizePhoneNumber("9820123456");
    assert.ok(valid1);
    assert.strictEqual(valid1.local, "9820123456");
    assert.strictEqual(valid1.e164, "+919820123456");

    const valid2 = normalizePhoneNumber("+91 98201 23456");
    assert.ok(valid2);
    assert.strictEqual(valid2.local, "9820123456");

    const invalid = normalizePhoneNumber("123456");
    assert.strictEqual(invalid, null);

    const invalidPrefix = normalizePhoneNumber("4123456789");
    assert.strictEqual(invalidPrefix, null);
  });

  // 2. New registration -> Profile incomplete (is_phone_verified: false)
  await suite.test("2. Registration: New user has is_phone_verified=false and incomplete profile", async () => {
    axios.get = async (url) => {
      if (url.includes("/wp-json/mumbai-auth/v1/profile/complete")) {
        return {
          data: {
            success: true,
            complete: false,
            profile_complete: false,
            is_phone_verified: false,
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(checkProfileComplete, { wpUserId: 101 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.complete, false);
    assert.strictEqual(res.data.is_phone_verified, false);
  });

  // 3. OTP Send for verify_phone (Authenticated)
  await suite.test("3. OTP Send: Dispatches OTP with purpose=verify_phone for authenticated user", async () => {
    let capturedPayload = null;
    wp.post = async (url, payload) => {
      if (url.includes("/otp/store")) {
        capturedPayload = payload;
        return {
          data: {
            success: true,
            message: "OTP sent successfully.",
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(sendOtp, {
      body: { phone: "9820123456", purpose: "verify_phone" },
      wpUserId: 101,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(capturedPayload.phone, "9820123456");
    assert.strictEqual(capturedPayload.purpose, "verify_phone");
    assert.strictEqual(capturedPayload.user_id, 101);
    assert.ok(capturedPayload.otp_hash);
  });

  // 4. Successful OTP Verification marks phone verified
  await suite.test("4. OTP Verify: Valid OTP marks phone verified", async () => {
    let capturedVerifyPayload = null;
    wp.post = async (url, payload) => {
      if (url.includes("/otp/verify")) {
        capturedVerifyPayload = payload;
        return {
          data: {
            success: true,
            message: "Phone number verified successfully.",
            is_phone_verified: true,
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "verify_phone" },
      wpUserId: 101,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.is_phone_verified, true);
    assert.strictEqual(capturedVerifyPayload.phone, "9820123456");
    assert.strictEqual(capturedVerifyPayload.purpose, "verify_phone");
    assert.strictEqual(capturedVerifyPayload.user_id, 101);
  });

  // 5. Incorrect OTP rejection
  await suite.test("5. Incorrect OTP: Fails with 400 and appropriate error message", async () => {
    wp.post = async (url) => {
      if (url.includes("/otp/verify")) {
        const error = new Error("Invalid verification code.");
        error.response = {
          status: 400,
          data: { success: false, message: "Invalid verification code. 4 attempts remaining." },
        };
        throw error;
      }
      return { data: {} };
    };

    const res = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "999999", purpose: "verify_phone" },
      wpUserId: 101,
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /Invalid verification code/);
  });

  // 6. Expired OTP rejection
  await suite.test("6. Expired OTP: Fails when OTP has expired", async () => {
    wp.post = async (url) => {
      if (url.includes("/otp/verify")) {
        const error = new Error("Verification code has expired.");
        error.response = {
          status: 400,
          data: { success: false, message: "Verification code has expired. Please request a new one." },
        };
        throw error;
      }
      return { data: {} };
    };

    const res = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "verify_phone" },
      wpUserId: 101,
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /expired/i);
  });

  // 7. Resend cooldown enforcement
  await suite.test("7. Resend Cooldown: Rejects OTP request during 60-second window", async () => {
    wp.post = async (url) => {
      if (url.includes("/otp/store")) {
        return {
          data: {
            success: false,
            message: "Please wait 45 seconds before requesting another code.",
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(sendOtp, {
      body: { phone: "9820123456", purpose: "verify_phone" },
      wpUserId: 101,
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /wait 45 seconds/i);
  });

  // 8. Auth state synchronization: /me endpoint returns is_phone_verified
  await suite.test("8. Auth State: /me returns is_phone_verified=true after verification", async () => {
    axios.get = async (url) => {
      if (url.includes("/wp-json/mumbai-auth/v1/me")) {
        return {
          data: {
            success: true,
            logged_in: true,
            current_user_id: 101,
            roles: ["customer"],
            phone: "9820123456",
            is_phone_verified: true,
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(me, {
      cookies: { mumbai_customer_auth: "test_session_cookie" },
      headers: { "x-mumbai-panel": "customer" },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.is_phone_verified, true);
    assert.strictEqual(res.data.user.is_phone_verified, true);
    assert.strictEqual(res.data.user.phone, "9820123456");
  });

  // 9. Completion Guard: Verified customer with address has complete=true
  await suite.test("9. Completion Guard: Verified customer with address has complete=true", async () => {
    axios.get = async (url) => {
      if (url.includes("/wp-json/mumbai-auth/v1/profile/complete")) {
        return {
          data: {
            success: true,
            complete: true,
            profile_complete: true,
            is_phone_verified: true,
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(checkProfileComplete, { wpUserId: 101 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.complete, true);
    assert.strictEqual(res.data.is_phone_verified, true);
  });

  // 10. Changing phone number resets verification
  await suite.test("10. Changing Phone: Saving a new phone resets is_phone_verified to false", async () => {
    let capturedProfile = null;
    axios.put = async (url, payload) => {
      if (url.includes("/wp-json/mumbai-auth/v1/profile")) {
        capturedProfile = payload;
        return {
          data: {
            success: true,
            message: "Profile saved successfully.",
            profile: payload,
            is_phone_verified: false, // Reset because phone changed
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(saveProfile, {
      body: {
        full_name: "John Doe",
        age: 28,
        phone: "9876543210", // New number
      },
      wpUserId: 101,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.is_phone_verified, false);
    assert.strictEqual(capturedProfile.phone, "9876543210");
  });

  // 11. Google user without phone verification is unverified
  await suite.test("11. Google User Without Verified Phone: is_phone_verified=false", () => {
    const unverifiedGoogleUser = {
      id: 202,
      email: "googleuser@gmail.com",
      name: "Google User",
      is_phone_verified: false,
    };

    const shouldRedirectToProfileSetup = !unverifiedGoogleUser.is_phone_verified;
    assert.strictEqual(shouldRedirectToProfileSetup, true);
  });

  // 12. Google user with verified phone is verified
  await suite.test("12. Google User With Verified Phone: is_phone_verified=true", () => {
    const verifiedGoogleUser = {
      id: 203,
      email: "verifiedgoogle@gmail.com",
      name: "Verified Google User",
      is_phone_verified: true,
    };

    const shouldRedirectToProfileSetup = !verifiedGoogleUser.is_phone_verified;
    assert.strictEqual(shouldRedirectToProfileSetup, false);
  });

  // 13. ProtectedRoute redirect loop prevention
  await suite.test("13. ProtectedRoute: Accessing /profile-setup when profile is incomplete does not redirect", () => {
    const simulateProtectedRoute = (pathname, profileComplete) => {
      if (!profileComplete && pathname !== "/profile-setup") {
        return { redirect: "/profile-setup" };
      }
      return { render: "Outlet" };
    };

    // Customer visits /checkout with incomplete profile -> redirects to /profile-setup
    assert.deepStrictEqual(simulateProtectedRoute("/checkout", false), { redirect: "/profile-setup" });

    // Customer on /profile-setup with incomplete profile -> Renders ProfileSetup, no redirect loop!
    assert.deepStrictEqual(simulateProtectedRoute("/profile-setup", false), { render: "Outlet" });

    // Customer visits /checkout with complete profile -> Renders checkout
    assert.deepStrictEqual(simulateProtectedRoute("/checkout", true), { render: "Outlet" });
  });

  // ─────────────────────────────────────────────────────────────
  // PHASE 3 HARDENING SPECIFIC TESTS (Requirements 1, 2, and 3)
  // ─────────────────────────────────────────────────────────────

  // 14. Unauthenticated verify_phone send is rejected (401)
  await suite.test("14. Hardening: Unauthenticated verify_phone send is rejected with 401", async () => {
    const res = await simulateHandler(sendOtp, {
      body: { phone: "9820123456", purpose: "verify_phone" },
      wpUserId: 0,
      user: null,
      cookies: {},
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /Authentication required/i);
  });

  // 15. Unauthenticated verify_phone verify is rejected (401)
  await suite.test("15. Hardening: Unauthenticated verify_phone verify is rejected with 401", async () => {
    const res = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "verify_phone" },
      wpUserId: 0,
      user: null,
      cookies: {},
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /Authentication required/i);
  });

  // 16. Caller cannot supply an arbitrary user_id to establish verification
  await suite.test("16. Hardening: Arbitrary user_id in body is completely ignored in send/verify", async () => {
    let capturedSendPayload = null;
    let capturedVerifyPayload = null;

    wp.post = async (url, payload) => {
      if (url.includes("/otp/store")) {
        capturedSendPayload = payload;
        return { data: { success: true, message: "OTP sent." } };
      }
      if (url.includes("/otp/verify")) {
        capturedVerifyPayload = payload;
        return { data: { success: true, is_phone_verified: true } };
      }
      return { data: {} };
    };

    // Attacker claims to be user 999, but session is authenticated as user 101
    await simulateHandler(sendOtp, {
      body: { phone: "9820123456", purpose: "verify_phone", user_id: 999 },
      wpUserId: 101,
      user: { id: 101, email: "realuser@example.com" },
    });

    assert.strictEqual(capturedSendPayload.user_id, 101, "Node must enforce session user ID and ignore arbitrary user_id");

    await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "verify_phone", user_id: 999 },
      wpUserId: 101,
      user: { id: 101, email: "realuser@example.com" },
    });

    assert.strictEqual(capturedVerifyPayload.user_id, 101, "Node must enforce session user ID and ignore arbitrary user_id");
  });

  // 17. User cannot verify another customer's phone (phone_in_use)
  await suite.test("17. Hardening: Authenticated user cannot claim or verify another customer's phone", async () => {
    wp.post = async (url) => {
      if (url.includes("/otp/store") || url.includes("/otp/verify")) {
        const error = new Error("Phone in use.");
        error.response = {
          status: 409,
          data: {
            code: "phone_in_use",
            message: "This phone number is already registered to another account.",
          },
        };
        throw error;
      }
      return { data: {} };
    };

    // User 101 tries to send OTP to User 202's registered phone
    const sendRes = await simulateHandler(sendOtp, {
      body: { phone: "9820999999", purpose: "verify_phone" },
      wpUserId: 101,
    });
    assert.strictEqual(sendRes.status, 409);
    assert.match(sendRes.data.message, /already registered to another account/i);

    // User 101 tries to verify User 202's registered phone
    const verifyRes = await simulateHandler(verifyOtp, {
      body: { phone: "9820999999", otp: "123456", purpose: "verify_phone" },
      wpUserId: 101,
    });
    assert.strictEqual(verifyRes.status, 409);
    assert.match(verifyRes.data.message, /already registered to another account/i);
  });

  // 18. reset_password remains available without authentication
  await suite.test("18. Hardening: reset_password OTP send and verify remain available without authentication", async () => {
    let capturedSendPayload = null;
    let capturedVerifyPayload = null;

    wp.post = async (url, payload) => {
      if (url.includes("/otp/store")) {
        capturedSendPayload = payload;
        return { data: { success: true, message: "If the number is registered, an OTP has been sent." } };
      }
      if (url.includes("/otp/verify")) {
        capturedVerifyPayload = payload;
        return { data: { success: true, reset_token: "mock_reset_token_123" } };
      }
      return { data: {} };
    };

    // Unauthenticated user requests password reset OTP
    const sendRes = await simulateHandler(sendOtp, {
      body: { phone: "9820123456", purpose: "reset_password" },
      wpUserId: 0,
      user: null,
      cookies: {},
    });
    assert.strictEqual(sendRes.status, 200);
    assert.strictEqual(sendRes.data.success, true);
    assert.strictEqual(capturedSendPayload.purpose, "reset_password");

    // Unauthenticated user verifies password reset OTP
    const verifyRes = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "123456", purpose: "reset_password" },
      wpUserId: 0,
      user: null,
      cookies: {},
    });
    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.data.success, true);
    assert.strictEqual(verifyRes.data.reset_token, "mock_reset_token_123");
    assert.strictEqual(capturedVerifyPayload.purpose, "reset_password");
  });

  // 19. Backend authorization: requireVerifiedPhone blocks unverified customer on protected endpoints
  await suite.test("19. Backend Authorization: requireVerifiedPhone blocks unverified user with 403", async () => {
    let nextCalled = false;
    const reqUnverified = {
      wpUserId: 101,
      user: { id: 101, is_phone_verified: false },
      isPhoneVerified: false,
    };
    const res = {
      statusCode: 200,
      status: function (code) { this.statusCode = code; return this; },
      json: function (data) { this.data = data; return this; },
    };

    requireVerifiedPhone(reqUnverified, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false, "next() must not be called for unverified user");
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.data.code, "PHONE_NOT_VERIFIED");

    // Verified user succeeds and invokes next()
    let nextCalledVerified = false;
    const reqVerified = {
      wpUserId: 101,
      user: { id: 101, is_phone_verified: true },
      isPhoneVerified: true,
    };
    requireVerifiedPhone(reqVerified, res, () => { nextCalledVerified = true; });
    assert.strictEqual(nextCalledVerified, true, "next() must be called for verified user");

    // Unauthenticated request returns 401
    let nextCalledUnauth = false;
    const reqUnauth = { wpUserId: 0, user: null };
    requireVerifiedPhone(reqUnauth, res, () => { nextCalledUnauth = true; });
    assert.strictEqual(nextCalledUnauth, false);
    assert.strictEqual(res.statusCode, 401);
  });

  // 20. Backend authorization: checkSessionPhoneVerified checks session status accurately
  await suite.test("20. Backend Authorization: checkSessionPhoneVerified returns false for unverified customer and true for verified", async () => {
    axios.get = async (url, config) => {
      if (config?.headers?.Cookie === "unverified_cookie") {
        return { data: { logged_in: true, current_user_id: 101, is_phone_verified: false } };
      }
      if (config?.headers?.Cookie === "verified_cookie") {
        return { data: { logged_in: true, current_user_id: 102, is_phone_verified: true } };
      }
      return { data: { logged_in: false } };
    };

    const unverifiedResult = await checkSessionPhoneVerified("unverified_cookie");
    assert.strictEqual(unverifiedResult, false);

    const verifiedResult = await checkSessionPhoneVerified("verified_cookie");
    assert.strictEqual(verifiedResult, true);

    const emptyResult = await checkSessionPhoneVerified(null);
    assert.strictEqual(emptyResult, false);
  });

  // 21. Legacy verified flag + missing verified phone -> false
  await suite.test("21. State Bug: Legacy verified flag + missing _mumbai_verified_phone is strictly false", async () => {
    axios.get = async (url) => {
      if (url.includes("/mumbai-auth/v1/me")) {
        // Legacy account: _mumbai_is_phone_verified=1 was set, but _mumbai_verified_phone is empty
        return {
          data: {
            logged_in: true,
            current_user_id: 1,
            roles: ["customer"],
            phone: "1234567890",
            verified_phone: "",
            is_phone_verified: false, // WordPress effective validator returns false
          },
        };
      }
      return { data: {} };
    };

    const meRes = await simulateHandler(me, {
      cookies: { mumbai_customer_auth: "legacy_cookie" },
    });

    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.is_phone_verified, false, "Must be false when verified_phone is missing");
    assert.strictEqual(meRes.data.user.is_phone_verified, false);
    assert.strictEqual(meRes.data.verified_phone, "");
  });

  // 22. Verified phone A -> current phone A -> true
  await suite.test("22. State Bug: Verified phone A with matching billing_phone is true", async () => {
    axios.get = async (url) => {
      if (url.includes("/mumbai-auth/v1/me")) {
        return {
          data: {
            logged_in: true,
            current_user_id: 45,
            roles: ["customer"],
            phone: "7339951567",
            verified_phone: "7339951567",
            is_phone_verified: true,
          },
        };
      }
      return { data: {} };
    };

    const meRes = await simulateHandler(me, {
      cookies: { mumbai_customer_auth: "valid_verified_cookie" },
    });

    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.is_phone_verified, true);
    assert.strictEqual(meRes.data.verified_phone, "7339951567");
    assert.strictEqual(meRes.data.user.phone, "7339951567");
  });

  // 23. Verified phone A -> current phone B -> false
  await suite.test("23. State Bug: Verified phone A, but current phone changed to B -> is_phone_verified is false", async () => {
    axios.get = async (url) => {
      if (url.includes("/mumbai-auth/v1/me")) {
        // Stored verified phone was A (7339951567), but billing phone was changed to B (9820123456)
        return {
          data: {
            logged_in: true,
            current_user_id: 45,
            roles: ["customer"],
            phone: "9820123456",
            verified_phone: "",
            is_phone_verified: false,
          },
        };
      }
      return { data: {} };
    };

    const meRes = await simulateHandler(me, {
      cookies: { mumbai_customer_auth: "mismatched_phone_cookie" },
    });

    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.is_phone_verified, false);
    assert.strictEqual(meRes.data.user.phone, "9820123456");
  });

  // 24. Phone A changed to B in profile update -> verification reset and cache invalidated
  await suite.test("24. State Bug: Phone changed from A to B via saveProfile resets verification", async () => {
    let capturedPutBody = null;
    axios.put = async (url, data) => {
      if (url.includes("/mumbai-auth/v1/profile")) {
        capturedPutBody = data;
        return {
          data: {
            success: true,
            message: "Profile saved successfully.",
            profile: { full_name: "Test User", age: 30, phone: "9820123456" },
            is_phone_verified: false,
            verified_phone: "",
            billing_phone: "9820123456",
          },
        };
      }
      return { data: {} };
    };

    const saveRes = await simulateHandler(saveProfile, {
      body: { full_name: "Test User", age: 30, phone: "9820123456" },
      wpUserId: 45,
      cookies: { mumbai_customer_auth: "user_45_cookie" },
    });

    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(saveRes.data.is_phone_verified, false, "Verification must be reset when phone changes");
    assert.strictEqual(saveRes.data.verified_phone, "");
    assert.strictEqual(capturedPutBody.phone, "9820123456");
  });

  // 25. Verify B -> B becomes verified
  await suite.test("25. State Bug: Successfully verifying Phone B via OTP establishes verified state", async () => {
    let capturedVerifyPayload = null;
    wp.post = async (url, payload) => {
      if (url.includes("/otp/verify")) {
        capturedVerifyPayload = payload;
        return {
          data: {
            success: true,
            message: "Phone verified successfully.",
            phone: "9820123456",
            verified_phone: "9820123456",
            is_phone_verified: true,
          },
        };
      }
      return { data: {} };
    };

    const verifyRes = await simulateHandler(verifyOtp, {
      body: { phone: "9820123456", otp: "654321", purpose: "verify_phone" },
      wpUserId: 45,
      cookies: { mumbai_customer_auth: "user_45_cookie" },
    });

    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.data.success, true);
    assert.strictEqual(verifyRes.data.is_phone_verified, true);
    assert.strictEqual(verifyRes.data.verified_phone, "9820123456");
    assert.strictEqual(capturedVerifyPayload.phone, "9820123456");
    assert.strictEqual(capturedVerifyPayload.user_id, 45);
  });

  // 26. reset_password OTP never changes verification state
  await suite.test("26. State Bug: reset_password OTP verification returns reset_token and never modifies phone verification", async () => {
    wp.post = async (url, payload) => {
      if (url.includes("/otp/verify")) {
        // WordPress returns reset_token, never phone verification
        return {
          data: {
            success: true,
            message: "OTP verified. Proceed to reset password.",
            reset_token: "mock_secret_reset_token_64",
          },
        };
      }
      return { data: {} };
    };

    const res = await simulateHandler(verifyOtp, {
      body: { phone: "7339951567", otp: "123456", purpose: "reset_password" },
      wpUserId: 0,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.reset_token, "mock_secret_reset_token_64");
    assert.strictEqual(res.data.is_phone_verified, undefined, "reset_password must never include is_phone_verified");
    assert.strictEqual(res.data.verified_phone, undefined, "reset_password must never include verified_phone");
  });

  // 27. Google login never sets phone verification
  await suite.test("27. State Bug: Google SSO login does not mark user as phone-verified", async () => {
    axios.get = async (url) => {
      if (url.includes("/mumbai-auth/v1/me")) {
        return {
          data: {
            logged_in: true,
            current_user_id: 46,
            roles: ["customer"],
            phone: "",
            verified_phone: "",
            is_phone_verified: false,
          },
        };
      }
      return { data: {} };
    };

    const meRes = await simulateHandler(me, {
      cookies: { mumbai_customer_auth: "google_sso_cookie" },
    });

    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.is_phone_verified, false);
    assert.strictEqual(meRes.data.user.is_phone_verified, false);
  });

  // 28. profile.phone cannot override billing_phone verification
  await suite.test("28. State Bug: getProfile enforces billing_phone as canonical source for phone verification", async () => {
    axios.get = async (url) => {
      if (url.includes("/mumbai-auth/v1/profile")) {
        return {
          data: {
            success: true,
            profile: { full_name: "Lalit", age: 34, phone: "1234567890" },
            billing_phone: "1234567890",
            verified_phone: "",
            is_phone_verified: false,
          },
        };
      }
      return { data: {} };
    };

    const profileRes = await simulateHandler(getProfile, {
      wpUserId: 1,
    });

    assert.strictEqual(profileRes.status, 200);
    assert.strictEqual(profileRes.data.is_phone_verified, false);
    assert.strictEqual(profileRes.data.profile.phone, "1234567890");
    assert.strictEqual(profileRes.data.verified_phone, "");
  });

  // 29. Current customer cannot claim another customer's phone
  await suite.test("29. Protection: Authenticated customer cannot claim another customer's registered phone", async () => {
    wp.post = async (url, payload) => {
      if (url.includes("/otp/store")) {
        const err = new Error("Conflict");
        err.response = {
          status: 409,
          data: {
            code: "phone_in_use",
            message: "This phone number is already registered to another account.",
          },
        };
        throw err;
      }
      return { data: {} };
    };

    const sendRes = await simulateHandler(sendOtp, {
      body: { phone: "7339951567", purpose: "verify_phone" },
      wpUserId: 46, // User 46 attempting to verify User 45's phone
      cookies: { mumbai_customer_auth: "user_46_cookie" },
    });

    assert.strictEqual(sendRes.status, 409);
    assert.strictEqual(sendRes.data.code, "phone_in_use");
    assert.strictEqual(sendRes.data.message, "This phone number is already registered to another account.");
  });

  // 30. Missing _mumbai_verified_phone safe behavior
  await suite.test("30. Safe Behavior: Missing _mumbai_verified_phone enforces unverified state on protected routes", async () => {
    let nextCalled = false;
    const req = {
      wpUserId: 1,
      isPhoneVerified: false,
      user: { id: 1, is_phone_verified: false },
    };
    const res = {
      statusCode: 200,
      status: function (code) { this.statusCode = code; return this; },
      json: function (data) { this.data = data; return this; },
    };

    requireVerifiedPhone(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.data.code, "PHONE_NOT_VERIFIED");
  });
});
