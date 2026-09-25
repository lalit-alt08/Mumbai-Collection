import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
process.env.RAZORPAY_WEBHOOK_SECRET = "mock_webhook_secret_789";

const { default: api } = await import("../src/config/woocommerce.js");
const { default: storeHoursService } = await import("../src/services/storeHoursService.js");
const { serverCache } = await import("../src/utils/memoryCache.js");
const { default: paymentIntentService } = await import("../src/services/paymentIntentService.js");
const {
  createOrder,
  verifyPayment,
  handleWebhook,
  finalizePaymentAndCreateOrder,
  _resetPaymentStoreHoursFallbackForTesting,
} = await import("../src/controllers/paymentController.js");
const { sendOtp } = await import("../src/controllers/authController.js");
const { default: wp } = await import("../src/services/wordpress.js");
const { getRazorpayInstance } = await import("../src/services/razorpayService.js");
const { default: axios } = await import("axios");

test("Deferred Razorpay/WooCommerce Order Creation & Forensic Audit Fixes", async (t) => {
  const originalApiGet = api.get;
  const originalApiPost = api.post;
  const originalApiPut = api.put;
  const originalWpPost = wp.post;
  const originalAxiosGet = axios.get;
  const originalGetStoreStatus = storeHoursService.getStoreStatus;

  t.beforeEach(() => {
    serverCache.clear();
    _resetPaymentStoreHoursFallbackForTesting?.();
    storeHoursService.getStoreStatus = async () => ({ is_open: true });
  });

  t.afterEach(() => {
    api.get = originalApiGet;
    api.post = originalApiPost;
    api.put = originalApiPut;
    wp.post = originalWpPost;
    axios.get = originalAxiosGet;
    storeHoursService.getStoreStatus = originalGetStoreStatus;
    serverCache.clear();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Deferred Order Creation & Zero Pre-Payment Orders
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("1.1. createOrder creates 0 WooCommerce orders before payment and returns order_id: null", async () => {
    let wcOrdersCreated = 0;
    api.post = async (path) => {
      if (path === "orders") {
        wcOrdersCreated++;
        return { data: { id: 9999 } };
      }
      return { data: {} };
    };

    // Mock Store API cart
    axios.get = async (url) => {
      if (url.includes("/wp-json/wc/store/v1/cart")) {
        return {
          data: {
            items: [
              { id: 101, quantity: 2, totals: { line_total: "120000" } },
            ],
            totals: {
              total_items: "120000",
              total_price: "120000", // ₹1200.00
            },
          },
        };
      }
      return { data: {} };
    };

    const req = {
      wpUserId: 42,
      wpUserEmail: "customer@example.com",
      wpAuthCookie: "mock_cookie",
      isSuspended: false,
      body: {
        billing_address: {
          first_name: "Test",
          last_name: "User",
          address_1: "123 Street",
          city: "Vasai",
          state: "MH",
          postcode: "401201",
          phone: "9876543210",
        },
        shipping_address: {
          first_name: "Test",
          last_name: "User",
          address_1: "123 Street",
          city: "Vasai",
          state: "MH",
          postcode: "401201",
          phone: "9876543210",
        },
      },
    };

    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseBody = d;
        return this;
      },
    };

    const rzp = getRazorpayInstance();
    const originalOrdersCreate = rzp.orders.create;
    rzp.orders.create = async (options) => ({
      id: "order_mock_rzp_test_101",
      amount: options.amount,
      currency: options.currency || "INR",
      receipt: options.receipt,
      status: "created",
    });

    try {
      await createOrder(req, res);

      assert.equal(statusCode, 200);
      assert.equal(responseBody?.success, true);
      assert.equal(responseBody?.order_id, null, "WooCommerce order_id must be null before payment");
      assert.ok(responseBody?.razorpay_order_id, "Must return razorpay_order_id");
      assert.equal(responseBody?.amount, 120000);
      assert.equal(wcOrdersCreated, 0, "Zero WooCommerce orders must be created before payment capture");

      // Verify payment intent is stored in cache
      const intent = await paymentIntentService.getPaymentIntent(responseBody.razorpay_order_id);
      assert.ok(intent, "Payment intent must be stored");
      assert.equal(intent.customer_id, 42);
      assert.equal(intent.amount_in_paise, 120000);
    } finally {
      rzp.orders.create = originalOrdersCreate;
    }
  });

  await t.test("1.2. Failed or cancelled payment leaves 0 WooCommerce orders created", async () => {
    let wcOrdersCreated = 0;
    api.post = async (path) => {
      if (path === "orders") {
        wcOrdersCreated++;
        return { data: { id: 9999 } };
      }
    };

    // User closes browser or cancels modal -> payment.failed webhook fires
    const req = {
      headers: {
        "x-razorpay-signature": "dummy_sig",
      },
      body: {
        event: "payment.failed",
        payload: {
          payment: { entity: { id: "pay_failed_123", order_id: "order_mock_cancelled" } },
        },
      },
    };

    let responseBody = null;
    const res = {
      status() { return this; },
      json(d) { responseBody = d; return this; },
    };

    // Temporarily mock signature verification to test event handling
    const originalVerifySig = crypto.timingSafeEqual;
    crypto.timingSafeEqual = () => true;
    try {
      await handleWebhook(req, res);
    } finally {
      crypto.timingSafeEqual = originalVerifySig;
    }

    assert.equal(responseBody?.success, true);
    assert.equal(wcOrdersCreated, 0, "Cancelled or failed payment must create 0 WooCommerce orders");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Concurrency Race & Idempotency: Browser Verify + Webhook Race
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("2.1. Concurrent browser verification + webhook race creates exactly 1 WooCommerce order", async () => {
    const rzpOrderId = "order_race_test_001";
    const rzpPaymentId = "pay_race_test_001";

    let wcOrderCreationCount = 0;
    let storedWcOrder = null;

    api.post = async (path, payload) => {
      if (path === "orders") {
        wcOrderCreationCount++;
        storedWcOrder = {
          id: 5555,
          status: "processing",
          meta_data: [{ key: "_razorpay_order_id", value: rzpOrderId }],
        };
        return { data: storedWcOrder };
      }
      return { data: {} };
    };

    api.get = async (path, params) => {
      if (path === "orders") {
        return { data: storedWcOrder ? [storedWcOrder] : [] };
      }
      if (path.startsWith("products/")) {
        return { data: { id: 101, manage_stock: false } };
      }
      return { data: {} };
    };

    // Mock Razorpay payment fetch
    const originalRzpFetch = (await import("../src/services/razorpayService.js")).fetchRazorpayPayment;
    // Store valid intent in memory
    const intent = {
      rzp_order_id: rzpOrderId,
      customer_id: 10,
      amount_in_paise: 150000,
      checkout_payload: {
        customer_id: 10,
        billing: { first_name: "Race", last_name: "Test" },
        shipping: { first_name: "Race", last_name: "Test" },
        line_items: [{ product_id: 101, quantity: 1 }],
      },
    };
    await paymentIntentService.storePaymentIntent(rzpOrderId, intent);

    // Mock paymentIntentService lock to work in-process with polling
    let activeLockWorker = null;
    paymentIntentService.acquireLock = async (id, workerId, maxWaitMs = 2000) => {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        if (!activeLockWorker) {
          activeLockWorker = workerId;
          return true;
        }
        if (activeLockWorker === workerId) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    };
    paymentIntentService.releaseLock = async () => {
      activeLockWorker = null;
      return true;
    };

    // Simulate parallel execution
    const runFinalize = (source) =>
      finalizePaymentAndCreateOrder({
        rzpOrderId,
        rzpPaymentId,
        source,
        expectedCustomerId: 10,
      });

    // Mock fetchRazorpayPayment via service mock
    const { getRazorpayInstance } = await import("../src/services/razorpayService.js");
    const rzpInstance = getRazorpayInstance();
    const originalPaymentsFetch = rzpInstance.payments.fetch;
    rzpInstance.payments.fetch = async () => ({
      id: rzpPaymentId,
      order_id: rzpOrderId,
      status: "captured",
      currency: "INR",
      amount: 150000,
      method: "upi",
    });

    try {
      const [resBrowser, resWebhook] = await Promise.all([
        runFinalize("browser"),
        runFinalize("webhook"),
      ]);

      assert.equal(wcOrderCreationCount, 1, "Exactly 1 WooCommerce order must be created");
      assert.equal(resBrowser.success, true);
      assert.equal(resWebhook.success, true);
      assert.equal(resBrowser.order_id, 5555);
      assert.equal(resWebhook.order_id, 5555);
    } finally {
      rzpInstance.payments.fetch = originalPaymentsFetch;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Webhook-Only Recovery (User closed browser)
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("3.1. Webhook creates WooCommerce order when browser was closed before verify", async () => {
    const rzpOrderId = "order_webhook_only_002";
    const rzpPaymentId = "pay_webhook_only_002";
    let wcOrderCreated = false;

    api.post = async (path, payload) => {
      if (path === "orders") {
        wcOrderCreated = true;
        return { data: { id: 7777, status: "processing" } };
      }
      return { data: {} };
    };

    api.get = async (path) => {
      if (path === "orders") return { data: [] };
      if (path.startsWith("products/")) return { data: { id: 101, manage_stock: false } };
      return { data: {} };
    };

    await paymentIntentService.storePaymentIntent(rzpOrderId, {
      rzp_order_id: rzpOrderId,
      customer_id: 15,
      amount_in_paise: 99000,
      checkout_payload: {
        customer_id: 15,
        billing: { first_name: "Closed", last_name: "Tab" },
        shipping: { first_name: "Closed", last_name: "Tab" },
        line_items: [{ product_id: 101, quantity: 1 }],
      },
    });

    const { getRazorpayInstance } = await import("../src/services/razorpayService.js");
    const rzpInstance = getRazorpayInstance();
    const originalPaymentsFetch = rzpInstance.payments.fetch;
    rzpInstance.payments.fetch = async () => ({
      id: rzpPaymentId,
      order_id: rzpOrderId,
      status: "captured",
      currency: "INR",
      amount: 99000,
      method: "card",
    });

    try {
      const result = await finalizePaymentAndCreateOrder({
        rzpOrderId,
        rzpPaymentId,
        source: "webhook",
      });

      assert.equal(result.success, true);
      assert.equal(result.order_id, 7777);
      assert.equal(wcOrderCreated, true, "WooCommerce order must be created by webhook");

      // Verify intent transitioned to order_created (durable payments)
      const remainingIntent = await paymentIntentService.getPaymentIntent(rzpOrderId);
      assert.ok(remainingIntent, "Payment intent must persist durably");
      assert.equal(remainingIntent.status, "order_created", "Payment intent status must be order_created after order creation");
      assert.equal(remainingIntent.wc_order_id, 7777, "Payment intent must link wc_order_id");
    } finally {
      rzpInstance.payments.fetch = originalPaymentsFetch;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Failed WC Creation Retains Payment Intent
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("4.1. Failed WooCommerce order creation retains payment intent for recovery", async () => {
    const rzpOrderId = "order_wc_fail_003";
    const rzpPaymentId = "pay_wc_fail_003";

    api.post = async (path) => {
      if (path === "orders") {
        throw new Error("WooCommerce MySQL server has gone away (simulated 500)");
      }
      return { data: {} };
    };

    api.get = async (path) => {
      if (path === "orders") return { data: [] };
      if (path.startsWith("products/")) return { data: { id: 101, manage_stock: false } };
      return { data: {} };
    };

    await paymentIntentService.storePaymentIntent(rzpOrderId, {
      rzp_order_id: rzpOrderId,
      customer_id: 20,
      amount_in_paise: 200000,
      checkout_payload: { line_items: [{ product_id: 101, quantity: 1 }] },
    });

    const { getRazorpayInstance } = await import("../src/services/razorpayService.js");
    const rzpInstance = getRazorpayInstance();
    const originalPaymentsFetch = rzpInstance.payments.fetch;
    rzpInstance.payments.fetch = async () => ({
      id: rzpPaymentId,
      order_id: rzpOrderId,
      status: "captured",
      currency: "INR",
      amount: 200000,
    });

    try {
      const result = await finalizePaymentAndCreateOrder({
        rzpOrderId,
        rzpPaymentId,
        source: "browser",
      });

      assert.equal(result.success, false);
      assert.equal(result.status, 502);

      // CRITICAL: Intent must NOT have been deleted
      const intent = await paymentIntentService.getPaymentIntent(rzpOrderId);
      assert.ok(intent, "Payment intent must be retained when WC creation fails so webhook/retry can recover");
    } finally {
      rzpInstance.payments.fetch = originalPaymentsFetch;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Forensic Audit Fix: Email OTP Cooldown & Identifier Integrity
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("5.1. sendOtp returns HTTP 429 when WordPress reports rate_limited: true", async () => {
    wp.post = async (path) => {
      if (path === "/wp-json/mumbai-auth/v1/otp/store") {
        return {
          data: {
            success: true,
            user_found: true,
            rate_limited: true,
          },
        };
      }
      return { data: {} };
    };

    const req = {
      body: { phone: "customer@example.com", purpose: "reset_password" },
    };
    let statusCode = 0;
    let responseBody = null;
    let retryAfterHeader = null;
    const res = {
      set(k, v) {
        if (k.toLowerCase() === "retry-after") retryAfterHeader = v;
        return this;
      },
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseBody = d;
        return this;
      },
    };

    await sendOtp(req, res);

    assert.equal(statusCode, 429, "Blocked OTP request must return HTTP 429");
    assert.equal(retryAfterHeader, "60");
    assert.equal(responseBody?.retryAfter, 60);
    assert.equal(responseBody?.success, false);
  });

  await t.test("5.2. Email containing 10 digits is NEVER stripped into phone number", async () => {
    let cleanPhonePassedToWp = "";
    wp.post = async (path, body) => {
      if (path === "/wp-json/mumbai-auth/v1/otp/store") {
        cleanPhonePassedToWp = body.phone;
        return {
          data: {
            success: true,
            user_found: true,
            email: "john9876543210@gmail.com",
          },
        };
      }
      return { data: {} };
    };

    const req = {
      body: { phone: "John9876543210@gmail.com", purpose: "reset_password" },
    };
    const res = {
      status() { return this; },
      json() { return this; },
    };

    await sendOtp(req, res);

    assert.equal(
      cleanPhonePassedToWp,
      "john9876543210@gmail.com",
      "Email with 10 digits must remain an email and not be normalized into phone digits"
    );
  });
});
