import test from "node:test";
import assert from "node:assert/strict";
import api from "../src/config/woocommerce.js";
import { searchIndexService } from "../src/services/searchIndexService.js";
import { serverCache } from "../src/utils/memoryCache.js";
import { reorderCategories, _setRedisClientForTesting } from "../src/controllers/adminCategoryController.js";

test("stale category order is rejected before writing", async () => {
  const originalGet = api.get;
  const originalPost = api.post;
  const originalDirty = searchIndexService.markDirty;
  let writes = 0;
  let owner;
  const redis = { set: async (_key, value) => { owner = value; return "OK"; }, get: async () => owner, eval: async () => 1 };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    _setRedisClientForTesting(redis);
    searchIndexService.markDirty = () => {};
    api.get = async () => ({ data: [{ id: 1, name: "One", parent: 0, menu_order: 1 }, { id: 2, name: "Two", parent: 0, menu_order: 2 }] });
    api.post = async () => { writes++; return { data: {} }; };
    serverCache.set("admin:categories", [{ id: 2 }]);
    await reorderCategories({ body: { category_ids: [2, 1], expected_order: [2, 1] } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "CATEGORY_ORDER_CONFLICT");
    assert.equal(writes, 0);
    assert.equal(serverCache.get("admin:categories"), null);
  } finally {
    api.get = originalGet;
    api.post = originalPost;
    searchIndexService.markDirty = originalDirty;
    _setRedisClientForTesting(undefined);
  }
});
