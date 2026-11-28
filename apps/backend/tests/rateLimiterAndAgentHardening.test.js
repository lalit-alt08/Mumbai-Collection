import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import axios from "axios";
import { httpAgent, httpsAgent } from "../src/config/httpAgent.js";
import wooClient from "../src/config/woocommerce.js";
import wpClient from "../src/services/wordpress.js";
import * as paymentCheckoutUtils from "../src/utils/paymentCheckoutUtils.js";
import { serverCache } from "../src/utils/memoryCache.js";
import { acquireLock, _setWpClientForTesting } from "../src/services/paymentIntentService.js";
import { _setRazorpayInstanceForTesting } from "../src/services/razorpayService.js";
import { createOrder, cancelPaymentOrder } from "../src/controllers/paymentController.js";
import {
  proxyStoreApi,
  _setStoreUpstreamAxiosForTesting,
  _setCartEnrichmentBudgetForTesting,
} from "../src/routes/storeRoutes.js";
import { _setSessionCacheForTesting } from "../src/middlewares/authMiddleware.js";
import storeHoursService from "../src/services/storeHoursService.js";
import productRouter from "../src/routes/productRoutes.js";
import reviewRouter from "../src/routes/reviewRoutes.js";
import paymentRouter from "../src/routes/paymentRoutes.js";
import {
  authLimiter,
  catalogLimiter,
  checkoutIpLimiter,
  checkoutLimiter,
  reviewLimiter,
  statusCheckLimiter,
  paymentRecoveryIpLimiter,
  paymentCallbackLimiter,
} from "../src/middlewares/rateLimiter.js";

test("Rate limiter and HTTP agent hardening invariants", async (t) => {
  await t.test("1. catalogLimiter is not duplicated on productRoutes handlers and reviewRoutes keeps single limits", () => {
    for (const layer of productRouter.stack) {
      if (!layer.route) continue;
      const hasCatalogLimiter = layer.route.stack.some((entry) => entry.handle === catalogLimiter);
      assert.equal(
        hasCatalogLimiter,
        false,
        `productRoutes ${layer.route.path} must not attach catalogLimiter (already applied on /api/products mount)`
      );
    }

    const getReviewLayer = reviewRouter.stack.find(
      (layer) => layer.route?.path === "/product/:productId" && layer.route.methods.get
    );
    assert.ok(getReviewLayer, "reviewRoutes GET /product/:productId must exist");
    assert.equal(
      getReviewLayer.route.stack.filter((entry) => entry.handle === catalogLimiter).length,
      1,
      "reviewRoutes GET /product/:productId must attach catalogLimiter once"
    );

    const postReviewLayer = reviewRouter.stack.find(
      (layer) => layer.route?.path === "/product/:productId" && layer.route.methods.post
    );
    assert.ok(postReviewLayer, "reviewRoutes POST /product/:productId must exist");
    assert.equal(
      postReviewLayer.route.stack.filter((entry) => entry.handle === reviewLimiter).length,
      1,
      "reviewRoutes POST /product/:productId must attach reviewLimiter once"
    );
  });

  await t.test("2. paymentRoutes orders IP guard -> requireAuth -> statusCheckLimiter on /check-status and isolates /callback", async () => {
    const checkStatusLayer = paymentRouter.stack.find((l) => l.route?.path === "/check-status");
    assert.ok(checkStatusLayer, "/check-status route must exist");
    const checkHandles = checkStatusLayer.route.stack.map((s) => s.handle);
    const ipIdx = checkHandles.indexOf(paymentRecoveryIpLimiter);
    const statusIdx = checkHandles.indexOf(statusCheckLimiter);
    assert.ok(ipIdx !== -1 && statusIdx !== -1, "check-status must include paymentRecoveryIpLimiter and statusCheckLimiter");
    assert.ok(ipIdx + 1 < statusIdx, "check-status must run auth middleware between IP limiter and statusCheckLimiter");

    let gateStatus = 0;
    let gateNextCalled = false;
    await checkHandles[ipIdx + 1](
      { cookies: {}, headers: {}, path: "/check-status", originalUrl: "/api/payments/check-status" },
      {
        status(code) { gateStatus = code; return this; },
        json() { return this; },
      },
      () => { gateNextCalled = true; }
    );
    assert.equal(gateNextCalled, false);
    assert.equal(gateStatus, 401, "Middleware before statusCheckLimiter must enforce authentication");

    const callbackLayer = paymentRouter.stack.find((l) => l.route?.path === "/callback");
    assert.ok(callbackLayer, "/callback route must exist");
    const callbackHandles = callbackLayer.route.stack.map((s) => s.handle);
    assert.ok(callbackHandles.includes(paymentCallbackLimiter), "/callback must use dedicated paymentCallbackLimiter");
    assert.equal(callbackHandles.includes(statusCheckLimiter), false, "/callback must not share statusCheckLimiter");

    // Rotating unauthenticated cookies must not bypass paymentCallbackLimiter's IP key
    const makeCbRes = () => {
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        set(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json() { return this; },
      };
      return res;
    };
    for (let i = 0; i < 60; i += 1) {
      let ok = false;
      const res = makeCbRes();
      await paymentCallbackLimiter(
        { headers: {}, ip: "198.51.100.42", cookies: { mumbai_customer_auth: `cookie-${i}` } },
        res,
        () => { ok = true; }
      );
      assert.equal(ok, true, `Callback request ${i + 1} within IP budget should pass`);
    }
    let blockedNext = false;
    const blockedRes = makeCbRes();
    await paymentCallbackLimiter(
      { headers: {}, ip: "198.51.100.42", cookies: { mumbai_customer_auth: "brand-new-cookie" } },
      blockedRes,
      () => { blockedNext = true; }
    );
    assert.equal(blockedNext, false, "Cookie rotation must not evade paymentCallbackLimiter IP cap");
    assert.equal(blockedRes.statusCode, 429);
  });

  await t.test("3. Internal HTTP clients bind both bounded httpAgent and httpsAgent (maxSockets=50)", () => {
    assert.equal(httpAgent.maxSockets, 50);
    assert.equal(httpsAgent.maxSockets, 50);
    assert.equal(wooClient.axiosConfig.httpAgent, httpAgent);
    assert.equal(wooClient.axiosConfig.httpsAgent, httpsAgent);
    assert.equal(wpClient.defaults.httpAgent, httpAgent);
    assert.equal(wpClient.defaults.httpsAgent, httpsAgent);
    assert.equal(paymentCheckoutUtils.httpAgent, httpAgent);
    assert.equal(paymentCheckoutUtils.httpsAgent, httpsAgent);

    const storeRoutesSrc = readFileSync(new URL("../src/routes/storeRoutes.js", import.meta.url), "utf8");
    const httpAgentUses = (storeRoutesSrc.match(/\bhttpAgent\b/g) || []).length;
    assert.ok(httpAgentUses >= 4, "storeRoutes.js must import and pass httpAgent to all upstream http://wordpress calls");

    const checkoutUtilsSrc = readFileSync(new URL("../src/utils/paymentCheckoutUtils.js", import.meta.url), "utf8");
    assert.ok(
      (checkoutUtilsSrc.match(/httpAgent\s*,/g) || []).length >= 2,
      "paymentCheckoutUtils.js must bind shared httpAgent on WooCommerce cart calls"
    );

    const paymentIntentSrc = readFileSync(new URL("../src/services/paymentIntentService.js", import.meta.url), "utf8");
    assert.ok(
      /axios\.create\(\{[\s\S]*httpAgent\s*,[\s\S]*httpsAgent\s*,/.test(paymentIntentSrc),
      "paymentIntentService.js must bind both httpAgent and httpsAgent on wpClient"
    );
  });

  await t.test("4. Banner endpoint sets conditional cache headers and versioned media uses 30-day cache", () => {
    const bannerCtrlSrc = readFileSync(new URL("../src/controllers/bannerController.js", import.meta.url), "utf8");
    assert.ok(
      bannerCtrlSrc.includes("public, max-age=30, s-maxage=60, stale-while-revalidate=300"),
      "getPublicBanners must allow short public caching on healthy non-forced requests"
    );
    assert.ok(
      bannerCtrlSrc.includes("data?.degraded === true"),
      "getPublicBanners must bypass public caching for degraded fallback responses"
    );
    assert.ok(
      bannerCtrlSrc.includes("appendMediaVersion"),
      "bannerController must tag /api/media/uploads/ assets with ?v="
    );

    const bannerServiceSrc = readFileSync(new URL("../src/services/bannerService.js", import.meta.url), "utf8");
    assert.ok(
      bannerServiceSrc.includes("degraded = true"),
      "bannerService getOutageFallback must mark fallback responses degraded"
    );

    const mediaRoutesSrc = readFileSync(new URL("../src/routes/mediaRoutes.js", import.meta.url), "utf8");
    assert.ok(
      mediaRoutesSrc.includes("if (response.status === 200)") &&
        mediaRoutesSrc.includes("req.query?.v || req.query?.ver") &&
        mediaRoutesSrc.includes("public, max-age=2592000, stale-while-revalidate=604800"),
      "mediaRoutes must apply 30-day cache strictly on 200 responses for versioned ?v= media"
    );
  });

  await t.test("5. Every backend file passing httpsAgent to axios/clients also binds bounded httpAgent", () => {
    const srcRoot = new URL("../src/", import.meta.url);
    const collectJs = (dirUrl) => {
      const files = [];
      for (const entry of readdirSync(dirUrl, { withFileTypes: true })) {
        const nextUrl = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dirUrl);
        if (entry.isDirectory()) files.push(...collectJs(nextUrl));
        else if (entry.name.endsWith(".js")) files.push(nextUrl);
      }
      return files;
    };
    for (const fileUrl of collectJs(srcRoot)) {
      if (fileUrl.pathname.endsWith("/config/httpAgent.js")) continue;
      const content = readFileSync(fileUrl, "utf8");
      const httpsCount = (content.match(/\bhttpsAgent\b/g) || []).length;
      const httpCount = (content.match(/\bhttpAgent\b/g) || []).length;
      if (httpsCount >= 2) {
        assert.ok(
          httpCount >= httpsCount,
          `${fileUrl.pathname} binds httpsAgent without matching httpAgent (${httpCount} vs ${httpsCount})`
        );
      }
    }
  });

  await t.test("6. Media error paths enforce no-store and PHP reconciliation fails closed on missing table or DB errors", () => {
    const mediaRoutesSrc = readFileSync(new URL("../src/routes/mediaRoutes.js", import.meta.url), "utf8");
    const errIdx = mediaRoutesSrc.indexOf('response.data.on("error"');
    assert.ok(errIdx !== -1 && mediaRoutesSrc.slice(errIdx).includes("applyNoStore()"), "mediaRoutes stream error must enforce no-store");
    assert.ok(
      mediaRoutesSrc.includes('setHeader("Cache-Control", "no-cache, no-store, must-revalidate")'),
      "mediaRoutes catch handler must explicitly enforce no-store on 404/502 errors"
    );

    const phpSrc = readFileSync(new URL("../../wordpress-plugin/mumbai-auth.php", import.meta.url), "utf8");
    const fnStart = phpSrc.indexOf("function mumbai_payment_intent_reconciliation_list");
    const fnEnd = phpSrc.indexOf("function mumbai_webhook_event_store");
    assert.ok(fnStart !== -1 && fnEnd > fnStart);
    const reconFn = phpSrc.slice(fnStart, fnEnd);
    assert.ok(reconFn.includes("durable_table_missing") && reconFn.includes("'status' => 500"), "reconciliation list must fail closed with 500 when table is missing");
    assert.ok(reconFn.includes("db_query_failed") && reconFn.includes("wpdb->last_error"), "reconciliation list must fail closed with 500 on DB query errors");

    const orphansStart = phpSrc.indexOf("function mumbai_webhook_events_orphans");
    const orphansEnd = phpSrc.indexOf("function mumbai_find_order_by_razorpay_order_id");
    assert.ok(orphansStart !== -1 && orphansEnd > orphansStart);
    const orphansFn = phpSrc.slice(orphansStart, orphansEnd);
    assert.ok(orphansFn.includes("durable_table_missing") && orphansFn.includes("'status' => 500"), "orphan webhook list must fail closed with 500 when table is missing");
    assert.ok(orphansFn.includes("db_query_failed") && orphansFn.includes("wpdb->last_error"), "orphan webhook list must fail closed with 500 on DB query errors");
    assert.ok(orphansFn.includes("refund_only") && orphansFn.includes("created_at ASC, event_id ASC"), "orphan webhook list must support oldest-first refund_only backlog queries");
  });

  await t.test("7. authLimiter tolerates non-string credentials and /create-order enforces pre-auth checkoutIpLimiter", () => {
    const strKey = authLimiter.keyGenerator({
      body: { credential: "header.payload.signature_1234567890abcdef1234567890" },
      ip: "203.0.113.10",
    });
    assert.equal(strKey, "auth:ature_1234567890abcdef1234567890:203.0.113.10");

    for (const badBody of [{ credential: 12345 }, { credential: { bad: true } }, { credential: ["a"] }, { email: { $ne: "" } }]) {
      const key = authLimiter.keyGenerator({ body: badBody, ip: "203.0.113.10" });
      assert.equal(key, "auth:anon:203.0.113.10");
    }

    const createOrderLayer = paymentRouter.stack.find((l) => l.route?.path === "/create-order");
    assert.ok(createOrderLayer, "/create-order route must exist");
    const handles = createOrderLayer.route.stack.map((s) => s.handle);
    const ipIdx = handles.indexOf(checkoutIpLimiter);
    const checkoutIdx = handles.indexOf(checkoutLimiter);
    assert.ok(ipIdx >= 1, "/create-order must apply validateRequest then checkoutIpLimiter");
    assert.ok(checkoutIdx > ipIdx + 1, "/create-order must apply auth/idempotency before per-user checkoutLimiter");
  });

  await t.test("8. Store API GET coalesces concurrent cart enrichment with read signals and acquireLock bounds waits", async () => {
    const originalApiGet = wooClient.get;
    const seenSignals = [];
    let wcProductCalls = 0;

    const makeMockRes = () => ({
      statusCode: 200,
      headers: {},
      body: null,
      writableEnded: false,
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
      on() {},
      removeListener() {},
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; this.writableEnded = true; return this; },
    });

    serverCache.clear();
    _setStoreUpstreamAxiosForTesting(async (config) => {
      seenSignals.push(config.signal);
      return {
        status: 200,
        headers: {},
        data: {
          items: [
            { id: 99, quantity: 1 },
            { id: 99, quantity: 2 },
          ],
        },
      };
    });
    wooClient.get = async (endpoint, _params, extraConfig = {}) => {
      if (endpoint === "products/99") {
        wcProductCalls += 1;
        assert.equal(extraConfig.timeout, 3500);
        assert.ok(extraConfig.signal instanceof AbortSignal);
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { data: { id: 99, manage_stock: true, stock_quantity: 4, backorders_allowed: false } };
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    };

    try {
      const reqA = { method: "GET", path: "/cart", headers: {}, cookies: {}, query: {} };
      const reqB = { method: "GET", path: "/cart", headers: {}, cookies: {}, query: {} };
      const resA = makeMockRes();
      const resB = makeMockRes();
      await Promise.all([proxyStoreApi(reqA, resA), proxyStoreApi(reqB, resB)]);

      assert.equal(resA.statusCode, 200);
      assert.equal(resB.statusCode, 200);
      assert.equal(wcProductCalls, 1, "concurrent/duplicate cart items must coalesce to one product fetch");
      assert.equal(seenSignals.length, 2);
      assert.ok(seenSignals.every((sig) => sig instanceof AbortSignal), "Store API GET reads must pass an AbortSignal");
      assert.equal(resA.body.items[0].stock_status, "instock");

      const lockConfigs = [];
      _setWpClientForTesting({
        post: async (_url, _body, config) => {
          lockConfigs.push(config);
          return { data: { acquired: false } };
        },
      });
      const start = Date.now();
      const acquired = await acquireLock("ord_budget_test", "worker_1", 300);
      const elapsed = Date.now() - start;
      assert.equal(acquired, false);
      assert.ok(lockConfigs.length >= 1, "acquireLock must call wpClient.post at least once");
      assert.ok(
        lockConfigs.every((cfg) => cfg?.timeout <= 300 && cfg?.signal instanceof AbortSignal),
        "each acquireLock request must respect remaining budget"
      );
      assert.ok(elapsed < 380, `acquireLock exceeded 300ms budget (${elapsed}ms)`);

      const boundedCalls = [];
      _setWpClientForTesting({
        post: async (_url, _body, config) => {
          boundedCalls.push(config);
          await new Promise((resolve) => setTimeout(resolve, 230));
          return { data: { acquired: false } };
        },
      });
      const boundedStart = Date.now();
      await acquireLock("ord_budget_short", "worker_1", 300);
      const boundedElapsed = Date.now() - boundedStart;
      assert.equal(boundedCalls.length, 1, "acquireLock must not launch an oversized retry when <100ms remains");
      assert.ok(boundedElapsed < 320, `acquireLock short remainder sleep overrun (${boundedElapsed}ms)`);
    } finally {
      wooClient.get = originalApiGet;
      _setStoreUpstreamAxiosForTesting(null);
      _setWpClientForTesting(null);
      serverCache.clear();
    }
  });

  await t.test("9. Cart enrichment bounds concurrency and invalidates immediately after stock mutations", async () => {
    const originalApiGet = wooClient.get;
    const originalStoreGuard = storeHoursService.checkCheckoutStoreGuard;
    let inFlight = 0;
    let maxInFlight = 0;
    let product105Qty = 5;

    const makeMockRes = () => {
      const closeHandlers = new Set();
      return {
        statusCode: 200,
        headers: {},
        body: null,
        destroyed: false,
        writableEnded: false,
        setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
        on(event, fn) {
          if (event === "close") closeHandlers.add(fn);
        },
        removeListener(event, fn) {
          if (event === "close") closeHandlers.delete(fn);
        },
        emitClose() {
          this.destroyed = true;
          for (const fn of [...closeHandlers]) fn();
        },
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; this.writableEnded = true; return this; },
      };
    };

    serverCache.clear();
    const customerCookie = "wordpress_logged_in_test=cust99|9999999999|tok|sig";
    _setSessionCacheForTesting(customerCookie, {
      userId: 99,
      roles: ["customer"],
      email: "shopper99@example.com",
      isPhoneVerified: true,
      isSuspended: false,
      expiresAt: Date.now() + 3600 * 1000,
      timestamp: Date.now(),
    });
    storeHoursService.checkCheckoutStoreGuard = async () => ({ allowed: true });

    const mockUpstream = async (config) => {
      if (config.method === "POST") {
        // Real WooCommerce Store API POST /checkout omits cart items/line_items
        return {
          status: 200,
          headers: {},
          data: {
            order_id: 9001,
            status: "pending",
            payment_method: "razorpay",
            payment_result: { payment_status: "success" },
          },
        };
      }
      if (config.params?.mode === "many") {
        return {
          status: 200,
          headers: {},
          data: { items: Array.from({ length: 8 }, (_, idx) => ({ id: 200 + idx, quantity: 1 })) },
        };
      }
      return { status: 200, headers: {}, data: { items: [{ id: 105, quantity: 1 }] } };
    };
    mockUpstream.get = async (url) => {
      if (String(url).includes("/wc/store/v1/cart")) {
        return {
          data: {
            items: [{ id: 105, product_id: 105, totals: { line_subtotal: "50000" } }],
            totals: { total_items: "50000" },
          },
        };
      }
      return { data: { version: 1 } };
    };
    _setStoreUpstreamAxiosForTesting(mockUpstream);

    let onProductCall = null;
    let productDelayMs = 15;
    wooClient.get = async (endpoint) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      onProductCall?.(endpoint);
      try {
        await new Promise((resolve) => setTimeout(resolve, productDelayMs));
        if (endpoint === "products/105") {
          return {
            data: {
              id: 105,
              manage_stock: true,
              stock_quantity: product105Qty,
              stock_status: product105Qty > 0 ? "instock" : "outofstock",
              backorders_allowed: false,
            },
          };
        }
        return { data: { id: 200, manage_stock: true, stock_quantity: 3, stock_status: "instock" } };
      } finally {
        inFlight -= 1;
      }
    };

    try {
      const warmRes = makeMockRes();
      await proxyStoreApi({ method: "GET", path: "/cart", headers: {}, cookies: {}, query: {} }, warmRes);
      assert.equal(warmRes.body.items[0].isOutOfStock, false);

      // Simulate stock depletion on WooCommerce + checkout cache invalidation
      product105Qty = 0;
      const checkoutRes = makeMockRes();
      await proxyStoreApi({
        method: "POST",
        path: "/checkout",
        headers: { "content-type": "application/json" },
        cookies: { mumbai_customer_auth: customerCookie },
        body: {
          payment_method: "razorpay",
          shipping_address: {
            first_name: "Test",
            last_name: "Shopper",
            phone: "9876543210",
            address_1: "101 Station Road",
            city: "Vasai West",
            state: "MH",
            postcode: "401202",
            country: "IN",
          },
        },
        query: {},
      }, checkoutRes);
      assert.equal(checkoutRes.statusCode, 200);

      const postCheckoutCart = makeMockRes();
      await proxyStoreApi({ method: "GET", path: "/cart", headers: {}, cookies: {}, query: {} }, postCheckoutCart);
      assert.equal(postCheckoutCart.body.items[0].isOutOfStock, true, "GET /cart must see fresh stock immediately after checkout invalidation");

      const manyRes = makeMockRes();
      await proxyStoreApi({ method: "GET", path: "/cart", headers: {}, cookies: {}, query: { mode: "many" } }, manyRes);
      assert.equal(maxInFlight, 5, `cart enrichment concurrency must saturate at cap 5 (saw ${maxInFlight})`);

      // Client disconnect during enrichment must stop queueing items 6-8 without aborting shared fetches
      serverCache.clear();
      const disconnectRes = makeMockRes();
      let disconnectCalls = 0;
      onProductCall = () => {
        disconnectCalls += 1;
        if (disconnectCalls === 1) disconnectRes.emitClose();
      };
      await proxyStoreApi({ method: "GET", path: "/cart", headers: {}, cookies: {}, query: { mode: "many" } }, disconnectRes);
      assert.ok(disconnectCalls <= 5, `disconnected cart must stop scheduling remaining batches (saw ${disconnectCalls})`);

      // Expired overall enrichment deadline must stop queueing remaining items
      serverCache.clear();
      _setCartEnrichmentBudgetForTesting(20);
      productDelayMs = 40;
      let budgetCalls = 0;
      onProductCall = () => { budgetCalls += 1; };
      const budgetRes = makeMockRes();
      await proxyStoreApi({ method: "GET", path: "/cart", headers: {}, cookies: {}, query: { mode: "many" } }, budgetRes);
      assert.equal(budgetCalls, 5, `expired enrichment budget must stop after first 5-worker batch (saw ${budgetCalls})`);
    } finally {
      _setCartEnrichmentBudgetForTesting(null);
      wooClient.get = originalApiGet;
      storeHoursService.checkCheckoutStoreGuard = originalStoreGuard;
      _setStoreUpstreamAxiosForTesting(null);
      serverCache.clear();
    }

    for (const file of [
      "../src/controllers/adminProductController.js",
      "../src/services/paymentFinalizeService.js",
      "../src/controllers/paymentReconciliationHandler.js",
    ]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.ok(src.includes("stock:enrichment:product:"), `${file} must invalidate stock:enrichment:product:`);
    }
  });

  await t.test("10. Razorpay stock reserve and release immediately invalidate Cart availability cache", async () => {
    const originalApiGet = wooClient.get;
    const originalWpGet = wpClient.get;
    const originalAxiosPost = axios.post;
    const originalStoreGuard = storeHoursService.checkCheckoutStoreGuard;
    const originalKeyId = process.env.RAZORPAY_KEY_ID;
    const originalKeySecret = process.env.RAZORPAY_KEY_SECRET;

    process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_mock123";
    process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "mock_secret_key_456";

    const makeMockRes = () => ({
      statusCode: 200,
      headers: {},
      body: null,
      writableEnded: false,
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
      on() {},
      removeListener() {},
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; this.writableEnded = true; return this; },
    });

    serverCache.clear();
    let product106Qty = 1;
    const intents = new Map();
    const activeReservations = new Map();

    storeHoursService.checkCheckoutStoreGuard = async () => ({ allowed: true, status: "open" });
    wpClient.get = async (url) => {
      if (String(url).includes("/internal/customer-suspension/")) {
        return { data: { is_suspended: false } };
      }
      throw new Error(`Unexpected wpClient.get: ${url}`);
    };
    axios.post = async (url) => {
      if (String(url).includes("/wc/store/v1/cart/update-customer")) {
        return {
          data: {
            items: [{ id: 106, quantity: 1, name: "Banarasi Dupatta", totals: { line_total: "59900" } }],
            totals: { total_price: "59900", total_items: "59900" },
            coupons: [],
            shipping_rates: [],
          },
        };
      }
      throw new Error(`Unexpected axios.post: ${url}`);
    };
    _setStoreUpstreamAxiosForTesting(async () => ({
      status: 200,
      headers: {},
      data: { items: [{ id: 106, quantity: 1 }] },
    }));
    wooClient.get = async (endpoint) => {
      const productPayload = {
        id: 106,
        name: "Banarasi Dupatta",
        manage_stock: true,
        stock_quantity: product106Qty,
        stock_status: product106Qty > 0 ? "instock" : "outofstock",
        backorders_allowed: false,
      };
      if (endpoint === "products") return { data: [productPayload] };
      if (endpoint === "products/106") return { data: productPayload };
      throw new Error(`Unexpected wooClient.get: ${endpoint}`);
    };
    _setRazorpayInstanceForTesting({
      orders: {
        create: async () => ({ id: "rzp_hold_106", amount: 59900, currency: "INR", status: "created" }),
        fetch: async (id) => ({ id, status: "created", amount_paid: 0 }),
        fetchPayments: async () => ({ items: [] }),
      },
    });
    _setWpClientForTesting({
      post: async (url, body) => {
        if (url.endsWith("/payment-intent/lock")) return { data: { success: true, acquired: true } };
        if (url.endsWith("/payment-intent/unlock")) return { data: { success: true, released: true } };
        if (url.endsWith("/payment-intent/get")) {
          if (body?.rzp_order_id) {
            return { data: { success: true, intent: intents.get(body.rzp_order_id) || null } };
          }
          return { data: { success: true, active_order_id: null } };
        }
        if (url.endsWith("/payment-intent/store")) {
          intents.set(body.rzp_order_id, { ...body.payload, rzp_order_id: body.rzp_order_id });
          return { data: { success: true } };
        }
        if (url.endsWith("/payment-intent/update-status")) {
          const intent = intents.get(body.rzp_order_id);
          if (intent && (!body.from_status || intent.status === body.from_status)) {
            intent.status = body.to_status;
            return { data: { success: true, updated: true } };
          }
          return { data: { success: false, updated: false } };
        }
        if (url.endsWith("/stock/reserve")) {
          activeReservations.set(body.reservation_id, body.line_items);
          product106Qty = 0;
          return { data: { success: true, reservation_id: body.reservation_id } };
        }
        if (url.endsWith("/stock/release")) {
          if (activeReservations.has(body.reservation_id)) {
            activeReservations.delete(body.reservation_id);
            product106Qty = 1;
          }
          return { data: { success: true } };
        }
        throw new Error(`Unexpected payment wpClient.post: ${url}`);
      },
    });

    try {
      // 1. Warm Cart enrichment cache while last unit is available
      const warmCartRes = makeMockRes();
      await proxyStoreApi({ method: "GET", path: "/cart", headers: {}, cookies: {}, query: {} }, warmCartRes);
      assert.equal(warmCartRes.body.items[0].isOutOfStock, false);

      // 2. Start Razorpay checkout (creates stock hold -> immediately invalidates warm Cart cache)
      const address = {
        first_name: "Test",
        last_name: "Shopper",
        phone: "9876543210",
        address_1: "101 Station Road",
        city: "Vasai West",
        state: "MH",
        postcode: "401202",
        country: "IN",
      };
      const createRes = makeMockRes();
      await createOrder({
        wpUserId: 1060,
        wpUserEmail: "shopper106@example.com",
        wpAuthCookie: "wordpress_logged_in_test=cust106",
        headers: {},
        body: { billing_address: address, shipping_address: address },
      }, createRes);
      assert.equal(createRes.statusCode, 200);
      assert.equal(createRes.body.razorpay_order_id, "rzp_hold_106");

      const heldCartRes = makeMockRes();
      await proxyStoreApi({ method: "GET", path: "/cart", headers: {}, cookies: {}, query: {} }, heldCartRes);
      assert.equal(heldCartRes.body.items[0].isOutOfStock, true, "Cart must immediately reflect held out-of-stock unit after Razorpay reserve");

      // 3. Dismiss/cancel checkout (releases hold -> immediately invalidates out-of-stock cache)
      const cancelRes = makeMockRes();
      await cancelPaymentOrder({
        user: { id: 1060 },
        body: { razorpay_order_id: "rzp_hold_106" },
      }, cancelRes);
      assert.equal(cancelRes.statusCode, 200);
      assert.equal(cancelRes.body.stock_released, true);

      const releasedCartRes = makeMockRes();
      await proxyStoreApi({ method: "GET", path: "/cart", headers: {}, cookies: {}, query: {} }, releasedCartRes);
      assert.equal(releasedCartRes.body.items[0].isOutOfStock, false, "Cart must immediately show unit available again after cancel release");
    } finally {
      wooClient.get = originalApiGet;
      wpClient.get = originalWpGet;
      axios.post = originalAxiosPost;
      storeHoursService.checkCheckoutStoreGuard = originalStoreGuard;
      _setRazorpayInstanceForTesting(null);
      _setStoreUpstreamAxiosForTesting(null);
      _setWpClientForTesting(null);
      serverCache.clear();
      if (originalKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = originalKeyId;
      if (originalKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
      else process.env.RAZORPAY_KEY_SECRET = originalKeySecret;
    }
  });
});
