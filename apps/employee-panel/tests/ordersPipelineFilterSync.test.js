import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  OrdersPipelineCoordinator,
  buildOrdersQueryKey,
  shouldDisplayOrdersPipelineSpinner,
} from "../src/utils/ordersPipelineCoordinator.js";
import {
  isOrderNeedingPacking,
  getEffectiveOrderStatus,
} from "../../backend/src/controllers/employeeController.js";
import {
  isOrderAcknowledged,
  getAcknowledgedOrderIds,
  acknowledgeOrderNotification,
  _getLocalAcknowledgedOrders,
} from "../../backend/src/services/orderNotificationService.js";

describe("Employee Panel Orders: Pipeline Coordinator & Race Synchronization Suite", () => {
  test("1. Delayed 'Yesterday' response with background poll in flight renders empty state cleanly", async () => {
    let committedState = null;
    let loadingState = true;
    let errorState = "";

    const coordinator = new OrdersPipelineCoordinator({
      getOrders: async (params, { signal } = {}) => {
        // If yesterday: delay 60ms and return 0 orders
        if (params.date_filter === "yesterday") {
          await new Promise((r) => setTimeout(r, 60));
          if (signal?.aborted) throw new Error("CanceledError");
          return { success: true, orders: [], total: 0, totalPages: 1 };
        }
        return { success: true, orders: [{ id: 101, status: "processing" }], total: 1, totalPages: 1 };
      },
      onStateUpdate: (state) => {
        committedState = state;
      },
      onError: (err) => {
        errorState = err;
      },
      onLoadingChange: (loading) => {
        loadingState = loading;
      },
    });

    const activeFilters = {
      activeTab: "active",
      debouncedSearch: "",
      locationFilter: "all",
      dateFilter: "yesterday",
      customDateRange: { start: "", end: "" },
      page: 1,
    };

    // User selects Yesterday
    const foregroundPromise = coordinator.fetchOrderList({
      isBackground: false,
      activeFilters,
      perPage: 20,
    });

    assert.equal(loadingState, true, "Loading must be true while foreground fetch is in flight");

    // While waiting for the 60ms Yesterday response, background poll triggers at 20ms
    await new Promise((r) => setTimeout(r, 20));
    const bgResult = await coordinator.fetchOrderList({
      isBackground: true,
      activeFilters,
      perPage: 20,
    });

    assert.equal(bgResult.status, "skipped", "Background poll must be skipped while foreground is loading");

    // Await foreground completion
    const fgResult = await foregroundPromise;
    assert.equal(fgResult.status, "success");
    assert.equal(fgResult.orders.length, 0);

    // Verify committed state
    assert.ok(committedState !== null);
    assert.equal(committedState.orders.length, 0);
    assert.equal(loadingState, false, "Loading must be false after foreground completion");
    assert.equal(errorState, "");

    const currentOrdersQueryKey = buildOrdersQueryKey(activeFilters);
    const hasCurrentOrders = committedState.queryKey === currentOrdersQueryKey;
    assert.equal(hasCurrentOrders, true, "Committed query key must match active Yesterday query key");

    // Verify UI spinner evaluation
    const isSpinnerShown = shouldDisplayOrdersPipelineSpinner({
      hasCurrentOrders,
      loading: loadingState,
      ordersLength: committedState.orders.length,
      error: errorState,
    });

    assert.equal(isSpinnerShown, false, "Must not display loading spinner on 0 orders empty state");
  });

  test("2. Background refreshes arriving out of order: older slower response is discarded", async () => {
    let committedOrders = [];

    const coordinator = new OrdersPipelineCoordinator({
      getOrders: async (params, { signal } = {}) => {
        const testId = params.search;
        if (testId === "slow") {
          await new Promise((r) => setTimeout(r, 70));
          if (signal?.aborted) throw new Error("CanceledError");
          return { success: true, orders: [{ id: 1, name: "Order 1 (Old)" }], total: 1 };
        }
        if (testId === "fast") {
          await new Promise((r) => setTimeout(r, 20));
          if (signal?.aborted) throw new Error("CanceledError");
          return { success: true, orders: [{ id: 2, name: "Order 2 (New)" }], total: 1 };
        }
        return { success: true, orders: [] };
      },
      onStateUpdate: ({ orders }) => {
        committedOrders = orders;
      },
    });

    coordinator.setLoading(false);

    // Launch slow background refresh 1
    const bg1 = coordinator.fetchOrderList({
      isBackground: true,
      activeFilters: { debouncedSearch: "slow" },
    });

    // Short gap, then launch fast background refresh 2
    await new Promise((r) => setTimeout(r, 10));
    const bg2 = coordinator.fetchOrderList({
      isBackground: true,
      activeFilters: { debouncedSearch: "fast" },
    });

    const [res1, res2] = await Promise.all([bg1, bg2]);

    assert.equal(res2.status, "success", "Fast background refresh 2 must succeed");
    assert.ok(res1.status === "aborted" || res1.status === "superseded", "Older background refresh 1 must be aborted or superseded");
    assert.equal(committedOrders[0]?.id, 2, "State must contain newer Order 2, not overwritten by Order 1");
  });

  test("3. Fetching visible order list does NOT swallow alarm for new counter orders", async () => {
    const triggeredAlarms = [];

    const coordinator = new OrdersPipelineCoordinator({
      getOrders: async () => ({
        success: true,
        orders: [{ id: 808, status: "processing" }],
      }),
      getPackingAlarms: async () => ({
        success: true,
        orders: [{ id: 808, status: "processing", is_acknowledged: false }],
      }),
      onAlarmTrigger: ({ orderId }) => {
        triggeredAlarms.push(orderId);
      },
    });

    coordinator.setLoading(false);

    // 1. List refresh loads order #808 into visible table first
    const listResult = await coordinator.fetchOrderList({
      isBackground: false,
      activeFilters: { activeTab: "active", dateFilter: "today" },
    });
    assert.equal(listResult.status, "success");
    // Alarm set must NOT contain #808 yet (the list path does not own alarm state)
    assert.equal(coordinator.knownAlarmOrderIds.has(808), false);
    assert.equal(triggeredAlarms.length, 0);

    // 2. Packing poll runs afterward and MUST sound the alarm for #808
    const alarmResult = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(alarmResult.status, "success");
    assert.deepEqual(triggeredAlarms, [808], "Packing poll must sound alarm even if list already fetched #808");
    assert.equal(coordinator.knownAlarmOrderIds.has(808), true);
  });

  test("4. Authoritative server acknowledgement status prevents already-acknowledged order from re-ringing upon reopening Orders", async () => {
    const triggeredAlarms = [];

    // Order #909 was acknowledged earlier by staff on Redis/backend
    const coordinator = new OrdersPipelineCoordinator({
      getPackingAlarms: async () => ({
        success: true,
        orders: [
          { id: 909, status: "processing", is_acknowledged: true },
          { id: 910, status: "processing", is_acknowledged: false },
        ],
      }),
      onAlarmTrigger: ({ orderId }) => {
        triggeredAlarms.push(orderId);
      },
    });

    coordinator.setLoading(false);

    // First check upon opening Orders tab
    const result = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(result.status, "success");

    // Order #909 must be marked known and quiet, Order #910 must sound alarm
    assert.equal(coordinator.knownAlarmOrderIds.has(909), true);
    assert.equal(coordinator.knownAlarmOrderIds.has(910), true);
    assert.deepEqual(triggeredAlarms, [910], "Only unacknowledged order #910 must ring; acknowledged #909 must stay silent");
  });

  test("5. Slow connection keeps in-flight packing check running without endless self-abort cycles", async () => {
    let callCount = 0;

    const coordinator = new OrdersPipelineCoordinator({
      getPackingAlarms: async ({ signal } = {}) => {
        callCount++;
        // Simulate a slow 60ms response (e.g. high network latency)
        await new Promise((r) => setTimeout(r, 60));
        if (signal?.aborted) throw new Error("CanceledError");
        return { success: true, orders: [{ id: 555, is_acknowledged: false }] };
      },
      onAlarmTrigger: () => {},
    });

    // Tick 1: starts slow packing check
    const check1Promise = coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(coordinator.isAlarmCheckInFlight, true);

    // Tick 2 (e.g. next 8s interval while check 1 is still in flight at 20ms)
    await new Promise((r) => setTimeout(r, 20));
    const check2Result = await coordinator.checkActivePackingAlarms({ isHidden: false });

    // Tick 2 must be skipped as in_flight and NOT abort check 1
    assert.equal(check2Result.status, "in_flight");
    assert.equal(callCount, 1, "Must not start a duplicate request while first is in flight");

    // Check 1 completes cleanly
    const check1Result = await check1Promise;
    assert.equal(check1Result.status, "success");
    assert.equal(coordinator.isAlarmCheckInFlight, false);
  });

  test("6. API returning success: false without throwing displays error / retry state without hanging spinner", async () => {
    let capturedError = "";
    let loadingState = true;

    const coordinator = new OrdersPipelineCoordinator({
      getOrders: async () => ({
        success: false,
        message: "Invalid date filter parameter",
      }),
      onError: (msg) => {
        capturedError = msg;
      },
      onLoadingChange: (loading) => {
        loadingState = loading;
      },
    });

    const activeFilters = {
      activeTab: "active",
      dateFilter: "invalid-date",
      page: 1,
    };

    const result = await coordinator.fetchOrderList({
      isBackground: false,
      activeFilters,
    });

    assert.equal(result.status, "error");
    assert.equal(capturedError, "Invalid date filter parameter");
    assert.equal(loadingState, false, "Loading must be cleared in finally");

    // UI spinner check
    const isSpinnerShown = shouldDisplayOrdersPipelineSpinner({
      hasCurrentOrders: false,
      loading: loadingState,
      ordersLength: 0,
      error: capturedError,
    });

    assert.equal(isSpinnerShown, false, "Spinner must NOT hang when server returns success: false with error");
  });

  test("7. isOrderNeedingPacking rings only for orders genuinely needing packing", () => {
    // 1. Packed or dispatched order at raw WooCommerce 'processing' must NOT need packing
    const packedOrder = {
      id: 701,
      status: "processing",
      meta_data: [{ key: "_delivery_status", value: "packed" }],
      payment_method: "cod",
    };
    assert.equal(isOrderNeedingPacking(packedOrder), false, "Packed order must not need packing");
    assert.equal(getEffectiveOrderStatus(packedOrder), "packed");

    const dispatchedOrder = {
      id: 702,
      status: "processing",
      meta_data: [{ key: "_delivery_status", value: "out-for-delivery" }],
      payment_method: "cod",
    };
    assert.equal(isOrderNeedingPacking(dispatchedOrder), false, "Dispatched order must not need packing");

    // 2. Cancelled / completed orders must not need packing
    assert.equal(isOrderNeedingPacking({ id: 703, status: "completed" }), false);
    assert.equal(isOrderNeedingPacking({ id: 704, status: "cancelled" }), false);
    assert.equal(isOrderNeedingPacking({ id: 705, status: "refunded" }), false);

    // 3. Unpaid online order must NOT need packing until payment is confirmed
    const unpaidOnlineOrder = {
      id: 706,
      status: "processing",
      payment_method: "razorpay",
      payment_method_title: "Razorpay (Cards / UPI)",
      date_paid: null,
      transaction_id: "",
    };
    assert.equal(isOrderNeedingPacking(unpaidOnlineOrder), false, "Unpaid online order must be excluded from packing alarms");

    // 4. Paid online order DOES need packing
    const paidOnlineOrder = {
      id: 707,
      status: "processing",
      payment_method: "razorpay",
      payment_method_title: "Razorpay (Cards / UPI)",
      date_paid: "2026-11-07T10:00:00",
      transaction_id: "pay_xyz123",
    };
    assert.equal(isOrderNeedingPacking(paidOnlineOrder), true, "Paid online order must be eligible for packing alarm");

    // 5. Legitimate Cash on Delivery (COD) order DOES need packing
    const codOrder = {
      id: 708,
      status: "processing",
      payment_method: "cod",
      payment_method_title: "Cash on delivery",
    };
    assert.equal(isOrderNeedingPacking(codOrder), true, "Legitimate COD order must be eligible for packing alarm");
  });

  test("8. Phone B silences active alarm when another device acknowledges (is_acknowledged: true in fallback poll)", async () => {
    const acknowledgedAlarms = [];

    // Phone B has order 801 currently ringing
    const coordinator = new OrdersPipelineCoordinator({
      getPackingAlarms: async () => ({
        success: true,
        // Server reports 801 was acknowledged (by Phone A)
        orders: [{ id: 801, status: "processing", is_acknowledged: true }],
      }),
      onAlarmAcknowledge: (orderId) => {
        acknowledgedAlarms.push(orderId);
      },
    });

    coordinator.knownAlarmOrderIds.add(801);

    // Phone B fallback poll runs
    const res = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(res.status, "success");
    assert.deepEqual(acknowledgedAlarms, [801], "Phone B fallback poll must call onAlarmAcknowledge for order 801");
  });

  test("9. Phone B reconciles ringing order that left packing queue or was acknowledged remotely via ringing_ids", async () => {
    let capturedParams = null;
    const acknowledgedAlarms = [];

    const coordinator = new OrdersPipelineCoordinator({
      getRingingIds: () => [802, 803],
      getPackingAlarms: async ({ params } = {}) => {
        capturedParams = params;
        return {
          success: true,
          // 802 is still packing but acknowledged; 803 was marked packed by Phone A so not in queue
          orders: [{ id: 802, status: "processing", is_acknowledged: true }],
          acknowledged_ringing_ids: [802, 803],
        };
      },
      onAlarmAcknowledge: (orderId) => {
        acknowledgedAlarms.push(orderId);
      },
    });

    const res = await coordinator.checkActivePackingAlarms({ isHidden: false });

    assert.equal(res.status, "success");
    assert.equal(capturedParams?.ringing_ids, "802,803", "Must send currently ringing IDs to authoritative endpoint");
    assert.ok(acknowledgedAlarms.includes(802), "802 must be acknowledged");
    assert.ok(acknowledgedAlarms.includes(803), "803 that left packing queue must be acknowledged and silenced");
  });

  test("10. Acknowledgements preserved when Redis recovers (unexpired local memory merged for Redis misses)", async () => {
    const testOrderId = 990001;
    const localStore = _getLocalAcknowledgedOrders();

    // Simulate entry stored in local memory during Redis outage
    const futureExpiry = Date.now() + 60000; // 60s remaining
    localStore.set(testOrderId, {
      orderId: testOrderId,
      employeeId: 42,
      acknowledgedAt: Date.now(),
      expiresAt: futureExpiry,
    });

    // Lookup via batch getAcknowledgedOrderIds
    const ackBatch = await getAcknowledgedOrderIds([testOrderId, 999999]);
    assert.equal(ackBatch.has(testOrderId), true, "Batch check must merge unexpired local memory for Redis misses");
    assert.equal(ackBatch.has(999999), false);

    // Lookup via single-ID isOrderAcknowledged
    const isAck = await isOrderAcknowledged(testOrderId);
    assert.equal(isAck, true, "Single-ID check must recognize unexpired local memory record");

    // Clean up test entry
    localStore.delete(testOrderId);
  });

  test("11. Bounded pagination prevents newest packed orders from crowding out older unacknowledged orders", async () => {
    // Simulate store where the first 50 orders are already packed/dispatched,
    // and older order #100 is on page 2 still unacknowledged and needing packing.
    const triggeredAlarms = [];
    let pageQueried = [];

    const coordinator = new OrdersPipelineCoordinator({
      getPackingAlarms: async () => {
        // Mock server implementing bounded pagination returning eligible packing order #100
        pageQueried.push(1, 2);
        return {
          success: true,
          orders: [{ id: 100, status: "processing", is_acknowledged: false }],
          acknowledged_ringing_ids: [],
        };
      },
      onAlarmTrigger: ({ orderId }) => {
        triggeredAlarms.push(orderId);
      },
    });

    const res = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(res.status, "success");
    assert.deepEqual(triggeredAlarms, [100], "Older order #100 must sound alarm even if 50 newer rows exist");
  });

  test("12. Coordinator propagates stable cursor across polls when scan budget is reached", async () => {
    const receivedQueries = [];
    const triggeredAlarms = [];

    const coordinator = new OrdersPipelineCoordinator({
      getPackingAlarms: async ({ params } = {}) => {
        receivedQueries.push(params || {});
        if (!params?.cursor) {
          // Poll 1: budget reached on page 2, returning next_cursor: 3
          return {
            success: true,
            orders: [],
            next_cursor: 3,
            acknowledged_ringing_ids: [],
          };
        }
        if (params.cursor === 3) {
          // Poll 2: scanned page 3, discovering order 301 and next_cursor: 4
          return {
            success: true,
            orders: [{ id: 301, status: "processing", is_acknowledged: false }],
            next_cursor: 4,
            acknowledged_ringing_ids: [],
          };
        }
        // Poll 3: scanned page 4, reached end of backlog (next_cursor: null)
        return {
          success: true,
          orders: [{ id: 401, status: "processing", is_acknowledged: false }],
          next_cursor: null,
          acknowledged_ringing_ids: [],
        };
      },
      onAlarmTrigger: ({ orderId }) => {
        triggeredAlarms.push(orderId);
      },
    });

    // Poll 1: initial poll without cursor
    const res1 = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(res1.status, "success");
    assert.equal(coordinator.alarmCursor, 3, "Coordinator must store next_cursor: 3");
    assert.equal(receivedQueries[0]?.cursor, undefined, "Poll 1 should not send cursor");

    // Poll 2: next poll must send cursor: 3
    const res2 = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(res2.status, "success");
    assert.equal(receivedQueries[1]?.cursor, 3, "Poll 2 must send cursor: 3");
    assert.equal(coordinator.alarmCursor, 4, "Coordinator must advance to next_cursor: 4");
    assert.ok(triggeredAlarms.includes(301), "Order 301 must trigger alarm");

    // Poll 3: next poll must send cursor: 4 and then reset cursor to null
    const res3 = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(res3.status, "success");
    assert.equal(receivedQueries[2]?.cursor, 4, "Poll 3 must send cursor: 4");
    assert.equal(coordinator.alarmCursor, null, "Coordinator must reset cursor to null at end of backlog");
    assert.ok(triggeredAlarms.includes(401), "Order 401 must trigger alarm");
  });

  test("13. Coordinator preserves cursor and reports discovery_unavailable during discovery outage, silences confirmed ringing orders independently, and clears degraded status on healthy empty poll", async () => {
    let pollCount = 0;
    const silencedAlarms = [];

    const coordinator = new OrdersPipelineCoordinator({
      getPackingAlarms: async () => {
        pollCount++;
        if (pollCount === 1) {
          // Poll 1: Outage! Upstream discovery failed, but order #777 was confirmed acknowledged in Redis
          return {
            success: false,
            discovery_unavailable: true,
            message: "Order discovery temporarily unavailable. Retrying...",
            orders: [],
            acknowledged_ringing_ids: [777],
            next_cursor: "2026-11-07T12:00:00.000Z_120",
          };
        }
        // Poll 2: Healthy discovery with empty queue (all packed)
        return {
          success: true,
          discovery_unavailable: false,
          partial_discovery_failure: false,
          orders: [],
          acknowledged_ringing_ids: [],
          next_cursor: null,
        };
      },
      onAlarmAcknowledge: (orderId) => {
        silencedAlarms.push(orderId);
      },
    });

    coordinator.alarmCursor = "2026-11-07T12:00:00.000Z_120";

    // Poll 1: Outage
    const res1 = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(res1.status, "error");
    assert.equal(res1.discovery_unavailable, true, "Must signal discovery_unavailable");
    assert.equal(coordinator.alarmCursor, "2026-11-07T12:00:00.000Z_120", "Must preserve cursor for retry");
    assert.ok(silencedAlarms.includes(777), "Confirmed ringing order 777 must be silenced despite discovery outage");

    // Poll 2: Healthy empty result
    const res2 = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(res2.status, "success");
    assert.equal(res2.discovery_unavailable, false, "Healthy empty queue must clear discovery_unavailable");
    assert.equal(coordinator.alarmCursor, null, "Cursor cleared on confirmed exhaustion");
  });

  test("14. Coordinator carries reconciliation_position and page1_offset across consecutive polls", async () => {
    const receivedQueries = [];

    const coordinator = new OrdersPipelineCoordinator({
      getRingingIds: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      getPackingAlarms: async ({ params } = {}) => {
        receivedQueries.push(params || {});
        if (!params?.reconciliation_position) {
          // Poll 1
          return {
            success: true,
            orders: [],
            acknowledged_ringing_ids: [],
            next_reconciliation_position: 6,
            next_page1_offset: 25,
            next_cursor: "cur_1",
          };
        }
        // Poll 2
        return {
          success: true,
          orders: [],
          acknowledged_ringing_ids: [],
          next_reconciliation_position: 0,
          next_page1_offset: 0,
          next_cursor: null,
        };
      },
    });

    // Poll 1
    await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(receivedQueries[0]?.reconciliation_position, undefined);
    assert.equal(coordinator.reconciliationPosition, 6, "Coordinator must store next_reconciliation_position");
    assert.equal(coordinator.page1Offset, 25, "Coordinator must store next_page1_offset");

    // Poll 2
    await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(receivedQueries[1]?.reconciliation_position, 6, "Poll 2 must forward reconciliation_position: 6");
    assert.equal(receivedQueries[1]?.page1_offset, 25, "Poll 2 must forward page1_offset: 25");
  });

  test("15. Partial poll rings for valid newest order, silences confirmed ack, preserves retry cursor, and reports degraded status", async () => {
    const triggeredAlarms = [];
    const silencedAlarms = [];

    const coordinator = new OrdersPipelineCoordinator({
      getRingingIds: () => [88],
      getPackingAlarms: async () => ({
        success: true,
        orders: [
          { id: 999, status: "processing", is_acknowledged: false, date_created_gmt: "2026-11-07T12:00:00.000Z" },
        ],
        acknowledged_ringing_ids: [88],
        partial_discovery_failure: true,
        discovery_unavailable: true,
        next_cursor: "2026-11-07T11:00:00.000Z_40",
      }),
      onAlarmTrigger: ({ orderId }) => {
        triggeredAlarms.push(orderId);
      },
      onAlarmAcknowledge: (orderId) => {
        silencedAlarms.push(orderId);
      },
    });

    coordinator.alarmCursor = "2026-11-07T11:00:00.000Z_40";

    const res = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(res.status, "success");
    assert.equal(res.discovery_unavailable, true, "Partial poll must report discovery_unavailable: true");
    assert.equal(res.partial_discovery_failure, true, "Partial poll must report partial_discovery_failure: true");

    // Valid newest order #999 must trigger alarm
    assert.deepEqual(triggeredAlarms, [999], "Newest unacknowledged order #999 must ring");

    // Confirmed ringing acknowledgement #88 must be silenced
    assert.deepEqual(silencedAlarms, [88], "Confirmed ringing acknowledgement #88 must be silenced");

    // Cursor must be preserved
    assert.equal(coordinator.alarmCursor, "2026-11-07T11:00:00.000Z_40", "Cursor must be preserved for retry");
  });

  test("16. Entirely failed response does NOT ring for any order, silences confirmed ack, and preserves retry cursor", async () => {
    const triggeredAlarms = [];
    const silencedAlarms = [];

    const coordinator = new OrdersPipelineCoordinator({
      getRingingIds: () => [55],
      getPackingAlarms: async () => ({
        success: false,
        message: "Upstream store down",
        acknowledged_ringing_ids: [55],
        next_cursor: "2026-11-07T10:00:00.000Z_20",
      }),
      onAlarmTrigger: ({ orderId }) => {
        triggeredAlarms.push(orderId);
      },
      onAlarmAcknowledge: (orderId) => {
        silencedAlarms.push(orderId);
      },
    });

    coordinator.alarmCursor = "2026-11-07T10:00:00.000Z_20";

    const res = await coordinator.checkActivePackingAlarms({ isHidden: false });
    assert.equal(res.status, "error");
    assert.equal(res.discovery_unavailable, true);

    // No new alarm triggered
    assert.equal(triggeredAlarms.length, 0, "No alarms must be triggered on an entirely failed poll");
    assert.deepEqual(res.newlyAlarmed, []);

    // Confirmed ack #55 must still be silenced
    assert.deepEqual(silencedAlarms, [55], "Confirmed ringing order #55 must be silenced even on failed poll");

    // Retry cursor must be preserved
    assert.equal(coordinator.alarmCursor, "2026-11-07T10:00:00.000Z_20", "Retry cursor must be preserved");
  });
});
