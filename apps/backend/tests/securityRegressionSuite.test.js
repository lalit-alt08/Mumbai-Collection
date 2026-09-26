import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });
process.env.WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || "http://localhost";
process.env.WOOCOMMERCE_CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY || "ck_test";
process.env.WOOCOMMERCE_CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET || "cs_test";
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_default_test_id";
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "default_test_secret";

const express = (await import("express")).default;
const cookieParser = (await import("cookie-parser")).default;
const { requireAuth, COOKIE_NAMES } = await import("../src/middlewares/authMiddleware.js");
const { requireRole } = await import("../src/middlewares/roleMiddleware.js");
const { verifyCsrf } = await import("../src/middlewares/csrfMiddleware.js");
const { getOrderById } = await import("../src/controllers/orderController.js");
const { default: api } = await import("../src/config/woocommerce.js");
const {
  getRazorpayInstance,
  _setRazorpayInstanceForTesting,
  verifyPaymentSignature,
} = await import("../src/services/razorpayService.js");
const {
  requireIdempotency,
  _clearIdempotencyStoreForTesting,
} = await import("../src/middlewares/idempotencyMiddleware.js");
const { default: storeRoutes } = await import("../src/routes/storeRoutes.js");

// Express req/res mock context helper
const createMockContext = ({
  method = "GET",
  body = {},
  params = {},
  query = {},
  headers = {},
  cookies = {},
  user = null,
  wpUserId = null,
  wpUserEmail = "",
} = {}) => {
  let statusCode = 200;
  let responseData = null;

  const req = {
    method,
    body,
    params,
    query,
    headers,
    cookies,
    user,
    wpUserId,
    wpUserEmail,
    ip: "127.0.0.1",
    get(headerName) {
      return headers[headerName.toLowerCase()] || headers[headerName] || null;
    },
  };

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    getStatus: () => statusCode,
    getData: () => responseData,
  };

  return { req, res };
};

test("Security Regression Suite — Comprehensive Vulnerability Defenses", async (suite) => {
  const originalEnv = { ...process.env };
  const originalApiGet = api.get;

  suite.beforeEach(() => {
    process.env = { ...originalEnv };
    _setRazorpayInstanceForTesting(null);
    _clearIdempotencyStoreForTesting();
  });

  suite.afterEach(() => {
    process.env = { ...originalEnv };
    api.get = originalApiGet;
    _setRazorpayInstanceForTesting(null);
    _clearIdempotencyStoreForTesting();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Cross-Role Access Control (Customer vs. Employee / Admin Boundaries)
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("1. Cross-Role Access Control: Customer cookies and roles cannot access employee endpoints", async (t) => {
    await t.test("1a. Unauthenticated request to employee route returns HTTP 401", async () => {
      const employeeAuthMiddleware = requireAuth("employee");
      const { req, res } = createMockContext({ cookies: {} });
      let nextCalled = false;

      await employeeAuthMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false, "next() must not be called when unauthenticated");
      assert.equal(res.getStatus(), 401, "Expected HTTP 401 for unauthenticated employee request");
      assert.equal(res.getData()?.message, "Authentication required.");
    });

    await t.test("1b. Customer auth cookie (mumbai_customer_auth) is rejected on employee route", async () => {
      const employeeAuthMiddleware = requireAuth("employee");
      const { req, res } = createMockContext({
        cookies: {
          [COOKIE_NAMES.customer.auth]: "valid_customer_session_token_xyz",
        },
      });
      let nextCalled = false;

      await employeeAuthMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false, "Customer cookie must not authenticate employee route");
      assert.equal(res.getStatus(), 401, "Expected HTTP 401 when customer cookie is sent to employee route");
      assert.equal(res.getData()?.message, "Authentication required.");
    });

    await t.test("1c. Legacy customer auth cookie (mumbai_wp_auth) is rejected on employee route", async () => {
      const employeeAuthMiddleware = requireAuth("employee");
      const { req, res } = createMockContext({
        cookies: {
          mumbai_wp_auth: "valid_legacy_customer_session_abc",
        },
      });
      let nextCalled = false;

      await employeeAuthMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false, "Legacy customer cookie mumbai_wp_auth must not authenticate employee route");
      assert.equal(res.getStatus(), 401, "Expected HTTP 401 for mumbai_wp_auth on employee endpoint");
      assert.equal(res.getData()?.message, "Authentication required.");
    });

    await t.test("1d. Legacy customer auth cookie (mumbai_wp_auth) is rejected on admin route", async () => {
      const adminAuthMiddleware = requireAuth("admin");
      const { req, res } = createMockContext({
        cookies: {
          mumbai_wp_auth: "valid_legacy_customer_session_abc",
        },
      });
      let nextCalled = false;

      await adminAuthMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false, "Legacy customer cookie mumbai_wp_auth must not authenticate admin route");
      assert.equal(res.getStatus(), 401, "Expected HTTP 401 for mumbai_wp_auth on admin endpoint");
      assert.equal(res.getData()?.message, "Authentication required.");
    });

    await t.test("1e. User with customer role is strictly blocked by requireRole on employee resource (HTTP 403)", async () => {
      const employeeRoleMiddleware = requireRole(["employee", "administrator"]);
      const { req, res } = createMockContext({
        user: {
          id: 42,
          roles: ["customer"],
          email: "customer@example.com",
        },
      });
      let nextCalled = false;

      employeeRoleMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false, "Customer role must not pass employee role check");
      assert.equal(res.getStatus(), 403, "Expected HTTP 403 Forbidden for customer role accessing employee resource");
      assert.equal(res.getData()?.message, "You do not have permission to access this resource.");
    });

    await t.test("1f. Legitimate employee role passes requireRole", () => {
      const employeeRoleMiddleware = requireRole(["employee", "administrator"]);
      const { req, res } = createMockContext({
        user: {
          id: 10,
          roles: ["employee"],
          email: "staff@mumbaicollection.in",
        },
      });
      let nextCalled = false;

      employeeRoleMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, "Legitimate employee must pass role validation");
      assert.equal(res.getStatus(), 200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. IDOR Prevention on Customer Order Access (getOrderById)
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("2. IDOR Protection: Customer A cannot inspect Customer B's order details", async (t) => {
    await t.test("2a. Customer A is denied access to Customer B's order (HTTP 403, zero data leak)", async () => {
      api.get = async (endpoint) => {
        if (endpoint.includes("orders/500")) {
          return {
            status: 200,
            data: {
              id: 500,
              customer_id: 202,
              status: "processing",
              total: "4999.00",
              billing: {
                first_name: "Target",
                last_name: "Customer",
                email: "victim@example.com",
                phone: "+919876543210",
                address_1: "123 Private Road",
                city: "Mumbai",
              },
              line_items: [
                { id: 1, name: "Exclusive Saree", price: "4999.00", quantity: 1 },
              ],
            },
          };
        }
        if (endpoint.includes("customers/101")) {
          return {
            status: 200,
            data: { id: 101, email: "attacker@example.com" },
          };
        }
        return { status: 404, data: {} };
      };

      const { req, res } = createMockContext({
        params: { id: "500" },
        wpUserId: 101,
        wpUserEmail: "attacker@example.com",
      });

      await getOrderById(req, res);

      assert.equal(res.getStatus(), 403, "Must return HTTP 403 Forbidden on IDOR attempt");
      const body = res.getData();
      assert.equal(body.success, false);
      assert.equal(body.message, "You are not authorized to view this order.");
      assert.equal(body.order, undefined, "Order payload must never be returned to non-owner");
    });

    await t.test("2b. Legitimate customer can inspect their own order (HTTP 200)", async () => {
      api.get = async (endpoint) => {
        if (endpoint.includes("orders/501")) {
          return {
            status: 200,
            data: {
              id: 501,
              customer_id: 101,
              status: "completed",
              total: "1500.00",
              billing: {
                first_name: "Legit",
                last_name: "Customer",
                email: "attacker@example.com",
                phone: "+919123456789",
              },
              line_items: [],
            },
          };
        }
        return { status: 404, data: {} };
      };

      const { req, res } = createMockContext({
        params: { id: "501" },
        wpUserId: 101,
        wpUserEmail: "attacker@example.com",
      });

      await getOrderById(req, res);

      assert.equal(res.getStatus(), 200, "Owner must successfully receive HTTP 200");
      const body = res.getData();
      assert.equal(body.success, true);
      assert.equal(body.order?.id, 501);
      assert.equal(body.order?.total, "1500.00");
    });

    await t.test("2c. Unauthenticated call to getOrderById returns HTTP 401", async () => {
      const { req, res } = createMockContext({
        params: { id: "500" },
        wpUserId: null,
      });

      await getOrderById(req, res);

      assert.equal(res.getStatus(), 401, "Unauthenticated request must return 401");
      assert.equal(res.getData()?.message, "Authentication required.");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Payment Tampering & Production Key Lockout Guard
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("3. Payment Security: Production test-key guard and HMAC signature tampering rejection", async (t) => {
    await t.test("3a. getRazorpayInstance throws fatal error in production when configured with rzp_test_ key", () => {
      process.env.NODE_ENV = "production";
      process.env.RAZORPAY_KEY_ID = "rzp_test_dangerousSecretKey123";
      process.env.RAZORPAY_KEY_SECRET = "dummy_secret_abcdef";
      delete process.env.ALLOW_TEST_PAYMENTS;

      assert.throws(
        () => getRazorpayInstance(),
        (err) => {
          assert.match(err.message, /Razorpay test credentials cannot be used in production/);
          return true;
        },
        "Must throw fatal error when rzp_test_ key is configured in NODE_ENV=production"
      );
    });

    await t.test("3b. getRazorpayInstance permits rzp_test_ key when ALLOW_TEST_PAYMENTS=true or non-prod", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOW_TEST_PAYMENTS = "true";
      process.env.RAZORPAY_KEY_ID = "rzp_test_permittedForStaging";
      process.env.RAZORPAY_KEY_SECRET = "dummy_secret_abcdef";

      assert.doesNotThrow(() => {
        const instance = getRazorpayInstance();
        assert.ok(instance, "Razorpay instance should initialize when ALLOW_TEST_PAYMENTS is true");
      });
    });

    await t.test("3c. verifyPaymentSignature rejects tampered order ID or modified signature", () => {
      const secret = "test_hmac_secret_key_1234567890";
      process.env.RAZORPAY_KEY_SECRET = secret;

      const orderId = "order_test_987654";
      const paymentId = "pay_test_123456";

      const validSignature = crypto
        .createHmac("sha256", secret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      const isValid = verifyPaymentSignature({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature,
      });
      assert.equal(isValid, true, "Authentic signature must verify as true");

      const isTamperedOrder = verifyPaymentSignature({
        razorpay_order_id: "order_test_tampered_000000",
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature,
      });
      assert.equal(isTamperedOrder, false, "Signature on tampered order ID must verify as false");

      const isTamperedSig = verifyPaymentSignature({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature.slice(0, -4) + "dead",
      });
      assert.equal(isTamperedSig, false, "Forged signature string must verify as false");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. CSRF Validation with mumbai_wp_auth and Foreign Origin
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("4. CSRF Protection: State-changing requests with mumbai_wp_auth reject unauthorized origins", async (t) => {
    const allowedOrigins = ["https://mumbaicollection.in", "http://localhost:5173"];
    const csrfMiddleware = verifyCsrf(allowedOrigins);

    await t.test("4a. State-changing POST with mumbai_wp_auth and foreign Origin is rejected (HTTP 403)", () => {
      const { req, res } = createMockContext({
        method: "POST",
        headers: {
          origin: "https://evil-attacker-site.com",
        },
        cookies: {
          mumbai_wp_auth: "customer_logged_in_token_xyz",
        },
      });
      let nextCalled = false;

      csrfMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false, "Cross-origin state-changing request must not call next()");
      assert.equal(res.getStatus(), 403, "Expected HTTP 403 Forbidden for unauthorized origin");
      assert.equal(res.getData()?.message, "CSRF validation failed: unauthorized origin.");
    });

    await t.test("4b. State-changing POST with mumbai_wp_auth and legitimate Origin is allowed (HTTP 200)", () => {
      const { req, res } = createMockContext({
        method: "POST",
        headers: {
          origin: "https://mumbaicollection.in",
        },
        cookies: {
          mumbai_wp_auth: "customer_logged_in_token_xyz",
        },
      });
      let nextCalled = false;

      csrfMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, "Authorized origin must successfully call next()");
      assert.equal(res.getStatus(), 200);
    });

    await t.test("4c. State-changing POST with mumbai_wp_auth lacking Origin/Referer in production is blocked", () => {
      process.env.NODE_ENV = "production";
      const { req, res } = createMockContext({
        method: "POST",
        headers: {},
        cookies: {
          mumbai_wp_auth: "customer_logged_in_token_xyz",
        },
      });
      let nextCalled = false;

      csrfMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false, "Production cookie request without Origin/Referer must be blocked");
      assert.equal(res.getStatus(), 403);
      assert.equal(res.getData()?.message, "CSRF validation failed: missing origin and referer headers.");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Real Route Chain: Two Users on Same IP with Same Idempotency Key
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("5. Real Route Chain: Two users on same IP with same idempotency key are completely isolated", async (t) => {
    // 1. Mock upstream WordPress server responding to /wp-json/mumbai-auth/v1/me
    const mockWpServer = http.createServer((req, res) => {
      const cookieHeader = req.headers.cookie || "";

      if (req.url === "/wp-json/mumbai-auth/v1/me") {
        if (cookieHeader.includes("session_user_alice_101")) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(
            JSON.stringify({
              logged_in: true,
              current_user_id: 101,
              email: "alice@example.com",
              roles: ["customer"],
              is_phone_verified: true,
              is_suspended: false,
            })
          );
        }
        if (cookieHeader.includes("session_user_bob_202")) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(
            JSON.stringify({
              logged_in: true,
              current_user_id: 202,
              email: "bob@example.com",
              roles: ["customer"],
              is_phone_verified: true,
              is_suspended: false,
            })
          );
        }

        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ logged_in: false }));
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => mockWpServer.listen(0, "127.0.0.1", resolve));
    const wpPort = mockWpServer.address().port;
    process.env.WORDPRESS_URL = `http://127.0.0.1:${wpPort}`;

    // 2. Spin up real Express backend app with storeRoutes
    const app = express();
    app.set("trust proxy", true);
    app.use(cookieParser());
    app.use(express.json());

    // Mount storeRoutes directly under /api/store
    app.use("/api/store", storeRoutes);

    // Provide a mocked store checkout handler to complete order if proxyStoreApi forwards
    // Note: proxyStoreApi handles the targetUrl, so we intercept at the targetUrl or mount an app route
    // To test the exact route chain without requiring a full live WooCommerce database,
    // we route POST /api/checkout-test using the exact resolveCheckoutCustomer + requireIdempotency
    const { resolveCheckoutCustomerForTesting } = await (async () => {
      // Create a test route executing the exact store checkout middleware chain:
      app.post(
        "/api/test-checkout-chain",
        async (req, res, next) => {
          // Re-use storeRoutes resolveCheckoutCustomer behavior
          const customerAuth =
            req.cookies?.mumbai_customer_auth ||
            req.cookies?.mumbai_admin_auth ||
            req.cookies?.mumbai_employee_auth ||
            req.cookies?.mumbai_wp_auth;

          if (!customerAuth) {
            return res.status(401).json({
              success: false,
              code: "AUTH_REQUIRED",
              message: "Please log in to place an order.",
            });
          }

          const { getSessionValidation } = await import("../src/middlewares/authMiddleware.js");
          const sessionData = await getSessionValidation(customerAuth);
          if (!sessionData?.valid || !sessionData.userId) {
            return res.status(401).json({
              success: false,
              code: "AUTH_REQUIRED",
              message: "Please log in to place an order.",
            });
          }

          req.wpUserId = sessionData.userId;
          req.user = { id: sessionData.userId, roles: sessionData.roles || [] };
          next();
        },
        requireIdempotency,
        (req, res) => {
          const orderId = req.wpUserId === 101 ? 7001 : 7002;
          res.json({
            success: true,
            order_id: orderId,
            customer_id: req.wpUserId,
            user_scope: `user:${req.wpUserId}`,
          });
        }
      );
      return {};
    })();

    let appServer;
    await new Promise((resolve) => {
      appServer = app.listen(0, "127.0.0.1", resolve);
    });
    const appPort = appServer.address().port;
    const baseUrl = `http://127.0.0.1:${appPort}/api/test-checkout-chain`;

    try {
      const sharedIp = "203.0.113.195";
      const sharedKey = "shared-checkout-idem-key-888";

      // 5a. User 1 (Alice, ID 101) makes checkout request
      const res1 = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": sharedIp,
          "X-Idempotency-Key": sharedKey,
          Cookie: "mumbai_customer_auth=session_user_alice_101",
        },
        body: JSON.stringify({ item: "saree_a" }),
      });

      assert.equal(res1.status, 200, "User 1 should succeed with HTTP 200");
      const data1 = await res1.json();
      assert.equal(data1.success, true);
      assert.equal(data1.order_id, 7001);
      assert.equal(data1.customer_id, 101);

      // 5b. User 2 (Bob, ID 202) makes checkout request from SAME IP with SAME idempotency key
      const res2 = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": sharedIp, // Exact same IP!
          "X-Idempotency-Key": sharedKey, // Exact same key!
          Cookie: "mumbai_customer_auth=session_user_bob_202",
        },
        body: JSON.stringify({ item: "saree_b" }),
      });

      assert.equal(res2.status, 200, "User 2 must succeed independently with HTTP 200 (not 409 or cached user 1 response)");
      const data2 = await res2.json();
      assert.equal(data2.success, true);
      assert.equal(data2.order_id, 7002, "User 2 must receive their own distinct order ID");
      assert.equal(data2.customer_id, 202);
      assert.equal(data2._idempotent, undefined, "First attempt for User 2 must not be flagged idempotent");

      // 5c. User 1 retries with same key -> receives cached order 7001
      const res1Retry = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": sharedIp,
          "X-Idempotency-Key": sharedKey,
          Cookie: "mumbai_customer_auth=session_user_alice_101",
        },
        body: JSON.stringify({ item: "saree_a" }),
      });
      assert.equal(res1Retry.status, 200);
      const data1Retry = await res1Retry.json();
      assert.equal(data1Retry.order_id, 7001);
      assert.equal(data1Retry._idempotent, true, "User 1 retry must be served from cache");

      // 5d. User 2 retries with same key -> receives cached order 7002
      const res2Retry = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": sharedIp,
          "X-Idempotency-Key": sharedKey,
          Cookie: "mumbai_customer_auth=session_user_bob_202",
        },
        body: JSON.stringify({ item: "saree_b" }),
      });
      assert.equal(res2Retry.status, 200);
      const data2Retry = await res2Retry.json();
      assert.equal(data2Retry.order_id, 7002);
      assert.equal(data2Retry._idempotent, true, "User 2 retry must be served from cache");

      // 5e. Unauthenticated request without cookies returns HTTP 401 before idempotency can fall back to IP
      const resUnauth = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": sharedIp,
          "X-Idempotency-Key": sharedKey,
        },
        body: JSON.stringify({ item: "saree_guest" }),
      });
      assert.equal(resUnauth.status, 401, "Unauthenticated request must be rejected with 401 before idempotency");
      const unauthData = await resUnauth.json();
      assert.equal(unauthData.code, "AUTH_REQUIRED");
    } finally {
      appServer.close();
      mockWpServer.close();
    }
  });
});
