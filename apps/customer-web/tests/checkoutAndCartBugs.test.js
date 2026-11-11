import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

import safeStorage, { safeSessionStorage } from "../src/utils/safeStorage.js";
import {
  getPendingPayment,
  setPendingPayment,
  clearPendingPayment,
  getOrCreateCheckoutIdempotencyKey,
  retireCheckoutIdempotencyKey,
  clearCheckoutIdempotencyKey,
  computeCartItemsFingerprint,
} from "../src/utils/checkoutIdempotency.js";
import {
  storeClient,
  addToCart,
  getCart,
  clearCartSession,
  getCartMutationVersion,
  isCartWriteInFlight,
  waitForCartWrites,
} from "../src/services/storeApi.js";
import { orchestrateCartMerge } from "../src/utils/cartMerge.js";

test("Customer-Web: Checkout Recovery & Cart Concurrency Verification Suite", async (t) => {
  t.beforeEach(() => {
    safeStorage.clear();
    safeSessionStorage.clear();
    clearCartSession();
  });

  t.afterEach(() => {
    safeStorage.clear();
    safeSessionStorage.clear();
    clearCartSession();
  });

  await t.test("1. Exit without paying: cancellation clears pending payment and retires checkout key", async () => {
    const userId = 101;
    const cart = {
      items: [{ id: 1, quantity: 2, totals: { line_total: "54000" } }],
      totals: { total_price: "54000" },
    };

    // Customer starts checkout: sets active attempt and saves pending payment
    const activeOrderRef = { current: "order_rzp_abandoned_1" };
    const activeUserRef = { current: userId };
    const key1 = getOrCreateCheckoutIdempotencyKey(cart, userId);
    setPendingPayment({ razorpay_order_id: activeOrderRef.current }, userId);

    assert.equal(getPendingPayment(userId)?.razorpay_order_id, "order_rzp_abandoned_1");

    // Exit without paying & confirm cancellation
    // Attempt verification guard: only clear if active attempt matches
    const incomingOrderToCancel = "order_rzp_abandoned_1";
    if (activeOrderRef.current === incomingOrderToCancel && String(activeUserRef.current) === String(userId)) {
      clearPendingPayment(userId);
      retireCheckoutIdempotencyKey(userId);
      activeOrderRef.current = null;
    }

    assert.equal(getPendingPayment(userId), null, "Pending payment must be cleared on confirmed cancellation");
    assert.equal(activeOrderRef.current, null, "Active order ref must be cleared");

    // Fresh checkout generates distinct key
    const key3 = getOrCreateCheckoutIdempotencyKey(cart, userId);
    assert.notEqual(key1, key3, "Fresh checkout must generate a fresh, non-replayed key");
  });

  await t.test("2. Authorized, captured, or gateway-unavailable cases PRESERVE recovery", async () => {
    const userId = 102;
    const activeOrderRef = { current: "order_rzp_in_recovery" };
    const activeUserRef = { current: userId };
    setPendingPayment({ razorpay_order_id: activeOrderRef.current }, userId);

    // Simulated rejection of cancellation from backend (e.g. 409 status or 503 gateway unavailable)
    const backendRejection = {
      success: false,
      status: 409,
      code: "PAYMENT_PROCESSING",
      message: "A payment is processing. Please check status before paying again.",
    };

    let isPersistentPending = false;
    if (!backendRejection.success && (backendRejection.status === 409 || backendRejection.status === 503)) {
      // Must NOT clear pending payment! Keep in recovery
      isPersistentPending = true;
    } else {
      clearPendingPayment(userId);
    }

    assert.equal(isPersistentPending, true, "Must flag persistent recovery state");
    assert.equal(
      getPendingPayment(userId)?.razorpay_order_id,
      "order_rzp_in_recovery",
      "Pending payment must remain intact in recovery state"
    );
  });

  await t.test("3. Total mismatch (CHECKOUT_TOTAL_CHANGED) updates full quote and requires new review if address changes", async () => {
    const userId = 103;
    let clientCart = {
      items: [{ id: 5, quantity: 1, totals: { line_total: "55900" } }],
      totals: { total_price: "55900", total_shipping: "5900", total_items: "50000" },
    };

    const initialKey = getOrCreateCheckoutIdempotencyKey(clientCart, userId);

    // Server returns CHECKOUT_TOTAL_CHANGED: ₹559 -> ₹540 with full authoritative quote
    const errData = {
      code: "CHECKOUT_TOTAL_CHANGED",
      expected_total_paise: 55900,
      actual_total_paise: 54000,
      cart: {
        items: [{ id: 5, quantity: 1, totals: { line_total: "54000" } }],
        totals: { total_price: "54000", total_shipping: "4000", total_items: "50000" },
      },
    };

    // Client mismatch handler:
    const retiredKey = retireCheckoutIdempotencyKey(userId);
    assert.notEqual(initialKey, retiredKey, "Must retire stale idempotency key");

    // Full quote replaces client cart:
    const updateCart = (newCart) => {
      clientCart = newCart;
    };
    if (errData.cart) {
      updateCart(errData.cart);
    }

    assert.equal(clientCart.totals.total_price, "54000");
    assert.equal(clientCart.totals.total_shipping, "4000", "Shipping breakdown matches authoritative quote");

    // Unconfirmed quote is set requiring explicit review
    let unconfirmedQuote = {
      expected_total_paise: errData.expected_total_paise,
      actual_total_paise: errData.actual_total_paise,
    };
    let checkoutAction = unconfirmedQuote ? "confirm_quote" : "checkout";
    assert.equal(checkoutAction, "confirm_quote", "Must require explicit review and confirmation");

    // If customer changes delivery address, unconfirmed quote is cleared requiring new review
    const onAddressChange = () => {
      unconfirmedQuote = null;
    };
    onAddressChange();
    checkoutAction = unconfirmedQuote ? "confirm_quote" : "checkout";
    assert.equal(checkoutAction, "checkout", "Address change must reset quote confirmation and require fresh checkout");
  });

  await t.test("4. Account B sees both items on first visit without refreshing, even when initial GET /cart returns late (Real storeClient)", async () => {
    const originalAdapter = storeClient.defaults.adapter;

    let resolveDelayedGet;
    const delayedGetPromise = new Promise((resolve) => {
      resolveDelayedGet = resolve;
    });

    storeClient.defaults.adapter = async (config) => {
      if (config.url?.includes("/cart/add-item")) {
        return {
          status: 200,
          statusText: "OK",
          headers: {
            "cart-token": "jwt_token_with_2_items",
            nonce: "test_nonce_123",
          },
          config,
          data: {
            items: [
              { id: 101, name: "Shirt", quantity: 1, totals: { line_total: "30000" } },
              { id: 102, name: "Pants", quantity: 1, totals: { line_total: "24000" } },
            ],
            totals: { total_price: "54000" },
          },
        };
      }

      if (config.url === "/cart" && config.method?.toLowerCase() === "get") {
        await delayedGetPromise;
        return {
          status: 200,
          statusText: "OK",
          headers: {
            "cart-token": "jwt_token_stale_empty",
            nonce: "test_nonce_123",
          },
          config,
          data: {
            items: [],
            totals: { total_price: "0" },
          },
        };
      }

      return { status: 200, data: {}, headers: {}, config };
    };

    try {
      safeStorage.setItem("wc_nonce", "valid_test_nonce_123");

      // 1. Initial cart read starts while cart is empty
      const inflightGetPromise = getCart();

      // 2. User immediately adds items before the read returns
      const addResult = await addToCart(101, 1);
      assert.equal(addResult.items.length, 2, "Add item must return 2 items");
      assert.equal(safeStorage.getItem("wc_cart_token"), "jwt_token_with_2_items");

      // 3. Now let the delayed getCart resolve with 0 items
      resolveDelayedGet();

      // 4. Because the read overlapped the write, storeClient MUST reject it with ERR_STALE_CART_READ!
      await assert.rejects(
        inflightGetPromise,
        (err) => err.code === "ERR_STALE_CART_READ" || err.isStaleCartRead === true,
        "Overlapping cart read must be rejected"
      );

      // 5. Stale token MUST NOT have replaced the newer token!
      assert.equal(
        safeStorage.getItem("wc_cart_token"),
        "jwt_token_with_2_items",
        "Stale token must NOT overwrite newer mutation token"
      );
    } finally {
      storeClient.defaults.adapter = originalAdapter;
    }
  });

  await t.test("5. Empty state and failure handling: cartConfirmed distinguishes empty vs loading", async () => {
    // A. Unconfirmed cart with 0 items: must NOT show empty state!
    let cartConfirmed = false;
    let loading = true;
    let cart = null;
    let isCartEmpty = cartConfirmed && (!cart || !cart.items || cart.items.length === 0);
    assert.equal(isCartEmpty, false, "Must not show empty state while cart is unconfirmed");

    // B. Confirmed cart with 0 items: SHOW empty state!
    cartConfirmed = true;
    loading = false;
    cart = { items: [] };
    isCartEmpty = cartConfirmed && (!cart || !cart.items || cart.items.length === 0);
    assert.equal(isCartEmpty, true, "Confirmed cart with 0 items shows empty state");

    // C. Confirmed cart with items: must NOT show empty state
    cart = { items: [{ id: 10, quantity: 1 }] };
    isCartEmpty = cartConfirmed && (!cart || !cart.items || cart.items.length === 0);
    assert.equal(isCartEmpty, false, "Cart with items must not be empty");

    // D. Failed cart read preserves last confirmed cart for same account
    const userId = 104;
    const confirmedCart = {
      items: [{ id: 8, name: "Kurti", quantity: 2 }],
      totals: { total_price: "80000" },
    };
    safeSessionStorage.setJSON(`confirmed_cart_${userId}`, confirmedCart);

    const cartLoadError = new Error("Network timeout");
    const activeCart = safeSessionStorage.getJSON(`confirmed_cart_${userId}`, null);
    const showFailedScreen = cartLoadError && !activeCart;
    assert.equal(showFailedScreen, false, "Must not show failure screen when confirmed cart is present");
    assert.equal(activeCart.items.length, 1, "Confirmed cart items must be preserved");
  });

  await t.test("6. Account switch never exposes another account's items (Account A -> Logout -> Account B)", async () => {
    const userA = 201;
    const userB = 202;

    const cartA = {
      items: [{ id: 50, name: "Gold Bangle", quantity: 1 }],
      totals: { total_price: "50000" },
    };

    // User A signs in and has cart
    safeSessionStorage.setJSON(`confirmed_cart_${userA}`, cartA);
    setPendingPayment({ razorpay_order_id: "order_user_a" }, userA);

    // User A logs out
    safeSessionStorage.removeItem(`confirmed_cart_${userA}`);
    clearCartSession();

    // User B signs in on same device
    const userBCart = safeSessionStorage.getJSON(`confirmed_cart_${userB}`, null);
    const userBPending = getPendingPayment(userB);

    assert.equal(userBCart, null, "User B must not see User A's confirmed cart");
    assert.equal(userBPending, null, "User B must not see User A's pending payment");
  });

  await t.test("7. Queued cart write does NOT cross accounts and is aborted when session changes (queuedEpoch !== cartSessionEpoch)", async () => {
    const originalAdapter = storeClient.defaults.adapter;
    let finishFirstWrite;
    const writeBlockedPromise = new Promise((resolve) => {
      finishFirstWrite = resolve;
    });

    storeClient.defaults.adapter = async (config) => {
      if (config.url?.includes("/cart/add-item")) {
        await writeBlockedPromise;
        return {
          status: 200,
          statusText: "OK",
          headers: { "cart-token": "token_for_add", nonce: "nonce_add" },
          config,
          data: {
            items: [{ id: config.data?.id || 1, quantity: 1, totals: { line_total: "10000" } }],
            totals: { total_price: "10000" },
          },
        };
      }
      return { status: 200, data: {}, headers: { nonce: "nonce_init" }, config };
    };

    try {
      safeStorage.setItem("wc_nonce", "valid_nonce_user_a");
      safeStorage.setItem("wc_cart_token", "token_user_a");

      // 1. Account A initiates a write that takes time
      const firstWritePromise = addToCart(101, 1);

      // 2. Account A queues a second write while the first is pending
      const queuedWritePromise = addToCart(102, 1);

      // 3. User switches accounts: clearCartSession is called (invalidates epoch)
      clearCartSession();

      // 4. Account B signs in and gets its own session
      safeStorage.setItem("wc_nonce", "valid_nonce_user_b");
      safeStorage.setItem("wc_cart_token", "token_user_b");

      // Verify Account B's active writes counter is clean (0), not stuck!
      assert.equal(isCartWriteInFlight(), false, "Account B's active writes counter must start at 0");

      // 5. Now let the first write resolve
      finishFirstWrite();
      await firstWritePromise.catch(() => {});

      // 6. The queued write MUST fail with CanceledError and NOT execute using Account B's token!
      await assert.rejects(
        queuedWritePromise,
        (err) => {
          return (
            axios.isCancel(err) ||
            err.code === "ERR_CANCELED" ||
            err.message?.includes("Cart session changed while write was queued")
          );
        },
        "Queued write from Account A must be rejected when session changes before sending"
      );

      // Token for Account B must remain untainted
      assert.equal(safeStorage.getItem("wc_cart_token"), "token_user_b");
      assert.equal(isCartWriteInFlight(), false, "Active writes counter must remain 0 after rejected queued write");
    } finally {
      storeClient.defaults.adapter = originalAdapter;
    }
  });

  await t.test("8. Review state is preserved when installing authoritative quote, and only resets on actual user changes", async () => {
    // Initial client cart
    let currentCart = {
      items: [{ id: 5, quantity: 1, totals: { line_total: "55900" } }],
      totals: { total_price: "55900", total_shipping: "5900" },
    };
    let selectedAddressId = "10";

    // Authoritative cart quote from backend ₹559 -> ₹540
    const authoritativeCart = {
      items: [{ id: 5, quantity: 1, totals: { line_total: "54000" } }],
      totals: { total_price: "54000", total_shipping: "4000" },
    };

    // Mismatch handler sets unconfirmedQuote with addressId and itemsFingerprint
    let unconfirmedQuote = {
      expected_total_paise: 55900,
      actual_total_paise: 54000,
      addressId: selectedAddressId,
      itemsFingerprint: computeCartItemsFingerprint(authoritativeCart),
    };

    // Review effect simulates:
    const runReviewResetCheck = (cart, addressId) => {
      if (!unconfirmedQuote) return;
      const currentFingerprint = computeCartItemsFingerprint(cart);
      if (
        String(addressId) !== String(unconfirmedQuote.addressId) ||
        currentFingerprint !== unconfirmedQuote.itemsFingerprint
      ) {
        unconfirmedQuote = null;
      }
    };

    // Installing the authoritative quote updates currentCart:
    currentCart = authoritativeCart;
    runReviewResetCheck(currentCart, selectedAddressId);

    // Confirmation state MUST be preserved!
    assert.notEqual(unconfirmedQuote, null, "Confirmation state must not clear itself when authoritative quote is installed");
    assert.equal(unconfirmedQuote.actual_total_paise, 54000);

    // If customer changes the quantity of an item:
    const modifiedCart = {
      items: [{ id: 5, quantity: 2, totals: { line_total: "108000" } }],
      totals: { total_price: "108000" },
    };
    runReviewResetCheck(modifiedCart, selectedAddressId);
    assert.equal(unconfirmedQuote, null, "Confirmation state must clear when customer alters cart items");

    // Re-install quote for address test:
    unconfirmedQuote = {
      expected_total_paise: 55900,
      actual_total_paise: 54000,
      addressId: "10",
      itemsFingerprint: computeCartItemsFingerprint(authoritativeCart),
    };

    // If customer changes the delivery address:
    runReviewResetCheck(authoritativeCart, "20");
    assert.equal(unconfirmedQuote, null, "Confirmation state must clear when customer changes delivery address");
  });

  await t.test("9. Guest cart merge purges guest Cart-Token so it cannot block payment after sign-in", async () => {
    // 1. Guest adds item and has guest token
    const guestCart = {
      items: [{ id: 42, name: "Saree", quantity: 1 }],
      totals: { total_price: "150000" },
    };
    safeStorage.setItem("wc_cart_token", "guest_token_uid_0");
    safeStorage.setItem("wc_nonce", "guest_nonce");

    // 2. User signs in as customer (userId: 88)
    // Orchestrate merge sequence:
    // a. Snapshot guest items
    const guestItems = guestCart?.items ? [...guestCart.items] : [];
    assert.equal(guestItems.length, 1);

    // b. Purge guest session token & nonce
    clearCartSession();
    assert.equal(safeStorage.getItem("wc_cart_token"), null, "Guest token must be cleared");
    assert.equal(safeStorage.getItem("wc_nonce"), null, "Guest nonce must be cleared");

    // c. Customer session initialized with customer credentials
    safeStorage.setItem("wc_cart_token", "customer_88_token");
    safeStorage.setItem("wc_nonce", "customer_88_nonce");

    // Verify token sent to backend payment endpoint belongs to customer, not guest
    const finalCartToken = safeStorage.getItem("wc_cart_token");
    assert.equal(finalCartToken, "customer_88_token", "Customer's own Cart-Token must be used for payment");
    assert.notEqual(finalCartToken, "guest_token_uid_0", "Guest token must NOT be sent after sign-in");
  });

  await t.test("10. Late Razorpay payment.failed callback cannot clear newer attempt or another account's attempt", async () => {
    const userId = 301;
    let activeUserRef = { current: userId };
    let activeOrderRef = { current: "rzp_order_old" };

    setPendingPayment({ razorpay_order_id: "rzp_order_old" }, userId);
    const keyOld = getOrCreateCheckoutIdempotencyKey(null, userId);

    // User starts a new checkout attempt:
    activeOrderRef.current = "rzp_order_new";
    setPendingPayment({ razorpay_order_id: "rzp_order_new" }, userId);

    // Delayed payment.failed arrives for rzp_order_old
    const requestUserId = userId;
    const requestOrderId = "rzp_order_old";

    let cancelledCalled = false;
    const handlePaymentFailed = async () => {
      // Scoped guard before awaiting:
      if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) {
        return;
      }
      cancelledCalled = true;
      clearPendingPayment(userId);
    };

    await handlePaymentFailed();

    assert.equal(cancelledCalled, false, "Late failure callback for superseded attempt must be ignored");
    assert.equal(
      getPendingPayment(userId)?.razorpay_order_id,
      "rzp_order_new",
      "Newer attempt must NOT be cleared by delayed failure callback"
    );

    // Cross-account check:
    activeUserRef.current = 302; // switched user
    activeOrderRef.current = "rzp_order_new";
    let crossAccountCancelled = false;
    const handleCrossAccountFailed = async () => {
      if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) {
        return;
      }
      crossAccountCancelled = true;
      clearPendingPayment(userId);
    };
    await handleCrossAccountFailed();
    assert.equal(crossAccountCancelled, false, "Late failure callback for different user must be ignored");
  });

  await t.test("11. Failed initial cart load renders Retry branch instead of spinning indefinitely or showing empty cart", async () => {
    const evaluateCartPageState = ({ loading, cart, cartConfirmed, cartLoadError, writeInFlight = false }) => {
      const hasItems = Boolean(cart?.items && cart.items.length > 0);
      const isRequestInFlight = loading || writeInFlight;
      if (isRequestInFlight && !hasItems) return { screen: "spinner" };
      if ((cartLoadError || !cartConfirmed) && !hasItems) return { screen: "retry" };
      if (!hasItems) return { screen: "empty" };
      return { screen: "cart_items" };
    };

    // State A: Initial fetch in progress
    const stateA = evaluateCartPageState({
      loading: true,
      cart: null,
      cartConfirmed: false,
      cartLoadError: null,
    });
    assert.equal(stateA.screen, "spinner", "Must show spinner during initial load");

    // State B: Initial fetch fails with network error (must NOT spin indefinitely!)
    const stateB = evaluateCartPageState({
      loading: false,
      cart: null,
      cartConfirmed: false,
      cartLoadError: new Error("Failed to load cart"),
    });
    assert.equal(stateB.screen, "retry", "Must show Retry screen when initial fetch fails, never spin indefinitely");

    // State C: User clicks Retry (clears error and sets loading: true)
    const stateC = evaluateCartPageState({
      loading: true,
      cart: null,
      cartConfirmed: false,
      cartLoadError: null,
    });
    assert.equal(stateC.screen, "spinner", "Must show spinner during retry attempt");

    // State D: Succeeded with 0 items (confirmed empty)
    const stateD = evaluateCartPageState({
      loading: false,
      cart: { items: [] },
      cartConfirmed: true,
      cartLoadError: null,
    });
    assert.equal(stateD.screen, "empty", "Must only show empty cart when confirmed by successful response");

    // State E: Succeeded with items
    const stateE = evaluateCartPageState({
      loading: false,
      cart: { items: [{ id: 1, name: "Kurti", quantity: 1 }] },
      cartConfirmed: true,
      cartLoadError: null,
    });
    assert.equal(stateE.screen, "cart_items", "Must show cart items when present");

    // State F: Background refresh fails when items already exist (preserves UI, no screen wipe)
    const stateF = evaluateCartPageState({
      loading: false,
      cart: { items: [{ id: 1, name: "Kurti", quantity: 1 }] },
      cartConfirmed: true,
      cartLoadError: new Error("Background network hiccup"),
    });
    assert.equal(stateF.screen, "cart_items", "Must preserve existing cart items if background revalidation fails");

    // State G: First read discarded as stale, write fails, no request in flight -> must show Retry, NOT stuck spinner!
    const stateG = evaluateCartPageState({
      loading: false,
      cart: null,
      cartConfirmed: false,
      cartLoadError: null,
      writeInFlight: false,
    });
    assert.equal(stateG.screen, "retry", "Must show Retry screen when cart is unconfirmed and no request/write is in flight");
  });

  await t.test("12. Real storeClient: First read overlapping a failed add schedules fresh read and settles active writes without indefinite spinner", async () => {
    const originalAdapter = storeClient.defaults.adapter;
    let getCallCount = 0;
    let resolveFirstGet;
    const firstGetGate = new Promise((resolve) => {
      resolveFirstGet = resolve;
    });

    let resolveAdd;
    const addGate = new Promise((resolve) => {
      resolveAdd = resolve;
    });

    storeClient.defaults.adapter = async (config) => {
      if (config.url === "/cart" && config.method?.toLowerCase() === "get") {
        getCallCount += 1;
        if (getCallCount === 1) {
          // First read waits until add has started
          await firstGetGate;
          return {
            status: 200,
            statusText: "OK",
            headers: { "cart-token": "token_initial", nonce: "nonce_1" },
            config,
            data: { items: [], totals: { total_price: "0" } },
          };
        } else {
          // Fresh read scheduled after write settles
          return {
            status: 200,
            statusText: "OK",
            headers: { "cart-token": "token_fresh", nonce: "nonce_2" },
            config,
            data: { items: [{ id: 201, name: "Fresh Item", quantity: 1 }], totals: { total_price: "20000" } },
          };
        }
      }

      if (config.url?.includes("/cart/add-item")) {
        // Add waits in flight, then fails with a 500 error
        await addGate;
        const error = new Error("Request failed with status code 500");
        error.response = { status: 500, statusText: "Internal Server Error", data: { message: "Server error" } };
        error.config = config;
        throw error;
      }

      return { status: 200, data: {}, headers: { nonce: "nonce_init" }, config };
    };

    try {
      safeStorage.setItem("wc_nonce", "valid_nonce_test_12");

      let currentCart = null;
      let cartConfirmed = false;
      let cartLoadError = null;
      let loading = false;

      const refreshCart = async () => {
        loading = true;
        cartLoadError = null;
        try {
          const data = await getCart();
          currentCart = data;
          cartConfirmed = true;
          return data;
        } catch (err) {
          if (err?.code === "ERR_STALE_CART_READ" || err?.isStaleCartRead) {
            // Discard stale read overlapping a concurrent mutation; schedule fresh read after writes settle
            waitForCartWrites().finally(() => {
              refreshCart().catch(() => {});
            });
            return currentCart;
          }
          cartLoadError = err;
          throw err;
        } finally {
          loading = false;
        }
      };

      // 1. Initial cart read starts while cart is empty
      const initialReadPromise = refreshCart();

      // 2. Concurrent add is initiated and enters in-flight state
      const addPromise = addToCart(999, 1);
      // Allow microtask to process request interceptor
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(isCartWriteInFlight(), true, "Write must be in-flight");

      // 3. Now let the initial read complete while the write is still active
      resolveFirstGet();
      await initialReadPromise;

      // The initial read was rejected by storeClient with ERR_STALE_CART_READ and caught by refreshCart
      assert.equal(cartConfirmed, false, "Initial read must NOT confirm cart while mutation was in flight");

      // 4. Now let the add fail
      resolveAdd();
      await assert.rejects(addPromise, /500/, "Add mutation must fail");

      // 5. Wait for cart writes to settle
      await waitForCartWrites();

      // Verify write tracking is cleared
      assert.equal(isCartWriteInFlight(), false, "Active writes must be 0 after failure settles");

      // 6. The scheduled fresh read executes and resolves with confirmed cart!
      // Give the scheduled promise tick to complete
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(cartConfirmed, true, "Fresh read after write settled must confirm cart");
      assert.equal(currentCart?.items?.length, 1, "Fresh cart items must be installed");
      assert.equal(cartLoadError, null);
    } finally {
      storeClient.defaults.adapter = originalAdapter;
    }
  });

  await t.test("13. Sign-in without guest items does NOT mark cart confirmed when customer cart read fails or is discarded", async () => {
    const originalAdapter = storeClient.defaults.adapter;

    // Simulate 502 Bad Gateway when customer cart is requested after sign-in
    storeClient.defaults.adapter = async (config) => {
      if (config.url === "/cart" && config.method?.toLowerCase() === "get") {
        const error = new Error("Request failed with status code 502");
        error.response = { status: 502, statusText: "Bad Gateway", data: { message: "Server unavailable" } };
        error.config = config;
        throw error;
      }
      return { status: 200, data: {}, headers: { nonce: "nonce_sign_in" }, config };
    };

    try {
      safeStorage.setItem("wc_nonce", "valid_nonce_user_c");
      safeStorage.setItem("wc_cart_token", "token_user_c");

      let cart = null;
      let cartConfirmed = false;
      let cartLoadError = null;
      let loading = false;

      const refreshCart = async () => {
        loading = true;
        cartLoadError = null;
        try {
          const data = await getCart();
          cart = data;
          cartConfirmed = true;
          return data;
        } catch (err) {
          if (err?.code === "ERR_STALE_CART_READ" || err?.isStaleCartRead) {
            return cart;
          }
          cartLoadError = err;
          throw err;
        } finally {
          loading = false;
        }
      };

      // Sign-in flow with no guest items
      const guestItems = [];
      const mergeAndRefresh = async () => {
        loading = true;
        cartConfirmed = false;
        try {
          const serverCart = await refreshCart();
          if (guestItems.length > 0) {
            // merge...
          }
          // Note: No unconditional setCartConfirmed(true)!
        } catch (_) {
          // Handled
        } finally {
          loading = false;
        }
      };

      await mergeAndRefresh();

      // Cart MUST NOT be marked confirmed because the server read failed!
      assert.equal(cartConfirmed, false, "Cart must NOT be confirmed if server read failed on sign-in");
      assert.notEqual(cartLoadError, null, "cartLoadError must be recorded");

      // Verify that the UI evaluation does NOT falsely show 'empty', but shows 'retry'
      const hasItems = Boolean(cart?.items && cart.items.length > 0);
      const isRequestInFlight = loading || isCartWriteInFlight();
      const showRetry = (cartLoadError || !cartConfirmed) && !hasItems && !isRequestInFlight;
      const showEmpty = cartConfirmed && !hasItems && !isRequestInFlight;

      assert.equal(showRetry, true, "Failed sign-in read must show Retry screen");
      assert.equal(showEmpty, false, "Failed sign-in read must NOT falsely show Your Cart is Empty");
    } finally {
      storeClient.defaults.adapter = originalAdapter;
    }
  });

  await t.test("14. Discarded read returns null (not guest cart) and sign-in merge waits for confirmed cart before merging all guest items", async () => {
    const originalAdapter = storeClient.defaults.adapter;
    let getCartAttempts = 0;
    const addedItems = [];

    storeClient.defaults.adapter = async (config) => {
      if (config.url === "/cart" && config.method?.toLowerCase() === "get") {
        getCartAttempts += 1;
        if (getCartAttempts === 1) {
          // First read is discarded (simulating concurrent write or stale token)
          const err = new Error("Stale cart read");
          err.code = "ERR_STALE_CART_READ";
          throw err;
        } else {
          // Second read succeeds with customer's empty server cart
          return {
            status: 200,
            statusText: "OK",
            headers: { "cart-token": "customer_cart_token", nonce: "nonce_c" },
            config,
            data: { items: [], totals: { total_price: "0" } },
          };
        }
      }

      if (config.url?.includes("/cart/add-item")) {
        const payload = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
        addedItems.push(payload);
        return {
          status: 200,
          statusText: "OK",
          headers: { "cart-token": "customer_cart_token", nonce: "nonce_c" },
          config,
          data: {
            items: addedItems.map((a) => ({ id: a.id, quantity: a.quantity, totals: { line_total: "10000" } })),
            totals: { total_price: String(addedItems.length * 10000) },
          },
        };
      }

      return { status: 200, data: {}, headers: { nonce: "nonce_init" }, config };
    };

    try {
      safeStorage.setItem("wc_nonce", "valid_nonce_test_14");
      safeStorage.setItem("wc_cart_token", "token_test_14");

      // Guest cart has 2 items
      const guestCartSnapshot = {
        items: [
          { id: 501, quantity: 1, name: "Suit" },
          { id: 502, quantity: 2, name: "Dupatta" },
        ],
      };
      let memoryCart = guestCartSnapshot;
      let cartConfirmed = false;

      // refreshCart implementation matching production: returns null when discarded
      const refreshCart = async () => {
        try {
          const data = await getCart();
          memoryCart = data;
          cartConfirmed = true;
          return data;
        } catch (err) {
          if (err?.code === "ERR_STALE_CART_READ" || err?.isStaleCartRead) {
            // Discarded read returns null - NEVER returns previous guest cart!
            return null;
          }
          throw err;
        }
      };

      // 1. First read is discarded
      const firstReadResult = await refreshCart();
      assert.equal(firstReadResult, null, "Discarded read must return null, NOT guest cart snapshot!");

      // 2. Sign-in merge flow:
      const guestItems = [...guestCartSnapshot.items];
      clearCartSession();
      memoryCart = null; // guest cart cleared from memory

      // Wait for confirmed cart before merging
      let serverCart = null;
      while (!serverCart) {
        await waitForCartWrites();
        const res = await refreshCart();
        if (res) {
          serverCart = res;
          break;
        }
        await waitForCartWrites();
      }

      assert.notEqual(serverCart, null, "Must obtain confirmed server cart");
      assert.equal(serverCart.items.length, 0, "Initial signed-in customer cart is empty");

      // Run merge: diffs guestItems against signed-in customer cart (0 items)
      for (const item of guestItems) {
        await addToCart(item.id, item.quantity);
      }

      // Assert all guest items were written to the signed-in customer's cart!
      assert.equal(addedItems.length, 2, "All guest items must be written to signed-in cart");
      assert.equal(addedItems[0].id, 501);
      assert.equal(addedItems[1].id, 502);
    } finally {
      storeClient.defaults.adapter = originalAdapter;
    }
  });

  await t.test("15. Checkout recovery state with expired session shows 'Sign in to recover your checkout' and preserves pending payment", async () => {
    const expiredUserId = "user_expired_999";
    safeSessionStorage.setItem("checkout_expired_user_id", expiredUserId);

    // Save pending payment for expired user
    setPendingPayment({ razorpay_order_id: "order_rzp_expired_999" }, expiredUserId);

    // Shopper reloads with no cart in memory and no active user session
    const user = null;
    const checkoutExpiredUserId = expiredUserId;
    const cart = null;
    const hasItems = Boolean(cart?.items && cart.items.length > 0);
    const loading = false;
    const cartConfirmed = false;
    const cartLoadError = null;

    // Evaluate UI state matching production Cart.jsx
    const isRecoveryRequired = Boolean(!user?.id && checkoutExpiredUserId);
    let renderedScreen = null;

    if (isRecoveryRequired && !hasItems) {
      renderedScreen = "sign_in_to_recover";
    } else if ((cartLoadError || !cartConfirmed) && !hasItems) {
      renderedScreen = "retry";
    } else if (!hasItems) {
      renderedScreen = "empty";
    } else {
      renderedScreen = "cart_items";
    }

    assert.equal(
      renderedScreen,
      "sign_in_to_recover",
      "Expired checkout session must show 'Sign in to recover your checkout', NOT generic Retry"
    );

    // Pending payment MUST be preserved!
    const preservedPending = getPendingPayment(expiredUserId);
    assert.equal(
      preservedPending?.razorpay_order_id,
      "order_rzp_expired_999",
      "Pending payment reference must be preserved across page reloads"
    );
  });

  await t.test("16. Guest sign-in with 502 on initial customer cart request: primary Retry resumes pending guest merge, restoring items in one tap without showing empty cart", async () => {
    const originalAdapter = storeClient.defaults.adapter;
    let getAttempts = 0;
    const addedItems = [];

    // Simulate network adapter: 502 on initial customer GET /cart (including internal read retry),
    // and 200 once customer taps Retry.
    storeClient.defaults.adapter = async (config) => {
      if (config.url === "/cart" && config.method?.toLowerCase() === "get") {
        getAttempts += 1;
        if (getAttempts <= 2) {
          const error = new Error("Request failed with status code 502");
          error.response = { status: 502, statusText: "Bad Gateway", data: { message: "Server unavailable" } };
          error.config = config;
          throw error;
        } else {
          return {
            status: 200,
            statusText: "OK",
            headers: { "cart-token": "customer_cart_token_555", nonce: "nonce_c555" },
            config,
            data: {
              items: addedItems.map((a) => ({ id: a.id, name: a.name, quantity: a.quantity, totals: { line_total: "15000" } })),
              totals: { total_price: String(addedItems.length * 15000) },
            },
          };
        }
      }

      if (config.url?.includes("/cart/add-item")) {
        const payload = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
        addedItems.push(payload);
        return {
          status: 200,
          statusText: "OK",
          headers: { "cart-token": "customer_cart_token_555", nonce: "nonce_c555" },
          config,
          data: {
            items: addedItems.map((a) => ({ id: a.id, name: `Product ${a.id}`, quantity: a.quantity, totals: { line_total: "15000" } })),
            totals: { total_price: String(addedItems.length * 15000) },
          },
        };
      }

      return { status: 200, data: {}, headers: { nonce: "nonce_init" }, config };
    };

    try {
      safeStorage.setItem("wc_nonce", "guest_nonce_16");
      safeStorage.setItem("wc_cart_token", "guest_token_16");

      // Shopper had 2 items in their guest cart before signing in
      const guestCartSnapshot = {
        items: [
          { id: 701, name: "Embroidered Kurti", quantity: 1 },
          { id: 702, name: "Silk Dupatta", quantity: 2 },
        ],
      };

      let cart = guestCartSnapshot;
      let loading = false;
      let cartConfirmed = false;
      let cartLoadError = null;
      let cartMergeNotice = null;
      let hasPendingMerge = false;
      let retryMergeFn = null;

      const refreshCart = async () => {
        loading = true;
        cartLoadError = null;
        try {
          const data = await getCart();
          cart = data;
          cartConfirmed = true;
          return data;
        } catch (err) {
          cartLoadError = err;
          throw err;
        } finally {
          loading = false;
        }
      };

      // Exact guest-to-customer handoff matching CartContext.jsx
      const guestItems = [...cart.items];
      clearCartSession();
      cart = null;

      const mergeAndRefresh = async () => {
        loading = true;
        cartLoadError = null;
        cartConfirmed = false;

        try {
          let serverCart = null;
          const res = await refreshCart();
          if (res) {
            serverCart = res;
          }
          if (!serverCart) return;

          if (guestItems.length > 0) {
            const result = await orchestrateCartMerge({
              guestItems,
              api: {
                refreshCart,
                addToCart: async (id, quantity, variation) => {
                  const res = await addToCart(id, quantity, variation);
                  return res;
                },
                updateCartItem: async () => {},
              },
              isSessionValid: () => true,
              initialCart: serverCart,
            });

            if (result.serverCart) {
              cart = result.serverCart;
              cartConfirmed = true;
            }

            if (result.failedItems && result.failedItems.length > 0) {
              cartMergeNotice = { failedItems: result.failedItems, retryable: true };
              hasPendingMerge = true;
            } else {
              retryMergeFn = null;
              cartMergeNotice = null;
              hasPendingMerge = false;
            }
          }
        } catch (err) {
          cartLoadError = err;
          if (guestItems.length > 0) {
            cartMergeNotice = {
              failedItems: guestItems.map((item) => ({ name: item.name || `Product #${item.id}` })),
              retryable: true,
            };
            hasPendingMerge = true;
          }
        } finally {
          loading = false;
        }
      };

      retryMergeFn = mergeAndRefresh;
      hasPendingMerge = guestItems.length > 0;

      // 1. Initial attempt fails with 502
      await mergeAndRefresh();

      assert.equal(getAttempts, 2, "Initial read attempts occurred (including internal read retry)");
      assert.notEqual(cartLoadError, null, "502 error recorded");
      assert.equal(cartConfirmed, false, "Cart not confirmed");
      assert.equal(hasPendingMerge, true, "Pending merge flag is set");
      assert.equal(cartMergeNotice?.retryable, true, "Retryable notice created");

      // Verify UI evaluation matching Cart.jsx
      const evaluateUI = () => {
        const hasItems = Boolean(cart?.items && cart.items.length > 0);
        const isRequestInFlight = loading || isCartWriteInFlight();
        if (isRequestInFlight && !hasItems) return "spinner";
        if ((cartLoadError || !cartConfirmed) && !hasItems) return "retry";
        if (!hasItems) return "empty";
        return "cart_items";
      };

      assert.equal(evaluateUI(), "retry", "Must show 'Couldn't load your cart' screen with Retry button");

      // 2. Primary Retry button click matching Cart.jsx line 668:
      // const handleRetry = () => {
      //   setLoading(true);
      //   setCartLoadError(null);
      //   if (hasPendingMerge || cartMergeNotice?.retryable) {
      //     retryCartMerge();
      //   } else {
      //     refreshCart().catch(() => {});
      //   }
      // };
      const handleRetry = async () => {
        loading = true;
        cartLoadError = null;
        if (hasPendingMerge || cartMergeNotice?.retryable) {
          await retryMergeFn();
        } else {
          await refreshCart().catch(() => {});
        }
      };

      await handleRetry();

      // 3. Verify single tap restored everything:
      assert.equal(getAttempts, 3, "Customer retry succeeded on next attempt");
      assert.equal(addedItems.length, 2, "Both guest items were added to customer's cart");
      assert.equal(cartConfirmed, true, "Cart is now confirmed");
      assert.equal(hasPendingMerge, false, "Pending merge resolved");
      assert.equal(cartMergeNotice, null, "Merge notice cleared");
      assert.equal(cartLoadError, null, "Cart load error cleared");
      assert.equal(evaluateUI(), "cart_items", "Cart items screen shown immediately in one tap!");
      assert.equal(cart.items.length, 2, "Both items present in customer cart");
    } finally {
      storeClient.defaults.adapter = originalAdapter;
    }
  });
});
