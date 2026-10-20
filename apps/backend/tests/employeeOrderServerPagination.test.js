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
