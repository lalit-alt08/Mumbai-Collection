import test from "node:test";
import assert from "node:assert/strict";

/**
 * Matching helper from Orders.jsx
 */
const isOrderDeliveredLocked = (order, now = Date.now()) => {
  if (!order) return false;
  const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
  const effectiveStatus = deliveryMeta?.value || order.status;
  const isDelivered = effectiveStatus === "completed";
  if (!isDelivered) return false;

  // If server explicitly marked it as locked, lock immediately
  if (order.is_status_locked === true) {
    return true;
  }

  let timestamp = null;

  // 1. _delivery_completed_at / delivery_completed_at
  const deliveryCompletedAt =
    order.delivery_completed_at ||
    order.meta_data?.find((m) => m.key === "_delivery_completed_at")?.value ||
    order.meta_data?.find((m) => m.key === "_delivered_at")?.value;

  if (deliveryCompletedAt) {
    const t = new Date(deliveryCompletedAt).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  // 2. date_completed_gmt
  if (!timestamp && order.date_completed_gmt) {
    const s = order.date_completed_gmt.endsWith("Z")
      ? order.date_completed_gmt
      : `${order.date_completed_gmt}Z`;
    const t = new Date(s).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  // 3. date_completed
  if (!timestamp && order.date_completed) {
    const t = new Date(order.date_completed).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  // 4. date_created_gmt
  if (!timestamp && order.date_created_gmt) {
    const s = order.date_created_gmt.endsWith("Z")
      ? order.date_created_gmt
      : `${order.date_created_gmt}Z`;
    const t = new Date(s).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  // 5. date_created
  if (!timestamp && order.date_created) {
    const t = new Date(order.date_created).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  if (timestamp) {
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    return (now - timestamp) >= TWENTY_FOUR_HOURS_MS;
  }

  // Fail closed: completed order with no usable timestamps is locked
  return true;
};

test("Order Fulfillment Status Lock: 24-Hour Rule Test Suite (Frontend UI Logic)", async (t) => {
  const BASE_TIME = new Date("2026-09-06T12:00:00.000Z").getTime();
  const ONE_MINUTE_MS = 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS;

  await t.test("1. Completed 23h59m ago => editable (lock is false)", () => {
    const deliveredAt = new Date(BASE_TIME - (TWENTY_FOUR_HOURS_MS - ONE_MINUTE_MS)).toISOString();
    const order = {
      id: 101,
      status: "completed",
      delivery_completed_at: deliveredAt,
    };

    const isLocked = isOrderDeliveredLocked(order, BASE_TIME);
    assert.equal(isLocked, false, "Order delivered 23h59m ago must remain editable");
  });

  await t.test("2. Completed exactly 24h ago => locked (lock is true)", () => {
    const deliveredAt = new Date(BASE_TIME - TWENTY_FOUR_HOURS_MS).toISOString();
    const order = {
      id: 102,
      status: "completed",
      delivery_completed_at: deliveredAt,
    };

    const isLocked = isOrderDeliveredLocked(order, BASE_TIME);
    assert.equal(isLocked, true, "Order delivered exactly 24h ago must be locked");
  });

  await t.test("3. Completed 25h+ ago => locked (lock is true)", () => {
    const delivered25hAgo = new Date(BASE_TIME - 25 * ONE_HOUR_MS).toISOString();
    const order25h = {
      id: 103,
      status: "completed",
      delivery_completed_at: delivered25hAgo,
    };
    assert.equal(isOrderDeliveredLocked(order25h, BASE_TIME), true, "Order delivered 25h ago must be locked");

    const delivered48hAgo = new Date(BASE_TIME - 48 * ONE_HOUR_MS).toISOString();
    const order48h = {
      id: 104,
      status: "completed",
      date_completed_gmt: delivered48hAgo,
    };
    assert.equal(isOrderDeliveredLocked(order48h, BASE_TIME), true, "Order delivered 48h ago must be locked");
  });

  await t.test("4. Completed with no completion timestamp but old date_created => locked", () => {
    const oldCreated = new Date(BASE_TIME - 72 * ONE_HOUR_MS).toISOString();
    const order = {
      id: 105,
      status: "completed",
      date_created_gmt: oldCreated,
    };
    assert.equal(
      isOrderDeliveredLocked(order, BASE_TIME),
      true,
      "Completed order with old date_created must be locked"
    );

    const orderWithLocalCreated = {
      id: 106,
      status: "completed",
      date_created: oldCreated,
    };
    assert.equal(
      isOrderDeliveredLocked(orderWithLocalCreated, BASE_TIME),
      true,
      "Completed order with old local date_created must be locked"
    );
  });

  await t.test("5. Completed with no usable timestamps => FAIL CLOSED (locked)", () => {
    const orderWithNoTimestamps = {
      id: 107,
      status: "completed",
    };
    assert.equal(
      isOrderDeliveredLocked(orderWithNoTimestamps, BASE_TIME),
      true,
      "Completed order with no timestamps must fail closed and be locked"
    );

    const orderWithOnlyModified = {
      id: 108,
      status: "completed",
      date_modified: new Date(BASE_TIME - 5 * ONE_MINUTE_MS).toISOString(),
      date_modified_gmt: new Date(BASE_TIME - 5 * ONE_MINUTE_MS).toISOString(),
    };
    assert.equal(
      isOrderDeliveredLocked(orderWithOnlyModified, BASE_TIME),
      true,
      "Order with only date_modified must not use date_modified and must fail closed to locked"
    );
  });

  await t.test("6. Non-completed orders => editable (lock is false regardless of age)", () => {
    const oldTimestamp = new Date(BASE_TIME - 72 * ONE_HOUR_MS).toISOString();

    const processingOrder = {
      id: 201,
      status: "processing",
      date_created: oldTimestamp,
      delivery_completed_at: oldTimestamp,
    };
    assert.equal(isOrderDeliveredLocked(processingOrder, BASE_TIME), false, "Processing orders must never be locked");

    const packedOrder = {
      id: 202,
      status: "packed",
      date_created: oldTimestamp,
    };
    assert.equal(isOrderDeliveredLocked(packedOrder, BASE_TIME), false, "Packed orders must never be locked");

    const outForDeliveryOrder = {
      id: 203,
      status: "out-for-delivery",
      date_created: oldTimestamp,
    };
    assert.equal(isOrderDeliveredLocked(outForDeliveryOrder, BASE_TIME), false, "Out for delivery orders must never be locked");

    const cancelledOrder = {
      id: 204,
      status: "cancelled",
      date_created: oldTimestamp,
    };
    assert.equal(isOrderDeliveredLocked(cancelledOrder, BASE_TIME), false, "Cancelled orders must never be locked");
  });

  await t.test("7. is_status_locked === true => locked immediately", () => {
    const recentTime = new Date(BASE_TIME - 5 * ONE_MINUTE_MS).toISOString();
    const order = {
      id: 301,
      status: "completed",
      delivery_completed_at: recentTime,
      is_status_locked: true,
    };
    assert.equal(
      isOrderDeliveredLocked(order, BASE_TIME),
      true,
      "Order with is_status_locked === true must be locked immediately even if recent"
    );
  });

  await t.test("8. Order #222 simulation (historical completed order) => locked using actual date_completed_gmt", () => {
    const order222 = {
      id: 222,
      order_number: "222",
      status: "completed",
      date_created: "2026-09-02T11:12:06",
      date_created_gmt: "2026-09-02T11:12:06",
      date_completed: "2026-09-02T11:16:11",
      date_completed_gmt: "2026-09-02T11:16:11",
      delivery_completed_at: null,
      is_status_locked: true,
    };
    assert.equal(
      isOrderDeliveredLocked(order222, BASE_TIME),
      true,
      "Order #222 must be locked using its actual date_completed_gmt"
    );
  });
});
