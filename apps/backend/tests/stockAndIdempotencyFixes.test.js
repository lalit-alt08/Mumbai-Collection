import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import http from "http";

process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";

const { default: api } = await import("../src/config/woocommerce.js");
const { default: storeHoursService } = await import("../src/services/storeHoursService.js");
const { serverCache } = await import("../src/utils/memoryCache.js");
const { default: paymentIntentService } = await import("../src/services/paymentIntentService.js");
const { default: axios } = await import("axios");
const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
const { createOrder } = await import("../src/controllers/paymentController.js");
const { requireIdempotency, _clearIdempotencyStoreForTesting } = await import("../src/middlewares/idempotencyMiddleware.js");

const makeRequest = async (server, method, path, { headers = {}, body = null } = {}) => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}${path}`;
  const reqHeaders = { ...headers };
  let reqBody = undefined;
  if (body !== null) {
    reqHeaders["Content-Type"] = "application/json";
    reqBody = JSON.stringify(body);
  }
  const res = await fetch(url, {
    method,
    headers: reqHeaders,
    body: reqBody,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = text;
  }
  return {
    statusCode: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: json,
  };
};

test("Stock Validation & Idempotency Loop Regression Test Suite", async (t) => {
  const originalApiGet = api.get;
  const originalAxiosGet = axios.get;
  const originalGetStoreStatus = storeHoursService.getStoreStatus;

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mount test route using real requireIdempotency middleware and real createOrder controller
  app.post("/api/payments/create-order", (req, res, next) => {
    req.wpUserId = 10;
    req.wpUserEmail = "customer@example.com";
    req.wpAuthCookie = "mumbai_customer_auth=valid";
    next();
  }, requireIdempotency, createOrder);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  t.beforeEach(() => {
    _clearIdempotencyStoreForTesting();
    serverCache.clear();
    storeHoursService.getStoreStatus = async () => ({ is_open: true });
  });

  t.afterEach(() => {
    api.get = originalApiGet;
    axios.get = originalAxiosGet;
    storeHoursService.getStoreStatus = originalGetStoreStatus;
    _clearIdempotencyStoreForTesting();
    serverCache.clear();
  });

  t.after(() => {
    server.close();
  });

  // Standard valid address
  const addresses = {
    billing_address: { first_name: "Test", last_name: "User", email: "test@example.com", phone: "9876543210", address_1: "Street 1", city: "Mumbai", state: "MH", postcode: "400001", country: "IN" },
    shipping_address: { first_name: "Test", last_name: "User", phone: "9876543210", address_1: "Street 1", city: "Mumbai", state: "MH", postcode: "400001", country: "IN" },
  };

  // 4a. create-order with an out-of-stock line returns 422 and creates no Razorpay order
  await t.test("4a. create-order with an out-of-stock line returns 422 and creates no Razorpay order", async () => {
    let rzpOrdersCreated = 0;
    _setRazorpayInstanceForTesting({
      orders: {
        create: async () => {
          rzpOrdersCreated++;
          return { id: "order_rzp_should_not_be_created" };
        },
      },
    });

    // Mock cart with product 232 (quantity: 2)
    axios.get = async (url) => {
      if (url.includes("/wp-json/wc/store/v1/cart")) {
        return {
          data: {
            items: [{ id: 232, name: "Sandisk Pendrive", quantity: 2, totals: { line_subtotal: "60000" } }],
            totals: { total_items: "60000", total_price: "60000" },
          },
        };
      }
      return { data: {} };
    };

    // Mock WooCommerce product 232 as out of stock
    api.get = async (path) => {
      if (path === "products/232") {
        return {
          data: {
            id: 232,
            name: "Sandisk Pendrive",
            manage_stock: true,
            stock_quantity: 0,
            backorders_allowed: false,
            stock_status: "outofstock",
          },
        };
      }
      return { data: {} };
    };

    const res = await makeRequest(server, "POST", "/api/payments/create-order", {
      headers: { "x-idempotency-key": "key-out-of-stock-test" },
      body: addresses,
    });

    assert.equal(res.statusCode, 422, "Must return HTTP 422");
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, "ITEM_OUT_OF_STOCK");
    assert.ok(res.body.message.includes("Sandisk Pendrive"), "Message must name the out of stock product");
    assert.equal(rzpOrdersCreated, 0, "Must create 0 Razorpay orders");
  });

  // 4b. after an intent reaches refunded, the same idempotency key produces a NEW razorpay_order_id
  await t.test("4b. after an intent reaches refunded, the same idempotency key produces a NEW razorpay_order_id", async () => {
    let createdCount = 0;
    _setRazorpayInstanceForTesting({
      orders: {
        create: async () => {
          createdCount++;
          return { id: `order_rzp_seq_${createdCount}` };
        },
      },
    });

    // In stock
    api.get = async (path) => ({
      data: { manage_stock: true, stock_quantity: 10, backorders_allowed: false, stock_status: "instock" },
    });

    axios.get = async (url) => ({
      data: {
        items: [{ id: 244, name: "DOMS Pen", quantity: 1, totals: { line_subtotal: "60000" } }],
        totals: { total_items: "60000", total_price: "60000" },
      },
    });

    const idempotencyKey = "same-idemp-key-refund-test";

    // Call 1: initial order created
    const res1 = await makeRequest(server, "POST", "/api/payments/create-order", {
      headers: { "x-idempotency-key": idempotencyKey },
      body: addresses,
    });

    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.razorpay_order_id, "order_rzp_seq_1");

    // Transition the intent to 'refunded'
    await paymentIntentService.updatePaymentIntentStatus({
      rzpOrderId: "order_rzp_seq_1",
      toStatus: "refunded",
      errorReason: "ITEM_OUT_OF_STOCK",
    });

    // Call 2: retry with the SAME idempotency key
    const res2 = await makeRequest(server, "POST", "/api/payments/create-order", {
      headers: { "x-idempotency-key": idempotencyKey },
      body: addresses,
    });

    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body.razorpay_order_id, "order_rzp_seq_2", "Must discard dead order and create a fresh Razorpay order");
    assert.equal(createdCount, 2, "Must have called Razorpay order creation twice");
  });

  // 4c. after a cancelled modal (intent still created), the same key returns the SAME order
  await t.test("4c. after a cancelled modal (intent still created), the same key returns the SAME order", async () => {
    let createdCount = 0;
    _setRazorpayInstanceForTesting({
      orders: {
        create: async () => {
          createdCount++;
          return { id: `order_rzp_cancelled_${createdCount}` };
        },
      },
    });

    api.get = async () => ({
      data: { manage_stock: true, stock_quantity: 10, backorders_allowed: false, stock_status: "instock" },
    });

    axios.get = async () => ({
      data: {
        items: [{ id: 244, name: "DOMS Pen", quantity: 1, totals: { line_subtotal: "60000" } }],
        totals: { total_items: "60000", total_price: "60000" },
      },
    });

    const idempotencyKey = "same-key-cancelled-modal";

    // Call 1
    const res1 = await makeRequest(server, "POST", "/api/payments/create-order", {
      headers: { "x-idempotency-key": idempotencyKey },
      body: addresses,
    });

    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.razorpay_order_id, "order_rzp_cancelled_1");

    // Intent is still 'created' (user closed modal without paying)
    const intent = await paymentIntentService.getPaymentIntent("order_rzp_cancelled_1");
    assert.equal(intent.status, "created");

    // Call 2: user clicks Pay again
    const res2 = await makeRequest(server, "POST", "/api/payments/create-order", {
      headers: { "x-idempotency-key": idempotencyKey },
      body: addresses,
    });

    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body.razorpay_order_id, "order_rzp_cancelled_1", "Must return the same order while intent is created");
    assert.equal(res2.body._idempotent, true, "Must flag as cached idempotent");
    assert.equal(createdCount, 1, "Must NOT create a duplicate Razorpay order");
  });

  // 4d. changed cart produces a new order
  await t.test("4d. changed cart produces a new order", async () => {
    let createdCount = 0;
    _setRazorpayInstanceForTesting({
      orders: {
        create: async () => {
          createdCount++;
          return { id: `order_rzp_cart_${createdCount}` };
        },
      },
    });

    api.get = async () => ({
      data: { manage_stock: true, stock_quantity: 10, backorders_allowed: false, stock_status: "instock" },
    });

    // Cart 1: 1 item
    axios.get = async () => ({
      data: {
        items: [{ id: 244, name: "DOMS Pen", quantity: 1, totals: { line_subtotal: "60000" } }],
        totals: { total_items: "60000", total_price: "60000" },
      },
    });

    const res1 = await makeRequest(server, "POST", "/api/payments/create-order", {
      headers: { "x-idempotency-key": "cart-1-fingerprint-key" },
      body: addresses,
    });

    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.razorpay_order_id, "order_rzp_cart_1");

    // Cart 2: changed quantity (yields different idempotency key from computeCartFingerprint)
    axios.get = async () => ({
      data: {
        items: [{ id: 244, name: "DOMS Pen", quantity: 2, totals: { line_subtotal: "120000" } }],
        totals: { total_items: "120000", total_price: "120000" },
      },
    });

    const res2 = await makeRequest(server, "POST", "/api/payments/create-order", {
      headers: { "x-idempotency-key": "cart-2-fingerprint-key" },
      body: addresses,
    });

    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body.razorpay_order_id, "order_rzp_cart_2", "Changed cart key must generate new order");
    assert.equal(createdCount, 2);
  });
});
