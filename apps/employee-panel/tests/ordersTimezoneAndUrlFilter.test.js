import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  getOrderDateIST,
  getOrderTimestampDate,
  resolveTabFromStatusParam,
  getCleanCustomerName,
} from "../src/utils/orderDate.js";

describe("Employee Panel Orders: Timezone & URL Filter Suite", () => {
  describe("1. Timezone Date Handling in Asia/Kolkata", () => {
    test("UTC order crossing midnight into IST 'today' is resolved to current IST date", () => {
      // Order #275 created at 2026-09-06 18:48:32 UTC (12:18:32 AM IST on 2026-09-07)
      const order275 = {
        id: 275,
        status: "processing",
        date_created: "2026-09-06T18:48:32",
        date_created_gmt: "2026-09-06T18:48:32",
      };

      const istDate = getOrderDateIST(order275);
      assert.equal(istDate, "2026-09-07", "Order #275 must resolve to 2026-09-07 in Asia/Kolkata");
    });

    test("Previous IST day order (before midnight IST) is resolved to previous IST date", () => {
      // Order #274 created at 2026-09-06 18:12:37 UTC (11:42:37 PM IST on 2026-09-06)
      const order274 = {
        id: 274,
        status: "processing",
        date_created: "2026-09-06T18:12:37",
        date_created_gmt: "2026-09-06T18:12:37",
      };

      const istDate = getOrderDateIST(order274);
      assert.equal(istDate, "2026-09-06", "Order #274 must resolve to 2026-09-06 in Asia/Kolkata");
    });

    test("Date object correctly formats in Asia/Kolkata timezone", () => {
      const order275 = {
        id: 275,
        date_created: "2026-09-06T18:48:32",
      };

      const dateObj = getOrderTimestampDate(order275);
      assert.ok(dateObj instanceof Date && !isNaN(dateObj.getTime()));

      const timeString = dateObj.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      // In IST, 18:48:32 UTC is 12:18 am / 12:18 AM
      assert.match(timeString, /12:18/i);
    });

    test("Handles missing or malformed dates gracefully", () => {
      assert.equal(getOrderDateIST(null), null);
      assert.equal(getOrderDateIST({}), null);
      assert.equal(getOrderDateIST({ date_created: "invalid-date" }), null);
      assert.equal(getOrderTimestampDate(null), null);
      assert.equal(getOrderTimestampDate({}), null);
    });
  });

  describe("2. URL Status Filter Mapping", () => {
    test("status=processing maps to 'active' (To Pack & Deliver)", () => {
      assert.equal(resolveTabFromStatusParam("processing"), "active");
    });

    test("status=active maps to 'active'", () => {
      assert.equal(resolveTabFromStatusParam("active"), "active");
    });

    test("Explicit standard tabs map directly", () => {
      assert.equal(resolveTabFromStatusParam("packed"), "packed");
      assert.equal(resolveTabFromStatusParam("out-for-delivery"), "out-for-delivery");
      assert.equal(resolveTabFromStatusParam("completed"), "completed");
      assert.equal(resolveTabFromStatusParam("cancelled"), "cancelled");
      assert.equal(resolveTabFromStatusParam("all"), "all");
    });

    test("Missing or invalid status parameter defaults safely to 'active'", () => {
      assert.equal(resolveTabFromStatusParam(null), "active");
      assert.equal(resolveTabFromStatusParam(""), "active");
      assert.equal(resolveTabFromStatusParam("undefined"), "active");
      assert.equal(resolveTabFromStatusParam("invalid-tab"), "active");
    });
  });

  describe("3. Orders Filter Pipeline Simulation", () => {
    const mockOrders = [
      {
        id: 275,
        status: "processing",
        date_created: "2026-09-06T18:48:32", // 2026-09-07 00:18:32 IST
      },
      {
        id: 274,
        status: "processing",
        date_created: "2026-09-06T18:12:37", // 2026-09-06 23:42:37 IST
      },
      {
        id: 273,
        status: "completed",
        date_created: "2026-09-06T15:17:34", // 2026-09-06 20:47:34 IST
      },
      {
        id: 267,
        status: "completed",
        date_created: "2026-09-03T06:32:27", // 2026-09-03 12:02:27 IST
      },
    ];

    const todayDateString = "2026-09-07";
    const yesterdayDateString = "2026-09-06";
    const sevenDaysAgoDateString = "2026-08-31";

    const runFilter = (orders, activeTab, dateFilter) => {
      return orders
        .filter((order) => {
          if (activeTab === "active") {
            return order.status !== "completed" && order.status !== "cancelled";
          }
          if (activeTab && activeTab !== "all") {
            return order.status === activeTab;
          }
          return true;
        })
        .filter((order) => {
          if (dateFilter === "all") return true;

          const orderDate = getOrderDateIST(order);
          if (!orderDate) return true;

          if (dateFilter === "today") {
            return orderDate === todayDateString;
          }
          if (dateFilter === "yesterday") {
            return orderDate === yesterdayDateString;
          }
          if (dateFilter === "7days") {
            return orderDate >= sevenDaysAgoDateString && orderDate <= todayDateString;
          }
          return true;
        });
    };

    test("Today filter includes Order #275 (created after midnight IST) and excludes Order #274", () => {
      const results = runFilter(mockOrders, "active", "today");
      const ids = results.map((o) => o.id);
      assert.deepEqual(ids, [275], "Only Order #275 should be present under Today (active)");
    });

    test("Yesterday filter includes Order #274 (created before midnight IST) and excludes Order #275", () => {
      const results = runFilter(mockOrders, "active", "yesterday");
      const ids = results.map((o) => o.id);
      assert.deepEqual(ids, [274], "Only Order #274 should be present under Yesterday (active)");
    });

    test("Last 7 Days filter includes all active orders from the past week", () => {
      const results = runFilter(mockOrders, "active", "7days");
      const ids = results.map((o) => o.id);
      assert.deepEqual(ids, [275, 274], "Both active orders should appear under Last 7 Days");
    });

    test("Completed tab with Yesterday filter includes Order #273", () => {
      const results = runFilter(mockOrders, "completed", "yesterday");
      const ids = results.map((o) => o.id);
      assert.deepEqual(ids, [273], "Completed Order #273 should be present under Yesterday");
    });
  });

  describe("4. Customer Name Deduplication (getCleanCustomerName)", () => {
    test("Deduplicates identical first and last names (e.g., lalit lalit -> lalit)", () => {
      assert.equal(getCleanCustomerName("", "lalit", "lalit"), "lalit");
      assert.equal(getCleanCustomerName("", "Lalit", "lalit"), "Lalit");
      assert.equal(getCleanCustomerName("lalit lalit", "", ""), "lalit");
      assert.equal(getCleanCustomerName("Lalit Lalit", "", ""), "Lalit");
    });

    test("Preserves distinct first and last names", () => {
      assert.equal(getCleanCustomerName("", "Rahul", "Sharma"), "Rahul Sharma");
      assert.equal(getCleanCustomerName("", "Lalit", "Sirvi"), "Lalit Sirvi");
      assert.equal(getCleanCustomerName("Lalit Sirvi", "", ""), "Lalit Sirvi");
    });

    test("Handles single names and fallback", () => {
      assert.equal(getCleanCustomerName("", "Lalit", ""), "Lalit");
      assert.equal(getCleanCustomerName("", "", "Sirvi"), "Sirvi");
      assert.equal(getCleanCustomerName("", "", "", "Guest Customer"), "Guest Customer");
    });
  });
});
