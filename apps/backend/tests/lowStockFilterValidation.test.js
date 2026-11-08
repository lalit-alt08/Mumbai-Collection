import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

describe("Inventory: Low Stock REST Query & Schema Validation Suite", () => {
  const pluginPath = fs.existsSync(path.resolve(process.cwd(), "mumbai-auth.php"))
    ? path.resolve(process.cwd(), "mumbai-auth.php")
    : path.resolve(process.cwd(), "../../mumbai-auth.php");

  test("lowstock is not registered as a persisted WooCommerce stock status", () => {
    const content = fs.readFileSync(pluginPath, "utf8");
    assert.doesNotMatch(content, /woocommerce_product_stock_status_options/);
    assert.doesNotMatch(content, /\$statuses\s*\[\s*['"]lowstock['"]\s*\]\s*=/);
  });

  test("lowstock is added only to the WooCommerce v3 products GET collection schema", () => {
    const content = fs.readFileSync(pluginPath, "utf8");
    assert.match(
      content,
      /add_filter\(\s*['"]rest_endpoints['"]\s*,\s*['"]mumbai_wc_v3_product_lowstock_collection_params['"]/,
    );
    assert.match(content, /\$route\s*=\s*['"]\/wc\/v3\/products['"]/);
    assert.match(content, /\$has_get\s*=\s*is_string\(\$methods\)/);
    assert.match(content, /\$handler\[['"]args['"]\]\[['"]stock_status['"]\]\[['"]enum['"]\]\[\]\s*=\s*['"]lowstock['"]/);
  });

  test("lowstock collection query enforces managed instock quantity 1 through 5", () => {
    const content = fs.readFileSync(pluginPath, "utf8");
    assert.match(content, /add_filter\(\s*['"]woocommerce_rest_product_object_query['"]/);
    assert.match(content, /'key'\s*=>\s*'_manage_stock'[\s\S]*?'value'\s*=>\s*'yes'/);
    assert.match(content, /'key'\s*=>\s*'_stock'\s*,\s*'value'\s*=>\s*0\s*,\s*'type'\s*=>\s*'NUMERIC'\s*,\s*'compare'\s*=>\s*'>'/);
    assert.match(content, /'key'\s*=>\s*'_stock'\s*,\s*'value'\s*=>\s*5\s*,\s*'type'\s*=>\s*'NUMERIC'\s*,\s*'compare'\s*=>\s*'<='/);
    assert.match(content, /'key'\s*=>\s*'_stock_status'\s*,\s*'value'\s*=>\s*'instock'/);
    assert.match(content, /\$request->set_param\(['"]stock_status['"]\s*,\s*null\)/);
    assert.doesNotMatch(content, /add_action\(\s*['"]pre_get_posts['"]\s*,\s*['"]mumbai_strip_lowstock_meta_query['"]\s*,/);
    assert.match(content, /pm_status\.meta_key = '_stock_status' AND pm_status\.meta_value = %s/);
    assert.match(content, /pm_manage\.meta_value = %s/);
    assert.match(content, /BETWEEN %d AND %d/);
    assert.match(content, /get_post_stati\(\['exclude_from_search'\s*=>\s*true\]/);
    assert.match(content, /\$wpdb->last_error\s*!==\s*''/);
  });
});
