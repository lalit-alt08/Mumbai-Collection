import test from "node:test";
import assert from "node:assert/strict";
import api from "../src/config/woocommerce.js";
import wp from "../src/services/wordpress.js";
import { getEmployeeOrders } from "../src/controllers/employeeController.js";

test("custom employee order statuses use WooCommerce-side pagination", async () => {
  const originalWpGet = wp.get;
  const originalApiGet = api.get;
  const calls = [];
  let responseBody;

  wp.get = async (path, config) => {
    calls.push({ path, params: config.params });
    return {
      data: {
        success: true,
        orders: [{
          id: 901,
          number: "901",
          status: "processing",
          total: "199.00",
          date_created: "2026-10-20T10:00:00",
          billing: { first_name: "Test", last_name: "Customer", email: "test@example.com", phone: "9876543210" },
          shipping: { city: "Vasai East" },
          line_items: [],
          meta_data: [{ key: "_delivery_status", value: "packed" }],
          payment_method_title: "Cash on Delivery",
        }],
        total: 61,
        total_pages: 4,
      },
    };
  };
  api.get = async () => {
    throw new Error("WooCommerce REST fallback should not be called for this query");
  };

  const req = {
    query: { status: "packed", page: "3", per_page: "20" },
    headers: {},
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
  };

  try {
    await getEmployeeOrders(req, res);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/wp-json/mumbai-auth/v1/employee/orders");
    assert.deepEqual(calls[0].params, { status: "packed", page: 3, per_page: 20 });
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.total, 61);
    assert.equal(responseBody.totalPages, 4);
    assert.equal(responseBody.orders[0].id, 901);
    assert.equal(responseBody.orders[0].status, "packed");
  } finally {
    wp.get = originalWpGet;
    api.get = originalApiGet;
  }
});

test("employee location filters are sent to the server-side paginated endpoint", async () => {
  const originalWpGet = wp.get;
  const originalApiGet = api.get;
  const calls = [];
  let responseBody;

  wp.get = async (path, config) => {
    calls.push({ path, params: config.params });
    return { data: { success: true, orders: [], total: 0, total_pages: 1 } };
  };
  api.get = async () => {
    throw new Error("Location filters must not scan WooCommerce REST pages");
  };

  const req = {
    query: { status: "all", location: "vasai-east", page: "2", per_page: "20" },
    headers: {},
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
  };

  try {
    await getEmployeeOrders(req, res);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/wp-json/mumbai-auth/v1/employee/orders");
    assert.deepEqual(calls[0].params, { status: "all", location: "vasai-east", page: 2, per_page: 20 });
    assert.equal(responseBody.success, true);
    assert.deepEqual(responseBody.orders, []);
  } finally {
    wp.get = originalWpGet;
    api.get = originalApiGet;
  }
});

test("location filters fail safely rather than scanning all orders without HPOS support", async () => {
  const originalWpGet = wp.get;
  const originalApiGet = api.get;
  let responseBody;

  wp.get = async () => {
    const error = new Error("HPOS is required");
    error.response = { status: 501, data: { code: "hpos_required", message: "HPOS is required" } };
    throw error;
  };
  api.get = async () => {
    throw new Error("Must not scan all WooCommerce orders for a location filter");
  };

  const req = { query: { status: "all", location: "vasai-east" }, headers: {} };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
  };

  try {
    await getEmployeeOrders(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(responseBody.success, false);
    assert.match(responseBody.message, /updated WooCommerce plugin with HPOS/i);
  } finally {
    wp.get = originalWpGet;
    api.get = originalApiGet;
  }
});
