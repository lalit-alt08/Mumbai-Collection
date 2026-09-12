import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  LOCATION_OPTIONS,
  getOrderLocationInfo,
  getLocationBadgeClass,
} from "../src/utils/orderLocation.js";
import { getOrderDateIST } from "../src/utils/orderDate.js";

describe("Employee Panel Orders: Delivery Location Filter Suite", () => {
  describe("1. Location Options & Badge Helpers", () => {
    test("All 5 delivery filter options (4 zones + Unassigned + All) are defined", () => {
      const ids = LOCATION_OPTIONS.map((l) => l.id);
      assert.deepEqual(ids, [
        "all",
        "vasai-east",
        "vasai-west",
        "nalasopara-east",
        "nalasopara-west",
        "unassigned",
      ]);
    });

    test("Badge classes return distinct, styling classes for each location", () => {
      assert.match(getLocationBadgeClass("vasai-east"), /blue/);
      assert.match(getLocationBadgeClass("vasai-west"), /indigo/);
      assert.match(getLocationBadgeClass("nalasopara-east"), /purple/);
      assert.match(getLocationBadgeClass("nalasopara-west"), /teal/);
      assert.match(getLocationBadgeClass("unassigned"), /amber/);
    });
  });

  describe("2. Deterministic Location Classification", () => {
    test("Pre-computed server delivery_location and key are prioritized", () => {
      const order = {
        delivery_location: "Vasai East",
        delivery_location_key: "vasai-east",
      };
      const info = getOrderLocationInfo(order);
      assert.equal(info.location, "Vasai East");
      assert.equal(info.location_key, "vasai-east");
    });

    test("Direct city matching for all 4 delivery regions", () => {
      // Vasai East
      assert.equal(getOrderLocationInfo({ shipping: { city: "Vasai East" } }).location_key, "vasai-east");
      assert.equal(getOrderLocationInfo({ billing: { city: "vasai (east)" } }).location_key, "vasai-east");

      // Vasai West
      assert.equal(getOrderLocationInfo({ shipping: { city: "Vasai West" } }).location_key, "vasai-west");
      assert.equal(getOrderLocationInfo({ billing: { city: "vasai-west" } }).location_key, "vasai-west");

      // Nalasopara East (handles Nallasopara & Nalasopara)
      assert.equal(getOrderLocationInfo({ shipping: { city: "Nallasopara East" } }).location_key, "nalasopara-east");
      assert.equal(getOrderLocationInfo({ billing: { city: "Nalasopara East" } }).location_key, "nalasopara-east");

      // Nalasopara West (handles Nallasopara & Nalasopara)
      assert.equal(getOrderLocationInfo({ shipping: { city: "Nallasopara West" } }).location_key, "nalasopara-west");
      assert.equal(getOrderLocationInfo({ billing: { city: "Nalasopara West" } }).location_key, "nalasopara-west");
    });

    test("Postcode fallback when city is missing or generic (e.g. 'Mumbai')", () => {
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401201" } }).location_key, "vasai-west");
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401208" } }).location_key, "vasai-east");
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401202" } }).location_key, "vasai-east");
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401203" } }).location_key, "nalasopara-west");
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401209" } }).location_key, "nalasopara-east");
    });

    test("Address keyword fallback", () => {
      assert.equal(
        getOrderLocationInfo({ shipping: { address_1: "Flat 204, Evershine City" } }).location_key,
        "vasai-east"
      );
      assert.equal(
        getOrderLocationInfo({ shipping: { address_1: "Near Babola Naka, Vasai" } }).location_key,
        "vasai-west"
      );
      assert.equal(
        getOrderLocationInfo({ shipping: { address_1: "Achole Road" } }).location_key,
        "nalasopara-east"
      );
      assert.equal(
        getOrderLocationInfo({ shipping: { address_1: "Near Patankar Park" } }).location_key,
        "nalasopara-west"
      );
    });

    test("Safe fallback to Unassigned for ambiguous addresses", () => {
      assert.equal(
        getOrderLocationInfo({ shipping: { city: "mahavir nagar", postcode: "402345" } }).location_key,
        "unassigned"
      );
      assert.equal(getOrderLocationInfo({}).location_key, "unassigned");
      assert.equal(getOrderLocationInfo(null).location_key, "unassigned");
    });
  });

  describe("3. Multi-Filter Pipeline (Status + Date + Location)", () => {
    const nowIso = new Date().toISOString();
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    const mockOrders = [
      {
        id: 101,
        status: "processing",
        date_created: nowIso,
        shipping: { city: "Vasai East" },
      },
      {
        id: 102,
        status: "processing",
        date_created: nowIso,
        shipping: { city: "Vasai West" },
      },
      {
        id: 103,
        status: "packed",
        date_created: nowIso,
        shipping: { city: "Nallasopara East" },
      },
      {
        id: 104,
        status: "completed",
        date_created: yesterdayIso,
        shipping: { city: "Nallasopara West" },
      },
      {
        id: 105,
        status: "processing",
        date_created: nowIso,
        shipping: { city: "Unknown Nagar" },
      },
    ];

    const todayDateString = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

    const runPipeline = (ordersList, activeTab, dateFilter, locationFilter) => {
      return ordersList.filter((order) => {
        if (activeTab === "active" && (order.status === "completed" || order.status === "cancelled")) {
          return false;
        }
        if (activeTab !== "all" && activeTab !== "active" && order.status !== activeTab) {
          return false;
        }
        if (locationFilter !== "all") {
          const loc = getOrderLocationInfo(order);
          if (loc.location_key !== locationFilter) {
            return false;
          }
        }
        if (dateFilter === "all") return true;

        const orderDate = getOrderDateIST(order);
        if (!orderDate) return true;
        if (dateFilter === "today") return orderDate === todayDateString;
        return true;
      });
    };

    test("Filtering by Vasai East isolates only Vasai East orders", () => {
      const results = runPipeline(mockOrders, "all", "all", "vasai-east");
      assert.deepEqual(results.map((o) => o.id), [101]);
    });

    test("Filtering by Vasai West isolates only Vasai West orders", () => {
      const results = runPipeline(mockOrders, "all", "all", "vasai-west");
      assert.deepEqual(results.map((o) => o.id), [102]);
    });

    test("Filtering by Nalasopara East isolates only Nalasopara East orders", () => {
      const results = runPipeline(mockOrders, "all", "all", "nalasopara-east");
      assert.deepEqual(results.map((o) => o.id), [103]);
    });

    test("Filtering by Nalasopara West isolates only Nalasopara West orders", () => {
      const results = runPipeline(mockOrders, "all", "all", "nalasopara-west");
      assert.deepEqual(results.map((o) => o.id), [104]);
    });

    test("Filtering by Unassigned isolates orders with non-standard addresses", () => {
      const results = runPipeline(mockOrders, "all", "all", "unassigned");
      assert.deepEqual(results.map((o) => o.id), [105]);
    });

    test("Combined: active status + today date + Vasai East location", () => {
      const results = runPipeline(mockOrders, "active", "today", "vasai-east");
      assert.deepEqual(results.map((o) => o.id), [101]);
    });

    test("Combined: packed status + Nalasopara East location", () => {
      const results = runPipeline(mockOrders, "packed", "all", "nalasopara-east");
      assert.deepEqual(results.map((o) => o.id), [103]);
    });

    test("All locations filter retains all matching status/date orders", () => {
      const results = runPipeline(mockOrders, "all", "all", "all");
      assert.equal(results.length, 5);
    });
  });
});
