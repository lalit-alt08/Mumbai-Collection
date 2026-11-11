import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import api from "../src/config/woocommerce.js";
import { fetchStockCounts, getAdminProductById, getAdminProducts } from "../src/controllers/adminProductController.js";
import { serverCache } from "../src/utils/memoryCache.js";
import { MemoryCache } from "../src/utils/memoryCache.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const counts = { all: 10, instock: 4, onbackorder: 2, outofstock: 3, lowstock: 2 };
const response = (data, total = data.length) => ({
  data,
  headers: { "x-wp-total": String(total), "x-wp-totalpages": "1" },
});
const invoke = async (query) => {
  let body;
  const res = { json: (value) => { body = value; }, status: () => res };
  await getAdminProducts({ query }, res);
  return body;
};

test("product stock summary keeps explicit status totals and accepts true zero", async (t) => {
  const oldGet = api.get;
  const oldAxiosGet = axios.get;
  const oldInternalKey = process.env.MUMBAI_INTERNAL_API_KEY;
  t.after(() => {
    api.get = oldGet;
    axios.get = oldAxiosGet;
    if (oldInternalKey === undefined) delete process.env.MUMBAI_INTERNAL_API_KEY;
    else process.env.MUMBAI_INTERNAL_API_KEY = oldInternalKey;
    serverCache.clear();
  });
  process.env.MUMBAI_INTERNAL_API_KEY = "test-only";
  serverCache.clear();
  axios.get = async () => ({ data: { success: true, counts: { ...counts, instock: 0 } } });

  assert.deepEqual(await fetchStockCounts(), { ...counts, instock: 0 });
});

test("WooCommerce count fallback preserves zero and rejects missing or invalid total headers", async (t) => {
  const oldGet = api.get;
  const oldAxiosGet = axios.get;
  const oldInternalKey = process.env.MUMBAI_INTERNAL_API_KEY;
  t.after(() => {
    api.get = oldGet;
    axios.get = oldAxiosGet;
    if (oldInternalKey === undefined) delete process.env.MUMBAI_INTERNAL_API_KEY;
    else process.env.MUMBAI_INTERNAL_API_KEY = oldInternalKey;
    serverCache.clear();
  });
  process.env.MUMBAI_INTERNAL_API_KEY = "test-only";
  axios.get = async () => { throw new Error("WordPress summary unavailable"); };
  api.get = async (_endpoint, params) => {
    assert.deepEqual(params.include_status, ["any"]);
    const status = params.stock_status || "all";
    const values = { all: 10, instock: 4, onbackorder: 2, outofstock: 3, lowstock: 0 };
    return response([], values[status]);
  };

  serverCache.clear();
  assert.deepEqual(await fetchStockCounts(), { all: 10, instock: 4, onbackorder: 2, outofstock: 3, lowstock: 0 });

  serverCache.clear();
  api.get = async (_endpoint, params) =>
    params.stock_status === "instock" ? { data: [], headers: {} } : response([], 0);
  await assert.rejects(fetchStockCounts(), /valid product total/);
});

test("filtered list keeps catalog-wide counts and list total scoped to filters", async (t) => {
  const oldGet = api.get;
  const oldAxiosGet = axios.get;
  const oldInternalKey = process.env.MUMBAI_INTERNAL_API_KEY;
  t.after(() => {
    api.get = oldGet;
    axios.get = oldAxiosGet;
    if (oldInternalKey === undefined) delete process.env.MUMBAI_INTERNAL_API_KEY;
    else process.env.MUMBAI_INTERNAL_API_KEY = oldInternalKey;
    serverCache.clear();
  });
  process.env.MUMBAI_INTERNAL_API_KEY = "test-only";
  serverCache.clear();
  serverCache.set("admin:categories:hierarchy", [], 300000);
  axios.get = async () => ({ data: { success: true, counts } });
  let listParams;
  api.get = async (_endpoint, params) => {
    if (params.per_page === 1) throw new Error("Unexpected full-count fallback");
    listParams = params;
    return response([{ id: 9, name: "Pastels", stock_status: "instock", manage_stock: true, stock_quantity: 2 }], 1);
  };

  const result = await invoke({ page: "1", per_page: "20", search: "Pastels", category: "42", stock_status: "lowstock" });
  assert.equal(listParams.stock_status, "lowstock");
  assert.equal(listParams.search, "Pastels");
  assert.equal(listParams.category, "42");
  assert.deepEqual(listParams.include_status, ["any"]);
  assert.equal(result.total, 1);
  assert.deepEqual(result.counts, counts);
});

test("product stock list filters use WooCommerce status exactly, including draft and backorder rows", async (t) => {
  const oldGet = api.get;
  const oldAxiosGet = axios.get;
  const oldInternalKey = process.env.MUMBAI_INTERNAL_API_KEY;
  t.after(() => {
    api.get = oldGet;
    axios.get = oldAxiosGet;
    if (oldInternalKey === undefined) delete process.env.MUMBAI_INTERNAL_API_KEY;
    else process.env.MUMBAI_INTERNAL_API_KEY = oldInternalKey;
    serverCache.clear();
  });
  process.env.MUMBAI_INTERNAL_API_KEY = "test-only";
  serverCache.clear();
  const fixtureCounts = { all: 6, instock: 4, onbackorder: 1, outofstock: 1, lowstock: 2 };
  axios.get = async () => ({ data: { success: true, counts: fixtureCounts } });
  const fixtures = [
    { id: 1, status: "draft", stock_status: "instock", manage_stock: false, stock_quantity: null },
    { id: 2, status: "publish", stock_status: "instock", manage_stock: true, stock_quantity: 1 },
    { id: 3, status: "publish", stock_status: "instock", manage_stock: true, stock_quantity: 5 },
    { id: 4, status: "publish", stock_status: "instock", manage_stock: true, stock_quantity: 6 },
    { id: 5, status: "publish", stock_status: "onbackorder", manage_stock: false, stock_quantity: null },
    { id: 6, status: "publish", stock_status: "outofstock", manage_stock: true, stock_quantity: 0 },
  ];
  api.get = async (_endpoint, params) => {
    assert.deepEqual(params.include_status, ["any"]);
    const matching = params.stock_status === "lowstock"
      ? fixtures.filter((product) => product.stock_status === "instock" && product.manage_stock && product.stock_quantity >= 1 && product.stock_quantity <= 5)
      : params.stock_status
        ? fixtures.filter((product) => product.stock_status === params.stock_status)
        : fixtures;
    return response(matching, matching.length);
  };

  const inStock = await invoke({ page: "1", per_page: "20", stock_status: "instock" });
  assert.deepEqual(inStock.products.map((product) => product.id), [1, 2, 3, 4]);
  const backorder = await invoke({ page: "1", per_page: "20", stock_status: "onbackorder" });
  assert.deepEqual(backorder.products.map((product) => product.id), [5]);
  const outOfStock = await invoke({ page: "1", per_page: "20", stock_status: "outofstock" });
  assert.deepEqual(outOfStock.products.map((product) => product.id), [6]);
  const lowStock = await invoke({ page: "1", per_page: "20", stock_status: "lowstock" });
  assert.deepEqual(lowStock.products.map((product) => product.id), [2, 3]);
  assert.deepEqual(lowStock.counts, fixtureCounts, "global counts remain independent of the active list filter");
});

test("a summary outage leaves a successful product list usable with counts null", async (t) => {
  const oldGet = api.get;
  const oldAxiosGet = axios.get;
  const oldInternalKey = process.env.MUMBAI_INTERNAL_API_KEY;
  t.after(() => {
    api.get = oldGet;
    axios.get = oldAxiosGet;
    if (oldInternalKey === undefined) delete process.env.MUMBAI_INTERNAL_API_KEY;
    else process.env.MUMBAI_INTERNAL_API_KEY = oldInternalKey;
    serverCache.clear();
  });
  process.env.MUMBAI_INTERNAL_API_KEY = "test-only";
  serverCache.clear();
  axios.get = async () => { throw new Error("WP down"); };
  api.get = async (_endpoint, params) => {
    if (params.per_page === 1) throw new Error("Woo count unavailable");
    return response([{ id: 15, name: "Still listed" }], 1);
  };
  const result = await invoke({ page: "1", per_page: "20" });
  assert.equal(result.success, true);
  assert.equal(result.products[0].name, "Still listed");
  assert.equal(result.counts, null);
});

test("a pre-invalidation product read cannot refill the list cache", async (t) => {
  const oldGet = api.get;
  const oldAxiosGet = axios.get;
  const oldInternalKey = process.env.MUMBAI_INTERNAL_API_KEY;
  t.after(() => {
    api.get = oldGet;
    axios.get = oldAxiosGet;
    if (oldInternalKey === undefined) delete process.env.MUMBAI_INTERNAL_API_KEY;
    else process.env.MUMBAI_INTERNAL_API_KEY = oldInternalKey;
    serverCache.clear();
  });
  process.env.MUMBAI_INTERNAL_API_KEY = "test-only";
  serverCache.clear();
  axios.get = async () => ({ data: { success: true, counts } });
  let releaseFirst;
  let listCalls = 0;
  api.get = async () => {
    listCalls++;
    if (listCalls === 1) return new Promise((resolve) => { releaseFirst = resolve; });
    return response([{ id: 2, name: "Fresh after stock update" }], 1);
  };

  const staleRequest = invoke({ page: "1", per_page: "20" });
  while (!releaseFirst) await new Promise((resolve) => setTimeout(resolve, 0));
  serverCache.invalidatePrefix("admin_products:");
  releaseFirst(response([{ id: 1, name: "Stale before stock update" }], 1));
  await staleRequest;
  assert.equal(serverCache.get("admin_products:1:20:all:all:"), null);

  const refreshed = await invoke({ page: "1", per_page: "20" });
  assert.equal(refreshed.products[0].name, "Fresh after stock update");
  assert.equal(listCalls, 2);
});

test("fresh staff product verification requests edit context and bypasses the list cache", async (t) => {
  const oldGet = api.get;
  t.after(() => { api.get = oldGet; });
  let captured;
  api.get = async (...args) => {
    captured = args;
    return { data: { id: 77, regular_price: "100.00", sale_price: "", stock_quantity: null, stock_status: "instock", manage_stock: false } };
  };
  let body;
  let statusCode;
  const res = {
    json: (value) => { body = value; return res; },
    status: (value) => { statusCode = value; return res; },
  };

  await getAdminProductById({ params: { id: "77" } }, res);
  assert.equal(captured[0], "products/77");
  assert.deepEqual(captured[1], { context: "edit" });
  assert.equal(statusCode, undefined);
  assert.equal(body.product.stock_quantity, null);
  assert.equal(body.product.sale_price, "");
});

test("slow stock counts do not delay product lists beyond the per-response budget on cache hits or misses", async (t) => {
  const oldGet = api.get;
  const oldAxiosGet = axios.get;
  const oldInternalKey = process.env.MUMBAI_INTERNAL_API_KEY;
  t.after(() => {
    api.get = oldGet;
    axios.get = oldAxiosGet;
    if (oldInternalKey === undefined) delete process.env.MUMBAI_INTERNAL_API_KEY;
    else process.env.MUMBAI_INTERNAL_API_KEY = oldInternalKey;
    serverCache.clear();
  });
  process.env.MUMBAI_INTERNAL_API_KEY = "test-only";
  serverCache.clear();
  axios.get = () => new Promise(() => {});
  api.get = async () => response([{ id: 78, name: "Available product" }], 1);

  const cachedListKey = "admin_products:1:20:all:all:";
  serverCache.set(cachedListKey, {
    success: true, page: 1, per_page: 20, total: 1, totalPages: 1,
    products: [{ id: 78, name: "Cached product" }],
  }, 60000);
  const hitStart = Date.now();
  const hit = await invoke({ page: "1", per_page: "20" });
  const hitElapsed = Date.now() - hitStart;
  assert.equal(hit.products[0].name, "Cached product");
  assert.equal(hit.counts, null);
  assert.ok(hitElapsed < 2500, `cached product list waited ${hitElapsed}ms for counts`);

  serverCache.clear();
  const missStart = Date.now();
  const miss = await invoke({ page: "1", per_page: "20" });
  const missElapsed = Date.now() - missStart;
  assert.equal(miss.products[0].name, "Available product");
  assert.equal(miss.counts, null);
  assert.ok(missElapsed < 2500, `uncached product list waited ${missElapsed}ms for counts`);
});

test("checkout stock mutations invalidate employee product pages and stock summaries", () => {
  const paymentPath = fileURLToPath(new URL("../src/controllers/paymentController.js", import.meta.url));
  const storePath = fileURLToPath(new URL("../src/routes/storeRoutes.js", import.meta.url));
  for (const file of [paymentPath, storePath]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /delete\(["']product_stock_counts["']\)[\s\S]{0,160}invalidatePrefix\(["']admin_products:["']\)/);
  }
  const paymentSource = fs.readFileSync(paymentPath, "utf8");
  assert.ok((paymentSource.match(/invalidatePrefix\(["']admin_products:["']\)/g) || []).length >= 2,
    "both payment finalization and payment reconciliation must invalidate inventory pages");
});

test("Redis read hit is discarded if local invalidation arrives while GET is pending", async () => {
  let releaseGet;
  let generations = ["1", "1"];
  const redis = {
    mget: async () => generations,
    get: () => new Promise((resolve) => { releaseGet = resolve; }),
    psetex: async () => "OK",
  };
  const cache = new MemoryCache({
    redisProvider: () => redis,
    subscriberProvider: () => null,
    redisConfiguredCheck: () => true,
    redisActiveCheck: () => true,
    generationReader: async () => generations,
  });

  const pending = cache.getOrFetch("inventory:product:1", async () => "fresh-from-upstream", 5000);
  while (!releaseGet) await new Promise((resolve) => setTimeout(resolve, 0));
  cache._invalidateLocal("key", "inventory:product:1");
  releaseGet(JSON.stringify("stale-redis-value"));

  assert.equal(await pending, "fresh-from-upstream");
  assert.equal(cache.get("inventory:product:1"), "fresh-from-upstream");
});

test("Redis generation bump before Pub/Sub delivery invalidates a pending Redis hit", async () => {
  let releaseGet;
  let generations = ["1", "1"];
  const redis = {
    mget: async () => generations,
    get: () => new Promise((resolve) => { releaseGet = resolve; }),
    psetex: async () => "OK",
  };
  const cache = new MemoryCache({
    redisProvider: () => redis,
    subscriberProvider: () => null,
    redisConfiguredCheck: () => true,
    redisActiveCheck: () => true,
    generationReader: async () => generations,
  });

  const pending = cache.getOrFetch("inventory:product:2", async () => "fresh-after-generation", 5000);
  while (!releaseGet) await new Promise((resolve) => setTimeout(resolve, 0));
  generations = ["1", "2"];
  releaseGet(JSON.stringify("stale-old-generation"));

  assert.equal(await pending, "fresh-after-generation");
  assert.equal(cache.get("inventory:product:2"), "fresh-after-generation");
});
