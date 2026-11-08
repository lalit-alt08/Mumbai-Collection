import test from "node:test";
import assert from "node:assert/strict";
import { getProductStockDisplay } from "../src/utils/productStockDisplay.js";

test("stock display uses WooCommerce status and the shared low-stock boundaries", () => {
  const cases = [
    [{ stock_status: "instock", manage_stock: true, stock_quantity: 0 }, "In Stock", "0 units"],
    [{ stock_status: "instock", manage_stock: true, stock_quantity: 1 }, "Low Stock", "1 unit"],
    [{ stock_status: "instock", manage_stock: true, stock_quantity: 5 }, "Low Stock", "5 units"],
    [{ stock_status: "instock", manage_stock: true, stock_quantity: 6 }, "In Stock", "6 units"],
    [{ stock_status: "instock", manage_stock: false, stock_quantity: null }, "In Stock", "Stock not tracked"],
    [{ stock_status: "onbackorder", manage_stock: false, stock_quantity: null }, "On Backorder", "Stock not tracked"],
    [{ stock_status: "outofstock", manage_stock: true, stock_quantity: 4 }, "Out of Stock", "4 units"],
    [{ stock_status: "instock", manage_stock: true, stock_quantity: null }, "In Stock", "Quantity unavailable"],
  ];

  for (const [product, expectedStatus, expectedQuantity] of cases) {
    const display = getProductStockDisplay(product);
    assert.equal(display.statusLabel, expectedStatus);
    assert.equal(display.quantityLabel, expectedQuantity);
  }
});
