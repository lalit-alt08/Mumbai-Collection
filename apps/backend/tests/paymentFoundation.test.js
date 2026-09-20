import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

// Mock env variables before importing modules
process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";

const {
  verifyPaymentSignature,
  getPublicKeyId,
} = await import("../src/services/razorpayService.js");

const { default: api } = await import("../src/config/woocommerce.js");
const { default: storeHoursService } = await import("../src/services/storeHoursService.js");
const {
  createOrder,
  verifyPayment,
  _resetPaymentStoreHoursFallbackForTesting,
} = await import("../src/controllers/paymentController.js");
const { serverCache } = await import("../src/utils/memoryCache.js");

test("Stage 1 — Backend Payment Foundation Test Suite", async (t) => {
  const originalApiGet = api.get;
  const originalApiPost = api.post;
  const originalApiPut = api.put;
  const originalGetStoreStatus = storeHoursService.getStoreStatus;

  t.beforeEach(() => {
    serverCache.clear();
    _resetPaymentStoreHoursFallbackForTesting?.();
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
    process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
    storeHoursService.getStoreStatus = async () => ({ is_open: true });
  });

  t.afterEach(() => {
    api.get = originalApiGet;
    api.post = originalApiPost;
    api.put = originalApiPut;
    storeHoursService.getStoreStatus = originalGetStoreStatus;
    serverCache.clear();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Razorpay Service Helpers
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("1.1. getPublicKeyId returns configured public key", () => {
    assert.equal(getPublicKeyId(), "rzp_test_mock123");
  });

  await t.test("1.2. verifyPaymentSignature validates authentic HMAC SHA256 signature", () => {
    const orderId = "order_mock_001";
    const paymentId = "pay_mock_001";
    const body = `${orderId}|${paymentId}`;
    const validSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    const isValid = verifyPaymentSignature({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: validSignature,
    });

    assert.equal(isValid, true, "Authentic signature must verify as valid");
  });

  await t.test("1.3. verifyPaymentSignature rejects forged or tampered signature", () => {
    const orderId = "order_mock_001";
    const paymentId = "pay_mock_001";
    const forgedSignature = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const isValid = verifyPaymentSignature({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: forgedSignature,
    });

    assert.equal(isValid, false, "Forged signature must be rejected");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. createOrder: Protections and Validations
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("2.1. createOrder blocks suspended customer", async () => {
    const req = {
      wpUserId: 10,
      isSuspended: true,
      body: { billing_address: {}, shipping_address: {} },
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await createOrder(req, res);

    assert.equal(statusCode, 403);
    assert.equal(responseBody?.code, "CUSTOMER_SUSPENDED");
  });

  await t.test("2.2. createOrder blocks when store is closed", async () => {
    storeHoursService.getStoreStatus = async () => ({
      is_open: false,
      message: "Store closed for the night",
    });

    const req = {
      wpUserId: 10,
      isSuspended: false,
      body: { billing_address: {}, shipping_address: {} },
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await createOrder(req, res);

    assert.equal(statusCode, 403);
    assert.equal(responseBody?.code, "STORE_CLOSED");
  });

  await t.test("2.3. createOrder fails closed with 503 when store hours service fails and no valid cache exists", async () => {
    storeHoursService.getStoreStatus = async () => {
      throw new Error("Store hours upstream service timeout");
    };

    const req = {
      wpUserId: 10,
      isSuspended: false,
      body: { billing_address: {}, shipping_address: {} },
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await createOrder(req, res);

    assert.equal(statusCode, 503);
    assert.equal(responseBody?.code, "STORE_HOURS_UNAVAILABLE");
    assert.equal(responseBody?.message, "Unable to verify store operating hours. Please try again in a few moments.");
  });

  await t.test("2.4. createOrder uses safe last-known fallback cache within 5 minutes when service temporarily fails", async () => {
    // 1. Initial successful call caches the status as open
    storeHoursService.getStoreStatus = async () => ({ is_open: true });

    api.get = async (path) => {
      if (path === "orders/501") {
        return {
          data: {
            id: 501,
            customer_id: 10,
            status: "pending",
            total: "500.00",
            meta_data: [{ key: "_razorpay_order_id", value: "order_existing_rzp_999" }],
          },
        };
      }
    };

    const req = {
      wpUserId: 10,
      isSuspended: false,
      body: { order_id: 501 },
    };
    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    // First request warms the fallback cache
    await createOrder(req, res);
    assert.equal(statusCode, 200);
    assert.equal(responseBody?.order_id, 501);

    // 2. Upstream service now throws an error, but fallback cache (< 5 min) allows checkout
    storeHoursService.getStoreStatus = async () => {
      throw new Error("Temporary network glitch");
    };

    statusCode = 200;
    responseBody = null;
    await createOrder(req, res);
    assert.equal(statusCode, 200);
    assert.equal(responseBody?.order_id, 501);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. createOrder: Existing Order Retry and Reuse
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("3.1. createOrder reuses existing _razorpay_order_id if order_id is passed", async () => {
    api.get = async (path) => {
      if (path === "orders/501") {
        return {
          data: {
            id: 501,
            customer_id: 10,
            status: "pending",
            total: "650.00",
            meta_data: [{ key: "_razorpay_order_id", value: "order_existing_rzp_999" }],
          },
        };
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const req = {
      wpUserId: 10,
      isSuspended: false,
      body: { order_id: 501 },
    };
    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await createOrder(req, res);

    assert.equal(statusCode, 200);
    assert.equal(responseBody?.success, true);
    assert.equal(responseBody?.order_id, 501);
    assert.equal(responseBody?.razorpay_order_id, "order_existing_rzp_999");
    assert.equal(responseBody?.amount, 65000); // ₹650 * 100 paise
    assert.equal(responseBody?.currency, "INR");
    assert.equal(responseBody?.key_id, "rzp_test_mock123");
  });

  await t.test("3.2. createOrder rejects retry if customer does not own the order", async () => {
    api.get = async () => ({
      data: {
        id: 502,
        customer_id: 99, // different user
        status: "pending",
        total: "650.00",
      },
    });

    const req = {
      wpUserId: 10,
      isSuspended: false,
      body: { order_id: 502 },
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await createOrder(req, res);

    assert.equal(statusCode, 403);
    assert.match(responseBody?.message, /not authorized/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. verifyPayment: Security & Integrity
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("4.1. verifyPayment returns idempotent success if order is already processing", async () => {
    api.get = async () => ({
      data: {
        id: 503,
        customer_id: 10,
        status: "processing",
        total: "800.00",
      },
    });

    const req = {
      wpUserId: 10,
      body: {
        order_id: 503,
        razorpay_order_id: "order_mock_001",
        razorpay_payment_id: "pay_mock_001",
        razorpay_signature: "any_sig",
      },
    };
    let responseBody = null;
    const res = {
      status() { return this; },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await verifyPayment(req, res);

    assert.equal(responseBody?.success, true);
    assert.equal(responseBody?._idempotent, true);
    assert.equal(responseBody?.status, "processing");
  });

  await t.test("4.2. verifyPayment rejects if signature is invalid", async () => {
    api.get = async () => ({
      data: {
        id: 504,
        customer_id: 10,
        status: "pending",
        total: "800.00",
        meta_data: [{ key: "_razorpay_order_id", value: "order_mock_001" }],
      },
    });

    const req = {
      wpUserId: 10,
      body: {
        order_id: 504,
        razorpay_order_id: "order_mock_001",
        razorpay_payment_id: "pay_mock_001",
        razorpay_signature: "bad_signature_000000000000000000000000000000000000000000000000000000",
      },
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await verifyPayment(req, res);

    assert.equal(statusCode, 400);
    assert.match(responseBody?.message, /invalid signature/i);
  });

  await t.test("4.3. verifyPayment rejects if order customer ID does not match authenticated user", async () => {
    api.get = async () => ({
      data: {
        id: 505,
        customer_id: 77, // different user
        status: "pending",
        total: "800.00",
      },
    });

    const req = {
      wpUserId: 10,
      body: {
        order_id: 505,
        razorpay_order_id: "order_mock_001",
        razorpay_payment_id: "pay_mock_001",
        razorpay_signature: "sig",
      },
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await verifyPayment(req, res);

    assert.equal(statusCode, 403);
    assert.match(responseBody?.message, /not authorized/i);
  });
});
