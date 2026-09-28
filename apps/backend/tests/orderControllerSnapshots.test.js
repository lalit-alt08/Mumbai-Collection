import { fileURLToPath } from "url";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import api from "../src/config/woocommerce.js";
import { getCustomerOrders, getOrderById } from "../src/controllers/orderController.js";
import { ERROR_CODE_HTTP_STATUS } from "../src/utils/errorCodes.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/orderSnapshots.json", import.meta.url));
const baselineSnapshots = JSON.parse(fs.readFileSync(fixturesPath, "utf-8"));

const capture = async (fn, req) => {
  let statusCode = 200;
  let body = null;
  const res = {
    status(c) {
      if (typeof c !== "number" || c < 100 || c > 999) {
        throw new TypeError(`Invalid status code: "${c}". Status code must be an integer.`);
      }
      statusCode = c;
      return this;
    },
    json(b) {
      body = b;
      return this;
    },
  };
  await fn(req, res);
  return { statusCode, body };
};

test("Phase 1: orderController Snapshot Diff and Error Code Coverage", async (t) => {
  const originalApiGet = api.get;

  t.afterEach(() => {
    api.get = originalApiGet;
  });

  await t.test("1. Error Codes Coverage: All error codes map to valid HTTP integers", () => {
    for (const [code, status] of Object.entries(ERROR_CODE_HTTP_STATUS)) {
      assert.ok(typeof code === "string" && code.length > 0, "Code must be non-empty string");
      assert.ok(Number.isInteger(status) && status >= 400 && status <= 599, `Status for ${code} must be integer 400-599`);
    }
  });

  await t.test("2. getCustomerOrders: Unauthenticated matches baseline snapshot", async () => {
    const current = await capture(getCustomerOrders, { query: {} });
    const baseline = baselineSnapshots.getCustomerOrders_unauth;

    assert.equal(current.statusCode, baseline.statusCode, "HTTP status code must match exactly (401)");
    assert.equal(current.body.success, baseline.body.success);
    assert.equal(current.body.message, baseline.body.message);
    assert.deepEqual(current.body.orders, baseline.body.orders);
    assert.equal(current.body.code, "AUTH_REQUIRED", "Added code field must be AUTH_REQUIRED");
  });

  await t.test("3. getCustomerOrders: Success matches baseline snapshot exactly", async () => {
    api.get = async (endpoint) => {
      if (endpoint === "customers/10") return { data: { email: "test@example.com" } };
      if (endpoint === "orders") {
        return {
          data: [
            {
              id: 101,
              status: "processing",
              date_created: "2026-09-28T12:00:00",
              total: "500.00",
              customer_id: 10,
              billing: { first_name: "John", last_name: "Doe", email: "test@example.com" },
              line_items: [{ id: 1, name: "Shirt", price: 500, quantity: 1 }],
            },
          ],
          headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
        };
      }
      return { data: {} };
    };

    const current = await capture(getCustomerOrders, { wpUserId: 10, query: {} });
    const baseline = baselineSnapshots.getCustomerOrders_success;

    assert.equal(current.statusCode, baseline.statusCode, "HTTP status code must match exactly (200)");
    assert.equal(current.body.success, baseline.body.success);
    assert.equal(current.body.total, baseline.body.total);
    assert.equal(current.body.count, baseline.body.count);
    assert.equal(current.body.orders[0].id, baseline.body.orders[0].id);
    assert.equal(current.body.orders[0].status, baseline.body.orders[0].status);
  });

  await t.test("4. getOrderById: Unauthenticated matches baseline snapshot", async () => {
    const current = await capture(getOrderById, { params: { id: "101" } });
    const baseline = baselineSnapshots.getOrderById_unauth;

    assert.equal(current.statusCode, baseline.statusCode, "HTTP status code must match exactly (401)");
    assert.equal(current.body.success, baseline.body.success);
    assert.equal(current.body.message, baseline.body.message);
    assert.equal(current.body.code, "AUTH_REQUIRED", "Added code field must be AUTH_REQUIRED");
  });

  await t.test("5. getOrderById: Not Found matches baseline snapshot", async () => {
    api.get = async () => ({ data: null });
    const current = await capture(getOrderById, { wpUserId: 10, params: { id: "999" } });
    const baseline = baselineSnapshots.getOrderById_not_found;

    assert.equal(current.statusCode, baseline.statusCode, "HTTP status code must match exactly (404)");
    assert.equal(current.body.success, baseline.body.success);
    assert.equal(current.body.message, baseline.body.message);
    assert.equal(current.body.code, "ORDER_NOT_FOUND", "Added code field must be ORDER_NOT_FOUND");
  });

  await t.test("6. getOrderById: Forbidden matches baseline snapshot", async () => {
    api.get = async (endpoint) => {
      if (endpoint.startsWith("orders/")) {
        return { data: { id: 202, customer_id: 99, billing: { email: "other@example.com" } } };
      }
      if (endpoint.startsWith("customers/")) {
        return { data: { email: "test@example.com" } };
      }
      return { data: {} };
    };

    const current = await capture(getOrderById, { wpUserId: 10, params: { id: "202" } });
    const baseline = baselineSnapshots.getOrderById_forbidden;

    assert.equal(current.statusCode, baseline.statusCode, "HTTP status code must match exactly (403)");
    assert.equal(current.body.success, baseline.body.success);
    assert.equal(current.body.message, baseline.body.message);
    assert.equal(current.body.code, "FORBIDDEN_ORDER_ACCESS", "Added code field must be FORBIDDEN_ORDER_ACCESS");
  });

  await t.test("7. getOrderById: Success matches baseline snapshot exactly", async () => {
    api.get = async (endpoint) => {
      if (endpoint.startsWith("orders/")) {
        return {
          data: {
            id: 101,
            status: "processing",
            customer_id: 10,
            billing: { first_name: "John", last_name: "Doe", email: "test@example.com" },
            line_items: [],
          },
        };
      }
      return { data: {} };
    };

    const current = await capture(getOrderById, { wpUserId: 10, params: { id: "101" } });
    const baseline = baselineSnapshots.getOrderById_success;

    assert.equal(current.statusCode, baseline.statusCode, "HTTP status code must match exactly (200)");
    assert.equal(current.body.success, baseline.body.success);
    assert.equal(current.body.order.id, baseline.body.order.id);
    assert.equal(current.body.order.status, baseline.body.order.status);
  });

  await t.test("8. getOrderById: Upstream Error matches baseline snapshot", async () => {
    api.get = async () => {
      const err = new Error("Database error");
      err.response = { status: 500 };
      throw err;
    };

    const current = await capture(getOrderById, { wpUserId: 10, params: { id: "101" } });
    const baseline = baselineSnapshots.getOrderById_upstream_error;

    assert.equal(current.statusCode, baseline.statusCode, "HTTP status code must match exactly (500)");
    assert.equal(current.body.success, baseline.body.success);
    assert.equal(current.body.message, baseline.body.message);
    assert.equal(current.body.code, "INTERNAL_SERVER_ERROR", "Added code field must be INTERNAL_SERVER_ERROR");
  });
});
