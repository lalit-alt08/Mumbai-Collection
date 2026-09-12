import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import api from "../src/config/woocommerce.js";
import { serverCache } from "../src/utils/memoryCache.js";
import {
  matchesEmployeeOrderSearch,
  filterAndPaginateEmployeeOrders,
} from "../src/controllers/employeeController.js";
import { getAdminProducts } from "../src/controllers/adminProductController.js";

const makeOrder = (overrides = {}) => ({
  id: 101,
  number: "101",
  status: "processing",
  billing: {
    first_name: "Lalit",
    last_name: "Solanki",
    email: "lalit@example.com",
    phone: "+91 98765 43210",
  },
  shipping: {},
  meta_data: [],
  ...overrides,
});

test("Employee order search matches order number, name, email, and phone", () => {
  const order = makeOrder();
  assert.equal(matchesEmployeeOrderSearch(order, "101"), true);
  assert.equal(matchesEmployeeOrderSearch(order, "lalit solanki"), true);
  assert.equal(matchesEmployeeOrderSearch(order, "lalit@example.com"), true);
  assert.equal(matchesEmployeeOrderSearch(order, "9876543210"), true);
  assert.equal(matchesEmployeeOrderSearch(order, "unknown"), false);
  assert.equal(matchesEmployeeOrderSearch(order, "a"), true, "One-character searches are ignored");
});

test("Employee order search applies filters before totals and pagination", () => {
  const orders = [
    makeOrder({ id: 1, number: "1001", meta_data: [{ key: "_delivery_status", value: "packed" }] }),
    makeOrder({ id: 2, number: "1002", billing: { first_name: "Asha", last_name: "Patil", email: "asha@example.com", phone: "9000000000" } }),
    makeOrder({ id: 3, number: "1003", billing: { first_name: "Lalit", last_name: "Solanki", email: "lalit@example.com", phone: "9876543210" }, shipping: { city: "Vasai East" } }),
  ];

  const result = filterAndPaginateEmployeeOrders(orders, {
    search: "lalit",
    status: "processing",
    location: "vasai-east",
    page: 1,
    limit: 1,
  });

  assert.equal(result.total, 1);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.orders.map((order) => order.id), [3]);
});

test("Employee order search returns accurate empty results", () => {
  const result = filterAndPaginateEmployeeOrders([makeOrder()], {
    search: "does-not-exist",
    status: "all",
    location: "all",
    page: 1,
    limit: 20,
  });

  assert.equal(result.total, 0);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.orders, []);
});

test("Product search does not recalculate uncached stock counts", async () => {
  const originalApiGet = api.get;
  const originalAxiosGet = axios.get;
  serverCache.clear();

  let stockCountCalls = 0;
  api.get = async () => ({
    data: [{ id: 1, name: "Blue Saree", sku: "MC-1", stock_status: "instock" }],
    headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
  });
  axios.get = async (url) => {
    if (url.includes("/products/stock-counts")) stockCountCalls += 1;
    throw new Error("Stock counts should not be fetched for a search request");
  };

  try {
    let responseData;
    const res = { json: (data) => { responseData = data; }, status: () => res };
    await getAdminProducts({ query: { search: "saree", page: "1", per_page: "20" } }, res);
    assert.equal(responseData.success, true);
    assert.equal(stockCountCalls, 0);
  } finally {
    api.get = originalApiGet;
    axios.get = originalAxiosGet;
    serverCache.clear();
  }
});

test("Product search forwards name and SKU terms to WooCommerce search", async () => {
  const originalApiGet = api.get;
  const originalAxiosGet = axios.get;
  const queries = [];
  serverCache.clear();
  api.get = async (_path, params) => {
    queries.push(params);
    return { data: [], headers: { "x-wp-total": "0", "x-wp-totalpages": "0" } };
  };
  axios.get = async () => { throw new Error("Stock counts should not be fetched for a search request"); };

  try {
    const res = { json: () => {}, status: () => res };
    await getAdminProducts({ query: { search: "blue saree", page: "1", per_page: "20" } }, res);
    await getAdminProducts({ query: { search: "MC-123", page: "1", per_page: "20" } }, res);
    assert.equal(queries[0].search, "blue saree");
    assert.equal(queries[1].search, "MC-123");
  } finally {
    api.get = originalApiGet;
    axios.get = originalAxiosGet;
    serverCache.clear();
  }
});
