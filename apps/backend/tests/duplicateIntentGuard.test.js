import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "crypto";

process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
process.env.WORDPRESS_URL = "http://127.0.0.1:9999";
process.env.CUSTOMER_ORIGIN = "http://localhost:5173";

const { default: app } = await import("../src/app.js");
const { default: api } = await import("../src/config/woocommerce.js");
const { default: storeHoursService } = await import("../src/services/storeHoursService.js");
const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
const { serverCache } = await import("../src/utils/memoryCache.js");
const { _setAnomalyHandlerForTesting } = await import("../src/services/alertService.js");
const { _setSessionCacheForTesting } = await import("../src/middlewares/authMiddleware.js");
const { default: axios } = await import("axios");

test("Server-Side Duplicate Intent Guard & Concurrent Double-Click Prevention", async (t) => {
  let server;
  let baseUrl;
  let razorpayOrdersCreated = 0;
  let createdRzpOrderIds = [];

  const originalApiGet = api.get;
  const originalAxiosGet = axios.get;
  const originalGetStoreStatus = storeHoursService.getStoreStatus;

  t.before(async () => {
    _setAnomalyHandlerForTesting(() => {});
    storeHoursService.getStoreStatus = async () => ({ is_open: true });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  t.after(async () => {
    api.get = originalApiGet;
    axios.get = originalAxiosGet;
    storeHoursService.getStoreStatus = originalGetStoreStatus;
    _setRazorpayInstanceForTesting(null);
    _setAnomalyHandlerForTesting(null);
    await new Promise((resolve) => server.close(resolve));
  });

  t.beforeEach(() => {
    serverCache.clear();
    razorpayOrdersCreated = 0;
    createdRzpOrderIds = [];

    // Mock stock query
    api.get = async () => ({
      data: { id: 10, manage_stock: false, stock_status: "instock" },
    });

    // Mock Razorpay client orders.create
    _setRazorpayInstanceForTesting({
      orders: {
        create: async (params) => {
          razorpayOrdersCreated++;
          const orderId = `order_mock_rzp_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
          createdRzpOrderIds.push(orderId);
          return {
            id: orderId,
            amount: params.amount,
            currency: params.currency || "INR",
            receipt: params.receipt,
            notes: params.notes,
          };
        },
      },
    });
  });

  const setupMockCustomerCart = (cartItems = [{ id: 10, quantity: 2, totals: { line_subtotal: 100000, line_total: 100000 } }]) => {
    const totalPaise = cartItems.reduce((acc, it) => acc + (it.totals?.line_total || 100000), 0);
    axios.get = async (url) => {
      if (url.includes("/wp-json/wc/store/v1/cart")) {
        return {
          data: {
            items: cartItems,
            totals: {
              total_price: String(totalPaise),
              total_items: String(totalPaise),
            },
            shipping_rates: [],
            coupons: [],
          },
        };
      }
      return { data: {} };
    };
  };

  const customerSessionCookie = "test_customer_guard_cookie_1";
  _setSessionCacheForTesting(customerSessionCookie, {
    userId: 88,
    roles: ["customer"],
    email: "customer88@example.com",
    isPhoneVerified: true,
    timestamp: Date.now(),
  });

  const payload = {
    billing_address: {
      first_name: "Rahul",
      last_name: "Sharma",
      email: "customer88@example.com",
      phone: "9876543210",
      address_1: "Station Road",
      city: "Vasai",
      state: "MH",
      postcode: "401202",
      country: "IN",
    },
    shipping_address: {
      first_name: "Rahul",
      last_name: "Sharma",
      phone: "9876543210",
      address_1: "Station Road",
      city: "Vasai",
      state: "MH",
      postcode: "401202",
      country: "IN",
    },
  };

  await t.test("1. First call creates a new Razorpay order; sequential second call reuses unpaid intent", async () => {
    setupMockCustomerCart();

    // Browser 1 click
    const res1 = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `mumbai_customer_auth=${customerSessionCookie}`,
        "X-Idempotency-Key": "key_first_click_1",
      },
      body: JSON.stringify(payload),
    });

    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.success, true);
    assert.ok(data1.razorpay_order_id);
    assert.equal(razorpayOrdersCreated, 1);

    // Browser 2 click with same user & same cart
    const res2 = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `mumbai_customer_auth=${customerSessionCookie}`,
        "X-Idempotency-Key": "key_second_click_2",
      },
      body: JSON.stringify(payload),
    });

    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.success, true);
    assert.equal(data2.reused, true, "Must flag reused intent");
    assert.equal(data2.razorpay_order_id, data1.razorpay_order_id, "Must return the exact same Razorpay order ID");
    assert.equal(razorpayOrdersCreated, 1, "Must NOT create a second Razorpay order");
  });

  await t.test("2. Changing cart items causes a new intent to be created (fingerprint invalidation)", async () => {
    // Cart with item 10
    setupMockCustomerCart([{ id: 10, quantity: 2, totals: { line_subtotal: 100000, line_total: 100000 } }]);

    const res1 = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `mumbai_customer_auth=${customerSessionCookie}`,
        "X-Idempotency-Key": "key_cart_a",
      },
      body: JSON.stringify(payload),
    });
    const data1 = await res1.json();
    assert.equal(razorpayOrdersCreated, 1);

    // Customer changes cart: adds product 20
    setupMockCustomerCart([
      { id: 10, quantity: 2, totals: { line_subtotal: 100000, line_total: 100000 } },
      { id: 20, quantity: 1, totals: { line_subtotal: 50000, line_total: 50000 } },
    ]);

    const res2 = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `mumbai_customer_auth=${customerSessionCookie}`,
        "X-Idempotency-Key": "key_cart_b",
      },
      body: JSON.stringify(payload),
    });
    const data2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.notEqual(data2.razorpay_order_id, data1.razorpay_order_id, "New cart must receive new Razorpay order ID");
    assert.equal(razorpayOrdersCreated, 2, "Second order must be created for altered cart");
  });

  await t.test("3. Concurrent clicks in 2 simulated browsers result in EXACTLY 1 Razorpay order created and identical order IDs returned", async () => {
    setupMockCustomerCart();

    // Trigger two simultaneous concurrent POST requests
    const [resBrowserA, resBrowserB] = await Promise.all([
      fetch(`${baseUrl}/api/payments/create-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `mumbai_customer_auth=${customerSessionCookie}`,
          "X-Idempotency-Key": "browser_a_click_" + Date.now(),
        },
        body: JSON.stringify(payload),
      }),
      fetch(`${baseUrl}/api/payments/create-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `mumbai_customer_auth=${customerSessionCookie}`,
          "X-Idempotency-Key": "browser_b_click_" + Date.now(),
        },
        body: JSON.stringify(payload),
      }),
    ]);

    assert.equal(resBrowserA.status, 200);
    assert.equal(resBrowserB.status, 200);

    const dataA = await resBrowserA.json();
    const dataB = await resBrowserB.json();

    assert.equal(dataA.success, true);
    assert.equal(dataB.success, true);
    assert.equal(dataA.razorpay_order_id, dataB.razorpay_order_id, "Both browsers must receive the exact same Razorpay order ID");
    assert.equal(razorpayOrdersCreated, 1, "Exactly 1 Razorpay order must be created across concurrent clicks");
  });
});
