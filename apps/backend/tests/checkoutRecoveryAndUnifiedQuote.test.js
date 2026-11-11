import test from "node:test";
import assert from "node:assert/strict";

process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";

const { default: paymentIntentService, _setWpClientForTesting } = await import("../src/services/paymentIntentService.js");
const { cancelPaymentOrder, checkPaymentStatus, createOrder } = await import("../src/controllers/paymentController.js");
const { default: requireIdempotency, _clearIdempotencyStoreForTesting, _setIdempotencyEntryForTesting } = await import("../src/middlewares/idempotencyMiddleware.js");
const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
const { serverCache } = await import("../src/utils/memoryCache.js");
const { default: storeHoursService } = await import("../src/services/storeHoursService.js");
const { default: axios } = await import("axios");

test("Checkout Recovery and Unified Quote Verification Suite", async (t) => {
  let intent = null;
  let gateway = null;
  let locks = new Map();
  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;
  const originalGetStoreStatus = storeHoursService.getStoreStatus;

  t.beforeEach(() => {
    serverCache.clear();
    _clearIdempotencyStoreForTesting();
    locks = new Map();
    storeHoursService.getStoreStatus = async () => ({ is_open: true });

    intent = {
      rzp_order_id: "order_test_recovery",
      customer_id: 42,
      amount_in_paise: 54000,
      status: "created",
      created_at: Date.now(),
      cart_fingerprint: "test_fingerprint_42",
      stock_reservation_id: "res_stock_123",
      checkout_payload: {},
    };

    paymentIntentService.acquireLock = async (key, owner) => {
      if (locks.has(key) && locks.get(key) !== owner) return false;
      locks.set(key, owner);
      return true;
    };
    paymentIntentService.releaseLock = async (key, owner) => {
      if (locks.get(key) === owner) locks.delete(key);
      return true;
    };

    paymentIntentService.getPaymentIntent = async (id, { fresh } = {}) => {
      if (id === intent.rzp_order_id) return intent;
      return null;
    };

    paymentIntentService.updatePaymentIntentStatus = async ({ fromStatus, toStatus }) => {
      if (!fromStatus || intent.status === fromStatus) {
        intent.status = toStatus;
        return true;
      }
      return false;
    };

    paymentIntentService.releaseCheckoutStock = async () => true;

    gateway = {
      orders: {
        fetch: async (id) => ({
          id,
          status: "created",
          amount_paid: 0,
        }),
        fetchPayments: async () => ({ items: [] }),
      },
      payments: {
        fetch: async () => ({ id: "pay_test", status: "created" }),
      },
    };
    _setRazorpayInstanceForTesting(gateway);

    _setWpClientForTesting({
      post: async () => ({ data: { success: true, updated: true, acquired: true } }),
      get: async () => ({ data: {} }),
    });
  });

  t.afterEach(() => {
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
    storeHoursService.getStoreStatus = originalGetStoreStatus;
    _setWpClientForTesting(null);
    _setRazorpayInstanceForTesting(null);
    serverCache.clear();
    _clearIdempotencyStoreForTesting();
  });

  const mockResponse = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    return res;
  };

  await t.test("1. Exit without paying: confirm cancellation releases stock and returns terminal result", async () => {
    const res = mockResponse();
    await cancelPaymentOrder(
      {
        body: { razorpay_order_id: "order_test_recovery" },
        user: { id: 42 },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.cancelled, true);
    assert.equal(res.body.terminal, true);
    assert.equal(intent.status, "cancelled");
  });

  await t.test("2. Repeated cancellation of confirmed unpaid attempt returns the exact same terminal result", async () => {
    intent.status = "cancelled";
    const res = mockResponse();
    await cancelPaymentOrder(
      {
        body: { razorpay_order_id: "order_test_recovery" },
        user: { id: 42 },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.cancelled, true);
    assert.equal(res.body.terminal, true);
  });

  await t.test("3. Authorized payment in Razorpay prevents cancellation and preserves recovery (409)", async () => {
    gateway.orders.fetchPayments = async () => ({
      items: [{ id: "pay_auth_1", status: "authorized" }],
    });

    const res = mockResponse();
    await cancelPaymentOrder(
      {
        body: { razorpay_order_id: "order_test_recovery" },
        user: { id: 42 },
      },
      res
    );

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
    assert.equal(intent.status, "created", "Intent status must not be cancelled");
  });

  await t.test("4. Captured payment in Razorpay prevents cancellation and preserves recovery (409)", async () => {
    gateway.orders.fetch = async () => ({
      id: "order_test_recovery",
      status: "paid",
      amount_paid: 54000,
    });

    const res = mockResponse();
    await cancelPaymentOrder(
      {
        body: { razorpay_order_id: "order_test_recovery" },
        user: { id: 42 },
      },
      res
    );

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "PAYMENT_ALREADY_CAPTURED");
    assert.equal(intent.status, "created");
  });

  await t.test("5. Gateway unavailable during cancellation preserves recovery (503)", async () => {
    gateway.orders.fetch = async () => {
      throw new Error("Razorpay connection timeout");
    };

    const res = mockResponse();
    await cancelPaymentOrder(
      {
        body: { razorpay_order_id: "order_test_recovery" },
        user: { id: 42 },
      },
      res
    );

    assert.equal(res.statusCode, 503);
    assert.equal(intent.status, "created");
  });

  await t.test("6. Customer authorization: cancellation by different user is forbidden (403)", async () => {
    const res = mockResponse();
    await cancelPaymentOrder(
      {
        body: { razorpay_order_id: "order_test_recovery" },
        user: { id: 99 }, // Different user
      },
      res
    );

    assert.equal(res.statusCode, 403);
    assert.equal(intent.status, "created");
  });

  await t.test("7. Idempotency replay cannot reopen a cancelled attempt (409 CHECKOUT_CANCELLED) on 1st and subsequent replays", async () => {
    intent.status = "cancelled";

    const req = {
      method: "POST",
      path: "/create-order",
      wpUserId: 42,
      headers: { "x-idempotency-key": "replay_key_cancelled_1" },
    };
    const res1 = mockResponse();
    let nextCalled1 = false;

    _setIdempotencyEntryForTesting("user:42:POST:/create-order:replay_key_cancelled_1", {
      status: "completed",
      statusCode: 200,
      body: {
        success: true,
        razorpay_order_id: "order_test_recovery",
      },
    });

    await requireIdempotency(req, res1, () => {
      nextCalled1 = true;
    });

    assert.equal(nextCalled1, false, "Must not proceed to next handler on 1st replay");
    assert.equal(res1.statusCode, 409);
    assert.equal(res1.body.code, "CHECKOUT_CANCELLED");

    // Second replay with the same key must ALSO be rejected with 409 CHECKOUT_CANCELLED
    const res2 = mockResponse();
    let nextCalled2 = false;
    await requireIdempotency(req, res2, () => {
      nextCalled2 = true;
    });

    assert.equal(nextCalled2, false, "Must not proceed to next handler on 2nd replay");
    assert.equal(res2.statusCode, 409);
    assert.equal(res2.body.code, "CHECKOUT_CANCELLED");
  });

  await t.test("7b. Failed payment intent lookup returns retryable 503 PAYMENT_STATE_UNVERIFIED", async () => {
    _setIdempotencyEntryForTesting("user:42:POST:/create-order:replay_key_failed_lookup", {
      status: "completed",
      statusCode: 200,
      body: {
        success: true,
        razorpay_order_id: "order_failed_lookup",
      },
    });

    paymentIntentService.getPaymentIntent = async (id) => {
      if (id === "order_failed_lookup") throw new Error("Payment intent DB timeout");
      return intent;
    };

    const req = {
      method: "POST",
      path: "/create-order",
      wpUserId: 42,
      headers: { "x-idempotency-key": "replay_key_failed_lookup" },
    };
    const res = mockResponse();
    let nextCalled = false;

    await requireIdempotency(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, "Must not proceed to next handler on failed lookup");
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "PAYMENT_STATE_UNVERIFIED");
  });

  await t.test("8. Total mismatch guard (CHECKOUT_TOTAL_CHANGED) triggers and returns full authoritative cart quote", async () => {
    axios.post = async (url) => {
      if (url.includes("/wp-json/wc/store/v1/cart/update-customer")) {
        return {
          data: {
            items: [{ id: 10, name: "Product A", quantity: 2, totals: { line_total: "54000" } }],
            totals: { total_items: "54000", total_price: "54000", total_shipping: "0" },
          },
        };
      }
      return { data: {} };
    };

    const req = {
      wpUserId: 42,
      wpAuthCookie: "customer_cookie_42",
      headers: {
        "x-idempotency-key": "fresh_checkout_key_1",
      },
      body: {
        expected_total_paise: 55900, // Stale quote
        billing_address: {
          first_name: "Lalit",
          last_name: "Sharma",
          phone: "9876543210",
          address_1: "Flat 101",
          city: "Vasai West",
          state: "MH",
          postcode: "401202",
          country: "IN",
        },
        shipping_address: {
          first_name: "Lalit",
          last_name: "Sharma",
          phone: "9876543210",
          address_1: "Flat 101",
          city: "Vasai West",
          state: "MH",
          postcode: "401202",
          country: "IN",
        },
      },
    };

    const res = mockResponse();
    await createOrder(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "CHECKOUT_TOTAL_CHANGED");
    assert.equal(res.body.expected_total_paise, 55900);
    assert.equal(res.body.actual_total_paise, 54000);
    assert.ok(res.body.cart, "Must return full authoritative cart quote");
    assert.equal(res.body.cart.totals.total_price, "54000");
  });

  await t.test("8b. Address pricing failure returns 502 ADDRESS_PRICING_FAILED with retryable flag", async () => {
    axios.post = async (url) => {
      if (url.includes("/wp-json/wc/store/v1/cart/update-customer")) {
        throw new Error("Courier API unreachable");
      }
      return { data: {} };
    };

    const req = {
      wpUserId: 42,
      wpAuthCookie: "customer_cookie_42",
      headers: {
        "x-idempotency-key": "fresh_checkout_key_addr_fail",
      },
      body: {
        expected_total_paise: 54000,
        billing_address: {
          first_name: "Lalit",
          last_name: "Sharma",
          phone: "9876543210",
          address_1: "Flat 101",
          city: "Vasai West",
          state: "MH",
          postcode: "401202",
          country: "IN",
        },
        shipping_address: {
          first_name: "Lalit",
          last_name: "Sharma",
          phone: "9876543210",
          address_1: "Flat 101",
          city: "Vasai West",
          state: "MH",
          postcode: "401202",
          country: "IN",
        },
      },
    };

    const res = mockResponse();
    await createOrder(req, res);

    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, "ADDRESS_PRICING_FAILED");
    assert.equal(res.body.retryable, true);
  });

  await t.test("9. Cart-Token ownership validation rejects token belonging to different customer, guest, or missing user_id (403)", async () => {
    const makeJwt = (payloadObj) => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
      return `${header}.${payload}.fakesig`;
    };

    const runWithToken = async (cartToken) => {
      const req = {
        wpUserId: 42, // Legitimate user is 42
        wpAuthCookie: "customer_cookie_42",
        headers: {
          "x-idempotency-key": "token_mismatch_key_" + Math.random(),
          "cart-token": cartToken,
        },
        body: {
          expected_total_paise: 54000,
          billing_address: {
            first_name: "Lalit",
            last_name: "Sharma",
            phone: "9876543210",
            address_1: "Flat 101",
            city: "Vasai West",
            state: "MH",
            postcode: "401202",
            country: "IN",
          },
          shipping_address: {
            first_name: "Lalit",
            last_name: "Sharma",
            phone: "9876543210",
            address_1: "Flat 101",
            city: "Vasai West",
            state: "MH",
            postcode: "401202",
            country: "IN",
          },
        },
      };

      const res = mockResponse();
      await createOrder(req, res);
      return res;
    };

    // Case A: Different user ID (999 !== 42)
    const resA = await runWithToken(makeJwt({ user_id: "999", exp: Date.now() + 3600000 }));
    assert.equal(resA.statusCode, 403);
    assert.equal(resA.body.code, "CART_TOKEN_MISMATCH");

    // Case B: Guest token with user_id: 0
    const resB = await runWithToken(makeJwt({ user_id: 0, exp: Date.now() + 3600000 }));
    assert.equal(resB.statusCode, 403);
    assert.equal(resB.body.code, "CART_TOKEN_MISMATCH");

    // Case C: Missing user_id
    const resC = await runWithToken(makeJwt({ exp: Date.now() + 3600000 }));
    assert.equal(resC.statusCode, 403);
    assert.equal(resC.body.code, "CART_TOKEN_MISMATCH");

    // Case D: Non-numeric user_id
    const resD = await runWithToken(makeJwt({ user_id: "guest_session_xyz" }));
    assert.equal(resD.statusCode, 403);
    assert.equal(resD.body.code, "CART_TOKEN_MISMATCH");
  });
});
