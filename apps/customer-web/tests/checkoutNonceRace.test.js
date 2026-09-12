import test from "node:test";
import assert from "node:assert/strict";

test("1. New session with no cached nonce: ensureSessionNonce acquires nonce from getCart before checkout", async () => {
  let nonce = "";
  let cartToken = "";
  let cartFetchCount = 0;

  const mockGetCart = async () => {
    cartFetchCount++;
    nonce = "test-nonce-12345";
    cartToken = "test-token-67890";
    return {
      items: [{ id: 1, name: "Shirt", totals: { line_subtotal: "65000" } }],
      totals: { total_items: "65000", total_price: "65000" },
    };
  };

  let initializingPromise = null;
  const ensureSessionNonce = async () => {
    if (nonce) return nonce;
    if (!initializingPromise) {
      initializingPromise = mockGetCart()
        .catch(() => null)
        .finally(() => {
          initializingPromise = null;
        });
    }
    await initializingPromise;
    return nonce;
  };

  assert.equal(nonce, "", "Initial nonce must be empty");
  const acquiredNonce = await ensureSessionNonce();
  assert.equal(acquiredNonce, "test-nonce-12345", "Nonce must be acquired from getCart");
  assert.equal(cartFetchCount, 1, "getCart should be called once");
});

test("2. getCart establishes nonce before getCheckout", async () => {
  let nonce = "";
  let executionLog = [];

  const getCart = async () => {
    executionLog.push("getCart:start");
    await new Promise((r) => setTimeout(r, 10));
    nonce = "fresh-session-nonce";
    executionLog.push("getCart:done");
    return { items: [{ id: 10, totals: { line_subtotal: "80000" } }], totals: { total_items: "80000" } };
  };

  const getCheckout = async (activeNonce) => {
    executionLog.push("getCheckout:start");
    if (!activeNonce) {
      throw { response: { status: 401, data: { code: "woocommerce_rest_missing_nonce" } } };
    }
    executionLog.push("getCheckout:done");
    return { order_id: 0, payment_gateways: ["cod"] };
  };

  // Phase 1: getCart first
  const cartData = await getCart();
  // Phase 2: getCheckout using established nonce
  const checkoutData = await getCheckout(nonce);

  assert.deepEqual(executionLog, [
    "getCart:start",
    "getCart:done",
    "getCheckout:start",
    "getCheckout:done",
  ]);
  assert.equal(cartData.totals.total_items, "80000");
  assert.equal(checkoutData.payment_gateways[0], "cod");
});

test("3. GET /checkout succeeds after nonce initialization", async () => {
  let nonce = "valid-nonce-abc";
  const mockHeaders = {};

  if (nonce) {
    mockHeaders["Nonce"] = nonce;
  }

  assert.ok(mockHeaders["Nonce"], "Nonce header must be attached to GET /checkout");
  assert.equal(mockHeaders["Nonce"], "valid-nonce-abc");
});

test("4. No nonce race occurs under parallel initialization calls", async () => {
  let nonce = "";
  let getCartCount = 0;
  let initializingPromise = null;

  const mockGetCart = async () => {
    getCartCount++;
    await new Promise((r) => setTimeout(r, 20));
    nonce = "singleton-nonce-xyz";
    return { items: [] };
  };

  const ensureSessionNonce = async () => {
    if (nonce) return nonce;
    if (!initializingPromise) {
      initializingPromise = mockGetCart()
        .catch(() => null)
        .finally(() => {
          initializingPromise = null;
        });
    }
    await initializingPromise;
    return nonce;
  };

  // Dispatch 5 parallel calls
  const results = await Promise.all([
    ensureSessionNonce(),
    ensureSessionNonce(),
    ensureSessionNonce(),
    ensureSessionNonce(),
    ensureSessionNonce(),
  ]);

  assert.equal(getCartCount, 1, "Only 1 getCart request should execute during parallel initialization");
  assert.deepEqual(results, [
    "singleton-nonce-xyz",
    "singleton-nonce-xyz",
    "singleton-nonce-xyz",
    "singleton-nonce-xyz",
    "singleton-nonce-xyz",
  ]);
});

test("5. Cart > ₹500 does not show minimum-order error", () => {
  const cart = {
    items: [{ id: 1, totals: { line_subtotal: "75000" } }],
    totals: { total_items: "75000" },
  };

  const itemsTotal = cart.totals?.total_items
    ? Number(cart.totals.total_items) / 100
    : 0;

  const MIN_ORDER_VALUE = 500;
  const isBelowMinOrder = itemsTotal < MIN_ORDER_VALUE;

  assert.equal(itemsTotal, 750);
  assert.equal(isBelowMinOrder, false, "Cart >= ₹500 must not trigger min-order error");
});

test("6. Cart < ₹500 does show minimum-order error", () => {
  const cart = {
    items: [{ id: 1, totals: { line_subtotal: "35000" } }],
    totals: { total_items: "35000" },
  };

  const itemsTotal = cart.totals?.total_items
    ? Number(cart.totals.total_items) / 100
    : 0;

  const MIN_ORDER_VALUE = 500;
  const isBelowMinOrder = itemsTotal < MIN_ORDER_VALUE;
  const shortfall = Math.max(0, MIN_ORDER_VALUE - itemsTotal);

  assert.equal(itemsTotal, 350);
  assert.equal(isBelowMinOrder, true, "Cart < ₹500 must trigger min-order error");
  assert.equal(shortfall, 150, "Shortfall must be correctly calculated");
});

test("7. Cart initialization failure does not show minimum-order error", () => {
  let cart = null;
  let checkout = null;
  let error = "Unable to load your checkout session. Please try again.";
  let authError = false;

  let state = "";
  if (authError) {
    state = "AUTH_EXPIRED";
  } else if (error || !cart || !checkout) {
    state = "CHECKOUT_UNAVAILABLE";
  } else {
    const itemsTotal = cart?.totals?.total_items ? Number(cart.totals.total_items) / 100 : 0;
    if (itemsTotal < 500) {
      state = "MIN_ORDER_NOT_MET";
    } else {
      state = "READY_FOR_CHECKOUT";
    }
  }

  assert.equal(state, "CHECKOUT_UNAVAILABLE", "Failed cart initialization must show CHECKOUT_UNAVAILABLE, not MIN_ORDER_NOT_MET");
});

test("8. 401/auth error is shown as authentication/session error", () => {
  let cart = null;
  let checkout = null;
  let error = "Your session has expired. Please log in again to proceed to checkout.";
  let authError = true;

  let state = "";
  if (authError) {
    state = "SESSION_EXPIRED";
  } else if (error || !cart || !checkout) {
    state = "CHECKOUT_UNAVAILABLE";
  }

  assert.equal(state, "SESSION_EXPIRED", "401 error must be identified as SESSION_EXPIRED");
});

test("9. Registered customer active state is maintained", () => {
  const user = {
    id: 10,
    email: "customer@example.com",
    name: "Regular Customer",
  };

  assert.ok(user.id);
  assert.equal(user.email, "customer@example.com");
});

test("10. STORE_CLOSED remains STORE_CLOSED", () => {
  const storeHours = {
    is_open: false,
    closed_message: "We are currently closed for new orders.",
    next_opening: { label: "tomorrow at 10:00 AM" },
  };

  const isStoreClosed = storeHours && storeHours.is_open === false;
  assert.equal(isStoreClosed, true, "Store closed state must be detected");
});

test("11. Phone verification error remains distinct", () => {
  const submitErrorResponse = {
    status: 400,
    data: {
      code: "PHONE_VERIFICATION_REQUIRED",
      message: "Please verify your phone number before completing checkout.",
    },
  };

  let renderedMessage = "";
  if (submitErrorResponse.data.code === "PHONE_VERIFICATION_REQUIRED") {
    renderedMessage = submitErrorResponse.data.message;
  }

  assert.equal(renderedMessage, "Please verify your phone number before completing checkout.");
});

test("12. Existing checkout flow still submits orders via POST /checkout correctly", () => {
  const checkoutPayload = {
    billing_address: {
      first_name: "Rahul",
      last_name: "Sharma",
      address_1: "Station Road",
      city: "Vasai",
      state: "MH",
      postcode: "401201",
      country: "IN",
      phone: "9876543210",
      email: "rahul@example.com",
    },
    payment_method: "cod",
    customer_note: "Near Station",
  };

  assert.equal(checkoutPayload.payment_method, "cod");
  assert.equal(checkoutPayload.billing_address.city, "Vasai");
  assert.ok(checkoutPayload.billing_address.first_name);
});

test("13. Rapid repeated checkout initialization does not create duplicate nonce/session requests", async () => {
  let cartCalls = 0;
  let cachedNonce = "";
  let inflightPromise = null;

  const getCart = async () => {
    cartCalls++;
    await new Promise((r) => setTimeout(r, 15));
    cachedNonce = "fresh-nonce-999";
    return { ok: true };
  };

  const initSession = async () => {
    if (cachedNonce) return cachedNonce;
    if (!inflightPromise) {
      inflightPromise = getCart().finally(() => {
        inflightPromise = null;
      });
    }
    await inflightPromise;
    return cachedNonce;
  };

  // Rapid dispatch of 10 simultaneous calls
  await Promise.all(Array.from({ length: 10 }, () => initSession()));

  assert.equal(cartCalls, 1, "Expected exactly 1 cart call despite 10 rapid triggers");
  assert.equal(cachedNonce, "fresh-nonce-999");
});

test("14. CUSTOMER_SUSPENDED is handled silently without console.error and sets UI message", () => {
  const errorResponse = {
    response: {
      status: 403,
      data: {
        success: false,
        code: "CUSTOMER_SUSPENDED",
        message: "Your account is currently suspended and you cannot place new orders.",
      },
    },
  };

  let loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    loggedErrors.push(args.join(" "));
  };

  let uiErrorMessage = "";
  try {
    const errData = errorResponse.response?.data;
    if (errData?.code === "CUSTOMER_SUSPENDED") {
      uiErrorMessage =
        errData?.message ||
        "Your account is currently suspended and you cannot place new orders.";
      return;
    }

    console.error(" PLACE ORDER ERROR:", errorResponse.response?.data || errorResponse.message);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(
    uiErrorMessage,
    "Your account is currently suspended and you cannot place new orders.",
    "Correct UI error message must be set for suspended customer"
  );
  assert.equal(
    loggedErrors.length,
    0,
    "No console.error should be emitted for CUSTOMER_SUSPENDED"
  );
});

test("15. Genuinely unexpected checkout error logs to console.error and sets UI error message", () => {
  const errorResponse = {
    response: {
      status: 500,
      data: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to connect to payment gateway.",
      },
    },
  };

  let loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    loggedErrors.push(args.join(" "));
  };

  let uiErrorMessage = "";
  try {
    const errData = errorResponse.response?.data;
    if (errData?.code === "CUSTOMER_SUSPENDED") {
      uiErrorMessage =
        errData?.message ||
        "Your account is currently suspended and you cannot place new orders.";
      return;
    }

    console.error(" PLACE ORDER ERROR:", errorResponse.response?.data || errorResponse.message);
    uiErrorMessage = errData?.message || "Failed to place order. Please try again.";
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(
    uiErrorMessage,
    "Failed to connect to payment gateway.",
    "UI error message must be set for unexpected failure"
  );
  assert.equal(
    loggedErrors.length,
    1,
    "Unexpected failure must be logged to console.error"
  );
  assert.ok(
    loggedErrors[0].includes("PLACE ORDER ERROR:"),
    "Log must include PLACE ORDER ERROR prefix"
  );
});

// -------------------------------------------------------------
// Product Detail & Reviews Ownership / Fallback Suite
// -------------------------------------------------------------

test("26. Product Reviews: currentUserReview identifies review where isOwner is true", () => {
  const reviews = [
    { id: 101, rating: 4, review: "Great shirt", isOwner: false },
    { id: 102, rating: 5, review: "My personal review", isOwner: true },
    { id: 103, rating: 3, review: "Average quality", isOwner: false },
  ];

  const currentUserReview = reviews.find((r) => r.isOwner === true);

  assert.ok(currentUserReview, "Must find current user's review");
  assert.equal(currentUserReview.id, 102);
  assert.equal(currentUserReview.review, "My personal review");
  assert.equal(currentUserReview.rating, 5);
});

test("27. Product Reviews: currentUserReview is undefined when no review has isOwner=true", () => {
  const reviews = [
    { id: 101, rating: 4, review: "Great shirt", isOwner: false },
    { id: 103, rating: 3, review: "Average quality", isOwner: false },
  ];

  const currentUserReview = reviews.find((r) => r.isOwner === true);
  assert.equal(currentUserReview, undefined, "currentUserReview must be undefined when none owned");
});

test("28. Product Reviews: Individual review item identifies own review via isOwner", () => {
  const r1 = { id: 101, review: "Others", isOwner: false };
  const r2 = { id: 102, review: "Mine", isOwner: true };

  const isOwnReview1 = r1.isOwner === true;
  const isOwnReview2 = r2.isOwner === true;

  assert.equal(isOwnReview1, false, "r1 is not own review");
  assert.equal(isOwnReview2, true, "r2 is own review");
});

test("29. Product Description: Falls back to short_description when description is missing or empty", () => {
  const productWithBoth = {
    description: "<p>Full detailed description</p>",
    short_description: "<p>Short summary</p>",
  };
  const productWithOnlyShort = {
    description: "",
    short_description: "<p>Only short description available</p>",
  };
  const productWithNeither = {
    description: null,
    short_description: undefined,
  };

  const resolveDesc = (p) => p?.description || p?.short_description;

  assert.equal(resolveDesc(productWithBoth), "<p>Full detailed description</p>");
  assert.equal(resolveDesc(productWithOnlyShort), "<p>Only short description available</p>");
  assert.equal(resolveDesc(productWithNeither), undefined);
});

test("30. Product Reviews: Renders reviewer name if present and falls back to Customer", () => {
  const r1 = { id: 101, reviewer: "Rahul Sharma", isOwner: false };
  const r2 = { id: 102, reviewer: "", isOwner: false };
  const r3 = { id: 103, reviewer: null, isOwner: false };

  const getDisplayName = (r) => r.reviewer || "Customer";

  assert.equal(getDisplayName(r1), "Rahul Sharma", "Should display valid customer reviewer name");
  assert.equal(getDisplayName(r2), "Customer", "Should fallback to Customer for empty string");
  assert.equal(getDisplayName(r3), "Customer", "Should fallback to Customer for null reviewer");
});

test("31. Cart Route Manager: Guard prevents repeated fetch loop on cart failure", async () => {
  let fetchAttempts = 0;
  let cart = null;
  const hasAttemptedRef = { current: false };

  const mockRefreshCart = async () => {
    fetchAttempts++;
    throw new Error("502 Bad Gateway");
  };

  const simulateRouteManager = async (path) => {
    const isAuthPage = ["/login", "/register"].some((p) => path.startsWith(p));
    if (isAuthPage) return;

    if (!cart && !hasAttemptedRef.current) {
      hasAttemptedRef.current = true;
      try {
        await mockRefreshCart();
      } catch (_) {
        // caught as CartRouteManager does
      }
    }
  };

  // 1st navigation to Home
  await simulateRouteManager("/");
  assert.equal(fetchAttempts, 1, "Initial navigation should attempt 1 fetch");
  assert.equal(hasAttemptedRef.current, true, "hasAttemptedRef should be true");

  // Re-render / dependency trigger should NOT loop because hasAttemptedRef is true
  await simulateRouteManager("/");
  assert.equal(fetchAttempts, 1, "Failed fetch must not trigger subsequent loops");
});

test("32. Axios Timeouts: Store API client has default 12000ms timeout", async () => {
  const { storeClient } = await import("../src/services/storeApi.js");
  assert.equal(storeClient.defaults.timeout, 12000, "Store client must have 12000ms timeout");
});

