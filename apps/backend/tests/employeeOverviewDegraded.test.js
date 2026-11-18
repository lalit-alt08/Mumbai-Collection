import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import api from "../src/config/woocommerce.js";
import wp from "../src/services/wordpress.js";
import { serverCache } from "../src/utils/memoryCache.js";
import { getEmployeeOverview, getEmployeeOrders } from "../src/controllers/employeeController.js";

test("overview reports unknown sections rather than caching outage zeros", async () => {
  const originalApi = api.get, originalWp = wp.get, originalAxios = axios.get;
  api.get = wp.get = axios.get = async () => { throw new Error("internal path C:/private/db"); };
  serverCache.delete("employee:overview");
  serverCache.delete("admin:product-stock-counts");
  let body;
  const res = { json(value) { body = value; return this; }, status() { return this; }, set() {} };
  try {
    await getEmployeeOverview({ headers: {} }, res);
    assert.equal(body.success, true);
    assert.equal(body.data.is_degraded, true);
    assert.equal(body.data.summary.ordersToPack, null);
    assert.equal(body.data.summary.receivedToday, null);
    assert.equal(body.data.summary.lowStockCount, null);
    assert.equal(serverCache.get("employee:overview"), null);
    assert.equal(JSON.stringify(body).includes("C:/private"), false);
  } finally {
    api.get = originalApi; wp.get = originalWp; axios.get = originalAxios;
    serverCache.delete("employee:overview");
  }
});

test("order error responses do not disclose internal error messages", async () => {
  const originalApi = api.get;
  api.get = async () => { const error = new Error("C:/private/database.sql"); error.response = { status: 400 }; throw error; };
  let body;
  const res = { status() { return this; }, json(value) { body = value; return this; } };
  try {
    await getEmployeeOrders({ query: {}, headers: {} }, res);
    assert.equal(body.success, false);
    assert.equal(body.message.includes("C:/private"), false);
  } finally { api.get = originalApi; }
});

test("degraded overview still transforms available low-stock images", async () => {
  const originalApi = api.get, originalWp = wp.get;
  api.get = async (path) => {
    if (path === "products") return { data: [{ id: 10, name: "Item", images: [{ src: "http://localhost:10004/wp-content/uploads/item.jpg" }], stock_quantity: 3 }] };
    throw new Error("Orders unavailable");
  };
  wp.get = async () => { throw new Error("Unavailable"); };
  serverCache.delete("employee:overview");
  let body;
  const res = { json(value) { body = value; return this; }, status() { return this; }, set() { return this; } };
  try {
    await getEmployeeOverview({ headers: { "x-forwarded-host": "api.example", "x-forwarded-proto": "https" } }, res);
    assert.equal(body.data.is_degraded, true);
    assert.equal(body.data.lowStockProducts[0].image, "https://api.example/api/media/uploads/item.jpg");
  } finally {
    api.get = originalApi;
    wp.get = originalWp;
    serverCache.delete("employee:overview");
  }
});
