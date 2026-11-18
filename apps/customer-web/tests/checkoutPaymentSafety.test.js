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
