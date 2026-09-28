import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";

process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
process.env.WORDPRESS_URL = "https://mumbai-collection.local";

const { default: api } = await import("../src/config/woocommerce.js");
const { default: storeHoursService } = await import("../src/services/storeHoursService.js");
const { serverCache } = await import("../src/utils/memoryCache.js");
const { default: paymentIntentService } = await import("../src/services/paymentIntentService.js");
const { default: storeRouter, _resetStoreRoutesHoursFallbackForTesting } = await import("../src/routes/storeRoutes.js");
const {
  createOrder,
  verifyPayment,
  checkPaymentStatus,
  reconcileOrder,
  _resetPaymentStoreHoursFallbackForTesting,
} = await import("../src/controllers/paymentController.js");
const { default: wp } = await import("../src/services/wordpress.js");
const { default: axios } = await import("axios");
const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
const setRazorpayInstanceForTesting = _setRazorpayInstanceForTesting;

// Helper to make an HTTP request to the running express test app
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

async function run() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mount storeRouter
  app.use("/api/store", storeRouter);

  // Mount payment endpoints with a dummy auth injector for testing controller directly
  app.post("/api/payments/create-order", (req, res, next) => {
    if (req.headers["x-test-suspended"]) req.isSuspended = true;
    req.wpUserId = req.headers["x-test-userid"] ? Number(req.headers["x-test-userid"]) : 10;
    req.wpUserEmail = "customer@example.com";
    req.wpAuthCookie = "mumbai_customer_auth=valid";
    createOrder(req, res, next);
  });

  app.post("/api/payments/verify", (req, res, next) => {
    req.wpUserId = req.headers["x-test-userid"] ? Number(req.headers["x-test-userid"]) : 10;
    verifyPayment(req, res, next);
  });

  app.post("/api/payments/check-status", (req, res, next) => {
    req.wpUserId = req.headers["x-test-userid"] ? Number(req.headers["x-test-userid"]) : 10;
    checkPaymentStatus(req, res, next);
  });

  app.post("/api/payments/reconcile/:id", (req, res, next) => {
    reconcileOrder(req, res, next);
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  const storeSnapshots = {};
  const paymentSnapshots = {};

  const originalApiGet = api.get;
  const originalApiPost = api.post;
  const originalApiPut = api.put;
  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;
  const originalAxiosRequest = axios.request;
  const originalWpPost = wp.post;
  const originalGetStoreStatus = storeHoursService.getStoreStatus;

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // PART A: storeRoutes /checkout pre-checks
    // ═════════════════════════════════════════════════════════════════════════
    console.log("--- Capturing storeRoutes /checkout pre-checks ---");

    let currentCartHandler = async () => ({ data: { items: [], totals: { total_items: "0" } } });

    axios.get = async (url, options = {}) => {
      if (url.includes("/wp-json/mumbai-auth/v1/me")) {
        const cookie = options.headers?.Cookie || "";
        if (cookie.includes("user_suspended")) {
          return {
            data: {
              logged_in: true,
              current_user_id: 10,
              is_suspended: true,
              is_phone_verified: true,
              roles: ["customer"],
              email: "customer@example.com",
            },
          };
        }
        if (cookie.includes("user_unverified_phone")) {
          return {
            data: {
              logged_in: true,
              current_user_id: 10,
              is_suspended: false,
              is_phone_verified: false,
              roles: ["customer"],
              email: "customer@example.com",
            },
          };
        }
        if (cookie.includes("valid_cust")) {
          return {
            data: {
              logged_in: true,
              current_user_id: 10,
              is_suspended: false,
              is_phone_verified: true,
              roles: ["customer"],
              email: "customer@example.com",
            },
          };
        }
        return { data: { logged_in: false } };
      }
      if (url.includes("/wp-json/wc/store/v1/cart")) {
        return currentCartHandler(url, options);
      }
      return { data: {} };
    };

    // 1. checkout_unauth (401)
    {
      const res = await makeRequest(server, "POST", "/api/store/checkout", { body: {} });
      storeSnapshots.checkout_unauth = { statusCode: res.statusCode, body: res.body };
    }

    // 2. checkout_suspended (403)
    {
      serverCache.clear();
      const res = await makeRequest(server, "POST", "/api/store/checkout", {
        headers: { Cookie: "mumbai_customer_auth=user_suspended" },
        body: {},
      });
      storeSnapshots.checkout_suspended = { statusCode: res.statusCode, body: res.body };
    }

    // 3. checkout_phone_not_verified (403)
    {
      serverCache.clear();
      const res = await makeRequest(server, "POST", "/api/store/checkout", {
        headers: { Cookie: "mumbai_customer_auth=user_unverified_phone" },
        body: {},
      });
      storeSnapshots.checkout_phone_not_verified = { statusCode: res.statusCode, body: res.body };
    }

    // 4. checkout_store_closed (403)
    {
      serverCache.clear();
      _resetStoreRoutesHoursFallbackForTesting();
      storeHoursService.getStoreStatus = async () => ({
        is_open: false,
        message: "Store closed for the night",
        next_opening: "Tomorrow at 09:00 AM",
        current_day: "Monday",
        current_time_ist: "23:00",
        schedule_today: "09:00 - 22:00",
        timezone: "Asia/Kolkata",
      });
      const res = await makeRequest(server, "POST", "/api/store/checkout", {
        headers: { Cookie: "mumbai_customer_auth=valid_cust" },
        body: {},
      });
      storeSnapshots.checkout_store_closed = { statusCode: res.statusCode, body: res.body };
    }

    // 5. checkout_store_hours_unavailable (503)
    {
      serverCache.clear();
      _resetStoreRoutesHoursFallbackForTesting();
      storeHoursService.getStoreStatus = async () => {
        throw new Error("Store hours redis down");
      };
      const res = await makeRequest(server, "POST", "/api/store/checkout", {
        headers: { Cookie: "mumbai_customer_auth=valid_cust" },
        body: {},
      });
      storeSnapshots.checkout_store_hours_unavailable = { statusCode: res.statusCode, body: res.body };
    }

    // Store open mock for subsequent tests
    const mockStoreOpen = () => {
      serverCache.clear();
      _resetStoreRoutesHoursFallbackForTesting();
      storeHoursService.getStoreStatus = async () => ({ is_open: true });
    };

    // 6. checkout_empty_cart (400)
    {
      mockStoreOpen();
      currentCartHandler = async () => ({ data: { items: [], totals: { total_items: "0" } } });
      const res = await makeRequest(server, "POST", "/api/store/checkout", {
        headers: { Cookie: "mumbai_customer_auth=valid_cust" },
        body: {},
      });
      storeSnapshots.checkout_empty_cart = { statusCode: res.statusCode, body: res.body };
    }

    // 7. checkout_min_order_value (400)
    {
      mockStoreOpen();
      currentCartHandler = async () => ({
        data: {
          items: [{ id: 1, name: "Socks", quantity: 1, totals: { line_subtotal: "30000" } }],
          totals: { total_items: "30000" },
        },
      });
      const res = await makeRequest(server, "POST", "/api/store/checkout", {
        headers: { Cookie: "mumbai_customer_auth=valid_cust" },
        body: {},
      });
      storeSnapshots.checkout_min_order_value = { statusCode: res.statusCode, body: res.body };
    }

    // 8. checkout_cart_fetch_failed (502)
    {
      mockStoreOpen();
      currentCartHandler = async () => {
        throw new Error("Store API cart unreachable");
      };
      const res = await makeRequest(server, "POST", "/api/store/checkout", {
        headers: { Cookie: "mumbai_customer_auth=valid_cust" },
        body: {},
      });
      storeSnapshots.checkout_cart_fetch_failed = { statusCode: res.statusCode, body: res.body };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PART B: paymentController endpoints
    // ═════════════════════════════════════════════════════════════════════════
    console.log("--- Capturing paymentController endpoints ---");

    // ─────────────────────────────────────────────────────────────────────────
    // 1. POST /api/payments/create-order
    // ─────────────────────────────────────────────────────────────────────────

    // 1.1 createOrder_suspended (403)
    {
      _resetPaymentStoreHoursFallbackForTesting();
      storeHoursService.getStoreStatus = async () => ({ is_open: true });
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        headers: { "x-test-suspended": "true" },
        body: { billing_address: {}, shipping_address: {} },
      });
      paymentSnapshots.createOrder_suspended = { statusCode: res.statusCode, body: res.body };
    }

    // 1.2 createOrder_store_closed (403)
    {
      _resetPaymentStoreHoursFallbackForTesting();
      storeHoursService.getStoreStatus = async () => ({
        is_open: false,
        message: "Store closed for the night",
        next_opening: "Tomorrow at 09:00 AM",
      });
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        body: { billing_address: {}, shipping_address: {} },
      });
      paymentSnapshots.createOrder_store_closed = { statusCode: res.statusCode, body: res.body };
    }

    // 1.3 createOrder_store_hours_unavailable (503)
    {
      _resetPaymentStoreHoursFallbackForTesting();
      storeHoursService.getStoreStatus = async () => {
        throw new Error("Redis failure");
      };
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        body: { billing_address: {}, shipping_address: {} },
      });
      paymentSnapshots.createOrder_store_hours_unavailable = { statusCode: res.statusCode, body: res.body };
    }

    // 1.4 createOrder_missing_addresses (400)
    {
      _resetPaymentStoreHoursFallbackForTesting();
      storeHoursService.getStoreStatus = async () => ({ is_open: true });
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        body: {},
      });
      paymentSnapshots.createOrder_missing_addresses = { statusCode: res.statusCode, body: res.body };
    }

    const standardAddresses = {
      billing_address: { first_name: "John", last_name: "Doe", email: "john@example.com", phone: "9876543210", address_1: "Street 1", city: "Mumbai", state: "MH", postcode: "400001", country: "IN" },
      shipping_address: { first_name: "John", last_name: "Doe", phone: "9876543210", address_1: "Street 1", city: "Mumbai", state: "MH", postcode: "400001", country: "IN" },
    };

    // 1.5 createOrder_cart_fetch_failed (502)
    {
      _resetPaymentStoreHoursFallbackForTesting();
      storeHoursService.getStoreStatus = async () => ({ is_open: true });
      axios.get = async (url) => {
        if (url.includes("/wp-json/wc/store/v1/cart")) {
          throw new Error("WooCommerce store cart down");
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        body: standardAddresses,
      });
      paymentSnapshots.createOrder_cart_fetch_failed = { statusCode: res.statusCode, body: res.body };
    }

    // 1.6 createOrder_empty_cart (400)
    {
      axios.get = async (url) => {
        if (url.includes("/wp-json/wc/store/v1/cart")) {
          return { data: { items: [], totals: { total_items: "0" } } };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        body: standardAddresses,
      });
      paymentSnapshots.createOrder_empty_cart = { statusCode: res.statusCode, body: res.body };
    }

    // 1.7 createOrder_min_order_value (400)
    {
      axios.get = async (url) => {
        if (url.includes("/wp-json/wc/store/v1/cart")) {
          return {
            data: {
              items: [{ id: 10, quantity: 1, totals: { line_subtotal: "35000" } }],
              totals: { total_items: "35000", total_price: "35000" },
            },
          };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        body: standardAddresses,
      });
      paymentSnapshots.createOrder_min_order_value = { statusCode: res.statusCode, body: res.body };
    }

    // 1.8 createOrder_invalid_total (400)
    {
      axios.get = async (url) => {
        if (url.includes("/wp-json/wc/store/v1/cart")) {
          return {
            data: {
              items: [{ id: 10, quantity: 1, totals: { line_subtotal: "60000" } }],
              totals: { total_items: "60000", total_price: "0" },
            },
          };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        body: standardAddresses,
      });
      paymentSnapshots.createOrder_invalid_total = { statusCode: res.statusCode, body: res.body };
    }

    // 1.9 createOrder_gateway_error (502)
    {
      const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
      _setRazorpayInstanceForTesting({
        orders: {
          create: async () => {
            throw new Error("Razorpay API outage");
          },
        },
      });
      axios.get = async (url) => {
        if (url.includes("/wp-json/wc/store/v1/cart")) {
          return {
            data: {
              items: [{ id: 10, quantity: 1, totals: { line_subtotal: "60000" } }],
              totals: { total_items: "60000", total_price: "60000" },
            },
          };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        body: standardAddresses,
      });
      paymentSnapshots.createOrder_gateway_error = { statusCode: res.statusCode, body: res.body };
    }

    // 1.10 createOrder_success (200)
    {
      const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
      _setRazorpayInstanceForTesting({
        orders: {
          create: async () => ({ id: "order_rzp_live_123" }),
        },
      });
      axios.get = async (url) => {
        if (url.includes("/wp-json/wc/store/v1/cart")) {
          return {
            data: {
              items: [{ id: 10, quantity: 1, totals: { line_subtotal: "60000" } }],
              totals: { total_items: "60000", total_price: "60000" },
            },
          };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/create-order", {
        body: standardAddresses,
      });
      paymentSnapshots.createOrder_success = { statusCode: res.statusCode, body: res.body };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. POST /api/payments/verify
    // ─────────────────────────────────────────────────────────────────────────

    // 2.1 verifyPayment_missing_params (400)
    {
      const res = await makeRequest(server, "POST", "/api/payments/verify", { body: {} });
      paymentSnapshots.verifyPayment_missing_params = { statusCode: res.statusCode, body: res.body };
    }

    // 2.2 verifyPayment_signature_mismatch (400)
    {
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        body: {
          razorpay_order_id: "order_mock_test_101",
          razorpay_payment_id: "pay_mock_test_101",
          razorpay_signature: "bad_signature_0000000000000000000000000000000000000000000000000000000000000000",
        },
      });
      paymentSnapshots.verifyPayment_signature_mismatch = { statusCode: res.statusCode, body: res.body };
    }

    // Helper to generate valid signature
    const makeValidSignature = (orderId, paymentId) => {
      return crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
    };

    // 2.3 verifyPayment_gateway_fetch_failed (502)
    {
      const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
      _setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => {
            throw new Error("Razorpay gateway timeout");
          },
        },
      });
      const orderId = "order_rzp_gateway_fail";
      const paymentId = "pay_rzp_gateway_fail";
      const signature = makeValidSignature(orderId, paymentId);
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_gateway_fetch_failed = { statusCode: res.statusCode, body: res.body };
    }

    // 2.4 verifyPayment_order_id_mismatch (400)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_expected";
      const paymentId = "pay_rzp_different_order";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: "order_rzp_COMPLETELY_DIFFERENT",
            status: "captured",
            amount: 60000,
            currency: "INR",
          }),
        },
      });
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_order_id_mismatch = { statusCode: res.statusCode, body: res.body };
    }

    // 2.5 verifyPayment_not_captured (400)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_authorized";
      const paymentId = "pay_rzp_authorized";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "authorized",
            amount: 60000,
            currency: "INR",
          }),
        },
      });
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_not_captured = { statusCode: res.statusCode, body: res.body };
    }

    // 2.6 verifyPayment_currency_mismatch (400)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_usd";
      const paymentId = "pay_rzp_usd";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: 60000,
            currency: "USD",
          }),
        },
      });
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_currency_mismatch = { statusCode: res.statusCode, body: res.body };
    }

    // 2.7 verifyPayment_lock_conflict (409)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_locked";
      const paymentId = "pay_rzp_locked";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: 60000,
            currency: "INR",
          }),
        },
      });
      // Mock lock fail
      const originalAcquireLock = paymentIntentService.acquireLock;
      paymentIntentService.acquireLock = async () => false;
      api.get = async () => ({ data: [] });
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentIntentService.acquireLock = originalAcquireLock;
      paymentSnapshots.verifyPayment_lock_conflict = { statusCode: res.statusCode, body: res.body };
    }

    // 2.8 verifyPayment_intent_not_found (404)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_no_intent";
      const paymentId = "pay_rzp_no_intent";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: 60000,
            currency: "INR",
          }),
        },
      });
      api.get = async () => ({ data: [] });
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_intent_not_found = { statusCode: res.statusCode, body: res.body };
    }

    // 2.9 verifyPayment_customer_mismatch (403)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_cust_mismatch";
      const paymentId = "pay_rzp_cust_mismatch";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: 60000,
            currency: "INR",
          }),
        },
      });
      api.get = async () => ({ data: [] });
      await paymentIntentService.storePaymentIntent(orderId, {
        rzp_order_id: orderId,
        customer_id: 9999, // Intent belongs to customer 9999
        amount_in_paise: 60000,
        status: "created",
      });
      // Caller has wpUserId = 10
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        headers: { "x-test-userid": "10" },
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_customer_mismatch = { statusCode: res.statusCode, body: res.body };
    }

    // 2.10 verifyPayment_amount_mismatch (400)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_amt_mismatch";
      const paymentId = "pay_rzp_amt_mismatch";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: 50000, // Debited 50000 paise
            currency: "INR",
          }),
        },
      });
      api.get = async () => ({ data: [] });
      await paymentIntentService.storePaymentIntent(orderId, {
        rzp_order_id: orderId,
        customer_id: 10,
        amount_in_paise: 60000, // Expected 60000 paise
        status: "created",
      });
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        headers: { "x-test-userid": "10" },
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_amount_mismatch = { statusCode: res.statusCode, body: res.body };
    }

    // 2.11 verifyPayment_stock_depleted (422)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_stock_depleted";
      const paymentId = "pay_rzp_stock_depleted";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: 60000,
            currency: "INR",
          }),
          refund: async () => ({ id: "rfnd_mock_123" }),
        },
      });
      api.get = async (path) => {
        if (path === "products/101") {
          return { data: { manage_stock: true, stock_quantity: 0, backorders_allowed: false } };
        }
        return { data: [] };
      };
      await paymentIntentService.storePaymentIntent(orderId, {
        rzp_order_id: orderId,
        customer_id: 10,
        amount_in_paise: 60000,
        status: "created",
        checkout_payload: {
          customer_id: 10,
          billing: {},
          shipping: {},
          line_items: [{ product_id: 101, quantity: 2 }],
        },
      });
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        headers: { "x-test-userid": "10" },
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_stock_depleted = { statusCode: res.statusCode, body: res.body };
    }

    // 2.12 verifyPayment_success (200)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_success_100";
      const paymentId = "pay_rzp_success_100";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: 60000,
            currency: "INR",
          }),
        },
      });
      api.get = async (path) => {
        if (path === "products/101") {
          return { data: { manage_stock: true, stock_quantity: 10, backorders_allowed: false } };
        }
        return { data: [] };
      };
      api.post = async (path) => {
        if (path === "orders") {
          return { data: { id: 7777, status: "processing" } };
        }
        return { data: {} };
      };
      await paymentIntentService.storePaymentIntent(orderId, {
        rzp_order_id: orderId,
        customer_id: 10,
        amount_in_paise: 60000,
        status: "created",
        checkout_payload: {
          customer_id: 10,
          billing: {},
          shipping: {},
          line_items: [{ product_id: 101, quantity: 1 }],
        },
      });
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        headers: { "x-test-userid": "10" },
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_success = { statusCode: res.statusCode, body: res.body };
    }

    // 2.13 verifyPayment_idempotent (200)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_idempotent_200";
      const paymentId = "pay_rzp_idempotent_200";
      const signature = makeValidSignature(orderId, paymentId);
      setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: 60000,
            currency: "INR",
          }),
        },
      });
      api.get = async (path) => {
        if (path === "orders") {
          return {
            data: [{
              id: 8888,
              status: "processing",
              meta_data: [{ key: "_razorpay_order_id", value: orderId }],
            }],
          };
        }
        return { data: [] };
      };
      const res = await makeRequest(server, "POST", "/api/payments/verify", {
        headers: { "x-test-userid": "10" },
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
      });
      paymentSnapshots.verifyPayment_idempotent = { statusCode: res.statusCode, body: res.body };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. POST /api/payments/check-status
    // ─────────────────────────────────────────────────────────────────────────

    // 3.1 checkPaymentStatus_missing_order_id (400)
    {
      const res = await makeRequest(server, "POST", "/api/payments/check-status", { body: {} });
      paymentSnapshots.checkPaymentStatus_missing_order_id = { statusCode: res.statusCode, body: res.body };
    }

    // 3.2 checkPaymentStatus_already_paid (200)
    {
      api.get = async (path) => {
        if (path === "orders") {
          return {
            data: [{
              id: 9991,
              status: "processing",
              meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_already_created" }],
            }],
          };
        }
        return { data: [] };
      };
      const res = await makeRequest(server, "POST", "/api/payments/check-status", {
        body: { razorpay_order_id: "order_rzp_already_created" },
      });
      paymentSnapshots.checkPaymentStatus_already_paid = { statusCode: res.statusCode, body: res.body };
    }

    // 3.3 checkPaymentStatus_gateway_error (502)
    {
      const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
      _setRazorpayInstanceForTesting({
        orders: {
          fetchPayments: async () => {
            throw new Error("Razorpay timeout");
          },
        },
      });
      api.get = async () => ({ data: [] });
      const res = await makeRequest(server, "POST", "/api/payments/check-status", {
        body: { razorpay_order_id: "order_rzp_query_fail" },
      });
      paymentSnapshots.checkPaymentStatus_gateway_error = { statusCode: res.statusCode, body: res.body };
    }

    // 3.4 checkPaymentStatus_unpaid (200)
    {
      const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
      _setRazorpayInstanceForTesting({
        orders: {
          fetchPayments: async () => ({
            items: [{ id: "pay_failed_1", status: "failed" }, { id: "pay_created_1", status: "created" }],
          }),
        },
      });
      api.get = async () => ({ data: [] });
      const res = await makeRequest(server, "POST", "/api/payments/check-status", {
        body: { razorpay_order_id: "order_rzp_unpaid_123" },
      });
      paymentSnapshots.checkPaymentStatus_unpaid = { statusCode: res.statusCode, body: res.body };
    }

    // 3.5 checkPaymentStatus_captured (200)
    {
// using global _setRazorpayInstanceForTesting
      const orderId = "order_rzp_captured_check";
      const paymentId = "pay_rzp_captured_check";
      setRazorpayInstanceForTesting({
        orders: {
          fetchPayments: async () => ({
            items: [{ id: paymentId, status: "captured", amount: 60000, currency: "INR" }],
          }),
        },
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: 60000,
            currency: "INR",
          }),
        },
      });
      api.get = async () => ({ data: [] });
      api.post = async (path) => {
        if (path === "orders") {
          return { data: { id: 8882, status: "processing" } };
        }
        return { data: {} };
      };
      await paymentIntentService.storePaymentIntent(orderId, {
        rzp_order_id: orderId,
        customer_id: 10,
        amount_in_paise: 60000,
        status: "created",
        checkout_payload: {
          customer_id: 10,
          billing: {},
          shipping: {},
          line_items: [],
        },
      });
      const res = await makeRequest(server, "POST", "/api/payments/check-status", {
        headers: { "x-test-userid": "10" },
        body: { razorpay_order_id: orderId },
      });
      paymentSnapshots.checkPaymentStatus_captured = { statusCode: res.statusCode, body: res.body };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. POST /api/payments/reconcile/:id (and the 409 mismatch)
    // ─────────────────────────────────────────────────────────────────────────

    // 4.1 reconcile_not_found (404)
    {
      api.get = async () => {
        throw new Error("Order not found");
      };
      const res = await makeRequest(server, "POST", "/api/payments/reconcile/99999");
      paymentSnapshots.reconcile_not_found = { statusCode: res.statusCode, body: res.body };
    }

    // 4.2 reconcile_no_rzp_order_id (200)
    {
      api.get = async (path) => {
        if (path === "orders/100") {
          return { data: { id: 100, status: "pending", meta_data: [] } };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/reconcile/100");
      paymentSnapshots.reconcile_no_rzp_order_id = { statusCode: res.statusCode, body: res.body };
    }

    // 4.3 reconcile_already_processing (200)
    {
      api.get = async (path) => {
        if (path === "orders/101") {
          return {
            data: {
              id: 101,
              status: "processing",
              meta_data: [{ key: "_razorpay_order_id", value: "order_mock_rzp_101" }],
            },
          };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/reconcile/101");
      paymentSnapshots.reconcile_already_processing = { statusCode: res.statusCode, body: res.body };
    }

    // 4.4 reconcile_gateway_error (502)
    {
      const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
      _setRazorpayInstanceForTesting({
        orders: {
          fetchPayments: async () => {
            throw new Error("Razorpay communication failed");
          },
        },
      });
      api.get = async (path) => {
        if (path === "orders/102") {
          return {
            data: {
              id: 102,
              status: "pending",
              meta_data: [{ key: "_razorpay_order_id", value: "order_mock_rzp_102" }],
            },
          };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/reconcile/102");
      paymentSnapshots.reconcile_gateway_error = { statusCode: res.statusCode, body: res.body };
    }

    // 4.5 reconcile_amount_mismatch_409 (409) — [The cancel/reconcile 409 amount mismatch]
    {
      const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
      _setRazorpayInstanceForTesting({
        orders: {
          fetchPayments: async () => ({
            items: [
              { id: "pay_captured_mismatch", status: "captured", amount: 50000 }, // Debited 500.00
            ],
          }),
        },
      });
      api.get = async (path) => {
        if (path === "orders/103") {
          return {
            data: {
              id: 103,
              status: "pending",
              total: "600.00", // Expected 600.00 (60000 paise)
              meta_data: [{ key: "_razorpay_order_id", value: "order_mock_rzp_103" }],
            },
          };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/reconcile/103");
      paymentSnapshots.reconcile_amount_mismatch_409 = { statusCode: res.statusCode, body: res.body };
    }

    // 4.6 reconcile_updated_to_processing (200)
    {
      const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
      _setRazorpayInstanceForTesting({
        orders: {
          fetchPayments: async () => ({
            items: [
              { id: "pay_captured_ok", status: "captured", amount: 60000, method: "upi" },
            ],
          }),
        },
      });
      api.get = async (path) => {
        if (path === "orders/104") {
          return {
            data: {
              id: 104,
              status: "pending",
              total: "600.00",
              meta_data: [{ key: "_razorpay_order_id", value: "order_mock_rzp_104" }],
            },
          };
        }
        return { data: {} };
      };
      api.put = async () => ({ data: {} });
      const res = await makeRequest(server, "POST", "/api/payments/reconcile/104");
      paymentSnapshots.reconcile_updated_to_processing = { statusCode: res.statusCode, body: res.body };
    }

    // 4.7 reconcile_no_captured_payment (200)
    {
      const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
      _setRazorpayInstanceForTesting({
        orders: {
          fetchPayments: async () => ({
            items: [
              { id: "pay_failed_1", status: "failed", amount: 60000 },
            ],
          }),
        },
      });
      api.get = async (path) => {
        if (path === "orders/105") {
          return {
            data: {
              id: 105,
              status: "pending",
              total: "600.00",
              meta_data: [{ key: "_razorpay_order_id", value: "order_mock_rzp_105" }],
            },
          };
        }
        return { data: {} };
      };
      const res = await makeRequest(server, "POST", "/api/payments/reconcile/105");
      paymentSnapshots.reconcile_no_captured_payment = { statusCode: res.statusCode, body: res.body };
    }

    // Write fixtures to disk
    const fixturesDir = path.resolve("tests/fixtures");
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(fixturesDir, "storeSnapshots.json"),
      JSON.stringify(storeSnapshots, null, 2),
      "utf-8"
    );
    console.log("Successfully wrote tests/fixtures/storeSnapshots.json");

    fs.writeFileSync(
      path.join(fixturesDir, "paymentSnapshots.json"),
      JSON.stringify(paymentSnapshots, null, 2),
      "utf-8"
    );
    console.log("Successfully wrote tests/fixtures/paymentSnapshots.json");

  } finally {
    server.close();
    api.get = originalApiGet;
    api.post = originalApiPost;
    api.put = originalApiPut;
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
    axios.request = originalAxiosRequest;
    wp.post = originalWpPost;
    storeHoursService.getStoreStatus = originalGetStoreStatus;
    serverCache.clear();
  }
}

run().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
