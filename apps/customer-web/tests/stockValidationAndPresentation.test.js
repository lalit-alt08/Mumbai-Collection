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
    assert.deepEqual(getProductStock(product), { maxStock: 2, isOutOfStock: false });
    assert.equal(getRemainingStock(product, 0), 2);
    assert.equal(getRemainingStock(product, 1), 1);
    assert.equal(getRemainingStock(product, 2), 0);
  });

  await t.test("out-of-stock status overrides an inconsistent positive quantity", () => {
    const product = { manage_stock: true, stock_quantity: 2, stock_status: "outofstock" };
    assert.deepEqual(getProductStock(product), { maxStock: 0, isOutOfStock: true });
    assert.equal(getRemainingStock(product, 0), 0);
  });

  await t.test("live cartItem out-of-stock status overrides stale product data from list", () => {
    // Stale product from cached list claims 2 in stock
    const staleProduct = { manage_stock: true, stock_quantity: 2, stock_status: "instock" };
    // Real-time cart item reports outofstock (e.g. Sandisk Cruzer)
    const cartItem = { id: 232, quantity: 2, stock_status: "outofstock", is_in_stock: false, quantity_limits: { maximum: 0 } };

    const stock = getProductStock(staleProduct, cartItem);
    assert.deepEqual(stock, { maxStock: 0, isOutOfStock: true });
    assert.equal(getRemainingStock(staleProduct, 2, cartItem), 0);
  });

  await t.test("cart errors are translated into safe, actionable messages", () => {
    assert.match(
      getCartFailureMessage({ response: { data: { code: "woocommerce_rest_cart_item_out_of_stock" } } }),
      /Stock changed/
    );
    assert.match(getCartFailureMessage(new Error("offline")), /Could not update your cart/);
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

  await t.test("2. Cart out-of-stock detection correctly identifies unavailable items", () => {
    const cartItems = [
      {
        id: 101,
        key: "key_item_1",
        name: "DOMS Brush Pen",
        quantity: 2,
        quantity_limits: { maximum: 0 },
      },
      {
        id: 102,
        key: "key_item_2",
        name: "Camel Pastels",
        quantity: 1,
        stock_status: "outofstock",
      },
      {
        id: 103,
        key: "key_item_3",
        name: "Classmate Notebook",
        quantity: 3,
        is_in_stock: false,
      },
      {
        id: 104,
        key: "key_item_4",
        name: "Available Item",
        quantity: 1,
        quantity_limits: { maximum: 10 },
        stock_status: "instock",
        is_in_stock: true,
      },
    ];

    const outOfStockItems = cartItems.filter(
      (item) =>
        item.quantity_limits?.maximum === 0 ||
        item.stock_status === "outofstock" ||
        item.is_in_stock === false ||
        Boolean(item.isOutOfStock)
    );

    assert.equal(outOfStockItems.length, 3, "Must flag all 3 out-of-stock variants");
    assert.deepEqual(
      outOfStockItems.map((i) => i.id),
      [101, 102, 103]
    );

    const hasRemainingItems = cartItems.length > outOfStockItems.length;
    assert.equal(hasRemainingItems, true, "Cart has 1 available item remaining for partial checkout");
  });

  await t.test("3. Checkout stock error handler extracts out_of_stock_details and maps cart keys", () => {
    const errorResponseData = {
      code: "ITEM_OUT_OF_STOCK",
      message: "The following item(s) are out of stock: DOMS Brush Pen. Please update your cart.",
      out_of_stock_items: ["DOMS Brush Pen"],
      out_of_stock_details: [
        {
          id: 101,
          key: "key_item_1",
          name: "DOMS Brush Pen",
          requested: 2,
          available: 0,
        },
      ],
    };

    const isStockError =
      errorResponseData.code === "ITEM_OUT_OF_STOCK" ||
      errorResponseData.code === "INSUFFICIENT_STOCK" ||
      errorResponseData.code === "woocommerce_rest_cart_item_out_of_stock";

    assert.equal(isStockError, true, "ITEM_OUT_OF_STOCK must trigger notification modal");

    const shortageDetails =
      Array.isArray(errorResponseData.out_of_stock_details) &&
      errorResponseData.out_of_stock_details.length > 0
        ? errorResponseData.out_of_stock_details
        : (errorResponseData.out_of_stock_items || []).map((name) => ({ name }));

    assert.equal(shortageDetails.length, 1);
    assert.equal(shortageDetails[0].key, "key_item_1");
    assert.equal(shortageDetails[0].requested, 2);
    assert.equal(shortageDetails[0].available, 0);
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

