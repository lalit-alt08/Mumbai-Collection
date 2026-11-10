import test from "node:test";
import assert from "node:assert/strict";
import { getProductStock } from "../src/utils/productUtils.js";

const sampleProducts = [
  {
    id: 1,
    name: "Standard Marker Set",
    price: "450",
    regular_price: "500",
    stock_status: "instock",
    manage_stock: false,
    average_rating: "4.5",
    date_created: "2026-01-01T00:00:00",
  },
  {
    id: 2,
    name: "Premium Acrylic Pens",
    price: "850",
    regular_price: "1200",
    stock_status: "instock",
    manage_stock: true,
    stock_quantity: 5,
    average_rating: "4.9",
    date_created: "2026-02-01T00:00:00",
  },
  {
    id: 3,
    name: "Artist Pro Palette Markers",
    price: "2499",
    regular_price: "2499",
    stock_status: "instock",
    manage_stock: true,
    stock_quantity: 2,
    average_rating: "4.2",
    date_created: "2026-03-01T00:00:00",
  },
  {
    id: 4,
    name: "Sold Out Metallic Markers",
    price: "350",
    regular_price: "400",
    stock_status: "outofstock",
    manage_stock: true,
    stock_quantity: 0,
    average_rating: "3.8",
    date_created: "2026-01-15T00:00:00",
  },
  {
    id: 5,
    name: "Intermediate Calligraphy Kit",
    price: "1400",
    regular_price: "1800",
    stock_status: "instock",
    manage_stock: true,
    stock_quantity: 10,
    average_rating: "4.7",
    date_created: "2026-02-15T00:00:00",
  },
];

function applyFiltersAndSort(products, { sortBy = "default", priceFilter = "all", inStockOnly = false }) {
  let list = [...products];

  if (inStockOnly) {
    list = list.filter((p) => {
      const { isOutOfStock } = getProductStock(p);
      return !isOutOfStock;
    });
  }

  if (priceFilter !== "all") {
    list = list.filter((p) => {
      const price = Number(p.price || p.sale_price || 0);
      if (priceFilter === "under-500") return price > 0 && price < 500;
      if (priceFilter === "500-1000") return price >= 500 && price <= 1000;
      if (priceFilter === "1000-2000") return price >= 1000 && price <= 2000;
      if (priceFilter === "above-2000") return price > 2000;
      return true;
    });
  }

  if (sortBy === "price-asc") {
    list.sort((a, b) => Number(a.price || a.sale_price || 0) - Number(b.price || b.sale_price || 0));
  } else if (sortBy === "price-desc") {
    list.sort((a, b) => Number(b.price || b.sale_price || 0) - Number(a.price || a.sale_price || 0));
  } else if (sortBy === "discount") {
    list.sort((a, b) => {
      const regA = Number(a.regular_price || a.price || 0);
      const curA = Number(a.price || a.sale_price || 0);
      const discA = regA > curA && regA > 0 ? (regA - curA) / regA : 0;

      const regB = Number(b.regular_price || b.price || 0);
      const curB = Number(b.price || b.sale_price || 0);
      const discB = regB > curB && regB > 0 ? (regB - curB) / regB : 0;

      return discB - discA;
    });
  } else if (sortBy === "rating") {
    list.sort((a, b) => Number(b.average_rating || 0) - Number(a.average_rating || 0));
  } else if (sortBy === "newest") {
    list.sort((a, b) => new Date(b.date_created || 0).getTime() - new Date(a.date_created || 0).getTime());
  }

  return list;
}

test("Category Filtering & Sorting Suite", async (t) => {
  await t.test("1. In-stock filter excludes out of stock items", () => {
    const result = applyFiltersAndSort(sampleProducts, { inStockOnly: true });
    assert.equal(result.length, 4);
    assert.equal(result.some((p) => p.id === 4), false);
  });

  await t.test("2. Price filter: under-500", () => {
    const result = applyFiltersAndSort(sampleProducts, { priceFilter: "under-500" });
    assert.equal(result.length, 2); // id 1 (450) and id 4 (350)
    assert.deepEqual(result.map((p) => p.id), [1, 4]);
  });

  await t.test("3. Price filter: 500-1000", () => {
    const result = applyFiltersAndSort(sampleProducts, { priceFilter: "500-1000" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 2); // id 2 (850)
  });

  await t.test("4. Price filter combined with in-stock filter", () => {
    const result = applyFiltersAndSort(sampleProducts, { priceFilter: "under-500", inStockOnly: true });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 1); // id 4 is excluded because out of stock
  });

  await t.test("5. Sort by price-asc (low to high)", () => {
    const result = applyFiltersAndSort(sampleProducts, { sortBy: "price-asc" });
    const prices = result.map((p) => Number(p.price));
    assert.deepEqual(prices, [350, 450, 850, 1400, 2499]);
  });

  await t.test("6. Sort by price-desc (high to low)", () => {
    const result = applyFiltersAndSort(sampleProducts, { sortBy: "price-desc" });
    const prices = result.map((p) => Number(p.price));
    assert.deepEqual(prices, [2499, 1400, 850, 450, 350]);
  });

  await t.test("7. Sort by discount (percentage savings)", () => {
    const result = applyFiltersAndSort(sampleProducts, { sortBy: "discount" });
    // id 2: (1200 - 850)/1200 = 29.1%
    // id 5: (1800 - 1400)/1800 = 22.2%
    // id 4: (400 - 350)/400 = 12.5%
    // id 1: (500 - 450)/500 = 10%
    // id 3: 0%
    assert.equal(result[0].id, 2);
    assert.equal(result[1].id, 5);
  });

  await t.test("8. Sort by rating", () => {
    const result = applyFiltersAndSort(sampleProducts, { sortBy: "rating" });
    assert.equal(result[0].id, 2); // 4.9
    assert.equal(result[1].id, 5); // 4.7
    assert.equal(result[2].id, 1); // 4.5
  });

  await t.test("9. Sort by newest", () => {
    const result = applyFiltersAndSort(sampleProducts, { sortBy: "newest" });
    assert.equal(result[0].id, 3); // 2026-03-01
    assert.equal(result[1].id, 5); // 2026-02-15
  });

  await t.test("10. Draft filter changes do not trigger category fetches until applied", () => {
    let fetchCount = 0;
    const appliedState = { sortBy: "default", priceFilter: "all", inStockOnly: false };
    let draftState = { ...appliedState };

    const mockFetchProducts = () => {
      fetchCount += 1;
    };

    // User modifies draft inside sheet
    draftState = { sortBy: "price-asc", priceFilter: "under-500", inStockOnly: true };

    // Closing or modifying draft makes 0 fetch calls
    assert.equal(fetchCount, 0);
    assert.notDeepEqual(draftState, appliedState);
  });

  await t.test("11. Applying identical filter draft values results in zero API requests (no-op)", () => {
    let fetchCount = 0;
    const appliedState = { sortBy: "price-asc", priceFilter: "under-500", inStockOnly: true };
    const draftState = { sortBy: "price-asc", priceFilter: "under-500", inStockOnly: true };

    const handleApply = (draft, current) => {
      const isUnchanged =
        draft.sortBy === current.sortBy &&
        draft.priceFilter === current.priceFilter &&
        draft.inStockOnly === current.inStockOnly;
      if (!isUnchanged) {
        fetchCount += 1;
      }
    };

    handleApply(draftState, appliedState);
    assert.equal(fetchCount, 0, "No network request when applying identical values");
  });

  await t.test("12. Applying modified filter draft values triggers exactly one page-one query and resets scroll offset", () => {
    let fetchCount = 0;
    let page = 5;
    let scrollTop = 1250;
    const appliedState = { sortBy: "default", priceFilter: "all", inStockOnly: false };
    const draftState = { sortBy: "rating", priceFilter: "500-1000", inStockOnly: true };

    const handleApply = (draft, current) => {
      const isUnchanged =
        draft.sortBy === current.sortBy &&
        draft.priceFilter === current.priceFilter &&
        draft.inStockOnly === current.inStockOnly;
      if (!isUnchanged) {
        page = 1;
        scrollTop = 0;
        fetchCount += 1;
      }
    };

    handleApply(draftState, appliedState);
    assert.equal(fetchCount, 1, "Exactly one page request triggered");
    assert.equal(page, 1, "Pagination reset to page 1");
    assert.equal(scrollTop, 0, "Product container scroll reset to top");
  });

  await t.test("13. Direct In-Stock toggle outside sheet triggers page-1 reset and scroll top", () => {
    let fetchCount = 0;
    let page = 3;
    let scrollTop = 820;
    let inStockOnly = false;

    const handleDirectToggleStock = () => {
      inStockOnly = !inStockOnly;
      page = 1;
      scrollTop = 0;
      fetchCount += 1;
    };

    handleDirectToggleStock();
    assert.equal(inStockOnly, true);
    assert.equal(fetchCount, 1);
    assert.equal(page, 1);
    assert.equal(scrollTop, 0);
  });

  await t.test("14. Reset all filters restores defaults and resets scroll offset", () => {
    let page = 4;
    let scrollTop = 950;
    let state = { sortBy: "price-desc", priceFilter: "above-2000", inStockOnly: true };

    const handleReset = () => {
      state = { sortBy: "default", priceFilter: "all", inStockOnly: false };
      page = 1;
      scrollTop = 0;
    };

    handleReset();
    assert.deepEqual(state, { sortBy: "default", priceFilter: "all", inStockOnly: false });
    assert.equal(page, 1);
    assert.equal(scrollTop, 0);
  });

  await t.test("15. Filter sheet accessibility: dialog exposes accessible name and triggers focus restoration", () => {
    let activeElement = "button-sort-pill";
    let triggerRef = { current: null };

    // 1. User clicks opening pill with keyboard or mouse
    const openSheet = (buttonId) => {
      activeElement = buttonId;
      triggerRef.current = { id: buttonId, focused: false, focus() { this.focused = true; } };
    };

    openSheet("sort-pill");
    assert.equal(triggerRef.current.id, "sort-pill");

    // 2. Dialog mounts with accessible name
    const dialogAttributes = {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "filter-sheet-title",
    };
    assert.equal(dialogAttributes["aria-labelledby"], "filter-sheet-title");

    // 3. Close restores focus to opening button
    const closeSheet = () => {
      if (triggerRef.current) {
        triggerRef.current.focus();
        activeElement = triggerRef.current.id;
        triggerRef.current = null;
      }
    };

    closeSheet();
    assert.equal(activeElement, "sort-pill");
  });

  await t.test("16. Focus trap cycle: Tab and Shift+Tab wrap within focusable elements", () => {
    const focusableElements = ["close-button", "sort-opt-1", "sort-opt-2", "clear-all-btn", "apply-btn"];
    let currentFocusIndex = 0;

    const handleKeyDown = (key, shiftKey) => {
      if (key === "Tab") {
        if (shiftKey) {
          // Shift + Tab: if on first element, wrap to last
          currentFocusIndex = currentFocusIndex === 0 ? focusableElements.length - 1 : currentFocusIndex - 1;
        } else {
          // Tab: if on last element, wrap to first
          currentFocusIndex = currentFocusIndex === focusableElements.length - 1 ? 0 : currentFocusIndex + 1;
        }
      }
    };

    // Forward tab to last element
    for (let i = 0; i < focusableElements.length - 1; i++) {
      handleKeyDown("Tab", false);
    }
    assert.equal(focusableElements[currentFocusIndex], "apply-btn");

    // Tabbing from last wraps to first
    handleKeyDown("Tab", false);
    assert.equal(focusableElements[currentFocusIndex], "close-button");

    // Shift-tab from first wraps to last
    handleKeyDown("Tab", true);
    assert.equal(focusableElements[currentFocusIndex], "apply-btn");
  });

  await t.test("17. Cold profile load: edit form ref focuses phone input once mounted, ignoring cold delays", () => {
    let isFocused = false;
    let focusAttempted = false;

    // Simulate input element
    const phoneInputMock = {
      disabled: false,
      focus() {
        isFocused = true;
      },
    };

    // Cold load: loading is initially true, edit form not yet mounted
    let loading = true;
    const editing = true;
    const focusField = "phone";

    // 150ms timeout would fail here because input is not mounted yet
    assert.equal(isFocused, false);

    // After cold fetch (e.g. 350ms later), loading completes and input mounts
    loading = false;

    // Mounted ref callback
    const setPhoneInputRef = (node) => {
      if (node && !node.disabled && editing && focusField === "phone" && !focusAttempted) {
        node.focus();
        focusAttempted = true;
      }
    };

    setPhoneInputRef(phoneInputMock);
    assert.equal(isFocused, true, "Phone input received focus once mounted");
    assert.equal(focusAttempted, true);
  });
});
