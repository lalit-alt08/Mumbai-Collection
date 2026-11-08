import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAdjustInput,
  buildProductAdjustmentPayload,
  applyProductAdjustment,
  calculateStockStep,
  matchesProductAdjustment,
} from "../src/utils/productAdjuster.js";

test("Phase 2: Mobile Quick Adjust Validation & Calculations", async (t) => {
  await t.test("validates non-negative integer stock quantity", () => {
    // Valid values
    assert.deepEqual(validateAdjustInput({ stock_quantity: 0 }), {
      isValid: true,
      updateData: { stock_quantity: 0 },
    });
    assert.deepEqual(validateAdjustInput({ stock_quantity: 15 }), {
      isValid: true,
      updateData: { stock_quantity: 15 },
    });
    assert.deepEqual(validateAdjustInput({ stock_quantity: "25" }), {
      isValid: true,
      updateData: { stock_quantity: 25 },
    });

    // Invalid values
    assert.equal(validateAdjustInput({ stock_quantity: -1 }).isValid, false);
    assert.equal(validateAdjustInput({ stock_quantity: 2.5 }).isValid, false);
    assert.equal(validateAdjustInput({ stock_quantity: "abc" }).isValid, false);
  });

  await t.test("validates valid non-negative regular price", () => {
    // Valid values
    assert.deepEqual(validateAdjustInput({ regular_price: "499" }), {
      isValid: true,
      updateData: { regular_price: "499" },
    });
    assert.deepEqual(validateAdjustInput({ regular_price: 1299.5 }), {
      isValid: true,
      updateData: { regular_price: "1299.5" },
    });
    assert.deepEqual(validateAdjustInput({ regular_price: 0 }), {
      isValid: true,
      updateData: { regular_price: "0" },
    });

    // Invalid values
    assert.equal(validateAdjustInput({ regular_price: -100 }).isValid, false);
    assert.equal(validateAdjustInput({ regular_price: "xyz" }).isValid, false);
  });

  await t.test("calculateStockStep clamps decrements to zero and handles positive increments", () => {
    // Decrement clamping
    assert.equal(calculateStockStep(5, -1), 4);
    assert.equal(calculateStockStep(0, -1), 0);
    assert.equal(calculateStockStep(2, -5), 0);

    // Increments & presets
    assert.equal(calculateStockStep(10, 1), 11);
    assert.equal(calculateStockStep(10, 5), 15);
    assert.equal(calculateStockStep(10, 10), 20);
    assert.equal(calculateStockStep(10, 20), 30);
    assert.equal(calculateStockStep("15", 5), 20);
    assert.equal(calculateStockStep("", 5), 5);
  });

  await t.test("applyProductAdjustment changes only submitted price and stock fields", () => {
    const originalProduct = {
      id: 101,
      name: "Bandhani Silk Saree",
      sku: "BAN-001",
      regular_price: "1499",
      price: "1499",
      stock_quantity: 4,
      stock_status: "instock",
    };

    // Update stock to 0 -> outofstock
    const outOfStockResult = applyProductAdjustment(originalProduct, { stock_quantity: 0 });
    assert.equal(outOfStockResult.stock_quantity, 0);
    assert.equal(outOfStockResult.stock_status, "outofstock");
    assert.equal(outOfStockResult.regular_price, "1499");

    // Update stock to 12 -> instock and price to 1599
    const inStockResult = applyProductAdjustment(originalProduct, { regular_price: "1599", stock_quantity: 12 });
    assert.equal(inStockResult.stock_quantity, 12);
    assert.equal(inStockResult.stock_status, "instock");
    assert.equal(inStockResult.regular_price, "1599");
    assert.equal(inStockResult.price, "1599");
  });

  await t.test("validates and applies sale_price adjustments alongside regular_price", () => {
    // Valid sale price less than regular price
    assert.deepEqual(
      validateAdjustInput({ regular_price: "1000", sale_price: "799" }),
      {
        isValid: true,
        updateData: { regular_price: "1000", sale_price: "799" },
      }
    );

    // Empty sale price clears the sale price
    assert.deepEqual(
      validateAdjustInput({ regular_price: "1000", sale_price: "" }),
      {
        isValid: true,
        updateData: { regular_price: "1000", sale_price: "" },
      }
    );

    // Sale price >= regular price is invalid
    assert.equal(
      validateAdjustInput({ regular_price: "1000", sale_price: "1000" }).isValid,
      false
    );
    assert.equal(
      validateAdjustInput({ regular_price: "1000", sale_price: "1200" }).isValid,
      false
    );

    // Negative sale price is invalid
    assert.equal(
      validateAdjustInput({ regular_price: "1000", sale_price: "-50" }).isValid,
      false
    );

    // Applying adjustment with sale_price updates price to sale_price and preserves regular_price
    const product = {
      id: 202,
      regular_price: "1000",
      price: "1000",
      stock_quantity: 10,
    };
    const updated = applyProductAdjustment(product, {
      regular_price: "1000",
      sale_price: "799",
    });
    assert.equal(updated.regular_price, "1000");
    assert.equal(updated.sale_price, "799");
    assert.equal(updated.price, "799");
  });

  await t.test("selective diffing: only returns changed fields when initialProduct is provided", () => {
    const original = {
      id: 303,
      regular_price: "2839",
      sale_price: "",
      stock_quantity: 5,
    };

    // 1. Only regular price changed -> stock_quantity must NOT be included
    const priceOnly = validateAdjustInput(
      { regular_price: "2999", sale_price: "", stock_quantity: 5 },
      original
    );
    assert.equal(priceOnly.isValid, true);
    assert.deepEqual(priceOnly.updateData, { regular_price: "2999" });
    assert.equal("stock_quantity" in priceOnly.updateData, false);

    // 2. Only stock changed -> price must NOT be included
    const stockOnly = validateAdjustInput(
      { regular_price: "2839", sale_price: "", stock_quantity: 8 },
      original
    );
    assert.equal(stockOnly.isValid, true);
    assert.deepEqual(stockOnly.updateData, { stock_quantity: 8 });
    assert.equal("regular_price" in stockOnly.updateData, false);

    // 3. Both changed -> both included
    const both = validateAdjustInput(
      { regular_price: "2999", sale_price: "2499", stock_quantity: 12 },
      original
    );
    assert.equal(both.isValid, true);
    assert.deepEqual(both.updateData, {
      regular_price: "2999",
      sale_price: "2499",
      stock_quantity: 12,
    });

    // 4. Nothing changed -> noChanges: true
    const unchanged = validateAdjustInput(
      { regular_price: "2839", sale_price: "", stock_quantity: 5 },
      original
    );
    assert.equal(unchanged.isValid, false);
    assert.equal(unchanged.noChanges, true);
    assert.equal(unchanged.error, "No changes to save.");
  });

  await t.test("price-only edits on unmanaged stock omit stock and CAS fields and preserve stock locally", () => {
    const unmanaged = {
      id: 404,
      regular_price: "100",
      sale_price: "",
      stock_quantity: null,
      manage_stock: false,
      stock_status: "instock",
    };
    const validation = validateAdjustInput(
      { regular_price: "125", sale_price: "", stock_quantity: "" },
      unmanaged
    );
    assert.deepEqual(validation.updateData, { regular_price: "125" });
    assert.deepEqual(buildProductAdjustmentPayload(validation.updateData, unmanaged), { regular_price: "125" });
    assert.deepEqual(applyProductAdjustment(unmanaged, validation.updateData), {
      ...unmanaged,
      regular_price: "125",
      price: "125",
    });
  });

  await t.test("explicit zero quantity preserves CAS even when original stock is null", () => {
    const unmanaged = { id: 405, stock_quantity: null, manage_stock: false, stock_status: "instock" };
    const validation = validateAdjustInput({ stock_quantity: "0" }, unmanaged);
    assert.deepEqual(validation.updateData, { stock_quantity: 0 });
    assert.deepEqual(buildProductAdjustmentPayload(validation.updateData, unmanaged), {
      stock_quantity: 0,
      expected_stock_quantity: null,
    });
  });

  await t.test("timeout verification compares zero stock and changed or cleared sale prices exactly", () => {
    assert.equal(matchesProductAdjustment({ stock_quantity: 0 }, { stock_quantity: 0 }), true);
    assert.equal(matchesProductAdjustment({ stock_quantity: null }, { stock_quantity: 0 }), false);
    assert.equal(matchesProductAdjustment({ regular_price: "100.00" }, { regular_price: "100" }), true);
    assert.equal(matchesProductAdjustment({ sale_price: "75.00" }, { sale_price: "80" }), false);
    assert.equal(matchesProductAdjustment({ sale_price: "" }, { sale_price: "" }), true);
    assert.equal(matchesProductAdjustment({ sale_price: "75" }, { sale_price: "" }), false);
    assert.equal(matchesProductAdjustment({}, { regular_price: "100" }), false);
  });
});
