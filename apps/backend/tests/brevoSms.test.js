import test from "node:test";
import assert from "node:assert";
import axios from "axios";
import wp from "../src/services/wordpress.js";
import {
  sendOtpSms,
  normalizePhoneNumber,
  formatOtpMessage,
  isMockSmsEnabled,
  getBrevoApiKey,
  getBrevoSender,
  BREVO_TRANSACTIONAL_SMS_URL,
} from "../src/services/brevoService.js";
import { sendOtp } from "../src/controllers/authController.js";

test("Brevo SMS Integration Test Suite", async (suite) => {
  const originalEnv = { ...process.env };
  const originalAxiosPost = axios.post;
  const originalWpPost = wp.post;

  suite.afterEach(() => {
    process.env = { ...originalEnv };
    axios.post = originalAxiosPost;
    wp.post = originalWpPost;
  });

  // Helper to simulate express request/response for sendOtp controller
  const simulateSendOtpRequest = async (body, headers = {}) => {
    return new Promise((resolve) => {
      const wpUserId = body?.user_id || 1;
      const req = {
        body,
        headers: { ...headers, "x-mumbai-panel": "customer" },
        cookies: {},
        wpUserId,
        user: { id: wpUserId, email: "customer@example.com" },
      };

      const res = {
        statusCode: 200,
        status: function (code) {
          this.statusCode = code;
          return this;
        },
        json: function (data) {
          resolve({ status: this.statusCode || 200, data });
        },
      };

      sendOtp(req, res).catch((err) => {
        resolve({ status: 500, data: { message: err.message } });
      });
    });
  };

  // 1. Phone number normalization tests
  await suite.test("Phone Normalizer: Validates and formats Indian mobile numbers correctly", () => {
    assert.strictEqual(normalizePhoneNumber("9820123456")?.e164, "+919820123456");
    assert.strictEqual(normalizePhoneNumber("+919820123456")?.e164, "+919820123456");
    assert.strictEqual(normalizePhoneNumber("919820123456")?.e164, "+919820123456");
    assert.strictEqual(normalizePhoneNumber("09820123456")?.e164, "+919820123456");
    assert.strictEqual(normalizePhoneNumber("+91 98201-23456")?.e164, "+919820123456");

    // Invalid numbers: too short, bad starting digit, non-digit junk
    assert.strictEqual(normalizePhoneNumber("12345"), null);
    assert.strictEqual(normalizePhoneNumber("5820123456"), null); // Must start with 6-9
    assert.strictEqual(normalizePhoneNumber("abcdefghij"), null);
    assert.strictEqual(normalizePhoneNumber(null), null);
  });

  // 2. Centralized OTP message format
  await suite.test("Message Formatter: Uses centralized OTP template without hardcoded OTP", () => {
    const msg = formatOtpMessage("482910");
    assert.strictEqual(
      msg,
      "Mumbai Collection: Your verification code is 482910. It expires in 5 minutes."
    );
  });

  // 3. MOCK_SMS=true successful send
  await suite.test("MOCK_SMS=true: Successfully returns simulated response without calling Brevo API", async () => {
    process.env.MOCK_SMS = "true";
    process.env.NODE_ENV = "development";

    let networkCalled = false;
    axios.post = async () => {
      networkCalled = true;
      return { status: 200, data: {} };
    };

    const result = await sendOtpSms({
      phone: "9820123456",
      otp: "654321",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.mock, true);
    assert.strictEqual(networkCalled, false, "Should not call Brevo API when mock mode is active");
  });

  // 4. MOCK_SMS=false successful Brevo request using mocked HTTP response
  await suite.test("MOCK_SMS=false: Dispatches real request to Brevo API with valid payload and headers", async () => {
    process.env.MOCK_SMS = "false";
    process.env.NODE_ENV = "development";
    process.env.BREVO_API_KEY = "test_brevo_secret_key_123";
    process.env.BREVO_SMS_SENDER = "mumbaicoll";

    let capturedUrl = "";
    let capturedBody = null;
    let capturedHeaders = null;

    axios.post = async (url, body, config) => {
      capturedUrl = url;
      capturedBody = body;
      capturedHeaders = config?.headers;
      return {
        status: 201,
        data: {
          reference: "ref_123",
          messageId: "brevo_msg_98765",
        },
      };
    };

    const result = await sendOtpSms({
      phone: "9820123456",
      otp: "123456",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.messageId, "brevo_msg_98765");
    assert.strictEqual(capturedUrl, BREVO_TRANSACTIONAL_SMS_URL);
    assert.strictEqual(capturedBody.sender, "mumbaicoll");
    assert.strictEqual(capturedBody.recipient, "+919820123456");
    assert.strictEqual(
      capturedBody.content,
      "Mumbai Collection: Your verification code is 123456. It expires in 5 minutes."
    );
    assert.strictEqual(capturedBody.type, "transactional");
    assert.strictEqual(capturedHeaders["api-key"], "test_brevo_secret_key_123");
  });

  // 5. Brevo 4xx failure
  await suite.test("Brevo 4xx Failure: Rejects cleanly when Brevo returns 400 client error", async () => {
    process.env.MOCK_SMS = "false";
    process.env.BREVO_API_KEY = "test_key";
    process.env.BREVO_SMS_SENDER = "mumbaicoll";

    axios.post = async () => {
      const error = new Error("Invalid sender ID");
      error.response = {
        status: 400,
        data: { code: "invalid_parameter", message: "Invalid sender ID provided" },
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await sendOtpSms({ phone: "9820123456", otp: "123456" });
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.ok(err.isBrevoError);
        return true;
      }
    );
  });

  // 6. Brevo 5xx failure
  await suite.test("Brevo 5xx Failure: Rejects cleanly when Brevo returns 500 server error", async () => {
    process.env.MOCK_SMS = "false";
    process.env.BREVO_API_KEY = "test_key";
    process.env.BREVO_SMS_SENDER = "mumbaicoll";

    axios.post = async () => {
      const error = new Error("Brevo internal server error");
      error.response = {
        status: 500,
        data: { code: "server_error", message: "Service temporarily unavailable" },
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await sendOtpSms({ phone: "9820123456", otp: "123456" });
      },
      (err) => {
        assert.strictEqual(err.status, 500);
        return true;
      }
    );
  });

  // 7. Timeout / Network failure
  await suite.test("Timeout / Network Failure: Handles network aborts and connection resets cleanly", async () => {
    process.env.MOCK_SMS = "false";
    process.env.BREVO_API_KEY = "test_key";
    process.env.BREVO_SMS_SENDER = "mumbaicoll";

    axios.post = async () => {
      const error = new Error("timeout of 10000ms exceeded");
      error.code = "ECONNABORTED";
      throw error;
    };

    await assert.rejects(
      async () => {
        await sendOtpSms({ phone: "9820123456", otp: "123456" });
      },
      (err) => {
        assert.ok(err.message.includes("timeout"));
        return true;
      }
    );
  });

  // 8. API key missing
  await suite.test("Configuration: Throws error when BREVO_API_KEY is missing", async () => {
    process.env.MOCK_SMS = "false";
    delete process.env.BREVO_API_KEY;

    await assert.rejects(
      async () => {
        await sendOtpSms({ phone: "9820123456", otp: "123456" });
      },
      (err) => {
        assert.ok(err.message.includes("BREVO_API_KEY is missing"));
        return true;
      }
    );
  });

  // 9. Sender configuration missing
  await suite.test("Configuration: Throws error when BREVO_SMS_SENDER is empty or whitespace", async () => {
    process.env.MOCK_SMS = "false";
    process.env.BREVO_API_KEY = "test_key";
    process.env.BREVO_SMS_SENDER = "   ";

    await assert.rejects(
      async () => {
        await sendOtpSms({ phone: "9820123456", otp: "123456" });
      },
      (err) => {
        assert.ok(err.message.includes("Brevo SMS sender configuration is missing"));
        return true;
      }
    );
  });

  // 10. Production safeguard: MOCK_SMS is never allowed in production
  await suite.test("Production Safeguard: MOCK_SMS is strictly ignored when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.MOCK_SMS = "true";

    assert.strictEqual(isMockSmsEnabled(), false, "Mock SMS must be false in production");
  });

  // 11. Controller Integration: OTP invalidation after SMS failure
  await suite.test("Controller: Invalidates stored OTP in WordPress if Brevo SMS fails", async () => {
    process.env.MOCK_SMS = "false";
    process.env.BREVO_API_KEY = "test_key";
    process.env.BREVO_SMS_SENDER = "mumbaicoll";

    let storedCalled = false;
    let invalidatedCalled = false;
    let invalidatedPayload = null;

    wp.post = async (path, body) => {
      if (path === "/wp-json/mumbai-auth/v1/otp/store") {
        storedCalled = true;
        return { data: { success: true, message: "OTP stored successfully." } };
      }
      if (path === "/wp-json/mumbai-auth/v1/otp/invalidate") {
        invalidatedCalled = true;
        invalidatedPayload = body;
        return { data: { success: true } };
      }
      return { data: { success: true } };
    };

    // Simulate Brevo network timeout
    axios.post = async () => {
      throw new Error("Brevo network failure");
    };

    const response = await simulateSendOtpRequest({
      phone: "9820123456",
      purpose: "verify_phone",
      user_id: 1,
    });

    assert.strictEqual(storedCalled, true, "Should have stored OTP in WordPress first");
    assert.strictEqual(invalidatedCalled, true, "Must have called invalidate on WordPress after SMS failure");
    assert.strictEqual(invalidatedPayload.phone, "9820123456");
    assert.strictEqual(invalidatedPayload.purpose, "verify_phone");
    assert.strictEqual(response.status, 500);
    assert.strictEqual(
      response.data.message,
      "Unable to send verification code. Please try again."
    );
  });

  // 12. Security & Anti-Enumeration: No sensitive data in logs & OTP never returned in API response
  await suite.test("Security: OTP and API Key are never leaked in response or logs", async () => {
    process.env.MOCK_SMS = "true";
    process.env.NODE_ENV = "development";
    process.env.BREVO_API_KEY = "super_secret_production_key_xyz";

    wp.post = async () => {
      return { data: { success: true, message: "If the number is registered, an OTP has been sent." } };
    };

    // Capture logs during execution
    const logs = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
      logs.push(args.join(" "));
      originalConsoleError(...args);
    };

    const response = await simulateSendOtpRequest({
      phone: "9820123456",
      purpose: "reset_password",
    });

    console.error = originalConsoleError;

    assert.strictEqual(response.status, 200);
    const responseString = JSON.stringify(response.data);

    // Response must NEVER contain the OTP code, hashes, or API key
    assert.strictEqual(
      responseString.includes("super_secret_production_key_xyz"),
      false,
      "API key must never be exposed in API response"
    );
    assert.strictEqual(
      response.data.otp,
      undefined,
      "OTP must never be in API response"
    );
    assert.strictEqual(
      response.data.otp_hash,
      undefined,
      "OTP hash must never be in API response"
    );

    // Logs must never leak the API key
    const allLogs = logs.join(" ");
    assert.strictEqual(
      allLogs.includes("super_secret_production_key_xyz"),
      false,
      "API key must never appear in error logs"
    );
  });
});
