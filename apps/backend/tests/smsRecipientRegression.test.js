import test from "node:test";
import assert from "node:assert";
import axios from "axios";
import wp from "../src/services/wordpress.js";
import {
  normalizePhoneNumber,
} from "../src/services/brevoService.js";
import { sendOtp } from "../src/controllers/authController.js";

test("Destination & Recipient Integrity Regression Suite", async (suite) => {
  const originalEnv = { ...process.env };
  const originalAxiosPost = axios.post;
  const originalWpPost = wp.post;

  suite.afterEach(() => {
    process.env = { ...originalEnv };
    axios.post = originalAxiosPost;
    wp.post = originalWpPost;
  });

  const simulateSendOtp = async (body, { wpUserId = 0, user = null, cookies = {} } = {}) => {
    return new Promise((resolve) => {
      const req = {
        body,
        headers: { "x-mumbai-panel": "customer" },
        cookies,
        wpUserId,
        user,
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

  // 1. Input 7339951567 → Brevo recipient +917339951567
  await suite.test("1. Input 7339951567 → Normalized to +917339951567", () => {
    const norm = normalizePhoneNumber("7339951567");
    assert.strictEqual(norm?.local, "7339951567");
    assert.strictEqual(norm?.e164, "+917339951567");
  });

  // 2. Input +917339951567 → same recipient
  await suite.test("2. Input +917339951567 → Normalized to +917339951567", () => {
    const norm = normalizePhoneNumber("+917339951567");
    assert.strictEqual(norm?.local, "7339951567");
    assert.strictEqual(norm?.e164, "+917339951567");
  });

  // 3. Input 9197339951567 → same recipient
  await suite.test("3. Input 9197339951567 → Normalized to +917339951567", () => {
    const norm = normalizePhoneNumber("9197339951567");
    assert.strictEqual(norm?.local, "7339951567");
    assert.strictEqual(norm?.e164, "+917339951567");
  });

  // 4. Input 07339951567 → same recipient
  await suite.test("4. Input 07339951567 → Normalized to +917339951567", () => {
    const norm = normalizePhoneNumber("07339951567");
    assert.strictEqual(norm?.local, "7339951567");
    assert.strictEqual(norm?.e164, "+917339951567");
  });

  // 5. No valid input can become 919820123456
  await suite.test("5. Input 7339951567 can NEVER become 9820123456 or +919820123456", () => {
    const norm = normalizePhoneNumber("7339951567");
    assert.notStrictEqual(norm?.local, "9820123456");
    assert.notStrictEqual(norm?.e164, "+919820123456");
    assert.strictEqual(norm?.local, "7339951567");
  });

  // 6. No default/test phone is ever used
  await suite.test("6. No default or fallback phone overrides the customer's phone", () => {
    const norm = normalizePhoneNumber("7339951567");
    assert.strictEqual(norm?.e164, "+917339951567");
    assert.notStrictEqual(norm?.e164, "+919820123456");
  });

  // 7. Brevo receives the customer's registered email
  await suite.test("7. Brevo API payload receives exactly the customer's registered account email", async () => {
    process.env.MOCK_EMAIL = "false";
    process.env.BREVO_API_KEY = "test_key";
    process.env.BREVO_EMAIL_SENDER_EMAIL = "noreply@mumbaicollection.in";

    let capturedPayload = null;
    axios.post = async (url, body) => {
      capturedPayload = body;
      return { status: 201, data: { messageId: "msg_reg_2" } };
    };

    wp.post = async (url, body) => {
      return {
        data: {
          success: true,
          message: "If the account is registered, an OTP has been sent.",
          user_found: true,
          email: "customer733@example.com",
        },
      };
    };

    const result = await simulateSendOtp({
      phone: "7339951567",
      purpose: "reset_password",
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(capturedPayload.to[0].email, "customer733@example.com");
  });

  // 8. Unknown phone remains anti-enumerated
  await suite.test("8. Unknown phone number returns 200 without dispatching Email", async () => {
    let dispatched = false;
    axios.post = async () => {
      dispatched = true;
      return { status: 201, data: {} };
    };

    wp.post = async () => {
      return {
        data: {
          success: true,
          message: "If the number is registered, an OTP has been sent.",
          user_found: false,
        },
      };
    };

    const result = await simulateSendOtp({
      phone: "9123456780",
      purpose: "reset_password",
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.success, true);
    assert.strictEqual(dispatched, false, "Message must not be dispatched for unregistered account");
  });

  // 9. Existing registered phone lookup still works and dispatches to registered email
  await suite.test("9. Registered customer lookup dispatches OTP to that customer's registered email", async () => {
    let capturedWpPayload = null;
    let capturedBrevoRecipient = null;

    wp.post = async (url, body) => {
      capturedWpPayload = body;
      return {
        data: {
          success: true,
          user_found: true,
          email: "customer733@example.com",
          message: "OTP sent.",
        },
      };
    };

    axios.post = async (url, body) => {
      capturedBrevoRecipient = body?.to?.[0]?.email;
      return { status: 201, data: { messageId: "msg_reg_3" } };
    };

    process.env.MOCK_EMAIL = "false";
    process.env.BREVO_API_KEY = "test_key";
    process.env.BREVO_EMAIL_SENDER_EMAIL = "noreply@mumbaicollection.in";

    const result = await simulateSendOtp({
      phone: "7339951567",
      purpose: "reset_password",
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(capturedWpPayload.phone, "7339951567");
    assert.strictEqual(capturedBrevoRecipient, "customer733@example.com");
  });

  // 10. verify_phone behavior dispatches to customer's registered email
  await suite.test("10. verify_phone requires authenticated session and sends to customer's registered email", async () => {
    let capturedBrevoRecipient = null;
    axios.post = async (url, body) => {
      capturedBrevoRecipient = body?.to?.[0]?.email;
      return { status: 201, data: { messageId: "msg_reg_4" } };
    };

    wp.post = async () => {
      return { data: { success: true } };
    };

    process.env.MOCK_EMAIL = "false";
    process.env.BREVO_API_KEY = "test_key";
    process.env.BREVO_EMAIL_SENDER_EMAIL = "noreply@mumbaicollection.in";

    // Unauthenticated verify_phone must fail with 401
    const unauthRes = await simulateSendOtp({
      phone: "7339951567",
      purpose: "verify_phone",
    });
    assert.strictEqual(unauthRes.status, 401);

    // Authenticated verify_phone succeeds and dispatches to customer's registered email
    const authRes = await simulateSendOtp(
      { phone: "7339951567", purpose: "verify_phone" },
      { wpUserId: 45, user: { id: 45, email: "user45@example.com" } }
    );
    assert.strictEqual(authRes.status, 200);
    assert.strictEqual(capturedBrevoRecipient, "user45@example.com");
  });
});
