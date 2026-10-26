import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanProductTitle,
  getCartFailureMessage,
  getProductStock,
  getRemainingStock,
  shuffleProducts,
  reshuffleCategoryProducts,
  filterAndShuffleRelatedProducts,
} from "../src/utils/productUtils.js";

test("Stock Validation & Presentation Test Suite", async (t) => {
  await t.test("stock availability reflects remaining stock after cart quantity", () => {
    const product = { manage_stock: true, stock_quantity: 2, stock_status: "instock" };
    assert.deepEqual(getProductStock(product), {
      maxStock: 2,
      isOutOfStock: false,
      availableStock: 2,
      backordersAllowed: false,
    });
    assert.equal(getRemainingStock(product, 0), 2);
    assert.equal(getRemainingStock(product, 1), 1);
    assert.equal(getRemainingStock(product, 2), 0);
  });

  await t.test("out-of-stock status overrides an inconsistent positive quantity", () => {
    const product = { manage_stock: true, stock_quantity: 2, stock_status: "outofstock" };
    assert.deepEqual(getProductStock(product), {
      maxStock: 0,
      isOutOfStock: true,
      availableStock: 0,
      backordersAllowed: false,
    });
    assert.equal(getRemainingStock(product, 0), 0);
  });

  await t.test("live cartItem out-of-stock status overrides stale product data from list", () => {
    // Stale product from cached list claims 2 in stock
    const staleProduct = { manage_stock: true, stock_quantity: 2, stock_status: "instock" };
    // Real-time cart item reports outofstock (e.g. Sandisk Cruzer)
    const cartItem = { id: 232, quantity: 2, stock_status: "outofstock", is_in_stock: false, quantity_limits: { maximum: 0 } };

    const stock = getProductStock(staleProduct, cartItem);
    assert.deepEqual(stock, {
      maxStock: 0,
      isOutOfStock: true,
      availableStock: 0,
      backordersAllowed: false,
    });
    assert.equal(getRemainingStock(staleProduct, 2, cartItem), 0);
  });

  await t.test("cart errors are translated into safe, actionable messages", () => {
    assert.match(
      getCartFailureMessage({ response: { data: { code: "woocommerce_rest_cart_item_out_of_stock" } } }),
      /out of stock/i
    );
    assert.match(getCartFailureMessage(new Error("offline")), /try again/i);
  });

  await t.test("1. cleanProductTitle strips marketplace scrape artifacts and SEO noise", () => {
    // Exact sample from user report
    const scraped1 =
      "Click to see full view 2 VIDEOS DOMS 14 Shades Brush Pen Box Pack | Super Soft Tip With Brilliant Colors | Water Based Ink Which Gives Water Color Effect | Pack Of 1, Multicolor";
    assert.equal(
      cleanProductTitle(scraped1),
      "DOMS 14 Shades Brush Pen Box Pack",
      "Must strip leading 'Click to see full view 2 VIDEOS' and isolate primary title before first pipe"
    );

    const scraped2 = "5 IMAGES Camel Oil Pastels 50 Shades Pack";
    assert.equal(
      cleanProductTitle(scraped2),
      "Camel Oil Pastels 50 Shades Pack",
      "Must strip '5 IMAGES' prefix"
    );

    const cleanTitle = "Classmate Pulse 6 Subject Spiral Notebook";
    assert.equal(
      cleanProductTitle(cleanTitle),
      "Classmate Pulse 6 Subject Spiral Notebook",
      "Must preserve already-clean titles unchanged"
    );

    assert.equal(cleanProductTitle(""), "");
    assert.equal(cleanProductTitle(null), "");
    assert.equal(cleanProductTitle(undefined), "");
  });

  await t.test("4. shuffleProducts: handles empty, single, and multiple items safely without mutation", () => {
    assert.deepEqual(shuffleProducts([]), []);
    assert.deepEqual(shuffleProducts(null), []);
    assert.deepEqual(shuffleProducts([{ id: 1 }]), [{ id: 1 }]);

    const original = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const copy = [...original];
    const shuffled = shuffleProducts(original);

    // Unmutated original
    assert.deepEqual(original, copy);
    // Same length and same elements
    assert.equal(shuffled.length, 5);
    const ids = shuffled.map((p) => p.id).sort();
    assert.deepEqual(ids, [1, 2, 3, 4, 5]);
  });

  await t.test("5. reshuffleCategoryProducts: prioritizes in-stock items ahead of out-of-stock items while shuffling", () => {
    const products = [
      { id: "p1", name: "Camel Oil Pastels", stock_status: "outofstock" },
      { id: "p2", name: "DOMS Brush Pen", stock_status: "instock", stock_quantity: 3 },
      { id: "p3", name: "Posca Marker", stock_status: "instock", stock_quantity: 10 },
      { id: "p4", name: "Sold Out Notebook", stock_status: "outofstock" },
      { id: "p5", name: "Highlighter", stock_status: "instock", stock_quantity: 5 },
    ];

    const result = reshuffleCategoryProducts(products);

    assert.equal(result.length, 5);
    // In-stock items (p2, p3, p5) must be the first 3 items in any order
    const firstThreeIds = new Set(result.slice(0, 3).map((p) => p.id));
    assert.equal(firstThreeIds.has("p2"), true, "p2 must be in top 3");
    assert.equal(firstThreeIds.has("p3"), true, "p3 must be in top 3");
    assert.equal(firstThreeIds.has("p5"), true, "p5 must be in top 3");

    // Out-of-stock items (p1, p4) must be at the end
    const lastTwoIds = new Set(result.slice(3).map((p) => p.id));
    assert.equal(lastTwoIds.has("p1"), true, "p1 must be at the end");
    assert.equal(lastTwoIds.has("p4"), true, "p4 must be at the end");
  });

  await t.test("6. filterAndShuffleRelatedProducts: completely excludes out-of-stock items from recommendations", () => {
    assert.deepEqual(filterAndShuffleRelatedProducts([]), []);
    assert.deepEqual(filterAndShuffleRelatedProducts(null), []);
    assert.deepEqual(filterAndShuffleRelatedProducts(undefined), []);

    // Exact case from user's screenshot: Stanley (out of stock) + Popsugar (in stock)
    const recommendations = [
      { id: "stanley_cup", name: "stanley", stock_status: "outofstock" },
      { id: "popsugar_car", name: "popsugar Off Roader", stock_status: "instock", stock_quantity: 5 },
      { id: "zero_qty", name: "Sold Out Toy", manage_stock: true, stock_quantity: 0, stock_status: "instock" },
      { id: "watercolor_set", name: "Camel Watercolor", stock_status: "instock" },
    ];

    const filtered = filterAndShuffleRelatedProducts(recommendations);

    // Only popsugar_car and watercolor_set should be present
    assert.equal(filtered.length, 2);
    const ids = new Set(filtered.map((p) => p.id));
    assert.equal(ids.has("stanley_cup"), false, "Stanley (out of stock) must be excluded");
    assert.equal(ids.has("zero_qty"), false, "Zero stock quantity must be excluded");
    assert.equal(ids.has("popsugar_car"), true, "In-stock Popsugar must be included");
    assert.equal(ids.has("watercolor_set"), true, "In-stock Camel Watercolor must be included");

    // When all items in recommendation are out of stock, should return empty array
    const allOutOfStock = [
      { id: "stanley_cup", name: "stanley", stock_status: "outofstock" },
      { id: "zero_qty", name: "Sold Out Toy", manage_stock: true, stock_quantity: 0 },
    ];
    assert.deepEqual(filterAndShuffleRelatedProducts(allOutOfStock), []);
  });

});

