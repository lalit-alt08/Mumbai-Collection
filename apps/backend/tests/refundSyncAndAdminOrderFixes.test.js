import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.env.NODE_ENV = "test";
process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
process.env.RAZORPAY_WEBHOOK_SECRET = "mock_webhook_secret_789";

const { default: api } = await import("../src/config/woocommerce.js");
const { handleWebhook, reconcileOrder } = await import("../src/controllers/paymentController.js");
const { getAdminOrders } = await import("../src/controllers/adminOrderController.js");
const { getRazorpayInstance } = await import("../src/services/razorpayService.js");
const { _setWpClientForTesting } = await import("../src/services/paymentIntentService.js");
const { serverCache } = await import("../src/utils/memoryCache.js");

const __dirname = dirname(fileURLToPath(import.meta.url));

const signWebhook = (payload) =>
  crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest("hex");

const createRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    set(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  };
  return res;
};

test("Refund Sync, Manual Reconcile Guard & Admin Status/Chart Fixes", async (t) => {
  const originalApiGet = api.get;
  const originalApiPut = api.put;
  const originalApiPost = api.post;
  const rzp = getRazorpayInstance();
  const originalFetchPayment = rzp.payments.fetch;
  const originalFetchOrderPayments = rzp.orders.fetchPayments;

  t.afterEach(() => {
    api.get = originalApiGet;
    api.put = originalApiPut;
    api.post = originalApiPost;
    rzp.payments.fetch = originalFetchPayment;
    rzp.orders.fetchPayments = originalFetchOrderPayments;
    _setWpClientForTesting(null);
    serverCache.clear();
  });

  await t.test("1. Full-refund webhook stages refund_pending on WooCommerce failure and preserves customer_note on success", async () => {
    const intent = {
      rzp_order_id: "rzp_refund_sync_1",
      rzp_payment_id: "pay_refund_sync_1",
      wc_order_id: 501,
      status: "order_created",
      amount_in_paise: 50000,
    };

    _setWpClientForTesting({
      post: async (path, body) => {
        if (path.endsWith("/payment-intent/lock")) return { data: { success: true, acquired: true } };
        if (path.endsWith("/payment-intent/get")) return { data: { success: true, intent: { ...intent } } };
        if (path.endsWith("/payment-intent/update-status")) {
          if (body.from_status && intent.status !== body.from_status) {
            return { data: { success: true, updated: false } };
          }
          intent.status = body.to_status;
          return { data: { success: true, updated: true } };
        }
        return { data: { success: true } };
      },
      get: async () => ({ data: { order: { id: 501, status: "processing" } } }),
    });

    rzp.payments.fetch = async () => ({
      id: "pay_refund_sync_1",
      order_id: "rzp_refund_sync_1",
      amount: 50000,
      amount_refunded: 50000,
      refund_status: "full",
    });

    // 1a. Simulate WooCommerce timeout on refund write -> intent MUST stay refund_pending for reconciler
    api.put = async () => {
      throw new Error("WooCommerce 504 Gateway Timeout");
    };

    const failPayload = {
      id: "evt_refund_fail_501",
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_501", payment_id: "pay_refund_sync_1" } } },
    };
    const res1 = createRes();
    await handleWebhook({ headers: { "x-razorpay-signature": signWebhook(failPayload) }, body: failPayload }, res1);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(res1.statusCode, 200);
    assert.equal(intent.status, "refund_pending", "Failed WooCommerce refund sync must leave intent in refund_pending");

    // 1b. Simulate retry when WooCommerce recovers -> must NOT overwrite customer_note and settles intent to refunded
    let wcPutPayload = null;
    api.put = async (_url, body) => {
      wcPutPayload = body;
      return { data: { id: 501, status: "refunded" } };
    };
    api.post = async () => ({ data: { id: 1 } });

    const okPayload = {
      id: "evt_refund_ok_501",
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_501", payment_id: "pay_refund_sync_1" } } },
    };
    const res2 = createRes();
    await handleWebhook({ headers: { "x-razorpay-signature": signWebhook(okPayload) }, body: okPayload }, res2);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(intent.status, "refunded");
    assert.equal(wcPutPayload?.status, "refunded");
    assert.equal(Object.hasOwn(wcPutPayload || {}, "customer_note"), false, "Must preserve shopper customer_note");
    assert.deepEqual(wcPutPayload?.meta_data, [{ key: "_delivery_status", value: "refunded" }]);
  });

  await t.test("2. Manual reconcileOrder refuses partially refunded payment with HTTP 409", async () => {
    _setWpClientForTesting({
      post: async (path) => {
        if (path.endsWith("/payment-intent/lock")) return { data: { success: true, acquired: true } };
        return { data: { success: true } };
      },
      get: async () => ({ data: {} }),
    });

    api.get = async (endpoint) => {
      if (endpoint === "orders/601") {
        return {
          data: {
            id: 601,
            status: "pending",
            total: "500.00",
            meta_data: [{ key: "_razorpay_order_id", value: "rzp_partial_601" }],
          },
        };
      }
      return { data: null };
    };

    rzp.orders.fetchPayments = async () => ({
      items: [
        {
          id: "pay_partial_601",
          order_id: "rzp_partial_601",
          status: "captured",
          amount: 50000,
          amount_refunded: 20000,
          refund_status: "partial",
          currency: "INR",
        },
      ],
    });

    const res = createRes();
    await reconcileOrder({ params: { id: "601" } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.reconciled, false);
    assert.equal(res.body?.anomaly, "PAYMENT_REFUNDED");
  });

  await t.test("3. getAdminOrders prioritizes terminal WooCommerce status over stale _delivery_status", async () => {
    api.get = async () => ({
      headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
      data: [
        {
          id: 701,
          number: "701",
          status: "refunded",
          total: "350.00",
          date_created: "2026-11-24T10:00:00",
          billing: { first_name: "Test", last_name: "User", email: "test@example.com" },
          line_items: [],
          meta_data: [{ key: "_delivery_status", value: "packed" }],
        },
      ],
    });

    const res = createRes();
    await getAdminOrders({ query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.orders?.[0]?.status, "refunded");
  });

  await t.test("4. Admin analytics 7-day trend formats labels in Asia/Kolkata timezone", () => {
    const source = fs.readFileSync(
      resolve(__dirname, "../src/controllers/adminAnalyticsController.js"),
      "utf8"
    );
    assert.match(source, /toLocaleDateString\("en-IN",\s*\{[\s\S]*?timeZone:\s*"Asia\/Kolkata"/);
  });
});
