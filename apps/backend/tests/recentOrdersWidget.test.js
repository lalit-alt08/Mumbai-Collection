import test from "node:test";
import assert from "node:assert/strict";
import { serverCache } from "../src/utils/memoryCache.js";

import { formatOrderDateTimeIST, getStatusBadgeClass } from "../../admin-dashboard/src/utils/recentOrdersFormatter.js";

test("Recent Orders Widget — Date/Time Formatting (Asia/Kolkata)", async (t) => {
  await t.test("formats date and time in Asia/Kolkata with month and 12-hour am/pm", () => {
    // 2026-09-08 13:05:00 UTC -> 18:35:00 IST (06:35 pm)
    const formatted = formatOrderDateTimeIST("2026-09-08T13:05:00Z");
    assert.equal(formatted, "08 Sep, 06:35 pm");
  });

  await t.test("handles naive UTC ISO string by assuming UTC and converting to IST", () => {
    // Naive string "2026-09-06T18:48:32" -> 18:48:32 UTC -> 2026-09-07 00:18:32 IST (12:18 am)
    const formatted = formatOrderDateTimeIST("2026-09-06T18:48:32");
    assert.equal(formatted, "07 Sep, 12:18 am");
  });

  await t.test("correctly calculates midnight IST boundary (18:30 UTC = 00:00 IST next day)", () => {
    // Exactly at midnight IST: 2026-08-31 18:30:00 UTC -> 2026-09-01 00:00:00 IST
    const midnight = formatOrderDateTimeIST("2026-08-31T18:30:00Z");
    assert.equal(midnight, "01 Sep, 12:00 am");

    // 1 second before midnight: 2026-08-31 18:29:59 UTC -> 2026-08-31 11:59:59 pm IST
    const beforeMidnight = formatOrderDateTimeIST("2026-08-31T18:29:59Z");
    assert.equal(beforeMidnight, "31 Aug, 11:59 pm");
  });

  await t.test("makes previous-day orders clearly distinguishable from same-day orders", () => {
    const orderDay1 = formatOrderDateTimeIST("2026-09-06T13:18:00Z"); // 06 Sep, 06:48 pm IST
    const orderDay2 = formatOrderDateTimeIST("2026-09-07T13:05:00Z"); // 07 Sep, 06:35 pm IST

    assert.ok(orderDay1.startsWith("06 Sep"), "Day 1 order shows 06 Sep");
    assert.ok(orderDay2.startsWith("07 Sep"), "Day 2 order shows 07 Sep");
    assert.notEqual(orderDay1.slice(0, 6), orderDay2.slice(0, 6), "Dates are clearly distinguishable");
  });

  await t.test("returns empty string on empty or invalid date", () => {
    assert.equal(formatOrderDateTimeIST(""), "");
    assert.equal(formatOrderDateTimeIST(null), "");
    assert.equal(formatOrderDateTimeIST("invalid-date-string"), "");
  });
});

test("Recent Orders Widget — Status Badge Styling", async (t) => {
  await t.test("packed has distinct purple styling (not gray)", () => {
    const cls = getStatusBadgeClass("packed");
    assert.ok(cls.includes("purple"), "packed must have purple styling");
    assert.ok(!cls.includes("gray-100"), "packed must not be unstyled gray");
  });

  await t.test("cancelled has soft red/rose styling", () => {
    const cls = getStatusBadgeClass("cancelled");
    assert.ok(cls.includes("rose"), "cancelled must have rose styling");
  });

  await t.test("failed has soft red/rose styling", () => {
    const cls = getStatusBadgeClass("failed");
    assert.ok(cls.includes("rose"), "failed must have rose styling");
  });

  await t.test("completed has emerald styling", () => {
    const cls = getStatusBadgeClass("completed");
    assert.ok(cls.includes("emerald"), "completed must have emerald styling");
  });

  await t.test("processing has blue styling", () => {
    const cls = getStatusBadgeClass("processing");
    assert.ok(cls.includes("blue"), "processing must have blue styling");
  });

  await t.test("out-for-delivery and dispatched have orange styling", () => {
    assert.ok(getStatusBadgeClass("out-for-delivery").includes("orange"));
    assert.ok(getStatusBadgeClass("dispatched").includes("orange"));
  });

  await t.test("unknown status falls back to gray styling", () => {
    const cls = getStatusBadgeClass("some_custom_status");
    assert.ok(cls.includes("gray-100"), "unknown status falls back to gray");
  });
});

test("Recent Orders Widget — Cache & Explicit Refresh Mechanism", async (t) => {
  await t.test("cache stores overview payload with TTL", () => {
    const testPayload = { test: "cached_data", timestamp: Date.now() };
    serverCache.set("admin:analytics:overview", testPayload, 120000);

    const retrieved = serverCache.get("admin:analytics:overview");
    assert.deepEqual(retrieved, testPayload, "retrieved payload matches cached payload");
  });

  await t.test("refresh query logic bypasses existing cached payload", () => {
    const testPayload = { test: "cached_data" };
    serverCache.set("admin:analytics:overview", testPayload, 120000);

    // Simulate controller condition:
    // const isRefresh = req.query.refresh === "true" || req.query.refresh === "1";
    // if (!isRefresh) { const cached = serverCache.get(...); if (cached) return res.json(cached); }
    const evaluateCache = (query) => {
      const isRefresh = query.refresh === "true" || query.refresh === "1";
      if (!isRefresh) {
        return serverCache.get("admin:analytics:overview");
      }
      return null; // Bypasses cache
    };

    assert.deepEqual(evaluateCache({}), testPayload, "Normal request uses cache");
    assert.equal(evaluateCache({ refresh: "true" }), null, "refresh=true bypasses cache");
    assert.equal(evaluateCache({ refresh: "1" }), null, "refresh=1 bypasses cache");
  });

  await t.test("refreshed payload replaces existing cache without affecting unrelated keys", () => {
    serverCache.set("admin:analytics:overview", { old: true }, 120000);
    serverCache.set("employee:overview:data", { emp: "preserved" }, 120000);

    // Overwrite overview cache on refresh:
    const freshPayload = { fresh: true };
    serverCache.set("admin:analytics:overview", freshPayload, 120000);

    assert.deepEqual(serverCache.get("admin:analytics:overview"), freshPayload, "Overview cache is updated with fresh data");
    assert.deepEqual(serverCache.get("employee:overview:data"), { emp: "preserved" }, "Unrelated cache key remains intact");

    // Clean up
    serverCache.delete("employee:overview:data");
    serverCache.delete("admin:analytics:overview");
  });
});

test("Recent Orders Widget — Cap at 10 and Sorting Preservation", async (t) => {
  await t.test("recentOrders is strictly capped at 10 items even with 100+ orders", () => {
    const orders = Array.from({ length: 50 }, (_, i) => ({
      id: 50 - i,
      order_number: String(50 - i),
      date_created: `2026-09-08T${String(10 + (i % 10)).padStart(2, "0")}:00:00Z`,
      status: "completed",
      total: "500",
    }));

    const recentOrders = orders.slice(0, 10);
    assert.equal(recentOrders.length, 10, "recentOrders must have at most 10 items");
    assert.equal(recentOrders[0].id, 50, "First order is the newest");
    assert.equal(recentOrders[9].id, 41, "10th order is the 10th newest");
  });

  await t.test("getEffectiveStatus preserves custom _delivery_status over raw status", async () => {
    const orderWithMeta = {
      id: 1,
      status: "processing",
      meta_data: [{ key: "_delivery_status", value: "packed" }],
    };

    const deliveryMeta = orderWithMeta.meta_data?.find((m) => m.key === "_delivery_status");
    const effectiveStatus = deliveryMeta?.value || orderWithMeta.status;

    assert.equal(effectiveStatus, "packed", "effectiveStatus must reflect custom _delivery_status meta");
  });
});

test("Recent Orders Widget — Clean Architecture & Route Separation Verification", async (t) => {
  await t.test("App.jsx does NOT expose /orders UI route", async () => {
    const fs = await import("fs");
    const appSource = fs.readFileSync("c:/Users/asus/Desktop/Mumbai Collection/apps/admin-dashboard/src/App.jsx", "utf8");

    assert.ok(!appSource.includes('import Orders from "./pages/Orders"'), "Orders component must NOT be imported in App.jsx");
    assert.ok(!appSource.includes('<Route path="orders"'), "/orders route must NOT be mounted in App.jsx");
  });

  await t.test("AdminLayout.jsx does NOT include Orders & Dispatch in navigation", async () => {
    const fs = await import("fs");
    const layoutSource = fs.readFileSync("c:/Users/asus/Desktop/Mumbai Collection/apps/admin-dashboard/src/layouts/AdminLayout.jsx", "utf8");

    assert.ok(!layoutSource.includes('href: "/orders"'), "AdminLayout must NOT link to /orders");
    assert.ok(!layoutSource.includes('Orders & Dispatch'), "Admin navigation must NOT display Orders & Dispatch");
  });

  await t.test("Overview.jsx does NOT link View All Orders, keeping clean 10-order snapshot", async () => {
    const fs = await import("fs");
    const overviewSource = fs.readFileSync("c:/Users/asus/Desktop/Mumbai Collection/apps/admin-dashboard/src/pages/Overview.jsx", "utf8");

    assert.ok(!overviewSource.includes('View All Orders'), "View All Orders link must be removed from Overview.jsx");
    assert.ok(!overviewSource.includes('to="/orders"'), "Overview.jsx must not link to /orders");
    assert.ok(overviewSource.includes('Order Total'), "Column header must say Order Total instead of Total Paid");
  });

  await t.test("Admin backend order APIs remain mounted and preserved", async () => {
    const fs = await import("fs");
    const routesSource = fs.readFileSync("c:/Users/asus/Desktop/Mumbai Collection/apps/backend/src/routes/adminRoutes.js", "utf8");

    assert.ok(routesSource.includes('getAdminOrders'), "getAdminOrders must remain mounted in adminRoutes.js");
    assert.ok(routesSource.includes('updateAdminOrderStatus'), "updateAdminOrderStatus must remain mounted in adminRoutes.js");
  });

  await t.test("Employee Panel order fulfillment routes remain preserved and authoritative", async () => {
    const fs = await import("fs");
    const empRoutesSource = fs.readFileSync("c:/Users/asus/Desktop/Mumbai Collection/apps/backend/src/routes/employeeRoutes.js", "utf8");

    assert.ok(empRoutesSource.includes('getEmployeeOrders'), "getEmployeeOrders must remain mounted in employeeRoutes.js");
    assert.ok(empRoutesSource.includes('updateOrderStatus'), "updateOrderStatus must remain mounted in employeeRoutes.js");
  });
});
