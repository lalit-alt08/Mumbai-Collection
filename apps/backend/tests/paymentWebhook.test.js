import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
process.env.RAZORPAY_WEBHOOK_SECRET = "mock_webhook_secret_789";

const {
  verifyWebhookSignature,
} = await import("../src/services/razorpayService.js");

const { default: api } = await import("../src/config/woocommerce.js");
const { handleWebhook, reconcileOrder } = await import("../src/controllers/paymentController.js");
const { serverCache } = await import("../src/utils/memoryCache.js");

test("Stage 3 — Razorpay Webhook Reliability & Reconciliation Suite", async (t) => {
  const originalApiGet = api.get;
  const originalApiPut = api.put;

  t.beforeEach(() => {
    serverCache.clear();
    process.env.RAZORPAY_WEBHOOK_SECRET = "mock_webhook_secret_789";
  });

  t.afterEach(() => {
    api.get = originalApiGet;
    api.put = originalApiPut;
    serverCache.clear();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Webhook Signature Verification
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("1.1. verifyWebhookSignature validates authentic HMAC SHA256 signature", () => {
    const payload = JSON.stringify({ event: "order.paid", id: "evt_1" });
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    const isValid = verifyWebhookSignature(payload, signature);
    assert.equal(isValid, true, "Authentic webhook signature must be valid");
  });

  await t.test("1.2. verifyWebhookSignature works with Buffer rawBody", () => {
    const payloadBuf = Buffer.from(JSON.stringify({ event: "order.paid", id: "evt_1" }));
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(payloadBuf)
      .digest("hex");

    const isValid = verifyWebhookSignature(payloadBuf, signature);
    assert.equal(isValid, true, "Buffer rawBody must verify correctly");
  });

  await t.test("1.3. verifyWebhookSignature rejects tampered or forged signature", () => {
    const payload = JSON.stringify({ event: "order.paid", id: "evt_1" });
    const forgedSignature = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    const isValid = verifyWebhookSignature(payload, forgedSignature);
    assert.equal(isValid, false, "Forged signature must be rejected");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. handleWebhook: Security & Authentication Gates
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("2.1. handleWebhook rejects request with missing signature header", async () => {
    const req = {
      headers: {},
      body: { event: "order.paid" },
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(d) { responseBody = d; return this; },
    };

    await handleWebhook(req, res);
    assert.equal(statusCode, 400);
    assert.match(responseBody?.message, /missing signature/i);
  });

  await t.test("2.2. handleWebhook rejects request with invalid signature", async () => {
    const req = {
      headers: { "x-razorpay-signature": "bad_signature" },
      rawBody: Buffer.from(JSON.stringify({ event: "order.paid" })),
      body: { event: "order.paid" },
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(d) { responseBody = d; return this; },
    };

    await handleWebhook(req, res);
    assert.equal(statusCode, 400);
    assert.match(responseBody?.message, /invalid webhook signature/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. handleWebhook: Idempotency & Order Synchronization
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("3.1. handleWebhook: duplicate event delivery returns idempotent 200 without re-processing", async () => {
    const rawBody = JSON.stringify({ event: "payment.captured", id: "evt_dup_1" });
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    // Pre-cache event in serverCache
    serverCache.set("webhook:event:evt_dup_1", true, 60000);

    let apiGetCalled = false;
    api.get = async () => {
      apiGetCalled = true;
      throw new Error("Should not be called");
    };

    const req = {
      headers: {
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": "evt_dup_1",
      },
      rawBody: Buffer.from(rawBody),
      body: JSON.parse(rawBody),
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(d) { responseBody = d; return this; },
    };

    await handleWebhook(req, res);

    assert.equal(statusCode, 200);
    assert.equal(responseBody?._idempotent, true);
    assert.equal(apiGetCalled, false, "WooCommerce API must not be queried for duplicate event");
  });

  await t.test("3.2. handleWebhook: order-level idempotency when order is already processing", async () => {
    const eventPayload = {
      event: "payment.captured",
      id: "evt_unique_101",
      payload: {
        payment: {
          entity: {
            id: "pay_test_101",
            order_id: "order_rzp_101",
            amount: 75000,
            currency: "INR",
            status: "captured",
            notes: { wc_order_id: "601" },
          },
        },
      },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    api.get = async (path) => {
      if (path === "orders/601") {
        return {
          data: {
            id: 601,
            status: "processing", // already paid!
            total: "750.00",
            meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_101" }],
          },
        };
      }
      throw new Error(`Unexpected path ${path}`);
    };

    let apiPutCalled = false;
    api.put = async () => {
      apiPutCalled = true;
    };

    const req = {
      headers: { "x-razorpay-signature": signature },
      rawBody: Buffer.from(rawBody),
      body: eventPayload,
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(d) { responseBody = d; return this; },
    };

    await handleWebhook(req, res);

    assert.equal(statusCode, 200);
    assert.equal(responseBody?._idempotent, true);
    assert.equal(apiPutCalled, false, "WooCommerce order must not be mutated if already processing");
  });

  await t.test("3.3. handleWebhook: successfully transitions pending order to processing", async () => {
    const eventPayload = {
      event: "payment.captured",
      id: "evt_unique_202",
      payload: {
        payment: {
          entity: {
            id: "pay_test_202",
            order_id: "order_rzp_202",
            amount: 85000,
            currency: "INR",
            status: "captured",
            method: "upi",
            notes: { wc_order_id: "602" },
          },
        },
      },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    api.get = async (path) => {
      if (path === "orders/602") {
        return {
          data: {
            id: 602,
            status: "pending",
            total: "850.00",
            meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_202" }],
          },
        };
      }
      throw new Error(`Unexpected path ${path}`);
    };

    let updatedPayload = null;
    api.put = async (path, payload) => {
      if (path === "orders/602") {
        updatedPayload = payload;
        return { data: { id: 602, status: "processing" } };
      }
      throw new Error(`Unexpected put path ${path}`);
    };

    const req = {
      headers: { "x-razorpay-signature": signature },
      rawBody: Buffer.from(rawBody),
      body: eventPayload,
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(d) { responseBody = d; return this; },
    };

    await handleWebhook(req, res);

    assert.equal(statusCode, 200);
    assert.equal(responseBody?.success, true);
    assert.equal(responseBody?.status, "processing");
    assert.equal(updatedPayload?.status, "processing");
    assert.equal(updatedPayload?.transaction_id, "pay_test_202");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. handleWebhook: Amount Mismatch & Failed Event Handling
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("4.1. handleWebhook: rejects on amount mismatch and does not update WooCommerce", async () => {
    const eventPayload = {
      event: "payment.captured",
      id: "evt_unique_303",
      payload: {
        payment: {
          entity: {
            id: "pay_test_303",
            order_id: "order_rzp_303",
            amount: 50000, // ₹500 in paise
            currency: "INR",
            status: "captured",
            notes: { wc_order_id: "603" },
          },
        },
      },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    api.get = async () => ({
      data: {
        id: 603,
        status: "pending",
        total: "1200.00", // ₹1200 expected total, but received ₹500!
        meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_303" }],
      },
    });

    let apiPutCalled = false;
    api.put = async () => { apiPutCalled = true; };

    const req = {
      headers: { "x-razorpay-signature": signature },
      rawBody: Buffer.from(rawBody),
      body: eventPayload,
    };
    let statusCode = 0;
    const res = {
      status(c) { statusCode = c; return this; },
      json() { return this; },
    };

    await handleWebhook(req, res);

    assert.equal(statusCode, 400, "Amount mismatch must be rejected with 400");
    assert.equal(apiPutCalled, false, "WooCommerce order must NOT be marked paid on amount mismatch");
  });

  await t.test("4.2. handleWebhook: payment.failed event does NOT cancel or fail WooCommerce order", async () => {
    const eventPayload = {
      event: "payment.failed",
      id: "evt_unique_404",
      payload: {
        payment: {
          entity: {
            id: "pay_failed_404",
            order_id: "order_rzp_404",
            error_code: "BAD_REQUEST_ERROR",
          },
        },
      },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    let apiPutCalled = false;
    api.put = async () => { apiPutCalled = true; };

    const req = {
      headers: { "x-razorpay-signature": signature },
      rawBody: Buffer.from(rawBody),
      body: eventPayload,
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(d) { responseBody = d; return this; },
    };

    await handleWebhook(req, res);

    assert.equal(statusCode, 200);
    assert.equal(responseBody?.success, true);
    assert.equal(apiPutCalled, false, "WooCommerce order must NOT be failed or cancelled");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. reconcileOrder: Lightweight Reconciliation
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("5.1. reconcileOrder returns action none when order has no razorpay order id", async () => {
    api.get = async (path) => {
      if (path === "orders/701") {
        return {
          data: {
            id: 701,
            status: "pending",
            total: "900.00",
            meta_data: [],
          },
        };
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const req = { params: { id: "701" } };
    let responseBody = null;
    const res = {
      json(d) { responseBody = d; return this; },
      status() { return this; },
    };

    await reconcileOrder(req, res);

    assert.equal(responseBody?.reconciled, true);
    assert.equal(responseBody?.action, "none");
    assert.match(responseBody?.message, /does not have an associated Razorpay order ID/i);
  });

  await t.test("5.2. reconcileOrder acknowledges already processing order without mutating", async () => {
    api.get = async (path) => {
      if (path === "orders/702") {
        return {
          data: {
            id: 702,
            status: "processing",
            total: "900.00",
            meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_702" }],
          },
        };
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const req = { params: { id: "702" } };
    let responseBody = null;
    const res = {
      json(d) { responseBody = d; return this; },
      status() { return this; },
    };

    await reconcileOrder(req, res);

    assert.equal(responseBody?.reconciled, true);
    assert.equal(responseBody?.action, "none");
    assert.match(responseBody?.message, /already in a completed\/processing state/i);
  });
});
