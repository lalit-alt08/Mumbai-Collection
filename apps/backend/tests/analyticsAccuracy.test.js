/**
 * Analytics Accuracy Test Suite
 *
 * Covers analytics cache invalidation, IST month boundaries, and the actual
 * analytics controller's manual refresh/cache behavior.
 *
 * Uses Node.js built-in test runner (node:test).
 * Stubs upstream clients; it does not call live WooCommerce or run the HTTP server.
 */

import test from "node:test";
import assert from "node:assert/strict";

test("Analytics Accuracy — Cache Invalidation API", async (t) => {

  await t.test("serverCache exposes invalidatePrefix method for cache busting", async () => {
    // Import the real serverCache to verify the invalidation API exists and works
    const { serverCache } = await import("../src/utils/memoryCache.js");

    // Seed the analytics deep cache
    serverCache.set("admin:analytics:deep", { test: true }, 60000);
    assert.ok(serverCache.get("admin:analytics:deep"), "cache should be populated");

    // Invalidate using prefix (mirrors what storeRoutes and adminOrderController do)
    serverCache.invalidatePrefix("admin:analytics");
    assert.equal(serverCache.get("admin:analytics:deep"), null,
      "invalidatePrefix('admin:analytics') must evict admin:analytics:deep"
    );
  });

  await t.test("serverCache.invalidatePrefix also clears admin:analytics:overview", async () => {
    const { serverCache } = await import("../src/utils/memoryCache.js");

    serverCache.set("admin:analytics:overview", { overview: true }, 60000);
    serverCache.set("admin:analytics:deep", { deep: true }, 60000);

    serverCache.invalidatePrefix("admin:analytics");

    assert.equal(serverCache.get("admin:analytics:overview"), null,
      "overview cache must be cleared by invalidatePrefix"
    );
    assert.equal(serverCache.get("admin:analytics:deep"), null,
      "deep cache must be cleared by invalidatePrefix"
    );
  });

  await t.test("unrelated cache keys are not evicted by analytics invalidation", async () => {
    const { serverCache } = await import("../src/utils/memoryCache.js");

    serverCache.set("employee:overview:data", { emp: true }, 60000);
    serverCache.set("admin:analytics:deep", { analytics: true }, 60000);

    serverCache.invalidatePrefix("admin:analytics");

    assert.ok(serverCache.get("employee:overview:data"),
      "employee:overview cache must NOT be evicted by admin:analytics invalidation"
    );
    // cleanup
    serverCache.delete("employee:overview:data");
  });
});

test("Analytics Accuracy — IST Month Boundary Calculation", async (t) => {
  const { getISTMonthBoundaries } = await import("../src/controllers/adminAnalyticsController.js");

  await t.test("explicitly tests the IST/UTC boundary for 2026-09-01T00:15:00+05:30", () => {
    // Reference date: middle of Sept 2026 IST
    const referenceDate = new Date("2026-09-15T12:00:00.000+05:30");
    const bounds = getISTMonthBoundaries(referenceDate);

    // Month should start at Sept 1, 00:00 IST
    // Which is 2026-08-31T18:30:00.000Z in UTC
    const expectedStartUTC = new Date("2026-08-31T18:30:00.000Z").getTime();
    // Month should end at Oct 1, 00:00 IST
    // Which is 2026-09-30T18:30:00.000Z in UTC
    const expectedEndUTC = new Date("2026-09-30T18:30:00.000Z").getTime();

    assert.equal(bounds.istMonthStartUTC, expectedStartUTC, "Month start matches IST boundary in UTC");
    assert.equal(bounds.istNextMonthStartUTC, expectedEndUTC, "Next month start matches IST boundary in UTC");

    // Order placed at 2026-09-01T00:15:00+05:30 (which is 2026-08-31T18:45:00.000Z)
    const orderTimestamp = new Date("2026-09-01T00:15:00.000+05:30").getTime();

    // Verify inclusion logic used in the controller:
    const belongsToSeptember = orderTimestamp >= bounds.istMonthStartUTC && orderTimestamp < bounds.istNextMonthStartUTC;
    assert.equal(belongsToSeptember, true, "Order placed at 00:15 IST on Sept 1 belongs to September");
  });

  await t.test("order exactly at 00:00 IST on month start belongs to current month", () => {
    const referenceDate = new Date("2026-10-10T10:00:00.000+05:30"); // October
    const bounds = getISTMonthBoundaries(referenceDate);
    
    const orderTimestamp = new Date("2026-10-01T00:00:00.000+05:30").getTime();
    const isIncluded = orderTimestamp >= bounds.istMonthStartUTC && orderTimestamp < bounds.istNextMonthStartUTC;
    assert.equal(isIncluded, true);
  });

  await t.test("order just before month start in IST belongs to previous month (excluded)", () => {
    const referenceDate = new Date("2026-10-10T10:00:00.000+05:30"); // October
    const bounds = getISTMonthBoundaries(referenceDate);
    
    // Sept 30, 23:59:59 IST
    const orderTimestamp = new Date("2026-09-30T23:59:59.000+05:30").getTime();
    const isIncluded = orderTimestamp >= bounds.istMonthStartUTC && orderTimestamp < bounds.istNextMonthStartUTC;
    assert.equal(isIncluded, false);
  });

  await t.test("order just before next month in IST belongs to current month", () => {
    const referenceDate = new Date("2026-10-10T10:00:00.000+05:30"); // October
    const bounds = getISTMonthBoundaries(referenceDate);
    
    // Oct 31, 23:59:59 IST
    const orderTimestamp = new Date("2026-10-31T23:59:59.000+05:30").getTime();
    const isIncluded = orderTimestamp >= bounds.istMonthStartUTC && orderTimestamp < bounds.istNextMonthStartUTC;
    assert.equal(isIncluded, true);
  });

  await t.test("order exactly at next month 00:00 IST belongs to next month (excluded)", () => {
    const referenceDate = new Date("2026-10-10T10:00:00.000+05:30"); // October
    const bounds = getISTMonthBoundaries(referenceDate);
    
    // Nov 1, 00:00:00 IST
    const orderTimestamp = new Date("2026-11-01T00:00:00.000+05:30").getTime();
    const isIncluded = orderTimestamp >= bounds.istMonthStartUTC && orderTimestamp < bounds.istNextMonthStartUTC;
    assert.equal(isIncluded, false);
  });

  await t.test("December to January wrap around", () => {
    const referenceDate = new Date("2026-12-15T12:00:00.000+05:30");
    const bounds = getISTMonthBoundaries(referenceDate);
    
    const expectedStartUTC = new Date("2026-11-30T18:30:00.000Z").getTime(); // Dec 1 IST
    const expectedEndUTC = new Date("2026-12-31T18:30:00.000Z").getTime();   // Jan 1 IST
    
    assert.equal(bounds.istMonthStartUTC, expectedStartUTC);
    assert.equal(bounds.istNextMonthStartUTC, expectedEndUTC);
  });
});

test("Analytics Accuracy — Manual Refresh (?refresh=true)", async (t) => {
  const { getAdminAnalytics } = await import("../src/controllers/adminAnalyticsController.js");
  const { serverCache } = await import("../src/utils/memoryCache.js");
  const { default: api } = await import("../src/config/woocommerce.js");
  const { default: wp } = await import("../src/services/wordpress.js");

  const originalGet = api.get;
  const originalWpGet = wp.get;
  wp.get = async () => { throw new Error("WP offline"); };

  const restoreApi = () => {
    api.get = originalGet;
  };

  t.afterEach(() => {
    restoreApi();
    wp.get = async () => { throw new Error("WP offline"); };
    serverCache.delete("admin:analytics:deep");
  });

  await t.test("normal GET returns cached analytics without fetching WooCommerce", async () => {
    const cachedPayload = {
      success: true,
      data: {
        revenue: { totalRevenue: 9999 },
        orders: { total: 42 },
      },
      cached: true,
    };

    serverCache.set("admin:analytics:deep", cachedPayload, 120000);

    let apiCalled = false;
    api.get = async () => {
      apiCalled = true;
      return { data: [], headers: { "x-wp-totalpages": "1" } };
    };

    let responseData = null;
    const req = { query: {} };
    const res = {
      json: (data) => {
        responseData = data;
      },
      status: () => res,
    };

    await getAdminAnalytics(req, res);

    assert.equal(apiCalled, false, "WooCommerce API must not be called on cache hit");
    assert.deepEqual(responseData, cachedPayload, "Must return cached payload directly");
  });

  await t.test("GET ?refresh=true bypasses cache, fetches fresh WooCommerce data, and updates cache", async () => {
    const stalePayload = {
      success: true,
      data: {
        revenue: { totalRevenue: 1000 },
        orders: { total: 5 },
      },
    };

    serverCache.set("admin:analytics:deep", stalePayload, 120000);

    const freshOrders = [
      {
        id: 101,
        status: "completed",
        total: "2500",
        shipping_total: "50",
        discount_total: "0",
        payment_method: "cod",
        payment_method_title: "Cash on delivery",
        billing: { first_name: "Fresh", last_name: "Buyer", email: "fresh@mumbai.com", phone: "9876543210" },
        line_items: [
          { product_id: 50, name: "Fresh Item", quantity: 2, total: "2450", image: { src: "https://img.test/50.jpg" } },
        ],
      },
    ];

    let apiCalled = false;
    api.get = async (endpoint) => {
      apiCalled = true;
      assert.equal(endpoint, "orders");
      return { data: freshOrders, headers: { "x-wp-totalpages": "1" } };
    };

    let responseData = null;
    const req = { query: { refresh: "true" } };
    const res = {
      json: (data) => {
        responseData = data;
      },
      status: () => res,
    };

    await getAdminAnalytics(req, res);

    assert.equal(apiCalled, true, "WooCommerce API MUST be called when refresh=true");
    assert.notDeepEqual(responseData, stalePayload, "Response must not be stale payload");
    assert.equal(responseData.data.revenue.totalRevenue, 2500, "Must calculate fresh revenue");
    assert.equal(responseData.data.orders.total, 1, "Must calculate fresh order count");

    // Verify cache replaced
    const newCached = serverCache.get("admin:analytics:deep");
    assert.ok(newCached, "admin:analytics:deep cache must be repopulated");
    assert.equal(newCached.data.revenue.totalRevenue, 2500, "Cached payload must be updated with fresh totalRevenue");
  });

  await t.test("GET ?refresh=1 also bypasses cache and returns fresh data", async () => {
    const stalePayload = {
      success: true,
      data: { revenue: { totalRevenue: 500 } },
    };
    serverCache.set("admin:analytics:deep", stalePayload, 120000);

    let apiCalled = false;
    api.get = async () => {
      apiCalled = true;
      return { data: [], headers: { "x-wp-totalpages": "1" } };
    };

    let responseData = null;
    const req = { query: { refresh: "1" } };
    const res = {
      json: (data) => {
        responseData = data;
      },
      status: () => res,
    };

    await getAdminAnalytics(req, res);

    assert.equal(apiCalled, true, "WooCommerce API MUST be called when refresh=1");
    assert.notDeepEqual(responseData, stalePayload);
  });

  await t.test("refresh does not invalidate unrelated caches", async () => {
    serverCache.set("employee:overview:summary", { untouched: true }, 60000);
    serverCache.set("catalog:products:list", { cat: true }, 60000);

    api.get = async () => ({ data: [], headers: { "x-wp-totalpages": "1" } });

    const req = { query: { refresh: "true" } };
    const res = { json: () => {}, status: () => res };

    await getAdminAnalytics(req, res);

    assert.deepEqual(serverCache.get("employee:overview:summary"), { untouched: true }, "employee cache remains intact");
    assert.deepEqual(serverCache.get("catalog:products:list"), { cat: true }, "catalog cache remains intact");

    serverCache.delete("employee:overview:summary");
    serverCache.delete("catalog:products:list");
  });

  await t.test("subsequent normal GET receives the refreshed cached payload without calling WooCommerce", async () => {
    const freshOrders = [
      {
        id: 202,
        status: "completed",
        total: "4000",
        billing: { first_name: "Repeat", last_name: "Tester", email: "repeat@test.com" },
        line_items: [],
      },
    ];

    let apiCallCount = 0;
    api.get = async () => {
      apiCallCount++;
      return { data: freshOrders, headers: { "x-wp-totalpages": "1" } };
    };

    // 1. Initial refresh call to populate cache
    const refreshReq = { query: { refresh: "true" } };
    let refreshResData = null;
    const refreshRes = { json: (d) => { refreshResData = d; }, status: () => refreshRes };
    await getAdminAnalytics(refreshReq, refreshRes);

    assert.equal(apiCallCount, 1, "API called once during refresh");
    assert.equal(refreshResData.data.revenue.totalRevenue, 4000);

    // 2. Subsequent normal GET call without refresh
    const normalReq = { query: {} };
    let normalResData = null;
    const normalRes = { json: (d) => { normalResData = d; }, status: () => normalRes };
    await getAdminAnalytics(normalReq, normalRes);

    assert.equal(apiCallCount, 1, "API must NOT be called on subsequent normal GET");
    assert.deepEqual(normalResData, refreshResData, "Subsequent GET must receive the refreshed cached payload");
  });
});

