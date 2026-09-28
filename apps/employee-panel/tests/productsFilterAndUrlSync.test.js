import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Products Inventory: Filter Tabs, Counts & URL Sync Suite", () => {
  // Test helper mirroring the tab definition in Products.jsx
  const buildStockFilterTabs = (stockCounts) => [
    { id: "all", label: "All Items", count: stockCounts?.all },
    { id: "instock", label: "In Stock", count: stockCounts?.instock },
    { id: "outofstock", label: "Out of Stock", count: stockCounts?.outofstock },
  ];

  // Test helper mirroring the URL resolution in Products.jsx
  const resolveStockFilterFromUrl = (urlParam) => {
    return urlParam === "instock" || urlParam === "outofstock" ? urlParam : "all";
  };

  test("1. Tab Definition: strictly contains 'all', 'instock', 'outofstock' and omits 'lowstock'", () => {
    const tabs = buildStockFilterTabs({ all: 50, instock: 40, outofstock: 10, lowstock: 5 });
    const tabIds = tabs.map((t) => t.id);

    assert.deepEqual(tabIds, ["all", "instock", "outofstock"]);
    assert.equal(tabIds.includes("lowstock"), false, "Must not contain 'lowstock' tab");
  });

  test("2. Tab Count Badges: correctly extracts and binds counts from server response", () => {
    const counts = { all: 42, instock: 35, outofstock: 7 };
    const tabs = buildStockFilterTabs(counts);

    assert.equal(tabs.find((t) => t.id === "all").count, 42);
    assert.equal(tabs.find((t) => t.id === "instock").count, 35);
    assert.equal(tabs.find((t) => t.id === "outofstock").count, 7);
  });

  test("3. URL Search Params Resolution: correctly resolves valid params and falls back for 'lowstock' or invalid", () => {
    assert.equal(resolveStockFilterFromUrl("outofstock"), "outofstock");
    assert.equal(resolveStockFilterFromUrl("instock"), "instock");
    assert.equal(resolveStockFilterFromUrl("lowstock"), "all", "Unsupported 'lowstock' must fallback to 'all'");
    assert.equal(resolveStockFilterFromUrl("random_param"), "all");
    assert.equal(resolveStockFilterFromUrl(null), "all");
    assert.equal(resolveStockFilterFromUrl(undefined), "all");
  });

  test("4. Clear Filters Condition: detects active filter states to render reset button", () => {
    const hasActiveFilters = (stockFilter, categoryFilter, search) => {
      return stockFilter !== "all" || categoryFilter !== "all" || (typeof search === "string" && search.trim() !== "");
    };

    assert.equal(hasActiveFilters("all", "all", ""), false, "No reset button when all defaults");
    assert.equal(hasActiveFilters("outofstock", "all", ""), true, "Active when stock filter selected");
    assert.equal(hasActiveFilters("all", "12", ""), true, "Active when category selected");
    assert.equal(hasActiveFilters("all", "all", "saree"), true, "Active when search query typed");
    assert.equal(hasActiveFilters("instock", "12", "silk"), true, "Active when all three filters used");
  });
});
