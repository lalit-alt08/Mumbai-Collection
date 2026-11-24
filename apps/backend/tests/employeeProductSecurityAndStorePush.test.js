import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
process.env.RAZORPAY_WEBHOOK_SECRET = "mock_webhook_secret_789";

const { schemas } = await import("../src/middlewares/requestValidation.js");
const { _setSessionCacheForTesting, clearSessionCache } = await import("../src/middlewares/authMiddleware.js");
const { default: api } = await import("../src/config/woocommerce.js");
const { default: wp } = await import("../src/services/wordpress.js");
const { serverCache } = await import("../src/utils/memoryCache.js");
const { default: storeHoursService } = await import("../src/services/storeHoursService.js");
const { _setWpClientForTesting } = await import("../src/services/paymentIntentService.js");
const { getRazorpayInstance } = await import("../src/services/razorpayService.js");
const { updateProduct } = await import("../src/controllers/adminProductController.js");
const { proxyStoreApi, _setStoreUpstreamAxiosForTesting } = await import("../src/routes/storeRoutes.js");
const { finalizePaymentAndCreateOrder } = await import("../src/services/paymentFinalizeService.js");
const {
  handleEmployeeOrderStream,
  _setOrderCreatedLedgerPathForTesting,
  _resetNotificationServiceForTesting,
  closeEmployeeOrderStreams,
} = await import("../src/services/orderNotificationService.js");
const { closeRedis } = await import("../src/config/redis.js");

const createMockRes = () => {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    headers,
    headersSent: false,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      this.headersSent = true;
      return this;
    },
    send(data) {
      this.body = data;
      this.headersSent = true;
      return this;
    },
  };
  return res;
};

const attachEmployeeSseCollector = (events) => {
  const listeners = {};
  const sseReq = {
    user: { id: 501, role: "employee", sessionKeyHash: "test_sse_hash_501" },
    on(event, fn) {
      listeners[event] = fn;
    },
  };
  const sseRes = {
    writeHead() {},
    setHeader() {},
    flushHeaders() {},
    on() {},
    write(chunk) {
      const lines = String(chunk).split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const parsed = JSON.parse(line.slice(5).trim());
          if (parsed?.event && parsed.event !== "CONNECTED") {
            events.push(parsed);
          }
        } catch {}
      }
      return true;
    },
    end() {},
  };
  handleEmployeeOrderStream(sseReq, sseRes);
  return () => listeners.close?.();
};

test("Employee Business Permissions & Checkout/Finalizer Notification Suite", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "mc-notif-ledger-"));
  const tempLedgerPath = join(tempDir, "order_created_notified.json");
  const originalWpPost = wp.post;
  const originalApiGet = api.get;
  const originalApiPost = api.post;
  const originalCheckStoreGuard = storeHoursService.checkCheckoutStoreGuard;
  const originalGetStoreStatus = storeHoursService.getStoreStatus;

  t.beforeEach(() => {
    serverCache.clear();
    clearSessionCache?.();
    _resetNotificationServiceForTesting();
    _setOrderCreatedLedgerPathForTesting(tempLedgerPath);
  });

  t.afterEach(() => {
    wp.post = originalWpPost;
    api.get = originalApiGet;
    api.post = originalApiPost;
    storeHoursService.checkCheckoutStoreGuard = originalCheckStoreGuard;
    storeHoursService.getStoreStatus = originalGetStoreStatus;
    _setStoreUpstreamAxiosForTesting(null);
    _setWpClientForTesting(null);
    closeEmployeeOrderStreams();
  });

  t.after(async () => {
    _setOrderCreatedLedgerPathForTesting(null);
    _resetNotificationServiceForTesting();
    await closeRedis();
    await rm(tempDir, { recursive: true, force: true });
  });

  await t.test("1. Employee role retains full price, name, and stock editing authority", async () => {
    const payload = {
      name: "Silk Kurta Set",
      regular_price: "1499",
      sale_price: "1199",
      stock_quantity: 12,
      expected_stock_quantity: 10,
    };
    assert.equal(schemas.productUpdate.safeParse(payload).success, true);

    let forwardedPayload = null;
    wp.post = async (path, body) => {
      if (path === "/wp-json/mumbai-auth/v1/staff/products/44/adjust") {
        forwardedPayload = body;
        return { data: { id: 44, ...body } };
      }
      return { data: {} };
    };

    const req = {
      params: { id: "44" },
      body: payload,
      user: { id: 7, role: "employee" },
      protocol: "https",
      get: () => "mumbaicollections.in",
    };
    const res = createMockRes();
    await updateProduct(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(forwardedPayload?.regular_price, "1499");
    assert.equal(forwardedPayload?.sale_price, "1199");
    assert.equal(forwardedPayload?.stock_quantity, 12);
  });

  await t.test("2. Real proxyStoreApi /checkout emits ZERO ORDER_CREATED events across pending, incomplete, abandoned, and COD requests", async () => {
    const observedEvents = [];
    const detachSse = attachEmployeeSseCollector(observedEvents);
    try {
      const customerCookie = "wordpress_logged_in_test=cust|9999999999|tok|hmac";
      _setSessionCacheForTesting(customerCookie, {
        userId: 88,
        roles: ["customer"],
        email: "shopper@example.com",
        isPhoneVerified: true,
        isSuspended: false,
        expiresAt: Date.now() + 3600 * 1000,
        timestamp: Date.now(),
      });

      storeHoursService.checkCheckoutStoreGuard = async () => ({ allowed: true });

      let nextUpstreamResponse = { status: 200, headers: {}, data: {} };
      const mockAxios = async () => nextUpstreamResponse;
      mockAxios.get = async (url) => {
        if (String(url).includes("/wc/store/v1/cart")) {
          return {
            data: {
              items: [{ id: 10, product_id: 10, totals: { line_subtotal: "59900" } }],
              totals: { total_items: "59900" },
            },
          };
        }
        return { data: { version: 1 } };
      };
      _setStoreUpstreamAxiosForTesting(mockAxios);

      const baseCheckoutReq = (paymentMethod, extra = {}) => ({
        method: "POST",
        path: "/checkout",
        query: {},
        headers: { "content-type": "application/json", ...extra.headers },
        cookies: { mumbai_customer_auth: customerCookie },
        body: {
          payment_method: paymentMethod,
          shipping_address: {
            first_name: "Asha",
            last_name: "Patel",
            phone: "9876543210",
            address_1: "101 Station Road",
            city: "Vasai West",
            state: "MH",
            postcode: "401202",
            country: "IN",
          },
          ...extra.body,
        },
      });

      // 2a. Normal Razorpay pre-payment pending order
      nextUpstreamResponse = {
        status: 200,
        headers: {},
        data: { id: 7001, status: "pending", needs_payment: true, payment_method: "razorpay", totals: { total_price: 59900 } },
      };
      const resPending = createMockRes();
      await proxyStoreApi(baseCheckoutReq("razorpay"), resPending);
      assert.equal(resPending.statusCode, 200);

      // 2b. Edge-case incomplete WooCommerce response (needs_payment: false without payment_method)
      nextUpstreamResponse = {
        status: 200,
        headers: {},
        data: { id: 7002, status: "pending", needs_payment: false, totals: { total_price: 59900 } },
      };
      const resIncomplete = createMockRes();
      await proxyStoreApi(baseCheckoutReq("razorpay"), resIncomplete);
      assert.equal(resIncomplete.statusCode, 200);

      // 2c. Failed/abandoned upstream checkout
      nextUpstreamResponse = {
        status: 400,
        headers: {},
        data: { code: "checkout_abandoned", message: "Abandoned" },
      };
      const resFailed = createMockRes();
      await proxyStoreApi(baseCheckoutReq("razorpay"), resFailed);
      assert.equal(resFailed.statusCode, 400);

      // 2d. Blocked COD attempt
      const resCod = createMockRes();
      await proxyStoreApi(baseCheckoutReq("cod"), resCod);
      assert.equal(resCod.statusCode, 400);
      assert.equal(resCod.body?.code, "PAYMENT_METHOD_UNAVAILABLE");

      await new Promise((r) => setTimeout(r, 25));
      assert.equal(observedEvents.length, 0, "Checkout proxy must NEVER trigger employee ORDER_CREATED alarms");
    } finally {
      detachSse();
    }
  });

  await t.test("3. Captured finalizer publishes ORDER_CREATED once, recovers crash gaps on retry, and skips ineligible on-hold orders", async () => {
    const observedEvents = [];
    const detachSse = attachEmployeeSseCollector(observedEvents);
    try {
      storeHoursService.getStoreStatus = async () => ({ is_open: true });

      const rzp = getRazorpayInstance();
      const origFetchPayment = rzp.payments.fetch;
      t.after(() => {
        rzp.payments.fetch = origFetchPayment;
      });

      const intents = new Map();
      const wcOrdersByRzpId = new Map();

      _setWpClientForTesting({
        post: async (path, body) => {
          if (path.endsWith("/payment-intent/lock")) return { data: { success: true, acquired: true } };
          if (path.endsWith("/payment-intent/get")) return { data: { success: true, intent: intents.get(body.rzp_order_id) || null } };
          if (path.endsWith("/payment-intent/update-status")) {
            const intent = intents.get(body.rzp_order_id);
            if (intent) Object.assign(intent, { status: body.to_status, wc_order_id: body.wc_order_id || intent.wc_order_id });
            return { data: { success: true, updated: true } };
          }
          if (path.endsWith("/orders/finalize-payment")) {
            const created = {
              id: 8801,
              number: "8801",
              status: "processing",
              total: "599.00",
              meta_data: body.meta_data || [],
              line_items: [],
            };
            const rzpOrderId = body.meta_data?.find((m) => m.key === "_razorpay_order_id")?.value;
            if (rzpOrderId) wcOrdersByRzpId.set(rzpOrderId, created);
            return { data: created };
          }
          return { data: { success: true } };
        },
        get: async (_path, config) => ({
          data: { success: true, order: wcOrdersByRzpId.get(config?.params?.rzp_order_id) || null },
        }),
      });

      api.get = async (endpoint) => {
        if (endpoint === "products/10") {
          return { data: { id: 10, name: "Kurta", manage_stock: true, stock_quantity: 5, stock_status: "instock" } };
        }
        return { data: null };
      };

      // 3a. Normal captured payment creation -> delivers 1 ORDER_CREATED event to staff SSE
      const rzpOrderNormal = `rzp_ord_norm_${Date.now()}`;
      intents.set(rzpOrderNormal, {
        rzp_order_id: rzpOrderNormal,
        customer_id: 88,
        status: "created",
        amount_in_paise: 59900,
        checkout_payload: {
          customer_id: 88,
          line_items: [{ product_id: 10, quantity: 1 }],
        },
      });
      rzp.payments.fetch = async (payId) => ({
        id: payId,
        order_id: rzpOrderNormal,
        status: "captured",
        amount: 59900,
        currency: "INR",
        method: "upi",
      });

      const normalResult = await finalizePaymentAndCreateOrder({
        rzpOrderId: rzpOrderNormal,
        rzpPaymentId: "pay_norm_1",
        expectedCustomerId: 88,
        source: "verify",
      });
      assert.equal(normalResult.success, true);
      assert.equal(normalResult.order_id, 8801);
      assert.equal(observedEvents.filter((e) => e.orderId === 8801 && e.event === "ORDER_CREATED").length, 1);

      // 3b. Crash-gap recovery: WC order 8802 exists in processing WITHOUT ledger notification -> retry delivers exactly 1 alert
      const rzpOrderCrash = `rzp_ord_crash_${Date.now()}`;
      wcOrdersByRzpId.set(rzpOrderCrash, {
        id: 8802,
        number: "8802",
        status: "processing",
        total: "799.00",
        meta_data: [],
      });
      rzp.payments.fetch = async (payId) => ({
        id: payId,
        order_id: rzpOrderCrash,
        status: "captured",
        amount: 79900,
        currency: "INR",
        method: "upi",
      });

      const crashRecovery = await finalizePaymentAndCreateOrder({
        rzpOrderId: rzpOrderCrash,
        rzpPaymentId: "pay_crash_1",
        expectedCustomerId: 88,
        source: "webhook",
      });
      assert.equal(crashRecovery.success, true);
      assert.equal(crashRecovery._idempotent, true);
      assert.equal(observedEvents.filter((e) => e.orderId === 8802 && e.event === "ORDER_CREATED").length, 1);

      // 3c. Subsequent idempotent retry for 8802 must NOT duplicate the alarm
      const secondRetry = await finalizePaymentAndCreateOrder({
        rzpOrderId: rzpOrderCrash,
        rzpPaymentId: "pay_crash_1",
        expectedCustomerId: 88,
        source: "verify",
      });
      assert.equal(secondRetry.success, true);
      assert.equal(observedEvents.filter((e) => e.orderId === 8802 && e.event === "ORDER_CREATED").length, 1);

      // 3d. Flagged existing order in 'on-hold' status must NEVER emit ORDER_CREATED
      const rzpOrderHold = `rzp_ord_hold_${Date.now()}`;
      wcOrdersByRzpId.set(rzpOrderHold, {
        id: 8803,
        number: "8803",
        status: "on-hold",
        total: "999.00",
        meta_data: [],
      });
      rzp.payments.fetch = async (payId) => ({
        id: payId,
        order_id: rzpOrderHold,
        status: "captured",
        amount: 99900,
        currency: "INR",
        method: "card",
      });

      const holdRetry = await finalizePaymentAndCreateOrder({
        rzpOrderId: rzpOrderHold,
        rzpPaymentId: "pay_hold_1",
        expectedCustomerId: 88,
        source: "webhook",
      });
      assert.equal(holdRetry.success, true);
      assert.equal(observedEvents.filter((e) => e.orderId === 8803).length, 0);
    } finally {
      detachSse();
    }
  });
});
