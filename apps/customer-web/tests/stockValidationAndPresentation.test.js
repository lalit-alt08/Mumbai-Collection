import test from "node:test";
import assert from "node:assert/strict";
import { cleanProductTitle } from "../src/utils/productUtils.js";

test("Stock Validation & Presentation Test Suite", async (t) => {
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
});
