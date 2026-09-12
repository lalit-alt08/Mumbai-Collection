import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

describe("Inventory: Low Stock REST Query & Schema Validation Suite", () => {
  const pluginPath = fs.existsSync(path.resolve(process.cwd(), "mumbai-auth.php"))
    ? path.resolve(process.cwd(), "mumbai-auth.php")
    : path.resolve(process.cwd(), "../../mumbai-auth.php");

  test("1. mumbai-auth.php hooks woocommerce_product_stock_status_options to include 'lowstock'", () => {
    const content = fs.readFileSync(pluginPath, "utf8");
    assert.match(
      content,
      /add_filter\(\s*['"]woocommerce_product_stock_status_options['"]/,
      "Must hook woocommerce_product_stock_status_options"
    );
    assert.match(
      content,
      /\$statuses\s*\[\s*['"]lowstock['"]\s*\]\s*=/,
      "Must register 'lowstock' in statuses array"
    );
  });

  test("2. mumbai-auth.php hooks woocommerce_rest_product_collection_params to permit 'lowstock' in schema enum", () => {
    const content = fs.readFileSync(pluginPath, "utf8");
    assert.match(
      content,
      /add_filter\(\s*['"]woocommerce_rest_product_collection_params['"]/,
      "Must hook woocommerce_rest_product_collection_params"
    );
    assert.match(
      content,
      /in_array\(\s*['"]lowstock['"]/,
      "Must ensure 'lowstock' is appended to stock_status enum"
    );
  });

  test("3. woocommerce_rest_product_object_query defines strict low stock boundary (_manage_stock = yes, _stock > 0, _stock <= 5)", () => {
    const content = fs.readFileSync(pluginPath, "utf8");
    assert.match(
      content,
      /add_filter\(\s*['"]woocommerce_rest_product_object_query['"]/,
      "Must hook woocommerce_rest_product_object_query"
    );
    assert.match(content, /'key'\s*=>\s*'_manage_stock'[\s\S]*?'value'\s*=>\s*'yes'/);
    assert.match(content, /'key'\s*=>\s*'_stock'[\s\S]*?'value'\s*=>\s*0[\s\S]*?'compare'\s*=>\s*'>'/);
    assert.match(content, /'key'\s*=>\s*'_stock'[\s\S]*?'value'\s*=>\s*5[\s\S]*?'compare'\s*=>\s*'<='/);
  });
});
