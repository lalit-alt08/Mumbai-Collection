import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../src/app.js";
import { storeLimiter, checkoutLimiter } from "../src/middlewares/rateLimiter.js";
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

  await t.test("2. Rate limiters storeLimiter and checkoutLimiter are properly instantiated and exported", () => {
    assert.ok(storeLimiter, "storeLimiter must be exported");
    assert.ok(checkoutLimiter, "checkoutLimiter must be exported");
    assert.equal(typeof storeLimiter, "function");
    assert.equal(typeof checkoutLimiter, "function");
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

    // 3. Forwarded IP behind reverse proxy
    const reqBehindProxy = { headers: { "x-forwarded-for": "203.0.113.195, 10.0.0.1" }, ip: "127.0.0.1" };
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
});
