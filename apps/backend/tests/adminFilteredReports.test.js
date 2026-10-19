import test from "node:test";
import assert from "node:assert/strict";

test("Admin filtered reports", async (t) => {
  const { getAdminAnalyticsReport } = await import("../src/controllers/adminAnalyticsController.js");
  const { getAdminCustomerOrders } = await import("../src/controllers/adminCustomerController.js");
  const { default: wp } = await import("../src/services/wordpress.js");
  const { serverCache } = await import("../src/utils/memoryCache.js");
  const originalGet = wp.get;
  t.after(async () => {
    wp.get = originalGet;
    const { redisClient } = await import("../src/config/redis.js");
    if (redisClient) {
      try {
        redisClient.disconnect();
      } catch {}
    }
  });

  await t.test("rejects invalid date ranges without querying WordPress", async () => {
    let called = false;
    wp.get = async () => { called = true; };
    let response;
    const res = { status(code) { this.code = code; return this; }, json(body) { response = body; } };

    await getAdminAnalyticsReport({ query: { date_from: "2026-02-30", date_to: "2026-03-01" } }, res);

    assert.equal(res.code, 400);
    assert.equal(called, false);
    assert.equal(response.success, false);
  });

  await t.test("converts IST dates to exclusive UTC bounds and forwards the product filter", async () => {
    const key = "admin:analytics:report:2026-10-01:2026-10-31:42";
    serverCache.delete(key);
    let request;
    const payload = { success: true, data: { summary: { revenue: 1250 }, products: [] } };
    wp.get = async (path, config) => {
      request = { path, config };
      return { data: payload };
    };
    let response;
    const res = { set() {}, json(body) { response = body; } };

    await getAdminAnalyticsReport({ query: { date_from: "2026-10-01", date_to: "2026-10-31", product_id: 42 } }, res);

    assert.equal(request.path, "/wp-json/mumbai-auth/v1/admin/analytics-report");
    assert.equal(request.config.params.date_after, "2026-09-30T18:30:00.000Z");
    assert.equal(request.config.params.date_before, "2026-10-31T18:30:00.000Z");
    assert.equal(request.config.params.product_id, 42);
    assert.deepEqual(response, payload);
    serverCache.delete(key);
  });

  await t.test("requests a customer's selected order-history page", async () => {
    let request;
    const payload = { success: true, page: 2, totalPages: 3, total: 24, orders: [{ id: 9 }] };
    wp.get = async (path, config) => {
      request = { path, config };
      return { data: payload };
    };
    let response;
    const res = { set() {}, json(body) { response = body; } };

    await getAdminCustomerOrders({ params: { id: "73" }, query: { page: "2", per_page: "10" } }, res);

    assert.equal(request.path, "/wp-json/mumbai-auth/v1/admin/customers/73/orders");
    assert.deepEqual(request.config.params, { page: 2, per_page: 10 });
    assert.deepEqual(response, payload);
  });

  await t.test("falls back to WooCommerce Core REST orders when WordPress endpoint is unrouted or fails", async () => {
    const { default: api } = await import("../src/config/woocommerce.js");
    const originalApiGet = api.get;
    t.after(() => { api.get = originalApiGet; });

    wp.get = async () => {
      const err = new Error("Not Found");
      err.response = { status: 404, data: { code: "rest_no_route", message: "No route was found matching the URL and request method." } };
      throw err;
    };

    let wcParams;
    api.get = async (endpoint, params) => {
      wcParams = { endpoint, params };
      return {
        data: [
          {
            id: 440,
            number: "440",
            total: "637.00",
            status: "completed",
            date_created_gmt: "2026-10-17T10:24:11",
            payment_method_title: "Cash on delivery",
            line_items: [
              { product_id: 225, name: "Portronics charger", quantity: 3, total: "597.00" }
            ]
          }
        ],
        headers: {
          "x-wp-total": "1",
          "x-wp-totalpages": "1"
        }
      };
    };

    let response;
    const res = { set() {}, json(body) { response = body; } };
    await getAdminCustomerOrders({ params: { id: "77" }, query: { page: "1", per_page: "10" } }, res);

    assert.equal(wcParams.endpoint, "orders");
    assert.equal(wcParams.params.customer, 77);
    assert.equal(response.success, true);
    assert.equal(response.total, 1);
    assert.equal(response.orders[0].id, 440);
    assert.equal(response.orders[0].items[0].name, "Portronics charger");
    assert.equal(response.orders[0].items[0].quantity, 3);
  });
});
