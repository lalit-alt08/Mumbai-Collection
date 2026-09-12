import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAdjustInput,
  applyProductAdjustment,
  calculateStockStep,
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

  await t.test("applyProductAdjustment updates price and stock with status calculation", () => {
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
    const outOfStockResult = applyProductAdjustment(originalProduct, {
      regular_price: "1499",
      stock_quantity: 0,
    });
    assert.equal(outOfStockResult.stock_quantity, 0);
    assert.equal(outOfStockResult.stock_status, "outofstock");
    assert.equal(outOfStockResult.regular_price, "1499");

    // Update stock to 12 -> instock and price to 1599
    const inStockResult = applyProductAdjustment(originalProduct, {
      regular_price: "1599",
      stock_quantity: 12,
    });
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
      stock_quantity: 10,
    });
    assert.equal(updated.regular_price, "1000");
    assert.equal(updated.sale_price, "799");
    assert.equal(updated.price, "799");
  });
});
