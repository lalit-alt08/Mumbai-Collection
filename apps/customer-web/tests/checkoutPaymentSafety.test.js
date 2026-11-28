import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let currentMockHandler = null;
const originalAdapter = axios.defaults.adapter;
axios.defaults.adapter = async (config) => {
  if (!currentMockHandler) {
    throw new Error(`No mock handler registered for ${config.url}`);
  }
  const result = await currentMockHandler(config);
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

test("confirmed checkout branches navigate without waiting for cart refresh", async () => {
  const originalWindow = globalThis.window;
  const originalTimeout = globalThis.setTimeout;
  let options;
  globalThis.window = { Razorpay: class { constructor(value) { options = value; } on() {} open() {} } };
  globalThis.setTimeout = (callback) => originalTimeout(callback, 0);
  try {
    const { createRazorpayHandler } = await import("../src/components/checkout/useRazorpayCheckout.js");
    for (const mode of ["already_paid", "dismiss", "poll"]) {
      const restore = setupMockAdapter(async (config) => {
        if (config.url?.includes("/create-order")) return { data: mode === "already_paid" ? { already_paid: true, order_id: 55 } : { razorpay_order_id: "order_test", key_id: "test", amount: 100, currency: "INR" } };
        if (config.url?.includes("/verify")) throw new Error("gateway unavailable");
        if (config.url?.includes("/check-status")) return { data: { success: true, order_id: 55 } };
        throw new Error(`Unexpected request ${config.url}`);
      });
      const navigations = [];
      const start = createRazorpayHandler({
        user: { id: 55 }, cart: { items: [] }, finalTotal: 1, billingAddress: {}, shippingAddress: {},
        idempotencyKeyRef: { current: "test" }, activeOrderRef: { current: null }, activeUserRef: { current: 55 },
        isSubmittingRef: { current: true }, pollTimerRef: { current: null },
        setLoading() {}, setPaymentStep() {}, setError() {}, setIsPersistentPending() {},
        refreshCart: () => new Promise(() => {}), navigate: (url) => navigations.push(url),
      });
      await start();
      if (mode === "dismiss") await options.modal.ondismiss();
      if (mode === "poll") await options.handler({ razorpay_order_id: "order_test", razorpay_payment_id: "pay_test", razorpay_signature: "test" });
      assert.deepEqual(navigations, ["/order-success/55"], mode);
      restore();
    }
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalTimeout;
    currentMockHandler = null;
  }
});

const setupMockAdapter = (handler) => {
  currentMockHandler = handler;
  return () => {
    currentMockHandler = null;
  };
};

test("Razorpay checkout preserves pending payment when verify returns support_required + terminal", async () => {
  const originalWindow = globalThis.window;
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

  const restoreAdapter = setupMockAdapter(async (config) => {
    if (config.url?.includes("/create-order")) {
      return {
        data: {
          razorpay_order_id: "order_support_1",
          key_id: "rzp_test_key",
          amount: 59900,
          currency: "INR",
        },
      };
    }
    if (config.url?.includes("/verify")) {
      return {
        data: {
          success: false,
          support_required: true,
          terminal: true,
          message: "Needs staff review. Do not pay again.",
        },
      };
    }
    throw new Error(`Unexpected request: ${config.url}`);
  });

  try {
    const { createRazorpayHandler } = await import(
      `../src/components/checkout/useRazorpayCheckout.js?test_support=${Date.now()}`
    );
    const { getPendingPayment, clearPendingPayment } = await import(
      "../src/utils/checkoutIdempotency.js"
    );

    const userId = 41001;
    clearPendingPayment(userId);

    const activeOrderRef = { current: null };
    const activeUserRef = { current: userId };
    const isSubmittingRef = { current: true };
    const idempotencyKeyRef = { current: "idem-key-1" };
    let persistentPending = false;
    let lastError = "";
    let navigatedTo = null;

    const startPayment = createRazorpayHandler({
      user: { id: userId, first_name: "Asha", email: "asha@example.com", phone: "9876543210" },
      cart: { items: [{ id: 1, quantity: 1 }], totals: { total_price: "59900" } },
      finalTotal: 599,
      billingAddress: { first_name: "Asha", email: "asha@example.com", phone: "9876543210" },
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
      navigate: (to) => { navigatedTo = to; },
    });

    await startPayment();
    assert.ok(capturedOptions?.handler, "Razorpay handler should be registered");

    await capturedOptions.handler({
      razorpay_order_id: "order_support_1",
      razorpay_payment_id: "pay_support_1",
      razorpay_signature: "sig_support_1",
    });

    const pending = getPendingPayment(userId);
    assert.ok(pending, "Pending payment must be retained for staff review");
    assert.equal(pending.razorpay_order_id, "order_support_1");
    assert.equal(pending.support_required, true);
    assert.equal(pending.amount, 59900);
    assert.equal(persistentPending, true);
    assert.match(lastError, /Do not pay again/i);
    assert.equal(navigatedTo, null);

    clearPendingPayment(userId);
  } finally {
    restoreAdapter();
    globalThis.window = originalWindow;
  }
});

test("Razorpay checkout ondismiss preserves pending payment when status check returns support_required + terminal", async () => {
  const originalWindow = globalThis.window;
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

  const restoreAdapter = setupMockAdapter(async (config) => {
    if (config.url?.includes("/create-order")) {
      return {
        data: {
          razorpay_order_id: "order_dismiss_support_2",
          key_id: "rzp_test_key",
          amount: 75000,
          currency: "INR",
        },
      };
    }
    if (config.url?.includes("/check-status")) {
      return {
        data: {
          success: false,
          support_required: true,
          terminal: true,
          message: "Staff review pending. Do not pay again.",
        },
      };
    }
    throw new Error(`Unexpected request: ${config.url}`);
  });

  try {
    const { createRazorpayHandler } = await import(
      `../src/components/checkout/useRazorpayCheckout.js?test_dismiss=${Date.now()}`
    );
    const { getPendingPayment, clearPendingPayment } = await import(
      "../src/utils/checkoutIdempotency.js"
    );

    const userId = 41002;
    clearPendingPayment(userId);

    const activeOrderRef = { current: null };
    const activeUserRef = { current: userId };
    const isSubmittingRef = { current: true };
    const idempotencyKeyRef = { current: "idem-key-2" };
    let persistentPending = false;
    let lastError = "";

    const startPayment = createRazorpayHandler({
      user: { id: userId },
      cart: { items: [{ id: 2, quantity: 1 }], totals: { total_price: "75000" } },
      finalTotal: 750,
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
      navigate: () => {},
    });

    await startPayment();
    await capturedOptions.modal.ondismiss();

    const pending = getPendingPayment(userId);
    assert.ok(pending, "Pending payment must remain saved after support_required ondismiss");
    assert.equal(pending.razorpay_order_id, "order_dismiss_support_2");
    assert.equal(pending.support_required, true);
    assert.equal(persistentPending, true);
    assert.match(lastError, /Do not pay again/i);

    clearPendingPayment(userId);
  } finally {
    restoreAdapter();
    globalThis.window = originalWindow;
  }
});

test("Razorpay checkout discards delayed verify success after an account switch", async () => {
  const originalWindow = globalThis.window;
  let capturedOptions = null;
  let resolveVerify = null;

  globalThis.window = {
    Razorpay: class MockRazorpay {
      constructor(options) {
        capturedOptions = options;
      }
      on() {}
      open() {}
    },
  };

  const restoreAdapter = setupMockAdapter(async (config) => {
    if (config.url?.includes("/create-order")) {
      return {
        data: {
          razorpay_order_id: "order_switch_3",
          key_id: "rzp_test_key",
          amount: 50000,
          currency: "INR",
        },
      };
    }
    if (config.url?.includes("/verify")) {
      return await new Promise((resolve) => {
        resolveVerify = resolve;
      });
    }
    throw new Error(`Unexpected request: ${config.url}`);
  });

  try {
    const { createRazorpayHandler } = await import(
      `../src/components/checkout/useRazorpayCheckout.js?test_switch=${Date.now()}`
    );
    const { clearPendingPayment } = await import("../src/utils/checkoutIdempotency.js");

    const userA = 41003;
    const userB = 41004;
    clearPendingPayment(userA);
    clearPendingPayment(userB);

    const activeOrderRef = { current: null };
    const activeUserRef = { current: userA };
    const isSubmittingRef = { current: true };
    const idempotencyKeyRef = { current: "idem-key-3" };
    let navigated = false;
    let cartRefreshed = false;

    const startPayment = createRazorpayHandler({
      user: { id: userA },
      cart: { items: [{ id: 3, quantity: 1 }], totals: { total_price: "50000" } },
      finalTotal: 500,
      billingAddress: {},
      shippingAddress: {},
      idempotencyKeyRef,
      activeOrderRef,
      activeUserRef,
      isSubmittingRef,
      pollTimerRef: { current: null },
      setLoading: () => {},
      setPaymentStep: () => {},
      setError: () => {},
      setIsPersistentPending: () => {},
      refreshCart: async () => { cartRefreshed = true; },
      navigate: () => { navigated = true; },
    });

    await startPayment();

    const handlerPromise = capturedOptions.handler({
      razorpay_order_id: "order_switch_3",
      razorpay_payment_id: "pay_switch_3",
      razorpay_signature: "sig_switch_3",
    });

    // Switch active account before verify resolves
    activeUserRef.current = userB;
    activeOrderRef.current = null;

    resolveVerify({ data: { success: true, order_id: 999 } });
    await handlerPromise;

    assert.equal(navigated, false, "Delayed response must not navigate the new account");
    assert.equal(cartRefreshed, false, "Delayed response must not refresh the new account's cart");

    clearPendingPayment(userA);
  } finally {
    restoreAdapter();
    globalThis.window = originalWindow;
  }
});

test("BillingForm destructures setAddressSignInRequired and CustomerOrderCard never falls back to order.id", () => {
  const billingSource = fs.readFileSync(
    path.join(__dirname, "../src/components/checkout/BillingForm.jsx"),
    "utf8"
  );
  assert.match(billingSource, /addressSignInRequired,\s*setAddressSignInRequired,?\s*\}\s*=\s*useCheckoutAddresses\(/);

  const cardSource = fs.readFileSync(
    path.join(__dirname, "../src/components/orders/CustomerOrderCard.jsx"),
    "utf8"
  );
  assert.doesNotMatch(cardSource, /onCheckPending\([^)]*\|\|\s*order\.id/);
});

test("Upfront address pricing rejects incomplete/mismatched carts, preserves retry on failure, and opens Razorpay once priced", async () => {
  const {
    hasSelectedShippingRate,
    isUsableCartTotal,
    isCartAddressPriced,
    syncCartAddressPricing,
  } = await import("../src/utils/checkoutAddressPricing.js");
  const { createRazorpayHandler } = await import("../src/components/checkout/useRazorpayCheckout.js");

  const billingAddress = {
    first_name: "Lalit",
    last_name: "Sirvi",
    email: "lalit@example.com",
    phone: "9820123456",
    address_1: "Near broadway park",
    city: "Vasai West",
    state: "MH",
    postcode: "401202",
    country: "IN",
  };
  const shippingAddress = { ...billingAddress };

  // 1. Nonempty shipping_rates without any selected rate must NOT count as priced
  const unselectedRatesCart = {
    items: [{ id: 1, quantity: 2 }],
    needs_shipping: true,
    shipping_address: { ...shippingAddress },
    shipping_rates: [
      {
        package_id: 0,
        shipping_rates: [{ rate_id: "flat_rate:1", price: "4000", selected: false }],
      },
    ],
    totals: { total_items: "355200", total_shipping: "0", total_price: "355200" },
  };
  assert.equal(hasSelectedShippingRate(unselectedRatesCart), false);
  assert.equal(isCartAddressPriced(unselectedRatesCart, shippingAddress), false);

  // 2. Transient pricing failure throws and does not update cart
  let updateCartCalls = 0;
  await assert.rejects(
    syncCartAddressPricing({
      cart: unselectedRatesCart,
      billingAddress,
      shippingAddress,
      updateCartCustomerFn: async () => {
        throw new Error("Network timeout");
      },
      updateCartFn: () => {
        updateCartCalls += 1;
      },
    }),
    /Network timeout/
  );
  assert.equal(updateCartCalls, 0);

  // 3. Returned carts with unselected rates, mismatched address, or unusable total_price are rejected as "unpriced"
  const incompleteResponses = [
    unselectedRatesCart,
    {
      ...unselectedRatesCart,
      shipping_address: { ...shippingAddress, city: "Other City" },
      shipping_rates: [
        { package_id: 0, shipping_rates: [{ rate_id: "flat_rate:1", price: "4000", selected: true }] },
      ],
    },
    {
      ...unselectedRatesCart,
      shipping_rates: [
        { package_id: 0, shipping_rates: [{ rate_id: "flat_rate:1", price: "4000", selected: true }] },
      ],
      totals: { total_items: "355200", total_shipping: "4000", total_price: "0" },
    },
    {
      ...unselectedRatesCart,
      shipping_rates: [
        { package_id: 0, shipping_rates: [{ rate_id: "flat_rate:1", price: "4000", selected: true }] },
      ],
      totals: { total_items: "355200", total_shipping: "4000", total_price: "" },
    },
  ];
  for (const badCart of incompleteResponses) {
    const res = await syncCartAddressPricing({
      cart: unselectedRatesCart,
      billingAddress,
      shippingAddress,
      updateCartCustomerFn: async () => badCart,
      updateCartFn: () => {
        updateCartCalls += 1;
      },
    });
    assert.equal(res.status, "unpriced");
  }
  assert.equal(isUsableCartTotal({ totals: { total_price: "NaN" } }), false);
  assert.equal(updateCartCalls, 0);

  // 4. Successful sync returns matching address, selected shipping rate, and usable total_price (₹3,552 -> ₹3,592)
  const pricedCart = {
    items: [{ id: 1, quantity: 2 }],
    needs_shipping: true,
    shipping_address: { ...shippingAddress },
    shipping_rates: [
      {
        package_id: 0,
        shipping_rates: [{ rate_id: "flat_rate:1", price: "4000", selected: true }],
      },
    ],
    totals: { total_items: "355200", total_shipping: "4000", total_price: "359200" },
  };
  let syncedCartState = unselectedRatesCart;
  const pricedResult = await syncCartAddressPricing({
    cart: unselectedRatesCart,
    billingAddress,
    shippingAddress,
    updateCartCustomerFn: async () => pricedCart,
    updateCartFn: (nextCart) => {
      syncedCartState = nextCart;
      updateCartCalls += 1;
    },
  });
  assert.equal(pricedResult.status, "priced");
  assert.equal(pricedResult.changedTotal, true);
  assert.equal(pricedResult.previousTotalPaise, 355200);
  assert.equal(pricedResult.actualTotalPaise, 359200);
  assert.equal(updateCartCalls, 1);
  assert.equal(isCartAddressPriced(syncedCartState, shippingAddress), true);

  // 5. Once upfront pricing succeeded before the tap, createRazorpayHandler sends 359200 and opens Razorpay directly
  let createOrderPayload = null;
  let razorpayOpened = false;
  const originalWindow = globalThis.window;
  globalThis.window = {
    Razorpay: class MockRazorpay {
      constructor(opts) {
        this.opts = opts;
      }
      on() {}
      open() {
        razorpayOpened = true;
      }
    },
  };
  const restoreAdapter = setupMockAdapter(async (config) => {
    if (String(config.url).includes("/create-order")) {
      createOrderPayload = JSON.parse(config.data);
      return {
        status: 200,
        data: {
          success: true,
          razorpay_order_id: "order_first_tap_123",
          key_id: "rzp_test_key",
          amount: 359200,
          currency: "INR",
        },
      };
    }
    throw new Error(`Unexpected request: ${config.url}`);
  });

  try {
    const startPayment = createRazorpayHandler({
      user: { id: 42, email: "lalit@example.com", name: "Lalit Sirvi" },
      cart: syncedCartState,
      finalTotal: Number(syncedCartState.totals.total_price) / 100,
      billingAddress,
      shippingAddress,
      idempotencyKeyRef: { current: "idem-first-tap-1" },
      activeOrderRef: { current: null },
      activeUserRef: { current: 42 },
      isSubmittingRef: { current: true },
      pollTimerRef: { current: null },
      setLoading: () => {},
      setPaymentStep: () => {},
      setError: () => {},
      setIsPersistentPending: () => {},
      refreshCart: async () => {},
      navigate: () => {},
    });

    await startPayment();
    assert.equal(createOrderPayload.expected_total_paise, 359200);
    assert.equal(razorpayOpened, true, "Razorpay must open when upfront pricing already matched");
  } finally {
    restoreAdapter();
    globalThis.window = originalWindow;
  }
});

test("Razorpay checkout blocks order-success on on-hold/_flagged and preserves Refund pending / Confirming states", async () => {
  const originalWindow = globalThis.window;
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => originalTimeout(callback, 0);

  let capturedOptions = null;
  globalThis.window = {
    Razorpay: class MockRazorpay {
      constructor(opts) {
        capturedOptions = opts;
      }
      on() {}
      open() {}
    },
  };

  try {
    const { createRazorpayHandler } = await import(
      `../src/components/checkout/useRazorpayCheckout.js?test_pillar3=${Date.now()}`
    );
    const { getPendingPayment, clearPendingPayment } = await import(
      "../src/utils/checkoutIdempotency.js"
    );

    const runScenario = async (userId, rzpOrderId, handler) => {
      clearPendingPayment(userId);
      const restore = setupMockAdapter(handler);
      let persistentPending = false;
      let lastError = "";
      let navigatedTo = null;
      try {
        const startPayment = createRazorpayHandler({
          user: { id: userId, first_name: "Meera", email: "meera@example.com" },
          cart: { items: [{ id: 1, quantity: 1 }], totals: { total_price: "59900" } },
          finalTotal: 599,
          billingAddress: { first_name: "Meera", email: "meera@example.com" },
          shippingAddress: {},
          idempotencyKeyRef: { current: `idem-${rzpOrderId}` },
          activeOrderRef: { current: null },
          activeUserRef: { current: userId },
          isSubmittingRef: { current: true },
          pollTimerRef: { current: null },
          setLoading: () => {},
          setPaymentStep: () => {},
          setError: (msg) => { lastError = msg; },
          setIsPersistentPending: (val) => { persistentPending = val; },
          refreshCart: async () => {},
          navigate: (to) => { navigatedTo = to; },
        });
        await startPayment();
        await capturedOptions.handler({
          razorpay_order_id: rzpOrderId,
          razorpay_payment_id: `pay_${rzpOrderId}`,
          razorpay_signature: `sig_${rzpOrderId}`,
        });
        return { pending: getPendingPayment(userId), persistentPending, lastError, navigatedTo };
      } finally {
        clearPendingPayment(userId);
        restore();
      }
    };

    // 1. Flagged / on-hold order must NOT celebrate as confirmed order success
    const flaggedRes = await runScenario(42001, "order_flagged_hold", async (config) => {
      if (config.url?.includes("/create-order")) {
        return { data: { razorpay_order_id: "order_flagged_hold", key_id: "rzp_test", amount: 59900, currency: "INR" } };
      }
      if (config.url?.includes("/verify")) {
        return { data: { success: true, order_id: 901, orderStatus: "on-hold", _flagged: true, message: "Order placed on hold for verification." } };
      }
      throw new Error(`Unexpected request ${config.url}`);
    });
    assert.equal(flaggedRes.navigatedTo, null);
    assert.equal(flaggedRes.persistentPending, true);
    assert.equal(flaggedRes.pending?.support_required, true);

    // 2. Refund pending must retain pending state & keep showing Refund pending
    const refundPendingRes = await runScenario(42002, "order_refund_wait", async (config) => {
      if (config.url?.includes("/create-order")) {
        return { data: { razorpay_order_id: "order_refund_wait", key_id: "rzp_test", amount: 59900, currency: "INR" } };
      }
      if (config.url?.includes("/verify")) {
        return { status: 422, data: { success: false, code: "ITEM_OUT_OF_STOCK", refund_status: "pending", refunded: false, message: "Refund pending" } };
      }
      if (config.url?.includes("/check-status")) {
        return { data: { success: false, paid: true, terminal: false, refunded: false, refund_status: "pending", message: "Refund pending — confirming refund." } };
      }
      throw new Error(`Unexpected request ${config.url}`);
    });
    assert.equal(refundPendingRes.navigatedTo, null);
    assert.equal(refundPendingRes.persistentPending, true);
    assert.ok(refundPendingRes.pending, "Pending payment must remain until Razorpay confirms refund");
    assert.match(refundPendingRes.lastError, /Refund pending/i);

    // 3. Temporary unavailability after capture shows Payment received · Confirming your order
    const confirmingRes = await runScenario(42003, "order_confirming_wait", async (config) => {
      if (config.url?.includes("/create-order")) {
        return { data: { razorpay_order_id: "order_confirming_wait", key_id: "rzp_test", amount: 59900, currency: "INR" } };
      }
      if (config.url?.includes("/verify")) {
        return { status: 503, data: { success: false, confirming: true, paid: true, captured: true, message: "Payment received · Confirming your order" } };
      }
      if (config.url?.includes("/check-status")) {
        return { data: { success: false, confirming: true, paid: true, captured: true, terminal: false, message: "Payment received · Confirming your order" } };
      }
      throw new Error(`Unexpected request ${config.url}`);
    });
    assert.equal(confirmingRes.navigatedTo, null);
    assert.equal(confirmingRes.persistentPending, true);
    assert.match(confirmingRes.lastError, /Payment received · Confirming your order/);
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalTimeout;
    currentMockHandler = null;
  }
});

test("In-modal retry after Razorpay payment.failed (wrong UPI PIN) clears error and redirects to order-success", async () => {
  const originalWindow = globalThis.window;
  const listeners = new Map();
  let capturedOptions = null;

  globalThis.window = {
    location: { hostname: "localhost", origin: "http://localhost:5173" },
    Razorpay: class MockRazorpay {
      constructor(opts) {
        capturedOptions = opts;
      }
      on(event, fn) {
        listeners.set(event, fn);
      }
      open() {}
    },
  };

  let cancelledCalls = 0;
  let verifyCalls = 0;
  let lastError = "";
  let navigatedTo = null;
  const activeOrderRef = { current: null };
  const activeUserRef = { current: 42010 };
  const isSubmittingRef = { current: true };
  const idempotencyKeyRef = { current: "idem-pin-retry" };

  const { createRazorpayHandler } = await import(
    `../src/components/checkout/useRazorpayCheckout.js?test_pin_retry=${Date.now()}`
  );
  const { getPendingPayment, clearPendingPayment } = await import(
    "../src/utils/checkoutIdempotency.js"
  );

  const restore = setupMockAdapter(async (config) => {
    if (config.url?.includes("/create-order")) {
      return { data: { razorpay_order_id: "order_pin_retry_1", key_id: "rzp_test", amount: 59900, currency: "INR" } };
    }
    if (config.url?.includes("/cancel")) {
      cancelledCalls++;
      return { data: { cancelled: true } };
    }
    if (config.url?.includes("/verify")) {
      verifyCalls++;
      return { data: { success: true, order_id: 987, orderStatus: "processing" } };
    }
    if (config.url?.includes("/check-status")) {
      return { data: { success: false, terminal: false, paid: false } };
    }
    throw new Error(`Unexpected request ${config.url}`);
  });

  try {
    const startPayment = createRazorpayHandler({
      user: { id: 42010 },
      cart: { items: [{ id: 10, quantity: 1 }], totals: { total_price: "59900" } },
      finalTotal: 599,
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
      setIsPersistentPending: () => {},
      refreshCart: async () => {},
      navigate: (to) => { navigatedTo = to; },
    });

    await startPayment();

    // 1. First UPI attempt fails inside modal with wrong PIN
    await listeners.get("payment.failed")({
      error: {
        description: "Incorrect PIN entered. Please try again.",
        metadata: { order_id: "order_pin_retry_1" },
      },
    });
    assert.equal(cancelledCalls, 0, "must not cancel order while Razorpay modal remains open for retry");
    assert.equal(activeOrderRef.current, "order_pin_retry_1", "activeOrderRef must remain intact for in-modal retry");
    assert.equal(lastError, "Incorrect PIN entered. Please try again.");

    // 2. Shopper retries inside the same modal and payment succeeds
    await capturedOptions.handler({
      razorpay_order_id: "order_pin_retry_1",
      razorpay_payment_id: "pay_pin_retry_ok",
      razorpay_signature: "sig_pin_retry_ok",
    });

    assert.equal(verifyCalls, 1, "handler must verify the successful retry");
    assert.equal(lastError, "", "previous incorrect PIN error must be cleared on successful retry");
    assert.equal(navigatedTo, "/order-success/987");
    assert.equal(getPendingPayment(42010), null);

    // 3. If shopper instead dismisses the modal after payment.failed without paying, it cancels & keeps failure reason
    lastError = "";
    navigatedTo = null;
    await startPayment();
    await listeners.get("payment.failed")({
      error: {
        description: "Incorrect PIN entered. Please try again.",
        metadata: { order_id: "order_pin_retry_1" },
      },
    });
    await capturedOptions.modal.ondismiss();
    assert.equal(cancelledCalls, 1, "dismissing modal after failure must cancel the order");
    assert.equal(lastError, "Incorrect PIN entered. Please try again.");
    assert.equal(activeOrderRef.current, null);
  } finally {
    clearPendingPayment(42010);
    restore();
    globalThis.window = originalWindow;
  }
});
