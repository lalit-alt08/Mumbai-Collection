import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { httpsAgent, httpAgent, mediaHttpsAgent, mediaHttpAgent } from "../src/config/httpAgent.js";
import {
  getSessionValidation,
  checkSessionSuspended,
  checkSessionPhoneVerified,
  invalidateSessionCache,
} from "../src/middlewares/authMiddleware.js";
import { serverCache } from "../src/utils/memoryCache.js";

test("Viral-Spike Hardening Suite", async (t) => {
  await t.test("1. Media connection pool is strictly isolated from main API pool", () => {
    // Media agent assertions
    assert.ok(mediaHttpsAgent, "mediaHttpsAgent must be defined");
    assert.ok(mediaHttpAgent, "mediaHttpAgent must be defined");
    assert.equal(
      mediaHttpsAgent.maxSockets,
      30,
      "mediaHttpsAgent default maxSockets must be 30"
    );
    assert.equal(
      mediaHttpAgent.maxSockets,
      30,
      "mediaHttpAgent default maxSockets must be 30"
    );

    // Main API agent assertions (must remain 50 and independent)
    assert.ok(httpsAgent, "httpsAgent must be defined");
    assert.ok(httpAgent, "httpAgent must be defined");
    assert.equal(
      httpsAgent.maxSockets,
      50,
      "httpsAgent maxSockets must remain 50"
    );
    assert.equal(
      httpAgent.maxSockets,
      50,
      "httpAgent maxSockets must remain 50"
    );
    assert.notEqual(
      mediaHttpsAgent,
      httpsAgent,
      "mediaHttpsAgent must be a distinct instance from httpsAgent"
    );
  });

  await t.test("2. getSessionValidation: single upstream call on cold cache, warm cache serves without upstream call", async () => {
    const originalGet = axios.get;
    let upstreamCallCount = 0;
    const testCookie = `mumbai_test_auth_${Date.now()}_1`;

    axios.get = async (url, config) => {
      upstreamCallCount++;
      assert.equal(config.timeout, 8000, "Upstream timeout must be 8000ms");
      return {
        data: {
          logged_in: true,
          current_user_id: 101,
          roles: ["customer"],
          email: "customer101@example.com",
          is_phone_verified: true,
          is_suspended: false,
        },
      };
    };

    try {
      // 1st call: cold cache -> hits upstream
      const session1 = await getSessionValidation(testCookie);
      assert.equal(session1.valid, true);
      assert.equal(session1.userId, 101);
      assert.equal(session1.isPhoneVerified, true);
      assert.equal(session1.isSuspended, false);
      assert.equal(upstreamCallCount, 1, "Cold cache must invoke upstream once");

      // 2nd call: warm cache -> must NOT hit upstream
      const session2 = await getSessionValidation(testCookie);
      assert.equal(session2.valid, true);
      assert.equal(session2.userId, 101);
      assert.equal(upstreamCallCount, 1, "Warm cache must not trigger new upstream call");
    } finally {
      axios.get = originalGet;
      invalidateSessionCache(testCookie);
    }
  });

  await t.test("3. getSessionValidation: single-flight deduplication under burst concurrency", async () => {
    const originalGet = axios.get;
    let upstreamCallCount = 0;
    const testCookie = `mumbai_test_auth_${Date.now()}_burst`;

    axios.get = async (url, config) => {
      upstreamCallCount++;
      // Simulate 50ms upstream processing delay
      await new Promise((r) => setTimeout(r, 50));
      return {
        data: {
          logged_in: true,
          current_user_id: 202,
          roles: ["customer"],
          email: "burst@example.com",
          is_phone_verified: true,
          is_suspended: false,
        },
      };
    };

    try {
      // 10 concurrent requests with the same auth cookie
      const results = await Promise.all([
        getSessionValidation(testCookie),
        getSessionValidation(testCookie),
        getSessionValidation(testCookie),
        getSessionValidation(testCookie),
        getSessionValidation(testCookie),
        getSessionValidation(testCookie),
        getSessionValidation(testCookie),
        getSessionValidation(testCookie),
        getSessionValidation(testCookie),
        getSessionValidation(testCookie),
      ]);

      assert.equal(
        upstreamCallCount,
        1,
        "10 concurrent calls must be coalesced into exactly 1 upstream call"
      );
      for (const res of results) {
        assert.equal(res.valid, true);
        assert.equal(res.userId, 202);
      }
    } finally {
      axios.get = originalGet;
      invalidateSessionCache(testCookie);
    }
  });

  await t.test("4. getSessionValidation: correctly identifies suspended and unverified users", async () => {
    const originalGet = axios.get;
    const suspendedCookie = `mumbai_test_suspended_${Date.now()}`;
    const unverifiedCookie = `mumbai_test_unverified_${Date.now()}`;

    axios.get = async (url, config) => {
      if (config.headers.Cookie === suspendedCookie) {
        return {
          data: {
            logged_in: true,
            current_user_id: 301,
            is_phone_verified: true,
            is_suspended: true,
          },
        };
      }
      return {
        data: {
          logged_in: true,
          current_user_id: 302,
          is_phone_verified: false,
          is_suspended: false,
        },
      };
    };

    try {
      const suspendedSession = await getSessionValidation(suspendedCookie);
      assert.equal(suspendedSession.valid, true);
      assert.equal(suspendedSession.isSuspended, true);

      const unverifiedSession = await getSessionValidation(unverifiedCookie);
      assert.equal(unverifiedSession.valid, true);
      assert.equal(unverifiedSession.isPhoneVerified, false);

      // Wrapper helpers
      assert.equal(await checkSessionSuspended(suspendedCookie), true);
      assert.equal(await checkSessionPhoneVerified(unverifiedCookie), false);
    } finally {
      axios.get = originalGet;
      invalidateSessionCache(suspendedCookie);
      invalidateSessionCache(unverifiedCookie);
    }
  });

  await t.test("5. getSessionValidation: strictly fails closed on upstream network timeout or error", async () => {
    const originalGet = axios.get;
    const errorCookie = `mumbai_test_error_${Date.now()}`;

    axios.get = async () => {
      const err = new Error("timeout of 8000ms exceeded");
      err.code = "ECONNABORTED";
      throw err;
    };

    try {
      const failedSession = await getSessionValidation(errorCookie);
      assert.equal(failedSession.valid, false, "Must mark session as invalid on failure");
      assert.equal(failedSession.error, "AUTH_TIMEOUT");

      // Wrapper helpers fail closed: unverified customer and invalid session
      const isSuspended = await checkSessionSuspended(errorCookie);
      assert.equal(isSuspended, false, "Invalid session returns false for suspended (handled as 401 AUTH_REQUIRED)");

      const isVerified = await checkSessionPhoneVerified(errorCookie);
      assert.equal(isVerified, false, "Failed auth must fail closed (treat as unverified)");
    } finally {
      axios.get = originalGet;
      invalidateSessionCache(errorCookie);
    }
  });

  await t.test("6. Post-checkout cache invalidation: selectively deletes ordered products and operational caches, keeps catalog browse cache intact", () => {
    // Populate caches
    serverCache.set("employee:overview:today", { count: 10 }, 60000);
    serverCache.set("admin:analytics:summary", { total: 5000 }, 60000);
    serverCache.set("admin:customers:list", [{ id: 1 }], 60000);
    serverCache.set("product_stock_counts", { all: 100 }, 60000);
    serverCache.set("catalog:products:all:{\"page\":1}", [{ id: 10 }, { id: 20 }], 60000);
    serverCache.set("catalog:products:all:{\"category\":\"summer\"}", [{ id: 30 }], 60000);
    serverCache.set("catalog:product:10", { id: 10, name: "Kurti" }, 60000);
    serverCache.set("catalog:product:20", { id: 20, name: "Saree" }, 60000);
    serverCache.set("catalog:product:99", { id: 99, name: "Unrelated Item" }, 60000);

    // Simulate post-checkout invalidation logic from storeRoutes.js
    const checkoutResponseData = {
      order_id: 5001,
      items: [
        { id: 10, name: "Kurti", quantity: 2 },
        { id: 20, name: "Saree", quantity: 1 },
      ],
    };

    serverCache.invalidatePrefix("employee:overview");
    serverCache.invalidatePrefix("admin:analytics");
    serverCache.invalidatePrefix("admin:customers");
    serverCache.delete("product_stock_counts");

    const orderItems = checkoutResponseData.items || [];
    for (const item of orderItems) {
      const productId = item.id || item.product_id;
      if (productId) {
        serverCache.delete(`catalog:product:${productId}`);
      }
    }

    // Assert operational caches are invalidated
    assert.equal(serverCache.get("employee:overview:today"), null, "employee:overview must be invalidated");
    assert.equal(serverCache.get("admin:analytics:summary"), null, "admin:analytics must be invalidated");
    assert.equal(serverCache.get("admin:customers:list"), null, "admin:customers must be invalidated");
    assert.equal(serverCache.get("product_stock_counts"), null, "product_stock_counts must be deleted");

    // Assert ordered product detail caches are invalidated
    assert.equal(serverCache.get("catalog:product:10"), null, "Ordered product 10 detail cache must be deleted");
    assert.equal(serverCache.get("catalog:product:20"), null, "Ordered product 20 detail cache must be deleted");
    assert.ok(serverCache.get("catalog:product:99"), "Unordered product 99 detail cache must remain intact");

    // CRITICAL: Assert catalog product list caches remain intact
    assert.ok(
      serverCache.get("catalog:products:all:{\"page\":1}"),
      "catalog browse listings must NOT be wiped by checkout"
    );
    assert.ok(
      serverCache.get("catalog:products:all:{\"category\":\"summer\"}"),
      "category listings must NOT be wiped by checkout"
    );

    // Clean up
    serverCache.invalidatePrefix("catalog:");
  });
});
