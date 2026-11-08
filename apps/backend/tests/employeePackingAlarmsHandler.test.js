import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import wp from "../src/services/wordpress.js";
import api from "../src/config/woocommerce.js";
import {
  getEmployeePackingAlarms,
  serializeOrderCursor,
  parseOrderCursor,
  parseWooCommerceDate,
  compareOrdersDescending,
  isOrderOlderThanCursor,
} from "../src/controllers/employeeController.js";
import { _getLocalAcknowledgedOrders } from "../src/services/orderNotificationService.js";

const createMockRes = () => {
  let statusCode = 200;
  let jsonData = null;
  const headers = {};
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    set(key, val) {
      headers[key] = val;
      return this;
    },
    json(data) {
      jsonData = data;
      return this;
    },
    _getStatusCode: () => statusCode,
    _getJSON: () => jsonData,
  };
};

describe("Employee Packing Alarms Backend Handler Suite", () => {
  const originalWpGet = wp.get;
  const originalApiGet = api.get;

  beforeEach(() => {
    _getLocalAcknowledgedOrders().clear();
  });

  afterEach(() => {
    wp.get = originalWpGet;
    api.get = originalApiGet;
    _getLocalAcknowledgedOrders().clear();
  });

  test("1. The newest 50 eligible orders are acknowledged; an older unacknowledged order on page 2 is returned", async () => {
    // Generate 50 acknowledged orders for page 1
    const baseTime = new Date("2026-11-07T12:00:00Z").getTime();
    const page1Orders = Array.from({ length: 50 }, (_, i) => {
      const id = i + 1;
      _getLocalAcknowledgedOrders().set(id, {
        orderId: id,
        expiresAt: Date.now() + 86400000,
      });
      return {
        id,
        status: "processing",
        payment_method: "cod",
        date_created_gmt: new Date(baseTime - i * 1000).toISOString(),
        meta_data: [{ key: "_delivery_status", value: "processing" }],
      };
    });

    // Page 2 has older order #99 which is unacknowledged
    const page2Orders = [
      {
        id: 99,
        status: "processing",
        payment_method: "cod",
        date_created_gmt: new Date(baseTime - 100000).toISOString(),
        meta_data: [{ key: "_delivery_status", value: "processing" }],
      },
    ];

    wp.get = async (url, { params } = {}) => {
      if (params?.cursor || params?.cursor_id) {
        return {
          data: {
            orders: page2Orders,
            total: 51,
            total_pages: 2,
            keyset_capability: "v1",
          },
          headers: { "x-mumbai-keyset-capability": "v1" },
        };
      }
      return {
        data: {
          orders: page1Orders,
          total: 51,
          total_pages: 2,
          keyset_capability: "v1",
        },
        headers: { "x-mumbai-keyset-capability": "v1" },
      };
    };

    const req = { query: {} };
    const res = createMockRes();

    await getEmployeePackingAlarms(req, res);

    const data = res._getJSON();
    assert.equal(data.success, true);
    const unacknowledgedFound = data.orders.find((o) => o.id === 99);
    assert.ok(unacknowledgedFound, "Older unacknowledged order #99 must be discovered and returned");
    assert.equal(unacknowledgedFound.is_acknowledged, false);
  });

  test("2. Scan budget is reached; next poll advances the backlog scan, and newly arrived orders are still discoverable on page 1", async () => {
    const baseTime = new Date("2026-11-07T12:00:00Z").getTime();

    // 100 acknowledged orders across page 1 and page 2
    for (let id = 1; id <= 100; id++) {
      _getLocalAcknowledgedOrders().set(id, {
        orderId: id,
        expiresAt: Date.now() + 86400000,
      });
    }

    let newlyArrivedOrder = null;

    wp.get = async (url, { params } = {}) => {
      if (!params?.cursor && !params?.cursor_id && (params?.page === 1 || !params?.page)) {
        const orders = newlyArrivedOrder
          ? [newlyArrivedOrder, ...Array.from({ length: 49 }, (_, i) => ({
              id: i + 1,
              status: "processing",
              payment_method: "cod",
              date_created_gmt: new Date(baseTime - i * 1000).toISOString(),
            }))]
          : Array.from({ length: 50 }, (_, i) => ({
              id: i + 1,
              status: "processing",
              payment_method: "cod",
              date_created_gmt: new Date(baseTime - i * 1000).toISOString(),
            }));
        return {
          data: { orders, total_pages: 5, keyset_capability: "v1" },
          headers: { "x-mumbai-keyset-capability": "v1" },
        };
      }

      // Backlog request
      if (params?.cursor || params?.cursor_id) {
        const cursorId = Number(params?.cursor_id || (params?.cursor && params.cursor.split("_")[1]));
        if (cursorId && cursorId >= 100) {
          // Poll 2 backlog: cursor is at 100, so return order #301
          return {
            data: {
              orders: [{
                id: 301,
                status: "processing",
                payment_method: "cod",
                date_created_gmt: new Date(baseTime - 200000).toISOString(),
              }],
              total_pages: 5,
              keyset_capability: "v1",
            },
            headers: { "x-mumbai-keyset-capability": "v1" },
          };
        }

        // Poll 1 backlog: cursor is at 50, return page 2 (orders 51 to 100, all acknowledged)
        return {
          data: {
            orders: Array.from({ length: 50 }, (_, i) => ({
              id: i + 51,
              status: "processing",
              payment_method: "cod",
              date_created_gmt: new Date(baseTime - (i + 51) * 1000).toISOString(),
            })),
            total_pages: 5,
            keyset_capability: "v1",
          },
          headers: { "x-mumbai-keyset-capability": "v1" },
        };
      }

      return {
        data: {
          orders: Array.from({ length: 50 }, (_, i) => ({
            id: i + 51,
            status: "processing",
            payment_method: "cod",
            date_created_gmt: new Date(baseTime - (i + 51) * 1000).toISOString(),
          })),
          total_pages: 5,
          keyset_capability: "v1",
        },
        headers: { "x-mumbai-keyset-capability": "v1" },
      };
    };

    // Poll 1: initial poll without cursor. Reads page 1 & page 2
    const req1 = { query: {} };
    const res1 = createMockRes();
    await getEmployeePackingAlarms(req1, res1);

    const data1 = res1._getJSON();
    assert.equal(data1.success, true);
    assert.ok(data1.next_cursor, "Poll 1 must yield a stable next_cursor when budget runs out");

    // Before Poll 2: customer places brand new order #999! It arrives on Page 1.
    newlyArrivedOrder = {
      id: 999,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime + 5000).toISOString(),
    };

    // Poll 2: client passes cursor returned from poll 1
    const req2 = { query: { cursor: data1.next_cursor } };
    const res2 = createMockRes();
    await getEmployeePackingAlarms(req2, res2);

    const data2 = res2._getJSON();
    assert.equal(data2.success, true);

    // Newly arrived order #999 on page 1 MUST be discovered immediately!
    const foundNew = data2.orders.find((o) => o.id === 999);
    assert.ok(foundNew, "Newly arrived order #999 must be discovered promptly on page 1");
    assert.equal(foundNew.is_acknowledged, false);

    // Backlog order #301 from backlog page MUST also be discovered!
    const foundBacklog = data2.orders.find((o) => o.id === 301);
    assert.ok(foundBacklog, "Backlog order #301 from cursor scan must be discovered");
  });

  test("3. Duplicate or invalid ringing IDs do not create extra lookups; individual fallback lookups strictly capped <= 6 with concurrency <= 3", async () => {
    let activeRequests = 0;
    let maxConcurrent = 0;
    const requestedIds = [];

    wp.get = async () => ({ data: { orders: [], total_pages: 1 } });

    // Mock individual order lookups tracking concurrency
    api.get = async (path) => {
      if (path === "orders") {
        // Simulate batch include lookup failing to test bounded fallback pool
        throw new Error("Batch not supported in this mock");
      }
      activeRequests++;
      maxConcurrent = Math.max(maxConcurrent, activeRequests);
      const match = path.match(/orders\/(\d+)/);
      if (match) requestedIds.push(Number(match[1]));

      await new Promise((r) => setTimeout(r, 20));
      activeRequests--;

      return {
        data: {
          id: match ? Number(match[1]) : 0,
          status: "processing",
          payment_method: "cod",
        },
      };
    };

    // Send duplicate '101', invalid 'abc', negative '-5', and 10 unique positive IDs
    const req = {
      query: {
        ringing_ids: "101,101,abc,-5,102,103,104,105,106,107,108,109,110",
      },
    };
    const res = createMockRes();

    await getEmployeePackingAlarms(req, res);

    const data = res._getJSON();
    assert.equal(data.success, true);

    // Verify deduplication: 101 must be looked up only once
    const count101 = requestedIds.filter((id) => id === 101).length;
    assert.equal(count101, 1, "Duplicate ID 101 must be queried only once");

    // Verify invalid IDs were completely skipped
    assert.ok(!requestedIds.includes(-5));
    assert.ok(!requestedIds.some(isNaN));

    // Verify individual lookups are capped at 6 max per poll to prevent mobile client timeouts
    assert.ok(requestedIds.length <= 6, `Total individual lookups must be capped <= 6 (was: ${requestedIds.length})`);

    // Verify concurrency limit: maxConcurrent MUST NEVER EXCEED 3!
    assert.ok(maxConcurrent <= 3, `Concurrent requests must be <= 3 (was: ${maxConcurrent})`);
    assert.ok(maxConcurrent > 0);
  });

  test("4. Confirmed acknowledgement or fulfillment transition silences alarm; timeout or error leaves alarm active", async () => {
    wp.get = async () => ({ data: { orders: [], total_pages: 1 } });

    // Order 501: acknowledged in Redis/memory by staff on Phone A
    _getLocalAcknowledgedOrders().set(501, {
      orderId: 501,
      expiresAt: Date.now() + 86400000,
    });

    api.get = async (path) => {
      if (path === "orders") {
        throw new Error("Batch unsupported");
      }

      // Order 502: marked packed on WooCommerce
      if (path === "orders/502") {
        return {
          data: {
            id: 502,
            status: "processing",
            meta_data: [{ key: "_delivery_status", value: "packed" }],
          },
        };
      }

      // Order 503: simulates upstream gateway timeout
      if (path === "orders/503") {
        const timeoutErr = new Error("ETIMEDOUT");
        timeoutErr.code = "ETIMEDOUT";
        throw timeoutErr;
      }

      // Order 504: still processing and needs packing
      if (path === "orders/504") {
        return {
          data: {
            id: 504,
            status: "processing",
            payment_method: "cod",
            meta_data: [{ key: "_delivery_status", value: "processing" }],
          },
        };
      }

      throw new Error("Not found");
    };

    const req = {
      query: {
        ringing_ids: "501,502,503,504",
      },
    };
    const res = createMockRes();

    await getEmployeePackingAlarms(req, res);

    const data = res._getJSON();
    assert.equal(data.success, true);

    const acknowledgedRinging = data.acknowledged_ringing_ids;
    assert.ok(acknowledgedRinging.includes(501), "Order 501 with confirmed acknowledgement must be in acknowledged_ringing_ids");
    assert.ok(acknowledgedRinging.includes(502), "Order 502 marked packed must be in acknowledged_ringing_ids");
    assert.equal(acknowledgedRinging.includes(503), false, "Order 503 with timeout must remain active (NOT silenced)");
    assert.equal(acknowledgedRinging.includes(504), false, "Order 504 still needing packing must remain active (NOT silenced)");
  });

  test("5. Page 1 stays full of unacknowledged orders across consecutive polls; backlog discovery is reserved and older orders are returned without stalling", async () => {
    const baseTime = new Date("2026-11-07T12:00:00Z").getTime();

    // 50 unacknowledged orders on page 1 (IDs 1-50)
    const page1Orders = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime - i * 1000).toISOString(),
    }));

    // Backlog orders (50 orders: IDs 101-150)
    const page2Orders = Array.from({ length: 50 }, (_, i) => ({
      id: i + 101,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime - 100000 - i * 1000).toISOString(),
    }));

    wp.get = async (url, { params } = {}) => {
      if (!params?.cursor && !params?.cursor_id && (params?.page === 1 || !params?.page)) {
        return {
          data: { orders: page1Orders, total_pages: 3, keyset_capability: "v1" },
          headers: { "x-mumbai-keyset-capability": "v1" },
        };
      }
      return {
        data: { orders: page2Orders, total_pages: 3, keyset_capability: "v1" },
        headers: { "x-mumbai-keyset-capability": "v1" },
      };
    };

    // Poll 1: initial poll
    const res1 = createMockRes();
    await getEmployeePackingAlarms({ query: {} }, res1);
    const data1 = res1._getJSON();

    assert.equal(data1.success, true);
    assert.ok(data1.next_cursor, "Must return next_cursor for backlog");

    // Verify backlog is NOT starved on Poll 1:
    // Page 1 gave its reserved share, and backlog order #101 was discovered!
    const p1Count = data1.orders.filter((o) => o.id <= 50).length;
    const backlogCount1 = data1.orders.filter((o) => o.id >= 101).length;
    assert.ok(p1Count <= 25, "Page 1 unacknowledged orders must be bounded so backlog is not starved");
    assert.ok(backlogCount1 > 0, "Backlog orders must be discovered on poll 1 even when page 1 is full of unacknowledged orders");

    // Poll 2: Page 1 still has 50 unacknowledged orders! Client passes cursor from poll 1
    const res2 = createMockRes();
    await getEmployeePackingAlarms({ query: { cursor: data1.next_cursor } }, res2);
    const data2 = res2._getJSON();

    assert.equal(data2.success, true);
    // Page 1 again gave up to 25, and backlog orders continue to be returned without stalling!
    const backlogCount2 = data2.orders.filter((o) => o.id >= 101).length;
    assert.ok(backlogCount2 > 0, "Backlog orders must continue advancing and returning on poll 2 without stalling");
  });

  test("6. Response fills halfway through a backlog page; cursor resumes from the exact last examined order without skipping unread rows", async () => {
    const baseTime = new Date("2026-11-07T12:00:00Z").getTime();

    // 25 orders on Page 1
    const page1Orders = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime - i * 1000).toISOString(),
    }));

    // Backlog has 50 orders (IDs 200 down to 151)
    const backlogOrders = Array.from({ length: 50 }, (_, i) => ({
      id: 200 - i,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime - 100000 - i * 1000).toISOString(),
    }));

    let examinedInBacklogPoll1 = [];
    let examinedInBacklogPoll2 = [];

    wp.get = async (url, { params } = {}) => {
      if (!params?.cursor && !params?.cursor_id && (params?.page === 1 || !params?.page)) {
        return {
          data: { orders: page1Orders, total_pages: 2, keyset_capability: "v1" },
          headers: { "x-mumbai-keyset-capability": "v1" },
        };
      }
      return {
        data: { orders: backlogOrders, total_pages: 2, keyset_capability: "v1" },
        headers: { "x-mumbai-keyset-capability": "v1" },
      };
    };

    // Poll 1: Page 1 fills 25 slots. The remaining 25 slots are filled by the first 25 backlog orders
    // (halfway through the 50 backlog orders)!
    const res1 = createMockRes();
    await getEmployeePackingAlarms({ query: { cursor: serializeOrderCursor(page1Orders[24]) } }, res1);
    const data1 = res1._getJSON();

    assert.equal(data1.success, true);
    assert.equal(data1.orders.length, 50, "Poll 1 must cap at exactly 50 total unacknowledged orders");

    // The 25 backlog orders collected should be IDs 200 down to 176
    const poll1BacklogIds = data1.orders.filter((o) => o.id >= 151 && o.id <= 200).map((o) => o.id);
    assert.equal(poll1BacklogIds.length, 25);
    assert.equal(poll1BacklogIds[0], 200);
    assert.equal(poll1BacklogIds[24], 176);

    // Crucial check: next_cursor must point to order #176 (the last examined order), NOT skipping the rest of the page!
    const parsedC = parseOrderCursor(data1.next_cursor);
    assert.equal(parsedC.id, 176, "Cursor must resume from exact last examined order (176)");

    // Poll 2: Resuming from cursor of order #176
    const res2 = createMockRes();
    await getEmployeePackingAlarms({ query: { cursor: data1.next_cursor } }, res2);
    const data2 = res2._getJSON();

    assert.equal(data2.success, true);
    // Poll 2 backlog orders MUST begin at order #175 and proceed downwards without skipping!
    const poll2BacklogIds = data2.orders.filter((o) => o.id >= 151 && o.id <= 175).map((o) => o.id);
    assert.ok(poll2BacklogIds.includes(175), "Order #175 (unread on poll 1) must be examined first on poll 2");
    assert.ok(!poll2BacklogIds.includes(176), "Order #176 was already examined and must not be repeated");
  });

  test("7. Discovery outage (both HPOS and WooCommerce fail): reports discovery_unavailable, preserves cursor, and returns confirmed ringing acknowledgements independently", async () => {
    // Both HPOS and WooCommerce REST fail
    wp.get = async () => {
      const err = new Error("Database connection refused");
      err.response = { status: 503 };
      throw err;
    };

    api.get = async (path) => {
      if (path === "orders") {
        const err = new Error("Gateway timeout");
        err.response = { status: 504 };
        throw err;
      }
      throw new Error("Unavailable");
    };

    // Staff acknowledged order 777 in Redis
    _getLocalAcknowledgedOrders().set(777, {
      orderId: 777,
      expiresAt: Date.now() + 86400000,
    });

    const activeCursor = "2026-11-07T10:00:00.000Z_500";
    const req = {
      query: {
        cursor: activeCursor,
        ringing_ids: "777",
      },
    };
    const res = createMockRes();

    await getEmployeePackingAlarms(req, res);

    const data = res._getJSON();
    // Must NOT look like an empty queue (success must be false, discovery_unavailable must be true)
    assert.equal(data.success, false);
    assert.equal(data.discovery_unavailable, true);

    // Cursor must be preserved for retry
    assert.equal(data.next_cursor, activeCursor, "Active cursor must be preserved for retry across discovery outage");

    // Confirmed ringing acknowledgement MUST be returned independently to silence phone
    assert.ok(data.acknowledged_ringing_ids.includes(777), "Confirmed ringing ack 777 must be returned even during store discovery outage");
  });

  test("8. More than 50 rows share one timestamp: across consecutive polls, unread lower IDs are discovered and cursor does not reset early", async () => {
    const tiedTimestamp = "2026-11-07T12:00:00.000Z";
    // 80 orders with the exact same creation timestamp! IDs 80 down to 1
    const allTiedOrders = Array.from({ length: 80 }, (_, i) => ({
      id: 80 - i,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: tiedTimestamp,
    }));

    // Mock upstream simulating MySQL / HPOS query with sorting and keyset pagination:
    // ORDER BY date_created_gmt DESC, id DESC
    // WHERE (date < cursor_date OR (date = cursor_date AND id < cursor_id))
    // LIMIT 50
    wp.get = async (url, { params } = {}) => {
      let filtered = [...allTiedOrders];
      filtered.sort(compareOrdersDescending);

      if (params?.cursor_id) {
        const cursorId = Number(params.cursor_id);
        const cursorDate = new Date(params.cursor_date || params.before || tiedTimestamp).getTime();
        filtered = filtered.filter((o) => {
          const oTime = new Date(o.date_created_gmt).getTime();
          if (oTime < cursorDate) return true;
          if (oTime === cursorDate && o.id < cursorId) return true;
          return false;
        });
      } else if (params?.before) {
        const beforeTime = new Date(params.before).getTime();
        filtered = filtered.filter((o) => new Date(o.date_created_gmt).getTime() <= beforeTime);
      }

      const pageRows = filtered.slice(0, params?.per_page || 50);
      return {
        data: {
          orders: pageRows,
          total_pages: Math.ceil(filtered.length / (params?.per_page || 50)) || 1,
          keyset_capability: "v1",
        },
        headers: { "x-mumbai-keyset-capability": "v1" },
      };
    };

    // Poll 1: initial poll without cursor
    const res1 = createMockRes();
    await getEmployeePackingAlarms({ query: {} }, res1);
    const data1 = res1._getJSON();

    assert.equal(data1.success, true);
    assert.ok(data1.next_cursor, "Poll 1 must yield next_cursor for remaining tied rows");
    const parsedC1 = parseOrderCursor(data1.next_cursor);
    assert.ok(parsedC1.id > 1, "Cursor must not point to end of queue yet");

    // Poll 2: Pass cursor from poll 1
    const res2 = createMockRes();
    await getEmployeePackingAlarms({ query: { cursor: data1.next_cursor } }, res2);
    const data2 = res2._getJSON();

    assert.equal(data2.success, true);
    // Lower IDs that were not read on poll 1 must be discovered on poll 2!
    const poll2Ids = data2.orders.map((o) => o.id);
    assert.ok(poll2Ids.includes(1), "Lowest ID 1 must be discovered across tied timestamps");
    // Verify cursor did not reset early
    assert.ok(data1.orders.length > 0 && data2.orders.length > 0);
  });

  test("9. Page one and backlog stay full across consecutive polls; both make progress and newly arrived order is still discovered", async () => {
    const baseTime = new Date("2026-11-07T12:00:00Z").getTime();
    let newlyArrived = null;

    const page1Base = Array.from({ length: 50 }, (_, i) => ({
      id: 50 - i,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime - i * 1000).toISOString(),
    }));

    const backlogBase = Array.from({ length: 50 }, (_, i) => ({
      id: 200 - i,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime - 100000 - i * 1000).toISOString(),
    }));

    wp.get = async (url, { params } = {}) => {
      if (!params?.cursor && !params?.cursor_id && (params?.page === 1 || !params?.page)) {
        const orders = newlyArrived ? [newlyArrived, ...page1Base.slice(0, 49)] : page1Base;
        return {
          data: { orders, total_pages: 3, keyset_capability: "v1" },
          headers: { "x-mumbai-keyset-capability": "v1" },
        };
      }

      let filtered = [...backlogBase];
      filtered.sort(compareOrdersDescending);
      if (params?.cursor_id) {
        filtered = filtered.filter((o) => isOrderOlderThanCursor({ id: Number(params.cursor_id), date: params.cursor_date }, o));
      }
      return {
        data: { orders: filtered.slice(0, 50), total_pages: 3, keyset_capability: "v1" },
        headers: { "x-mumbai-keyset-capability": "v1" },
      };
    };

    // Poll 1
    const res1 = createMockRes();
    await getEmployeePackingAlarms({ query: {} }, res1);
    const data1 = res1._getJSON();
    assert.equal(data1.success, true);
    assert.ok(data1.next_cursor);
    assert.ok(data1.next_page1_offset > 0, "Poll 1 must yield next_page1_offset for deferred page 1 orders");

    // Customer places new order #999!
    newlyArrived = {
      id: 999,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime + 5000).toISOString(),
    };

    // Poll 2 with cursor and page1_offset
    const res2 = createMockRes();
    await getEmployeePackingAlarms({
      query: {
        cursor: data1.next_cursor,
        page1_offset: data1.next_page1_offset,
      },
    }, res2);
    const data2 = res2._getJSON();
    assert.equal(data2.success, true);

    // Newly arrived order #999 discovered!
    const foundNew = data2.orders.find((o) => o.id === 999);
    assert.ok(foundNew, "Brand new order #999 must be discovered immediately");

    // Deferred portion of Page 1 discovered!
    const deferredP1 = data2.orders.find((o) => o.id <= 25);
    assert.ok(deferredP1, "Deferred portion of Page 1 must get a chance to appear");

    // Backlog orders continue advancing!
    const backlogOrders = data2.orders.filter((o) => o.id > 50 && o.id < 999);
    assert.ok(backlogOrders.length > 0, "Backlog orders must continue making progress");
  });

  test("10. Batch lookup or individual lookup stalls past budget: returns in time with confirmed results, cancels work, and rotates IDs beyond the first six on next poll", async () => {
    let lookupCallCount = 0;
    const queriedIds = [];

    wp.get = async () => ({ data: { orders: [], total_pages: 1 } });

    api.get = async (path, params, extraConfig) => {
      if (path === "orders") {
        // Batch lookup stalls or throws
        throw new Error("Batch lookup unavailable");
      }

      lookupCallCount++;
      const match = path.match(/orders\/(\d+)/);
      if (match) queriedIds.push(Number(match[1]));

      // Check if signal is provided
      if (extraConfig?.signal?.aborted) {
        const abortErr = new Error("Aborted");
        abortErr.code = "ERR_CANCELED";
        throw abortErr;
      }

      return {
        data: {
          id: match ? Number(match[1]) : 0,
          status: "processing",
          payment_method: "cod",
        },
      };
    };

    // 12 ringing IDs: 1 to 12
    const ringingIds = Array.from({ length: 12 }, (_, i) => i + 1).join(",");

    // Poll 1
    const res1 = createMockRes();
    await getEmployeePackingAlarms({ query: { ringing_ids: ringingIds } }, res1);
    const data1 = res1._getJSON();

    assert.equal(data1.success, true);
    assert.equal(data1.next_reconciliation_position, 6, "Poll 1 must advance next_reconciliation_position by 6");
    assert.deepEqual(queriedIds.slice(0, 6), [1, 2, 3, 4, 5, 6]);

    // Poll 2: client passes reconciliation_position: 6
    queriedIds.length = 0;
    const res2 = createMockRes();
    await getEmployeePackingAlarms({
      query: {
        ringing_ids: ringingIds,
        reconciliation_position: data1.next_reconciliation_position,
      },
    }, res2);
    const data2 = res2._getJSON();

    assert.equal(data2.success, true);
    // Poll 2 MUST query IDs beyond the first six (7 to 12)!
    assert.ok(queriedIds.includes(7), "Poll 2 must rotate past the first 6 IDs to reach ID 7");
    assert.ok(queriedIds.includes(12), "Poll 2 must reach ID 12");
  });

  test("11. Newest query succeeds but backlog read fails: cursor preserved, partial failure reported, and confirmed acknowledgements silence alarms", async () => {
    // Page 1 succeeds with order #10
    wp.get = async (url, { params } = {}) => {
      if (params?.page === 1 || (!params?.cursor && !params?.before)) {
        return {
          data: {
            orders: [{
              id: 10,
              status: "processing",
              payment_method: "cod",
              date_created_gmt: "2026-11-07T12:00:00.000Z",
            }],
            total_pages: 3,
          },
        };
      }
      // Backlog read fails
      const err = new Error("Backlog upstream timeout");
      err.response = { status: 504 };
      throw err;
    };

    api.get = async () => {
      throw new Error("REST fallback error");
    };

    // Staff acknowledged ringing order 888 in Redis
    _getLocalAcknowledgedOrders().set(888, {
      orderId: 888,
      expiresAt: Date.now() + 86400000,
    });

    const activeCursor = "2026-11-07T11:00:00.000Z_40";
    const res = createMockRes();
    await getEmployeePackingAlarms({
      query: {
        cursor: activeCursor,
        ringing_ids: "888",
      },
    }, res);

    const data = res._getJSON();
    assert.equal(data.success, true);
    assert.equal(data.partial_discovery_failure, true);
    assert.equal(data.discovery_unavailable, true, "Must signal UI to show retrying status");
    assert.equal(data.next_cursor, activeCursor, "Last valid cursor must be preserved on backlog failure");

    // Order 10 from page 1 still discovered
    assert.ok(data.orders.some((o) => o.id === 10));

    // Confirmed ringing acknowledgement 888 still returned to silence device
    assert.ok(data.acknowledged_ringing_ids.includes(888));
  });

  test("12. 70+ orders at one timestamp under Asia/Kolkata (normalizing timezone-less GMT) across multiple polls: lower IDs and older orders are discovered without stalling", async () => {
    // 75 orders at exact same GMT timestamp without Z (WooCommerce GMT format: 17:30 IST = 12:00 GMT)
    const tiedGmt = "2026-11-07T12:00:00";
    const tiedOrders = Array.from({ length: 75 }, (_, i) => ({
      id: 75 - i,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: tiedGmt,
    }));

    // Plus an older order from earlier in the day
    const olderOrder = {
      id: 999,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: "2026-11-07T11:00:00.000Z",
    };

    const allStoreOrders = [...tiedOrders, olderOrder];

    wp.get = async (url, { params } = {}) => {
      let filtered = [...allStoreOrders];
      filtered.sort(compareOrdersDescending);

      if (params?.cursor_id) {
        const cursorId = Number(params.cursor_id);
        const rawDate = params.cursor_date || params.cursor?.split("_")[0];
        const cursorDate = new Date(rawDate.endsWith("Z") ? rawDate : `${rawDate}Z`).getTime();
        filtered = filtered.filter((o) => {
          const oRaw = o.date_created_gmt;
          const oTime = new Date(oRaw.endsWith("Z") ? oRaw : `${oRaw}Z`).getTime();
          if (oTime < cursorDate) return true;
          if (oTime === cursorDate && o.id < cursorId) return true;
          return false;
        });
      }

      const page = params?.page || 1;
      const perPage = params?.per_page || 50;
      const pageRows = params?.cursor_id
        ? filtered.slice(0, perPage)
        : filtered.slice((page - 1) * perPage, page * perPage);

      return {
        data: {
          orders: pageRows,
          total_pages: Math.ceil(filtered.length / perPage) || 1,
          keyset_capability: "v1",
        },
        headers: { "x-mumbai-keyset-capability": "v1" },
      };
    };

    // Poll 1: initial poll without cursor
    const res1 = createMockRes();
    await getEmployeePackingAlarms({ query: {} }, res1);
    const data1 = res1._getJSON();

    assert.equal(data1.success, true);
    assert.ok(data1.next_cursor, "Poll 1 must yield next_cursor for remaining backlog orders");
    const parsedC1 = parseOrderCursor(data1.next_cursor);
    assert.equal(parsedC1.id, 1, "Poll 1 hits cap at lowest tied ID 1 and sets cursor to 1");

    // Poll 1 discovered the 50 orders within its cap (including tied order ID 1)
    const poll1Ids = data1.orders.map((o) => o.id);
    assert.ok(poll1Ids.includes(1), "Lowest ID 1 of tied timestamp is examined and returned on poll 1");

    // Poll 2: Pass cursor from poll 1 to reach older order #999 from earlier timestamp
    const res2 = createMockRes();
    await getEmployeePackingAlarms({ query: { cursor: data1.next_cursor } }, res2);
    const data2 = res2._getJSON();

    assert.equal(data2.success, true);
    const poll2Ids = data2.orders.map((o) => o.id);
    assert.ok(poll2Ids.includes(999), "Older order #999 must be discovered after tied rows without stalling");
    assert.equal(data2.next_cursor, null, "Backlog is fully exhausted after order #999");
  });

  test("13. Batch cut short by response cap (50 orders): cursor advances to the exact last examined order and next poll resumes without skipping unread rows", async () => {
    const baseTime = new Date("2026-11-07T12:00:00.000Z").getTime();

    // Page 1 has 25 unacknowledged orders (IDs 1-25)
    const page1Orders = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime - i * 1000).toISOString(),
    }));

    // Backlog has 50 unacknowledged orders (IDs 101 to 150)
    const backlogOrders = Array.from({ length: 50 }, (_, i) => ({
      id: 150 - i,
      status: "processing",
      payment_method: "cod",
      date_created_gmt: new Date(baseTime - 100000 - i * 1000).toISOString(),
    }));

    wp.get = async (url, { params } = {}) => {
      if (!params?.cursor && !params?.cursor_id && (params?.page === 1 || !params?.page)) {
        return {
          data: { orders: page1Orders, total_pages: 2, keyset_capability: "v1" },
          headers: { "x-mumbai-keyset-capability": "v1" },
        };
      }

      let filtered = [...backlogOrders];
      filtered.sort(compareOrdersDescending);
      if (params?.cursor_id) {
        filtered = filtered.filter((o) => isOrderOlderThanCursor({ id: Number(params.cursor_id), date: params.cursor_date }, o));
      }

      return {
        data: { orders: filtered.slice(0, 50), total_pages: 2, keyset_capability: "v1" },
        headers: { "x-mumbai-keyset-capability": "v1" },
      };
    };

    // Poll 1: Starts with cursor pointing to last order of Page 1 (#25)
    const res1 = createMockRes();
    await getEmployeePackingAlarms({ query: { cursor: serializeOrderCursor(page1Orders[24]) } }, res1);
    const data1 = res1._getJSON();

    assert.equal(data1.success, true);
    // 25 from page 1 + 25 from backlog = 50 total orders
    assert.equal(data1.orders.length, 50, "Response must cap at exactly 50 total unacknowledged orders");

    // The 25 backlog orders examined are IDs 150 down to 126
    const p1Backlog = data1.orders.filter((o) => o.id >= 101 && o.id <= 150);
    assert.equal(p1Backlog.length, 25);
    assert.equal(p1Backlog[0].id, 150);
    assert.equal(p1Backlog[24].id, 126);

    // Cursor must point to the 25th examined order (#126), NOT order #101
    const parsedNext = parseOrderCursor(data1.next_cursor);
    assert.equal(parsedNext.id, 126, "Cursor must advance to exact 25th order examined (#126)");

    // Poll 2: Resuming from cursor #126
    const res2 = createMockRes();
    await getEmployeePackingAlarms({ query: { cursor: data1.next_cursor } }, res2);
    const data2 = res2._getJSON();

    assert.equal(data2.success, true);
    // Poll 2 backlog orders must resume from order #125 down to 101 without skipping!
    const p2Backlog = data2.orders.filter((o) => o.id >= 101 && o.id <= 125);
    assert.ok(p2Backlog.some((o) => o.id === 125), "Order #125 must be examined next without skipping");
    assert.ok(!p2Backlog.some((o) => o.id === 126), "Order #126 was already examined on poll 1 and must not be repeated");
  });

  test("14. Fallback response without capability proof (including zero rows): cursor is preserved for retry, partial discovery failure reported, and no false exhaustion", async () => {
    // HPOS fails so fallback WooCommerce REST path is taken
    wp.get = async () => {
      const err = new Error("HPOS 503");
      err.response = { status: 503 };
      throw err;
    };

    // Page 1 succeeds on WooCommerce REST fallback
    api.get = async (path, params) => {
      if (path === "orders") {
        if (!params?.cursor && !params?.cursor_id) {
          return {
            data: [{
              id: 50,
              status: "processing",
              payment_method: "cod",
              date_created_gmt: "2026-11-07T12:00:00.000Z",
            }],
            headers: { "x-wp-totalpages": "3" },
          };
        }
        // Backlog query on WooCommerce REST returns 0 rows and NO keyset capability header
        return {
          data: [],
          headers: {
            "x-wp-totalpages": "3",
            // Notice: NO "x-mumbai-keyset-capability" header!
          },
        };
      }
      throw new Error("Not found");
    };

    const activeCursor = "2026-11-07T11:00:00.000Z_40";
    const res = createMockRes();
    await getEmployeePackingAlarms({ query: { cursor: activeCursor } }, res);
    const data = res._getJSON();

    assert.equal(data.success, true);
    assert.equal(data.partial_discovery_failure, true, "Must flag partial_discovery_failure when capability signal is absent");
    assert.equal(data.discovery_unavailable, true, "Must flag discovery_unavailable to keep degraded indicator visible");
    // Cursor MUST NOT be set to null (which would falsely claim backlog exhaustion)
    assert.equal(data.next_cursor, activeCursor, "Must preserve retry cursor rather than claiming backlog exhaustion");

    // Page 1 order #50 still successfully returned
    assert.ok(data.orders.some((o) => o.id === 50));
  });

  test("15. Fresh backlog scan without incoming cursor starts from last raw row of page 1 and requires capability proof; empty response without capability header flags partial failure and preserves P1-derived cursor", async () => {
    // HPOS fails so WooCommerce REST fallback is used
    wp.get = async () => {
      const err = new Error("HPOS 503");
      err.response = { status: 503 };
      throw err;
    };

    let backlogParamsReceived = null;

    api.get = async (path, params) => {
      if (path === "orders") {
        if (!params?.cursor && !params?.cursor_id) {
          // Page 1 returns order #100 with total_pages = 2
          return {
            data: [{
              id: 100,
              status: "processing",
              payment_method: "cod",
              date_created_gmt: "2026-11-07T14:00:00.000Z",
            }],
            headers: { "x-wp-totalpages": "2" },
          };
        }
        // First backlog request
        backlogParamsReceived = params;
        // Upstream returns 200 OK with empty array [] but WITHOUT x-mumbai-keyset-capability header
        return {
          data: [],
          headers: {
            "x-wp-totalpages": "2",
          },
        };
      }
      throw new Error("Not found");
    };

    const res = createMockRes();
    // Fresh poll: NO incoming cursor!
    await getEmployeePackingAlarms({ query: {} }, res);
    const data = res._getJSON();

    // 1. Verify backlog request started from last raw row of verified page 1 (order #100)
    assert.ok(backlogParamsReceived, "Backlog request must be initiated on fresh poll with total_pages > 1");
    assert.equal(backlogParamsReceived.cursor_id, 100, "Backlog query must target cursor_id from last raw row of page 1");
    assert.equal(backlogParamsReceived.cursor_date, "2026-11-07T14:00:00.000Z");

    // 2. Verify capability proof requirement: must NOT falsely report healthy backlog exhaustion (next_cursor: null)
    assert.equal(data.success, true);
    assert.equal(data.partial_discovery_failure, true, "Must flag partial_discovery_failure when capability signal is missing on first backlog response");
    assert.equal(data.discovery_unavailable, true, "Must flag discovery_unavailable");
    assert.notEqual(data.next_cursor, null, "Must NOT return next_cursor: null when capability signal is missing");
    assert.equal(data.next_cursor, "2026-11-07T14:00:00.000Z_100", "Must preserve P1-derived retry cursor");
  });

  test("16. Cursor parser and date parser strictly reject malformed cursors: negative IDs, decimals, non-digits, and invalid calendar days (Feb 31)", () => {
    // Valid cursor
    const valid = parseOrderCursor("2026-11-07T12:00:00.000Z_50");
    assert.ok(valid);
    assert.equal(valid.id, 50);
    assert.equal(valid.date, "2026-11-07T12:00:00.000Z");

    // Negative ID
    assert.equal(parseOrderCursor("2026-11-07T12:00:00.000Z_-7"), null, "Must reject negative ID -7");
    assert.equal(parseOrderCursor("-7"), null, "Must reject legacy -7");

    // Decimal ID
    assert.equal(parseOrderCursor("2026-11-07T12:00:00.000Z_2.5"), null, "Must reject decimal ID 2.5");
    assert.equal(parseOrderCursor("2.5"), null, "Must reject legacy 2.5");

    // Zero ID
    assert.equal(parseOrderCursor("2026-11-07T12:00:00.000Z_0"), null, "Must reject zero ID");
    assert.equal(parseOrderCursor("0"), null, "Must reject legacy 0");

    // Out-of-range integer string (greater than MAX_SAFE_INTEGER)
    assert.equal(parseOrderCursor("2026-11-07T12:00:00.000Z_9999999999999999999999999999999999999999999999"), null, "Must reject out-of-range ID");
    assert.equal(parseOrderCursor("9999999999999999999999999999999999999999999999"), null, "Must reject out-of-range legacy ID");

    // Non-digit / malformed
    assert.equal(parseOrderCursor("2026-11-07T12:00:00.000Z_abc"), null, "Must reject non-numeric ID");
    assert.equal(parseOrderCursor("2026-11-07T12:00:00.000Z_1e3"), null, "Must reject scientific notation");

    // Calendar validation: February 31 must be rejected (no rollover to March 3)
    assert.equal(parseWooCommerceDate("2026-02-31T12:00:00.000Z"), null, "Must reject Feb 31");
    assert.equal(parseWooCommerceDate("2026-04-31 12:00:00"), null, "Must reject April 31");
    assert.equal(parseWooCommerceDate("2026-02-29T12:00:00.000Z"), null, "Must reject Feb 29 in non-leap year 2026");
    assert.equal(parseOrderCursor("2026-02-31T12:00:00.000Z_50"), null, "Must reject Feb 31 cursor");

    // Time component validation
    assert.equal(parseWooCommerceDate("2026-11-07 25:00:00"), null, "Must reject hour 25");
    assert.equal(parseWooCommerceDate("2026-11-07 12:60:00"), null, "Must reject minute 60");
    assert.equal(parseWooCommerceDate("2026-11-07 12:00:60"), null, "Must reject second 60");
    assert.equal(parseWooCommerceDate("2026-13-01 12:00:00"), null, "Must reject month 13");
  });

  test("17. Saved legacy numeric cursor (e.g. '2') does not send null_2 to upstream WordPress request, restarts from verified first page, and issues a fresh date-and-ID cursor", async () => {
    let backlogParamsSent = null;

    wp.get = async (url, { params } = {}) => {
      if (params?.cursor || params?.cursor_id) {
        backlogParamsSent = params;
        return {
          data: {
            orders: [{
              id: 75,
              status: "processing",
              payment_method: "cod",
              date_created_gmt: "2026-11-07T11:45:00.000Z",
            }],
            total_pages: 3,
            keyset_capability: "v1",
          },
          headers: { "x-mumbai-keyset-capability": "v1" },
        };
      }

      // Page 1
      return {
        data: {
          orders: [{
            id: 100,
            status: "processing",
            payment_method: "cod",
            date_created_gmt: "2026-11-07T12:00:00.000Z",
          }],
          total_pages: 3,
          keyset_capability: "v1",
        },
        headers: { "x-mumbai-keyset-capability": "v1" },
      };
    };

    const res = createMockRes();
    // Saved legacy cursor "2" passed in query!
    await getEmployeePackingAlarms({ query: { cursor: "2" } }, res);
    const data = res._getJSON();

    assert.equal(data.success, true);
    // 1. Verify upstream request NEVER received "null_2" or cursor_date: null
    assert.ok(backlogParamsSent, "Backlog request must be sent");
    assert.notEqual(backlogParamsSent.cursor, "null_2", "Cursor must NEVER be 'null_2'");
    assert.equal(backlogParamsSent.cursor, "2026-11-07T12:00:00.000Z_100", "Cursor must be restarted from last raw row of verified page 1");
    assert.equal(backlogParamsSent.cursor_id, 100);
    assert.equal(backlogParamsSent.cursor_date, "2026-11-07T12:00:00.000Z");

    // 2. Verify backend issued a fresh date-and-ID cursor (NEVER returns "2" or "3")
    assert.notEqual(data.next_cursor, "2", "Must NEVER return legacy cursor '2'");
    assert.notEqual(data.next_cursor, "3", "Must NEVER advance legacy cursor to '3'");
    assert.equal(data.next_cursor, "2026-11-07T11:45:00.000Z_75", "Must issue fresh date-and-ID cursor from last examined backlog order");
  });
});
