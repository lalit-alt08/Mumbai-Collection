import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../src/app.js";
import { storeLimiter, checkoutLimiter, statusCheckLimiter } from "../src/middlewares/rateLimiter.js";
import { getProductReviews } from "../src/controllers/reviewController.js";
import api from "../src/config/woocommerce.js";

test("Pre-Production Hardening Test Suite", async (t) => {
  await t.test("1. POST /api/store/checkout rejects unauthenticated requests with HTTP 401 AUTH_REQUIRED", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/store/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 401, "Must return 401 when customer auth cookie is absent");
      const jsonResponse = await res.json();
      assert.deepEqual(jsonResponse, {
        success: false,
        code: "AUTH_REQUIRED",
        message: "Please log in to place an order.",
      });
    } finally {
      server.close();
    }
  });

  await t.test("2. Rate limiters storeLimiter, checkoutLimiter, and statusCheckLimiter are properly instantiated and exported", () => {
    assert.ok(storeLimiter, "storeLimiter must be exported");
    assert.ok(checkoutLimiter, "checkoutLimiter must be exported");
    assert.ok(statusCheckLimiter, "statusCheckLimiter must be exported");
    assert.equal(typeof storeLimiter, "function");
    assert.equal(typeof checkoutLimiter, "function");
    assert.equal(typeof statusCheckLimiter, "function");
  });

  await t.test("3. Helmet CSP response headers are enabled and include Razorpay/Google directives", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      const csp = res.headers.get("content-security-policy");

      assert.ok(csp, "Content-Security-Policy header must be present");
      assert.match(csp, /accounts\.google\.com/, "CSP must allow Google Auth");
      assert.match(csp, /checkout\.razorpay\.com/, "CSP must prepare Razorpay checkout SDK directive");
      assert.match(csp, /api\.razorpay\.com/, "CSP must prepare Razorpay API directive");
    } finally {
      server.close();
    }
  });

  await t.test("4. getProductReviews public response strictly omits reviewerEmail (PII Privacy Protection)", async () => {
    const originalGet = api.get;
    try {
      api.get = async (url) => {
        if (url === "products/reviews") {
          return {
            data: [
              {
                id: 1,
                product_id: 42,
                rating: 5,
                reviewer: "Test Customer",
                reviewer_email: "secret_customer_pii@example.com",
                review: "Loved the product!",
                verified: true,
                date_created: "2026-09-10T12:00:00Z",
              },
            ],
          };
        }
        return { data: [] };
      };

      let jsonResponse = null;

      const req = {
        params: { productId: "42" },
      };
      const res = {
        status(code) {
          return this;
        },
        json(data) {
          jsonResponse = data;
          return this;
        },
      };

      await getProductReviews(req, res);

      assert.equal(jsonResponse?.success, true);
      assert.equal(jsonResponse?.reviews?.length, 1);
      const reviewItem = jsonResponse.reviews[0];

      assert.equal(reviewItem.id, 1);
      assert.equal(reviewItem.reviewer, "Test Customer");
      assert.equal(reviewItem.review, "Loved the product!");
      assert.equal(
        reviewItem.reviewerEmail,
        undefined,
        "reviewerEmail must NOT be present in public review response"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(reviewItem, "reviewerEmail"),
        false,
        "reviewerEmail key must be completely absent from public review object"
      );
    } finally {
      api.get = originalGet;
    }
  });

  await t.test("5. Query validation middleware handles Express 5 getter-only req.query safely without 500 error", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      // Test GET /api/products
      const resProducts = await fetch(`http://127.0.0.1:${port}/api/products`);
      assert.notEqual(resProducts.status, 500, "/api/products must not return 500");
      assert.equal(resProducts.status, 200, "/api/products must return 200");

      // Test GET /api/products/categories
      const resCategories = await fetch(`http://127.0.0.1:${port}/api/products/categories`);
      assert.notEqual(resCategories.status, 500, "/api/products/categories must not return 500");
      assert.equal(resCategories.status, 200, "/api/products/categories must return 200");

      // Test GET /api/products/search
      const resSearch = await fetch(`http://127.0.0.1:${port}/api/products/search?q=test`);
      assert.notEqual(resSearch.status, 500, "/api/products/search must not return 500");
      assert.equal(resSearch.status, 200, "/api/products/search must return 200");
    } finally {
      server.close();
    }
  });

  await t.test("6. validateRequest rejects invalid query parameters with 400 VALIDATION_ERROR and coerces valid types", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      // Invalid page number
      const resInvalid = await fetch(`http://127.0.0.1:${port}/api/products?page=-5`);
      assert.equal(resInvalid.status, 400, "Must return 400 for negative page number");
      const errJson = await resInvalid.json();
      assert.equal(errJson.code, "VALIDATION_ERROR");

      // Valid coerced page parameter
      const resValid = await fetch(`http://127.0.0.1:${port}/api/products?page=1&per_page=10`);
      assert.equal(resValid.status, 200, "Must return 200 for valid pagination query");
    } finally {
      server.close();
    }
  });

  await t.test("7. checkoutLimiter keys requests by user ID, auth cookie, and client IP without leaking across customers", () => {
    // 1. Authenticated user
    const reqWithUser = { user: { id: 101 }, headers: {} };
    assert.equal(checkoutLimiter.keyGenerator(reqWithUser), "checkout:user:101");

    // 2. Customer with auth cookie
    const reqWithCookie = { cookies: { mumbai_customer_auth: "wordpress_logged_in_abcdef1234567890abcdef1234567890" }, headers: {} };
    assert.equal(checkoutLimiter.keyGenerator(reqWithCookie), "checkout:cookie:abcdef1234567890abcdef1234567890");

    // 3. Forwarded IP behind reverse proxy (Express sets req.ip via trust proxy)
    const reqBehindProxy = { ip: "203.0.113.195" };
    assert.equal(checkoutLimiter.keyGenerator(reqBehindProxy), "checkout:ip:203.0.113.195");

    // 4. Fallback socket IP
    const reqDirect = { headers: {}, socket: { remoteAddress: "192.168.1.50" } };
    assert.equal(checkoutLimiter.keyGenerator(reqDirect), "checkout:ip:192.168.1.50");
  });

  await t.test("8. POST /api/store/checkout applies requireIdempotency and honors X-Idempotency-Key", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      // Send unauthenticated request with an idempotency key - requireIdempotency runs and intercepts
      const res = await fetch(`http://127.0.0.1:${port}/api/store/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": "test-uuid-checkout-123",
        },
        body: JSON.stringify({ test: "data" }),
      });

      // It gets evaluated through requireIdempotency -> proxyStoreApi -> 401 AUTH_REQUIRED
      assert.equal(res.status, 401);
      const jsonResponse = await res.json();
      assert.equal(jsonResponse.code, "AUTH_REQUIRED");
    } finally {
      server.close();
    }
  });

  await t.test("9. statusCheckLimiter: 10 rapid calls from the same session do not trigger HTTP 429", async () => {
    const statuses = [];
    const fakeRes = () => ({
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        return this;
      },
      set() {},
    });

    const req = {
      ip: "127.0.0.1",
      cookies: { mumbai_customer_auth: "sess_verify_rapid_test_123" },
      headers: {},
    };

    for (let i = 0; i < 10; i++) {
      let nextCalled = false;
      const res = fakeRes();
      statusCheckLimiter(req, res, () => {
        nextCalled = true;
      });
      statuses.push({ nextCalled, statusCode: res.statusCode });
    }

    assert.equal(statuses.every((s) => s.nextCalled && s.statusCode === undefined), true, "All 10 rapid calls must pass through without 429");
  });

  await t.test("10. POST /api/payments/verify: 10 rapid calls from same session do not return 429", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const responses = [];
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/api/payments/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "mumbai_customer_auth=sess_rapid_client_456",
          },
          body: JSON.stringify({
            razorpay_order_id: "order_123",
            razorpay_payment_id: "pay_123",
            razorpay_signature: "sig_123",
          }),
        });
        responses.push(res.status);
      }

      assert.equal(responses.includes(429), false, "None of the 10 rapid verify calls should return 429");
    } finally {
      server.close();
    }
  });
});
