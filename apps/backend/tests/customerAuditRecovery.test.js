import test from "node:test";
import assert from "node:assert/strict";
import api from "../src/config/woocommerce.js";
import { getFavorites } from "../src/controllers/favoritesController.js";
import { getCustomerOrders } from "../src/controllers/orderController.js";
import { fetchProducts, fetchProductsByIds } from "../src/services/productService.js";

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, setHeader() {}, json(body) { this.body = body; return this; } });

test("wishlist hydration failure is explicitly degraded", async () => {
  const original = api.get;
  try {
    api.get = async (path) => {
      if (path.startsWith("customers/")) return { data: { meta_data: [{ key: "mumbai_favorites", value: [11, 12] }] } };
      throw new Error("catalog unavailable");
    };
    const res = response();
    await getFavorites({ user: { id: 812341 }, query: { page: 2, per_page: 1 } }, res);
    assert.equal(res.body.degraded, true);
  } finally { api.get = original; }
});

test("order history outage does not return a successful empty list", async () => {
  const original = api.get;
  try {
    api.get = async () => { throw new Error("store unavailable"); };
    const res = response();
    await getCustomerOrders({ wpUserId: 812342, query: {}, headers: {} }, res);
    assert.equal(res.body.success, false);
    assert.ok(res.statusCode >= 500);
  } finally { api.get = original; }
});

test("catalog cards request product type for variable-product guard", async () => {
  const original = api.get;
  try {
    api.get = async (_path, params) => {
      assert.ok(params._fields.split(",").includes("type"));
      return { data: [], headers: {} };
    };
    await fetchProducts();
  } finally { api.get = original; }
});

test("fetchProductsByIds requests catalog_visibility and excludes hidden published products", async () => {
  const original = api.get;
  try {
    api.get = async (_path, params) => {
      const requestedFields = new Set(String(params._fields || "").split(","));
      assert.ok(requestedFields.has("catalog_visibility"));
      const project = (obj) =>
        Object.fromEntries(Object.entries(obj).filter(([k]) => requestedFields.has(k)));
      return {
        data: [
          project({ id: 101, name: "Visible Toy", status: "publish", catalog_visibility: "visible" }),
          project({ id: 102, name: "Hidden Toy", status: "publish", catalog_visibility: "hidden" }),
        ],
      };
    };
    const items = await fetchProductsByIds([101, 102]);
    assert.deepEqual(items.map((p) => p.id), [101]);
  } finally { api.get = original; }
});

test("fetchProducts rejects an upstream catalog visibility mismatch instead of corrupting pagination", async () => {
  const original = api.get;
  try {
    api.get = async (_path, params) => {
      assert.equal(params.mumbai_catalog_only, "1");
      assert.ok(String(params._fields || "").split(",").includes("catalog_visibility"));
      return {
        data: [
          { id: 201, name: "Shown", status: "publish", catalog_visibility: "visible" },
          { id: 202, name: "Hidden", status: "publish", catalog_visibility: "hidden" },
        ],
        headers: { "x-wp-total": "2", "x-wp-totalpages": "1" },
      };
    };
    await assert.rejects(
      fetchProducts(1, 20),
      /outside the requested catalog visibility filter/
    );
  } finally { api.get = original; }
});

test("formatted customer orders include safe payment and delivery metadata while stripping internal keys", async () => {
  const original = api.get;
  try {
    api.get = async () => ({
      data: [
        {
          id: 9001,
          customer_id: 812349,
          number: "9001",
          status: "pending",
          total: "599.00",
          date_created: "2026-11-18T04:00:00",
          line_items: [],
          meta_data: [
            { key: "_razorpay_order_id", value: "order_RzpSafe123" },
            { key: "_scheduled_delivery_date", value: "2026-11-19" },
            { key: "_scheduled_delivery_label", value: "Tomorrow from 9:00 AM" },
            { key: "_payment_captured_without_delivery_slot", value: "yes" },
            { key: "_internal_staff_audit_note", value: "CONFIDENTIAL" },
          ],
        },
      ],
      headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
    });
    const res = response();
    await getCustomerOrders({ wpUserId: 812349, query: {}, headers: {} }, res);
    assert.equal(res.body.success, true);
    const order = res.body.orders[0];
    assert.equal(order.razorpay_order_id, "order_RzpSafe123");
    const keys = order.meta_data.map((m) => m.key);
    assert.ok(keys.includes("_razorpay_order_id"));
    assert.ok(keys.includes("_scheduled_delivery_date"));
    assert.ok(keys.includes("_scheduled_delivery_label"));
    assert.ok(keys.includes("_payment_captured_without_delivery_slot"));
    assert.ok(!keys.includes("_internal_staff_audit_note"));
  } finally { api.get = original; }
});
