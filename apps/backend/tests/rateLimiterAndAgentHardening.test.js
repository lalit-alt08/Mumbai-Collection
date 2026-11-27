import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { httpAgent, httpsAgent } from "../src/config/httpAgent.js";
import wooClient from "../src/config/woocommerce.js";
import wpClient from "../src/services/wordpress.js";
import * as paymentCheckoutUtils from "../src/utils/paymentCheckoutUtils.js";
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
});
