import test from "node:test";
import assert from "node:assert/strict";
import api from "../src/config/woocommerce.js";
import wp from "../src/services/wordpress.js";
import { createProduct } from "../src/controllers/adminProductController.js";
import { searchIndexService } from "../src/services/searchIndexService.js";

test("employee product creation claims a durable operation before writing", async (t) => {
  const originals = { get: api.get, post: api.post, wpPost: wp.post, markDirty: searchIndexService.markDirty };
  searchIndexService.markDirty = () => {};
  t.after(() => { api.get = originals.get; api.post = originals.post; wp.post = originals.wpPost; searchIndexService.markDirty = originals.markDirty; });
  const records = new Map();
  let writes = 0;
  let failAfterWrite = false;
  api.get = async (path) => path === "products/categories"
    ? { data: [{ id: 9, name: "Department", slug: "department", parent: 0 }] }
    : { data: { id: 741, name: "Pen", images: [] } };
  api.post = async () => {
    writes++;
    if (failAfterWrite) throw new Error("WooCommerce response lost after write");
    return { data: { id: 741, name: "Pen", images: [] } };
  };
  wp.post = async (_path, body) => {
    let record = records.get(body.operation);
    if (body.action === "claim" && !record) {
      record = { state: "pending", fingerprint: body.fingerprint };
      records.set(body.operation, record);
      return { data: { claimed: true, state: "pending" } };
    }
    if (record.fingerprint !== body.fingerprint) throw new Error("fingerprint mismatch");
    if (body.action === "finish") { record.state = "complete"; record.product_id = body.product_id; }
    return { data: { claimed: false, ...record } };
  };
  const request = (key) => ({ baseUrl: "/api/employee", wpUserId: 8, headers: { "x-idempotency-key": key }, body: { name: "Pen", regular_price: "15", category_ids: [9] } });
  const invoke = async (req) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await createProduct(req, res);
    return res;
  };
  await t.test("uncertain write remains pending and is not repeated", async () => {
    failAfterWrite = true;
    const first = await invoke(request("lost-response"));
    assert.equal(first.statusCode, 503);
    assert.equal(first.body.code, "PRODUCT_CREATION_UNRESOLVED");
    const second = await invoke(request("lost-response"));
    assert.equal(second.statusCode, 409);
    assert.equal(writes, 1);
  });
  await t.test("completed operation returns the existing product", async () => {
    failAfterWrite = false;
    const first = await invoke(request("completed"));
    const second = await invoke(request("completed"));
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal(second.body.product.id, 741);
    assert.equal(writes, 2);
  });
});
