import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import api from "../src/config/woocommerce.js";
import wp from "../src/services/wordpress.js";
import { serverCache } from "../src/utils/memoryCache.js";
import { getEmployeeOverview, getEmployeeOrders } from "../src/controllers/employeeController.js";
import { formatOverviewOrderItem } from "../src/utils/employeeOrderFormatter.js";

test("dashboard preview exposes whether delivery arrangements need review", () => {
  const order = { id: 1, payment_method: "cod", meta_data: [{ key: "_payment_captured_without_delivery_slot", value: "yes" }] };
  assert.equal(formatOverviewOrderItem(order, "packed").delivery_review_required, true);
  assert.equal(formatOverviewOrderItem({ ...order, meta_data: [] }, "packed").delivery_review_required, false);
});

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  set() { return this; },
  json(body) { this.body = body; return this; },
});

test("dashboard completion count uses the same IST completion query as its drilldown", async () => {
  const saved = { apiGet: api.get, wpGet: wp.get, axiosGet: axios.get, getOrFetch: serverCache.getOrFetch };
  const calls = [];
  try {
    serverCache.getOrFetch = async (_key, fetch) => fetch();
    api.get = async (path, params) => path === "products"
      ? { data: [], headers: { "x-wp-total": "0" } }
      : { data: [], headers: { "x-wp-total": "0" } };
    axios.get = async () => ({ data: { success: true, counts: { all: 0, instock: 0, onbackorder: 0, outofstock: 0, lowstock: 0 } } });
    wp.get = async (path, config) => {
      if (path.endsWith('/summary')) return { data: { counts: { processing: 0, packed: 0, "out-for-delivery": 0, dispatched: 0 } } };
      calls.push(config.params);
      return { data: { success: true, date_basis: "completed", total: 2, total_pages: 1, orders: [] } };
    };
    const overview = response();
    await getEmployeeOverview({ headers: {} }, overview);
    assert.equal(overview.body.data.summary.completedToday, 2);
    const list = response();
    await getEmployeeOrders({ headers: {}, query: { status: "completed", date_filter: "today", date_basis: "completed" } }, list);
    assert.equal(list.body.total, 2);
    assert.equal(calls.length, 2);
    for (const field of ["status", "date_basis", "after", "before"]) assert.equal(calls[0][field], calls[1][field]);
  } finally {
    api.get = saved.apiGet; wp.get = saved.wpGet; axios.get = saved.axiosGet; serverCache.getOrFetch = saved.getOrFetch;
  }
});

test("malformed operational summary is reported as unavailable instead of a partial count", async () => {
  const saved = { apiGet: api.get, wpGet: wp.get, axiosGet: axios.get, getOrFetch: serverCache.getOrFetch };
  try {
    serverCache.getOrFetch = async (_key, fetch) => fetch();
    api.get = async () => ({ data: [], headers: { "x-wp-total": "0" } });
    axios.get = async () => ({ data: { success: true, counts: { all: 0, instock: 0, onbackorder: 0, outofstock: 0, lowstock: 0 } } });
    wp.get = async (path) => path.endsWith("/summary")
      ? { data: { counts: {} } }
      : { data: { success: true, date_basis: "completed", total: 0, total_pages: 1, orders: [] } };
    const res = response();
    await getEmployeeOverview({ headers: {} }, res);
    assert.equal(res.body.data.summary.ordersToPack, null);
    assert.ok(res.body.data.unavailable_sections.includes("order_summary"));
  } finally {
    api.get = saved.apiGet; wp.get = saved.wpGet; axios.get = saved.axiosGet; serverCache.getOrFetch = saved.getOrFetch;
  }
});

test("completion drilldown fails closed when the WordPress plugin lacks completion filtering", async () => {
  const saved = wp.get;
  try {
    wp.get = async () => ({ data: { success: true, total: 0, orders: [] } });
    const res = response();
    await getEmployeeOrders({ headers: {}, query: { status: "completed", date_filter: "today", date_basis: "completed" } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
  } finally { wp.get = saved; }
});
