import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });
process.env.WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || "http://localhost";
process.env.WOOCOMMERCE_CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY || "ck_test";
process.env.WOOCOMMERCE_CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET || "cs_test";

const { default: api } = await import("../src/config/woocommerce.js");
const {
  updateOrderStatus,
  getEmployeeOrders,
  getOrderDeliveredTimestamp,
  isOrderStatusLocked,
} = await import("../src/controllers/employeeController.js");
const { updateAdminOrderStatus } = await import("../src/controllers/adminOrderController.js");
const { serverCache } = await import("../src/utils/memoryCache.js");

test("Backend Order Status 3-Day (72-Hour) Lock & Transition Test Suite", async (t) => {
  const originalApiGet = api.get;
  const originalApiPut = api.put;

  const BASE_TIME = new Date("2026-09-06T12:00:00.000Z").getTime();
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const THREE_DAYS_MS = 72 * ONE_HOUR_MS; // 259,200,000 ms
  const TWO_DAYS_23H_59M_MS = THREE_DAYS_MS - 60000; // 259,140,000 ms

  t.beforeEach(() => {
    serverCache.clear();
  });

  t.afterEach(() => {
    api.get = originalApiGet;
    api.put = originalApiPut;
    serverCache.clear();
  });

  await t.test("1. Helper getOrderDeliveredTimestamp respects priority and ignores date_modified", () => {
    // 1. _delivery_completed_at in meta_data
    const orderWithMeta = {
      status: "completed",
      meta_data: [{ key: "_delivery_completed_at", value: "2026-09-06T10:00:00.000Z" }],
      date_completed_gmt: "2026-09-05T00:00:00.000Z",
      date_completed: "2026-09-05T05:30:00",
    };
    assert.equal(
      getOrderDeliveredTimestamp(orderWithMeta),
      new Date("2026-09-06T10:00:00.000Z").getTime(),
      "meta _delivery_completed_at must have highest priority"
    );

    // 2. date_completed_gmt when no meta
    const orderWithGmt = {
      status: "completed",
      date_completed_gmt: "2026-09-06T08:00:00",
      date_completed: "2026-09-05T05:30:00",
    };
    assert.equal(
      getOrderDeliveredTimestamp(orderWithGmt),
      new Date("2026-09-06T08:00:00Z").getTime(),
      "date_completed_gmt must have second priority"
    );

    // 3. date_completed when no meta and no gmt
    const orderWithLocal = {
      status: "completed",
      date_completed: "2026-09-06T06:00:00Z",
    };
    assert.equal(
      getOrderDeliveredTimestamp(orderWithLocal),
      new Date("2026-09-06T06:00:00Z").getTime(),
      "date_completed must be third priority"
    );

    // 4. date_created_gmt fallback when no completed timestamp
    const orderWithCreatedGmt = {
      status: "completed",
      date_created_gmt: "2026-09-04T12:00:00Z",
    };
    assert.equal(
      getOrderDeliveredTimestamp(orderWithCreatedGmt),
      new Date("2026-09-04T12:00:00Z").getTime(),
      "date_created_gmt must be fourth priority"
    );

    // 5. date_created fallback when no gmt created timestamp
    const orderWithCreated = {
      status: "completed",
      date_created: "2026-09-04T12:00:00",
    };
    assert.equal(
      getOrderDeliveredTimestamp(orderWithCreated),
      new Date("2026-09-04T12:00:00").getTime(),
      "date_created must be fifth priority"
    );

    // 6. Must NOT use date_modified
    const orderWithOnlyModified = {
      status: "completed",
      date_modified: "2026-09-01T00:00:00Z",
      date_modified_gmt: "2026-09-01T00:00:00Z",
    };
    assert.equal(
      getOrderDeliveredTimestamp(orderWithOnlyModified),
      null,
      "date_modified must never be used as delivery timestamp"
    );
  });

  await t.test("2. isOrderStatusLocked: evaluates exact boundary conditions", () => {
    // 2 days 23h 59m ago (71h 59m = 259,140,000 ms) => editable
    const order2d23h59m = {
      status: "completed",
      meta_data: [{ key: "_delivery_completed_at", value: new Date(BASE_TIME - TWO_DAYS_23H_59M_MS).toISOString() }],
    };
    assert.equal(isOrderStatusLocked(order2d23h59m, BASE_TIME), false, "Order at 2 days 23h 59m must still be editable");

    // Exactly 3 days (72h = 259,200,000 ms) ago => locked
    const orderExact3Days = {
      status: "completed",
      meta_data: [{ key: "_delivery_completed_at", value: new Date(BASE_TIME - THREE_DAYS_MS).toISOString() }],
    };
    assert.equal(isOrderStatusLocked(orderExact3Days, BASE_TIME), true, "Order at exactly 3 days must be locked");

    // After 3 days (73h and 96h / 4 days ago) => locked
    const order73h = {
      status: "completed",
      date_completed_gmt: new Date(BASE_TIME - 73 * ONE_HOUR_MS).toISOString(),
    };
    assert.equal(isOrderStatusLocked(order73h, BASE_TIME), true, "Order at 73h must be locked");

    const order4Days = {
      status: "completed",
      date_completed_gmt: new Date(BASE_TIME - 96 * ONE_HOUR_MS).toISOString(),
    };
    assert.equal(isOrderStatusLocked(order4Days, BASE_TIME), true, "Order at 4 days must be locked");

    // Completed with no completion timestamp but old date_created => locked
    const orderOldCreated = {
      status: "completed",
      date_created_gmt: new Date(BASE_TIME - 120 * ONE_HOUR_MS).toISOString(),
    };
    assert.equal(isOrderStatusLocked(orderOldCreated, BASE_TIME), true);

    // Completed with no usable timestamps => FAIL CLOSED (locked)
    const orderNoTimestamps = {
      status: "completed",
    };
    assert.equal(isOrderStatusLocked(orderNoTimestamps, BASE_TIME), true);

    // Non-completed order (e.g. processing 5 days ago) => NOT locked
    const orderProcessing = {
      status: "processing",
      meta_data: [{ key: "_delivery_status", value: "processing" }],
      date_created: new Date(BASE_TIME - 120 * ONE_HOUR_MS).toISOString(),
    };
    assert.equal(isOrderStatusLocked(orderProcessing, BASE_TIME), false);

    // Order #222 simulation (actual historical values: completed 4 days prior to BASE_TIME) => locked
    const order222 = {
      id: 222,
      status: "completed",
      date_created: "2026-09-02T11:12:06",
      date_created_gmt: "2026-09-02T11:12:06",
      date_completed: "2026-09-02T11:16:11",
      date_completed_gmt: "2026-09-02T11:16:11",
      meta_data: [{ key: "_delivery_status", value: "completed" }],
    };
    assert.equal(isOrderStatusLocked(order222, BASE_TIME), true);
  });

  await t.test("3. Backend rejects status change on order delivered >= 3 days (72 hours) ago with HTTP 400", async () => {
    const delivered80hAgo = new Date(Date.now() - 80 * ONE_HOUR_MS).toISOString();

    api.get = async (endpoint) => {
      assert.ok(endpoint.includes("orders/222"));
      return {
        data: {
          id: 222,
          status: "completed",
          date_completed_gmt: delivered80hAgo,
          meta_data: [
            { key: "_delivery_status", value: "completed" },
            { key: "_delivery_completed_at", value: delivered80hAgo },
          ],
        },
      };
    };

    let putCalled = false;
    api.put = async () => {
      putCalled = true;
      return { data: {} };
    };

    const req = {
      params: { id: "222" },
      body: { status: "processing" },
      user: { id: 1, role: "employee" },
    };

    let statusCode = null;
    let responseData = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        responseData = data;
      },
    };

    await updateOrderStatus(req, res);

    assert.equal(statusCode, 400, "Must return HTTP 400 when locked");
    assert.deepEqual(responseData, {
      success: false,
      message: "Status changes are locked after 24 hours of delivery.",
    });
    assert.equal(putCalled, false, "WooCommerce PUT must not be called when order is locked");
  });

  await t.test("4. Backend allows status change on order delivered < 3 days (72 hours) ago (e.g. 2 days / 48 hours ago)", async () => {
    const delivered48hAgo = new Date(Date.now() - 48 * ONE_HOUR_MS).toISOString();

    api.get = async (endpoint) => {
      assert.ok(endpoint.includes("orders/223"));
      return {
        data: {
          id: 223,
          status: "completed",
          date_completed_gmt: delivered48hAgo,
          meta_data: [{ key: "_delivery_status", value: "completed" }],
        },
      };
    };

    let putPayload = null;
    api.put = async (endpoint, payload) => {
      assert.ok(endpoint.includes("orders/223"));
      putPayload = payload;
      return {
        data: {
          id: 223,
          status: payload.status,
          meta_data: payload.meta_data,
        },
      };
    };

    const req = {
      params: { id: "223" },
      body: { status: "processing" },
      user: { id: 1, role: "employee" },
    };

    let statusCode = null;
    let responseData = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        responseData = data;
      },
    };

    await updateOrderStatus(req, res);

    assert.equal(statusCode, null, "Should not return an error status");
    assert.equal(responseData?.success, true);
    assert.equal(putPayload?.status, "processing");
  });

  await t.test("5. Backend allows status change on non-delivered orders", async () => {
    api.get = async (endpoint) => {
      assert.ok(endpoint.includes("orders/224"));
      return {
        data: {
          id: 224,
          status: "processing",
          meta_data: [{ key: "_delivery_status", value: "processing" }],
        },
      };
    };

    let putPayload = null;
    api.put = async (endpoint, payload) => {
      putPayload = payload;
      return {
        data: {
          id: 224,
          status: payload.status,
          meta_data: payload.meta_data,
        },
      };
    };

    const req = {
      params: { id: "224" },
      body: { status: "packed" },
      user: { id: 1, role: "employee" },
    };

    let responseData = null;
    const res = {
      status: () => res,
      json: (data) => {
        responseData = data;
      },
    };

    await updateOrderStatus(req, res);

    assert.equal(responseData?.success, true);
    assert.equal(putPayload?.meta_data?.[0]?.value, "packed");
  });

  await t.test("6. Transitioning to 'completed' writes _delivery_completed_at and _delivery_status", async () => {
    api.get = async (endpoint) => {
      return {
        data: {
          id: 225,
          status: "processing",
          meta_data: [{ key: "_delivery_status", value: "out-for-delivery" }],
        },
      };
    };

    let putPayload = null;
    api.put = async (endpoint, payload) => {
      putPayload = payload;
      return {
        data: {
          id: 225,
          status: "completed",
          meta_data: payload.meta_data,
        },
      };
    };

    const req = {
      params: { id: "225" },
      body: { status: "completed" },
      user: { id: 1, role: "employee" },
    };

    let responseData = null;
    const res = {
      status: () => res,
      json: (data) => {
        responseData = data;
      },
    };

    await updateOrderStatus(req, res);

    assert.equal(responseData?.success, true);
    assert.equal(putPayload?.status, "completed");

    const statusMeta = putPayload?.meta_data?.find((m) => m.key === "_delivery_status");
    const completedAtMeta = putPayload?.meta_data?.find((m) => m.key === "_delivery_completed_at");

    assert.equal(statusMeta?.value, "completed");
    assert.ok(completedAtMeta?.value, "Must include _delivery_completed_at timestamp in meta_data");

    const parsedTime = new Date(completedAtMeta.value).getTime();
    assert.ok(!isNaN(parsedTime) && parsedTime > Date.now() - 5000, "Timestamp must be valid ISO string for current time");
  });

  await t.test("7. getEmployeeOrders exposes timestamps and is_status_locked boolean", async () => {
    const delivered4DaysAgo = new Date(Date.now() - 96 * ONE_HOUR_MS).toISOString();
    const delivered2DaysAgo = new Date(Date.now() - 48 * ONE_HOUR_MS).toISOString();

    api.get = async () => {
      return {
        data: [
          {
            id: 301,
            status: "completed",
            date_completed: delivered4DaysAgo,
            date_completed_gmt: delivered4DaysAgo,
            meta_data: [{ key: "_delivery_completed_at", value: delivered4DaysAgo }],
          },
          {
            id: 302,
            status: "completed",
            date_completed: delivered2DaysAgo,
            date_completed_gmt: delivered2DaysAgo,
            meta_data: [{ key: "_delivery_completed_at", value: delivered2DaysAgo }],
          },
          {
            id: 303,
            status: "processing",
            date_completed: null,
            meta_data: [],
          },
        ],
        headers: {
          "x-wp-total": "3",
          "x-wp-totalpages": "1",
        },
      };
    };

    const req = {
      query: { page: "1", per_page: "20" },
    };

    let responseData = null;
    const res = {
      status: () => res,
      json: (data) => {
        responseData = data;
      },
    };

    await getEmployeeOrders(req, res);

    assert.equal(responseData?.success, true);
    const orders = responseData?.orders || [];
    assert.equal(orders.length, 3);

    // Order 301: delivered 4 days ago (96h) => locked (> 72h)
    assert.equal(orders[0].id, 301);
    assert.equal(orders[0].delivery_completed_at, delivered4DaysAgo);
    assert.equal(orders[0].is_status_locked, true);

    // Order 302: delivered 2 days ago (48h) => NOT locked (< 72h)
    assert.equal(orders[1].id, 302);
    assert.equal(orders[1].delivery_completed_at, delivered2DaysAgo);
    assert.equal(orders[1].is_status_locked, false);

    // Order 303: processing => NOT locked
    assert.equal(orders[2].id, 303);
    assert.equal(orders[2].is_status_locked, false);
  });

  await t.test("9. Admin Order Status Updates strictly follow 3-day (72-hour) delivery lock and quick-commerce payload rules", async (t2) => {
    await t2.test("Admin can update an unlocked order", async () => {
      let putCalledWith = null;
      api.get = async (endpoint) => {
        if (endpoint === "orders/401") {
          return {
            data: {
              id: 401,
              status: "processing",
              meta_data: [],
            },
          };
        }
        return { data: null };
      };
      api.put = async (endpoint, payload) => {
        putCalledWith = { endpoint, payload };
        return {
          data: { id: 401, ...payload },
        };
      };

      const req = {
        params: { id: "401" },
        body: { status: "packed" },
        user: { id: 1, role: "administrator" },
        ip: "127.0.0.1",
      };
      let jsonRes = null;
      let statusCode = 200;
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (data) => {
          jsonRes = data;
        },
      };

      await updateAdminOrderStatus(req, res);

      assert.equal(statusCode, 200);
      assert.equal(jsonRes.success, true);
      assert.equal(putCalledWith.endpoint, "orders/401");
      // "packed" maps to WooCommerce processing with _delivery_status meta
      assert.equal(putCalledWith.payload.status, "processing");
      assert.deepEqual(putCalledWith.payload.meta_data, [
        { key: "_delivery_status", value: "packed" },
      ]);
    });

    await t2.test("Admin can update completed order delivered < 3 days ago (e.g. 2 days / 48 hours ago)", async () => {
      const delivered48hAgo = new Date(Date.now() - 48 * ONE_HOUR_MS).toISOString();
      let putCalledWith = null;
      api.get = async (endpoint) => {
        if (endpoint === "orders/405") {
          return {
            data: {
              id: 405,
              status: "completed",
              date_completed: delivered48hAgo,
              meta_data: [{ key: "_delivery_completed_at", value: delivered48hAgo }],
            },
          };
        }
        return { data: null };
      };
      api.put = async (endpoint, payload) => {
        putCalledWith = { endpoint, payload };
        return {
          data: { id: 405, ...payload },
        };
      };

      const req = {
        params: { id: "405" },
        body: { status: "processing" },
        user: { id: 1, role: "administrator" },
        ip: "127.0.0.1",
      };
      let jsonRes = null;
      let statusCode = 200;
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (data) => {
          jsonRes = data;
        },
      };

      await updateAdminOrderStatus(req, res);

      assert.equal(statusCode, 200);
      assert.equal(jsonRes.success, true);
      assert.equal(putCalledWith.endpoint, "orders/405");
      assert.equal(putCalledWith.payload.status, "processing");
    });

    await t2.test("Admin is rejected from changing a completed order after 3 days (Cannot bypass lock)", async () => {
      const delivered80hAgo = new Date(Date.now() - 80 * ONE_HOUR_MS).toISOString();
      let putCalled = false;
      api.get = async (endpoint) => {
        if (endpoint === "orders/402") {
          return {
            data: {
              id: 402,
              status: "completed",
              date_completed: delivered80hAgo,
              meta_data: [{ key: "_delivery_completed_at", value: delivered80hAgo }],
            },
          };
        }
        return { data: null };
      };
      api.put = async () => {
        putCalled = true;
      };

      const req = {
        params: { id: "402" },
        body: { status: "processing", force: true, override_lock: true }, // Attempts to bypass
        user: { id: 1, role: "administrator" },
        ip: "127.0.0.1",
      };
      let jsonRes = null;
      let statusCode = 200;
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (data) => {
          jsonRes = data;
        },
      };

      await updateAdminOrderStatus(req, res);

      assert.equal(statusCode, 400);
      assert.equal(jsonRes.success, false);
      assert.equal(jsonRes.message, "Status changes are locked after 24 hours of delivery.");
      assert.equal(putCalled, false, "WooCommerce PUT must NOT be called when order is locked");
    });

    await t2.test("out-for-delivery maps to WooCommerce processing", async () => {
      let putPayload = null;
      api.get = async () => ({
        data: {
          id: 403,
          status: "processing",
          meta_data: [{ key: "_delivery_status", value: "packed" }],
        },
      });
      api.put = async (endpoint, payload) => {
        putPayload = payload;
        return { data: { id: 403, ...payload } };
      };

      const req = {
        params: { id: "403" },
        body: { status: "out-for-delivery" },
        user: { id: 1 },
      };
      const res = {
        status: () => res,
        json: () => {},
      };

      await updateAdminOrderStatus(req, res);

      assert.equal(putPayload.status, "processing");
      assert.deepEqual(putPayload.meta_data, [
        { key: "_delivery_status", value: "out-for-delivery" },
      ]);
    });

    await t2.test("completed sets WooCommerce status to completed and records completion timestamp", async () => {
      let putPayload = null;
      api.get = async () => ({
        data: {
          id: 404,
          status: "processing",
          meta_data: [{ key: "_delivery_status", value: "out-for-delivery" }],
        },
      });
      api.put = async (endpoint, payload) => {
        putPayload = payload;
        return { data: { id: 404, ...payload } };
      };

      const req = {
        params: { id: "404" },
        body: { status: "completed" },
        user: { id: 1 },
      };
      const res = {
        status: () => res,
        json: () => {},
      };

      await updateAdminOrderStatus(req, res);

      assert.equal(putPayload.status, "completed");
      const deliveryMeta = putPayload.meta_data.find((m) => m.key === "_delivery_status");
      const completedAtMeta = putPayload.meta_data.find((m) => m.key === "_delivery_completed_at");
      assert.equal(deliveryMeta?.value, "completed");
      assert.ok(completedAtMeta?.value, "Must set _delivery_completed_at timestamp");
      const parsedTime = new Date(completedAtMeta.value).getTime();
      assert.ok(!isNaN(parsedTime) && parsedTime > 0);
    });
  });
});
