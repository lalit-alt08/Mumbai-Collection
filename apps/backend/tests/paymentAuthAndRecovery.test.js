import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "crypto";

process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
process.env.CUSTOMER_ORIGIN = "http://localhost:5173";

const { default: app } = await import("../src/app.js");
const { default: api } = await import("../src/config/woocommerce.js");
const { default: paymentIntentService } = await import("../src/services/paymentIntentService.js");
const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
const { serverCache } = await import("../src/utils/memoryCache.js");
const { _setAnomalyHandlerForTesting } = await import("../src/services/alertService.js");
const { _setSessionCacheForTesting } = await import("../src/middlewares/authMiddleware.js");

const generateHmacSignature = (orderId, paymentId) => {
  return crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
};

test("Payment Auth, Verify, and Recovery Security Suite (Through Real Express Router)", async (t) => {
  let server;
  let baseUrl;
  let wcOrdersCreated = 0;
  let createdOrderPayloads = [];

  const originalApiPost = api.post;
  const originalApiGet = api.get;
  const originalAcquireLock = paymentIntentService.acquireLock;
  const originalReleaseLock = paymentIntentService.releaseLock;
  const originalClearCart = paymentIntentService.clearCustomerWcCart;

  t.before(async () => {
    _setAnomalyHandlerForTesting(() => {});
    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.clearCustomerWcCart = async () => true;

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  t.after(async () => {
    api.post = originalApiPost;
    api.get = originalApiGet;
    paymentIntentService.acquireLock = originalAcquireLock;
    paymentIntentService.releaseLock = originalReleaseLock;
    paymentIntentService.clearCustomerWcCart = originalClearCart;
    _setRazorpayInstanceForTesting(null);
    _setAnomalyHandlerForTesting(null);
    await new Promise((resolve) => server.close(resolve));
  });

  t.beforeEach(() => {
    serverCache.clear();
    wcOrdersCreated = 0;
    createdOrderPayloads = [];

    api.post = async (path, body) => {
      if (path === "orders") {
        wcOrdersCreated++;
        createdOrderPayloads.push(body);
        return {
          data: {
            id: 7001,
            number: "7001",
            status: "processing",
            line_items: body.line_items || [],
          },
        };
      }
      return { data: {} };
    };

    api.get = async (path) => {
      return { data: [] };
    };
  });

  // 1. /check-status requires a session (401 when no session)
  await t.test("1a. POST /api/payments/check-status rejects with 401 when unauthenticated", async () => {
    const res = await fetch(`${baseUrl}/api/payments/check-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        razorpay_order_id: "order_mock_test_101",
      }),
    });

    assert.equal(res.status, 401, "Expected 401 Unauthorized when unauthenticated");
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, "Authentication required.");
  });

  await t.test("1b. POST /api/payments/check-status succeeds when valid customer session cookie is present", async () => {
    const testCookie = "valid_customer_session_token_1";
    _setSessionCacheForTesting(testCookie, {
      userId: 101,
      roles: ["customer"],
      email: "testuser@example.com",
      isPhoneVerified: true,
      timestamp: Date.now(),
    });

    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async () => ({ items: [] }),
      },
      payments: {
        fetch: async () => ({ status: "created" }),
      },
    });

    const rzpOrderId = "order_check_status_ok_1";
    serverCache.set(`payment_intent:${rzpOrderId}`, {
      customer_id: 101,
      amount_in_paise: 50000,
      currency: "INR",
      status: "created",
    });

    const res = await fetch(`${baseUrl}/api/payments/check-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `mumbai_customer_auth=${testCookie}`,
      },
      body: JSON.stringify({
        razorpay_order_id: rzpOrderId,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.paid, false);
    assert.equal(body.message, "Payment not completed or still processing.");
  });

  // 2. /verify with wrong signature rejects with 400
  await t.test("2. POST /api/payments/verify rejects with 400 when signature is wrong", async () => {
    const rzpOrderId = "order_mock_sig_test";
    const rzpPaymentId = "pay_mock_sig_test";

    const res = await fetch(`${baseUrl}/api/payments/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: rzpPaymentId,
        razorpay_signature: "bad_signature_forged_hash",
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes("invalid signature"));
    assert.equal(wcOrdersCreated, 0, "No WooCommerce order must be created for invalid signature");
  });

  // 3. Another user's razorpay_order_id with no session: cannot verify without valid signature
  await t.test("3a. Another user's razorpay_order_id with no session fails with 400 when signature cannot be forged", async () => {
    const victimRzpOrderId = "order_victim_101";

    const res = await fetch(`${baseUrl}/api/payments/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        razorpay_order_id: victimRzpOrderId,
        razorpay_payment_id: "pay_attacker_probe",
        razorpay_signature: "wrong_sig_attacker",
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(wcOrdersCreated, 0);
  });

  // 3b. Another user's razorpay_order_id when caller HAS a session for User 202 (cross-user probe)
  await t.test("3b. Caller with User 202 session cannot verify User 101's order intent through router (403 Mismatch)", async () => {
    const victimRzpOrderId = "order_victim_intent_101";
    const paymentId = "pay_mock_victim_101";
    const validSignature = generateHmacSignature(victimRzpOrderId, paymentId);

    // Store intent belonging to victim User 101
    serverCache.set(`payment_intent:${victimRzpOrderId}`, {
      customer_id: 101,
      amount_in_paise: 50000,
      currency: "INR",
      status: "created",
      cart_fingerprint: "cart_fp_101",
      checkout_payload: {
        customer_id: 101,
        billing: { first_name: "Victim", email: "victim@example.com" },
      },
    });

    // Mock Razorpay gateway returning payment for victim order
    _setRazorpayInstanceForTesting({
      payments: {
        fetch: async () => ({
          id: paymentId,
          order_id: victimRzpOrderId,
          status: "captured",
          currency: "INR",
          amount: 50000,
        }),
      },
    });

    // Caller presents session for User 202
    const attackerCookie = "session_token_user_202";
    _setSessionCacheForTesting(attackerCookie, {
      userId: 202,
      roles: ["customer"],
      email: "user202@example.com",
      isPhoneVerified: true,
      timestamp: Date.now(),
    });

    const res = await fetch(`${baseUrl}/api/payments/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `mumbai_customer_auth=${attackerCookie}`,
      },
      body: JSON.stringify({
        razorpay_order_id: victimRzpOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature,
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, "You are not authorized to verify this payment.");
    assert.equal(wcOrdersCreated, 0);
  });

  // 4. Expired session mid-payment: unauthenticated verify with valid signature succeeds, DB provides owner and amount
  await t.test("4. Expired session mid-payment allows /verify with valid signature; owner & amount come from DB; minimal response", async () => {
    const rzpOrderId = "order_session_expired_101";
    const paymentId = "pay_session_expired_101";
    const validSignature = generateHmacSignature(rzpOrderId, paymentId);

    // Store intent in DB belonging to Customer 555
    serverCache.set(`payment_intent:${rzpOrderId}`, {
      customer_id: 555,
      amount_in_paise: 75000,
      currency: "INR",
      status: "created",
      cart_fingerprint: "cart_fp_555",
      checkout_payload: {
        customer_id: 555,
        billing: { first_name: "Pooja", last_name: "Patel", email: "pooja@example.com" },
        shipping: { first_name: "Pooja", last_name: "Patel" },
        line_items: [{ product_id: 42, quantity: 2, total: "750.00" }],
      },
    });

    // Mock Razorpay gateway returning payment details
    _setRazorpayInstanceForTesting({
      payments: {
        fetch: async () => ({
          id: paymentId,
          order_id: rzpOrderId,
          status: "captured",
          currency: "INR",
          amount: 75000,
        }),
      },
    });

    // Call /api/payments/verify with NO session cookies (session expired during OTP entry)
    const res = await fetch(`${baseUrl}/api/payments/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature,
      }),
    });

    assert.equal(res.status, 200, `Expected status 200, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.order_id, 7001);
    assert.equal(body.order_number, "7001");
    assert.equal(body.orderStatus, "processing");

    // Verify response is minimal (no sensitive customer or intent fields returned)
    assert.equal(body.customer_id, undefined);
    assert.equal(body.billing, undefined);

    // Verify exactly 1 order created in WooCommerce
    assert.equal(wcOrdersCreated, 1);
    // Verify owner and line items came strictly from DB intent, never client request
    assert.equal(createdOrderPayloads[0].customer_id, 555);
    assert.equal(createdOrderPayloads[0].billing.email, "pooja@example.com");

    // 5. Replayed valid signature: idempotent, no second order
    const replayRes = await fetch(`${baseUrl}/api/payments/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature,
      }),
    });

    assert.equal(replayRes.status, 200);
    const replayBody = await replayRes.json();
    assert.equal(replayBody.success, true);
    assert.equal(replayBody.order_id, 7001);
    assert.equal(String(replayBody.order_number), "7001");
    assert.equal(replayBody._idempotent, true);

    // Crucial check: wcOrdersCreated must still be exactly 1!
    assert.equal(wcOrdersCreated, 1, "Replaying valid signature must NOT create a second order!");
  });
});
