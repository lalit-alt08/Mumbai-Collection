import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

let currentMockHandler = null;
const originalAdapter = axios.defaults.adapter;
axios.defaults.adapter = async (config) => {
  if (!currentMockHandler) {
    throw new Error(`No mock handler registered for ${config.url}`);
  }
  const result = await currentMockHandler(config);
  if (result.reject) {
    const err = new Error(result.message || "Request failed");
    err.response = {
      status: result.status ?? 503,
      data: result.data ?? {
        success: false,
        code: "UPSTREAM_INVALID_JSON",
        message: "Store service is temporarily unavailable. Please try again in a moment.",
      },
      headers: {},
      config,
    };
    err.config = config;
    throw err;
  }
  return {
    data: result.data,
    status: result.status ?? 200,
    statusText: "OK",
    headers: {},
    config,
  };
};

test.after(() => {
  axios.defaults.adapter = originalAdapter;
});

test("Outage drill: lost verifyPayment response + 503 outage preserves payment reference and warns not to pay again", async () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  let capturedOptions = null;

  globalThis.window = {
    Razorpay: class MockRazorpay {
      constructor(options) {
        capturedOptions = options;
      }
      on() {}
      open() {}
    },
  };
  // Speed up the 5 x 2500ms retry backoff sleeps during unit test
  globalThis.setTimeout = (fn) => originalSetTimeout(fn, 1);

  currentMockHandler = async (config) => {
    if (config.url?.includes("/create-order")) {
      return {
        data: {
          razorpay_order_id: "order_outage_drill_1",
          key_id: "rzp_test_key",
          amount: 89900,
          currency: "INR",
        },
      };
    }
    // Simulate WordPress outage / 503 UPSTREAM_INVALID_JSON on verify and all status checks
    if (config.url?.includes("/verify") || config.url?.includes("/check-status")) {
      return {
        reject: true,
        status: 503,
        data: {
          success: false,
          code: "UPSTREAM_INVALID_JSON",
          message: "Store service is temporarily unavailable. Please try again in a moment.",
        },
      };
    }
    throw new Error(`Unexpected request: ${config.url}`);
  };

  try {
    const { createRazorpayHandler } = await import(
      `../src/components/checkout/useRazorpayCheckout.js?outage_drill=${Date.now()}`
    );
    const { getPendingPayment, clearPendingPayment } = await import(
      "../src/utils/checkoutIdempotency.js"
    );

    const userId = 55001;
    clearPendingPayment(userId);

    const activeOrderRef = { current: null };
    const activeUserRef = { current: userId };
    const isSubmittingRef = { current: true };
    const idempotencyKeyRef = { current: "idem-outage-1" };
    let persistentPending = false;
    let lastError = "";
    let navigated = false;

    const startPayment = createRazorpayHandler({
      user: { id: userId, first_name: "Priya", email: "priya@example.com", phone: "9876543210" },
      cart: { items: [{ id: 10, quantity: 2 }], totals: { total_price: "89900" } },
      finalTotal: 899,
      billingAddress: {},
      shippingAddress: {},
      idempotencyKeyRef,
      activeOrderRef,
      activeUserRef,
      isSubmittingRef,
      pollTimerRef: { current: null },
      setLoading: () => {},
      setPaymentStep: () => {},
      setError: (msg) => { lastError = msg; },
      setIsPersistentPending: (val) => { persistentPending = val; },
      refreshCart: async () => {},
      navigate: () => { navigated = true; },
    });

    await startPayment();
    await capturedOptions.handler({
      razorpay_order_id: "order_outage_drill_1",
      razorpay_payment_id: "pay_outage_drill_1",
      razorpay_signature: "sig_outage_drill_1",
    });

    const pending = getPendingPayment(userId);
    assert.ok(pending, "Pending payment reference must be preserved during a 503 outage");
    assert.equal(pending.razorpay_order_id, "order_outage_drill_1");
    assert.equal(persistentPending, true, "Persistent pending banner must activate so shopper checks status first");
    assert.match(lastError, /do not pay again/i);
    assert.equal(navigated, false);

    clearPendingPayment(userId);
  } finally {
    currentMockHandler = null;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.window = originalWindow;
  }
});

test("Outage drill: cached categories remain available when backend returns 503 UPSTREAM_INVALID_JSON", async () => {
  const { getCategories, getCachedCategories } = await import("../src/services/productService.js");

  // 1. Seed last-known-good catalog categories
  currentMockHandler = async (config) => {
    if (config.url?.includes("/categories")) {
      return {
        data: [
          { id: 1, name: "Toys", slug: "toys", count: 12 },
          { id: 2, name: "Stationery", slug: "stationery", count: 8 },
        ],
      };
    }
    throw new Error(`Unexpected request: ${config.url}`);
  };
  const live = await getCategories();
  assert.equal(live.length, 2);

  // 2. Simulate WordPress PHP-leak 503 outage
  currentMockHandler = async () => ({
    reject: true,
    status: 503,
    data: {
      success: false,
      code: "UPSTREAM_INVALID_JSON",
      message: "Store service is temporarily unavailable. Please try again in a moment.",
    },
  });

  // Last-known-good cached categories remain intact for shoppers to browse
  const cached = getCachedCategories();
  assert.ok(Array.isArray(cached) && cached.length === 2);
  assert.equal(cached[0].slug, "toys");
  currentMockHandler = null;
});
