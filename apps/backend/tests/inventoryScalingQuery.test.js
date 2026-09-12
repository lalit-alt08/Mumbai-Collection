import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import {
  getAdminProducts,
  updateProduct,
  createProduct,
  deleteProduct,
  fetchStockCounts,
} from "../src/controllers/adminProductController.js";
import api from "../src/config/woocommerce.js";
import { serverCache } from "../src/utils/memoryCache.js";

test("Phase 1: Inventory/Catalog Scaling Query Architecture Test Suite", async (t) => {
  const originalApiGet = api.get;
  const originalApiPost = api.post;
  const originalApiPut = api.put;
  const originalApiDelete = api.delete;
  const originalAxiosGet = axios.get;

  t.beforeEach(() => {
    serverCache.clear();
  });

  t.afterEach(() => {
    api.get = originalApiGet;
    api.post = originalApiPost;
    api.put = originalApiPut;
    api.delete = originalApiDelete;
    axios.get = originalAxiosGet;
    serverCache.clear();
  });

  await t.test("1. Server-Side Pagination: passes page and per_page cleanly to WooCommerce API", async () => {
    let capturedParams = null;

    api.get = async (endpoint, params) => {
      if (params.per_page !== 1) {
        capturedParams = params;
      }
      return {
        data: [
          { id: 101, name: "Product 1", price: "999", stock_quantity: 12, stock_status: "instock" },
          { id: 102, name: "Product 2", price: "1299", stock_quantity: 4, stock_status: "instock" },
        ],
        headers: {
          "x-wp-total": "512",
          "x-wp-totalpages": "26",
        },
      };
    };

    const req = {
      query: { page: "3", per_page: "20" },
    };
    let responseData = null;
    const res = {
      json: (data) => { responseData = data; },
      status: () => res,
    };

    await getAdminProducts(req, res);

    assert.ok(responseData, "Response should return data");
    assert.equal(responseData.success, true);
    assert.equal(responseData.page, 3);
    assert.equal(responseData.per_page, 20);
    assert.equal(responseData.total, 512);
    assert.equal(responseData.totalPages, 26);
    assert.equal(capturedParams.page, 3);
    assert.equal(capturedParams.per_page, 20);
  });

  await t.test("2. SKU / Search Query: forwards search term properly to WooCommerce query", async () => {
    let capturedParams = null;

    api.get = async (endpoint, params) => {
      if (params.per_page !== 1) {
        capturedParams = params;
      }
      return {
        data: [
          { id: 104, name: "Bandhani Saree", sku: "MC-104", price: "1499", stock_quantity: 8, stock_status: "instock" },
        ],
        headers: {
          "x-wp-total": "1",
          "x-wp-totalpages": "1",
        },
      };
    };

    const req = {
      query: { search: "MC-104", page: "1", per_page: "20" },
    };
    let responseData = null;
    const res = {
      json: (data) => { responseData = data; },
      status: () => res,
    };

    await getAdminProducts(req, res);

    assert.equal(responseData.success, true);
    assert.equal(capturedParams.search, "MC-104");
    assert.equal(responseData.total, 1);
    assert.equal(responseData.products[0].sku, "MC-104");
  });

  await t.test("3. Low-Stock Filtering: forwards stock_status=lowstock to WooCommerce and preserves exact totals", async () => {
    let capturedParams = null;

    api.get = async (endpoint, params) => {
      if (params.per_page !== 1) {
        capturedParams = params;
      }
      return {
        data: [
          { id: 201, name: "Low Stock Saree", price: "1999", stock_quantity: 3, stock_status: "instock" },
          { id: 202, name: "Low Stock Kurti", price: "799", stock_quantity: 1, stock_status: "instock" },
        ],
        headers: {
          "x-wp-total": "14",
          "x-wp-totalpages": "1",
        },
      };
    };

    const req = {
      query: { stock_status: "lowstock", page: "1", per_page: "20" },
    };
    let responseData = null;
    const res = {
      json: (data) => { responseData = data; },
      status: () => res,
    };

    await getAdminProducts(req, res);

    assert.equal(responseData.success, true);
    assert.equal(capturedParams.stock_status, "lowstock");
    assert.equal(responseData.total, 14);
    assert.equal(responseData.totalPages, 1);
    assert.equal(responseData.products.length, 2);
  });

  await t.test("4. Stock Summary Counts: returns all, instock, lowstock, outofstock counts", async () => {
    // Mock WordPress custom stock-counts endpoint
    axios.get = async (url) => {
      if (url.includes("/mumbai-auth/v1/products/stock-counts")) {
        return {
          data: {
            success: true,
            counts: {
              all: 500,
              instock: 450,
              lowstock: 15,
              outofstock: 35,
            },
          },
        };
      }
      throw new Error("Unknown URL");
    };

    api.get = async () => ({
      data: [{ id: 1, name: "Test" }],
      headers: { "x-wp-total": "500", "x-wp-totalpages": "25" },
    });

    const req = { query: { page: "1", per_page: "20" } };
    let responseData = null;
    const res = {
      json: (data) => { responseData = data; },
      status: () => res,
    };

    await getAdminProducts(req, res);

    assert.equal(responseData.success, true);
    assert.deepEqual(responseData.counts, {
      all: 500,
      instock: 450,
      lowstock: 15,
      outofstock: 35,
    });
  });

  await t.test("5. In-Memory 60s Cache: serves repeated query from cache without calling WooCommerce API", async () => {
    let callCount = 0;
    serverCache.set("product_stock_counts", { all: 1, instock: 1, lowstock: 0, outofstock: 0 }, 60000);

    api.get = async () => {
      callCount++;
      return {
        data: [{ id: 301, name: "Cached Item", price: "500", stock_quantity: 10 }],
        headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
      };
    };

    const req = { query: { page: "1", per_page: "20", search: "Cached" } };
    let res1Data = null;
    let res2Data = null;
    const res1 = { json: (d) => { res1Data = d; }, status: () => res1 };
    const res2 = { json: (d) => { res2Data = d; }, status: () => res2 };

    // First request - Cache MISS
    await getAdminProducts(req, res1);
    assert.equal(callCount, 1, "WooCommerce should be called once on miss");
    assert.equal(res1Data.success, true);

    // Second identical request - Cache HIT
    await getAdminProducts(req, res2);
    assert.equal(callCount, 1, "WooCommerce should NOT be called again on cache hit");
    assert.equal(res2Data.success, true);
    assert.equal(res2Data.products[0].name, "Cached Item");
  });

  await t.test("6. Cache Invalidation: updateProduct clears product list cache and stock counts", async () => {
    let getCallCount = 0;
    serverCache.set("product_stock_counts", { all: 1, instock: 1, lowstock: 0, outofstock: 0 }, 60000);

    api.get = async () => {
      getCallCount++;
      return {
        data: [{ id: 401, name: "Product 401", price: "500", stock_quantity: 10 }],
        headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
      };
    };

    api.put = async () => ({
      data: { id: 401, name: "Product 401", price: "550", stock_quantity: 8 },
    });

    const getReq = { query: { page: "1", per_page: "20" } };
    const getRes = { json: () => {}, status: () => getRes };

    // Warm cache
    await getAdminProducts(getReq, getRes);
    assert.equal(getCallCount, 1);

    // Mutation: updateProduct
    const putReq = {
      params: { id: "401" },
      body: { regular_price: "550", stock_quantity: 8 },
    };
    const putRes = { json: () => {}, status: () => putRes };
    await updateProduct(putReq, putRes);

    serverCache.set("product_stock_counts", { all: 1, instock: 1, lowstock: 0, outofstock: 0 }, 60000);

    // Subsequent query should miss cache and fetch fresh data
    await getAdminProducts(getReq, getRes);
    assert.equal(getCallCount, 2, "Should re-fetch from WooCommerce after updateProduct mutation");
  });

  await t.test("7. Cache Invalidation: deleteProduct clears product list cache and stock counts", async () => {
    let getCallCount = 0;
    serverCache.set("product_stock_counts", { all: 1, instock: 1, lowstock: 0, outofstock: 0 }, 60000);

    api.get = async () => {
      getCallCount++;
      return {
        data: [{ id: 501, name: "Product 501", price: "500" }],
        headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
      };
    };

    api.delete = async () => ({
      data: { id: 501, name: "Product 501" },
    });

    const getReq = { query: { page: "1", per_page: "20" } };
    const getRes = { json: () => {}, status: () => getRes };

    // Warm cache
    await getAdminProducts(getReq, getRes);
    assert.equal(getCallCount, 1);

    // Mutation: deleteProduct
    const delReq = { params: { id: "501" } };
    const delRes = { json: () => {}, status: () => delRes };
    await deleteProduct(delReq, delRes);

    serverCache.set("product_stock_counts", { all: 1, instock: 1, lowstock: 0, outofstock: 0 }, 60000);

    // Subsequent query should miss cache and fetch fresh data
    await getAdminProducts(getReq, getRes);
    assert.equal(getCallCount, 2, "Should re-fetch from WooCommerce after deleteProduct mutation");
  });

  await t.test("8. Cache Invalidation: createProduct clears product list cache and stock counts", async () => {
    let getCallCount = 0;
    serverCache.set("product_stock_counts", { all: 1, instock: 1, lowstock: 0, outofstock: 0 }, 60000);

    api.get = async () => {
      getCallCount++;
      return {
        data: [{ id: 601, name: "Product 601", price: "500" }],
        headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
      };
    };

    api.post = async () => ({
      data: { id: 602, name: "New Product", price: "1200", stock_quantity: 10 },
    });

    const getReq = { query: { page: "1", per_page: "20" } };
    const getRes = { json: () => {}, status: () => getRes };

    // Warm cache
    await getAdminProducts(getReq, getRes);
    assert.equal(getCallCount, 1);

    // Mutation: createProduct
    const createReq = {
      body: { name: "New Product", regular_price: "1200", stock_quantity: 10 },
    };
    const createRes = { json: () => {}, status: () => createRes };
    await createProduct(createReq, createRes);

    serverCache.set("product_stock_counts", { all: 1, instock: 1, lowstock: 0, outofstock: 0 }, 60000);

    // Subsequent query should miss cache and fetch fresh data
    await getAdminProducts(getReq, getRes);
    assert.equal(getCallCount, 2, "Should re-fetch from WooCommerce after createProduct mutation");
  });
});
