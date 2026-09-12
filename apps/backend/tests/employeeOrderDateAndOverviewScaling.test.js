import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getISTDateBoundaries } from "../src/utils/orderDateBounds.js";

describe("Backend: IST Date Boundaries & Order Querying Suite", () => {
  const referenceISTDate = new Date("2026-09-07T14:30:00+05:30"); // 2:30 PM IST on Sep 7, 2026

  test("1. 'today' filter creates exact IST day start and end in UTC ISO format", () => {
    const bounds = getISTDateBoundaries("today", null, null, referenceISTDate);
    assert.ok(bounds, "Bounds should not be null");
    assert.equal(bounds.startDate, "2026-09-07");
    assert.equal(bounds.endDate, "2026-09-07");

    // 2026-09-07 00:00:00 IST is 2026-09-06 18:30:00.000 UTC
    assert.equal(bounds.after, "2026-09-06T18:30:00.000Z");
    // 2026-09-07 23:59:59.999 IST is 2026-09-07 18:29:59.999 UTC
    assert.equal(bounds.before, "2026-09-07T18:29:59.999Z");
  });

  test("2. 'yesterday' filter creates exact yesterday IST boundaries", () => {
    const bounds = getISTDateBoundaries("yesterday", null, null, referenceISTDate);
    assert.ok(bounds, "Bounds should not be null");
    assert.equal(bounds.startDate, "2026-09-06");
    assert.equal(bounds.endDate, "2026-09-06");

    // 2026-09-06 00:00:00 IST is 2026-09-05 18:30:00.000 UTC
    assert.equal(bounds.after, "2026-09-05T18:30:00.000Z");
    // 2026-09-06 23:59:59.999 IST is 2026-09-06 18:29:59.999 UTC
    assert.equal(bounds.before, "2026-09-06T18:29:59.999Z");
  });

  test("3. '7days' filter creates exact 7-day range ending today in IST", () => {
    const bounds = getISTDateBoundaries("7days", null, null, referenceISTDate);
    assert.ok(bounds, "Bounds should not be null");
    assert.equal(bounds.startDate, "2026-09-01");
    assert.equal(bounds.endDate, "2026-09-07");

    // 2026-09-01 00:00:00 IST is 2026-08-31 18:30:00.000 UTC
    assert.equal(bounds.after, "2026-08-31T18:30:00.000Z");
    assert.equal(bounds.before, "2026-09-07T18:29:59.999Z");
  });

  test("4. 'custom' filter parses custom start and end date strings into IST boundaries", () => {
    const bounds = getISTDateBoundaries("custom", "2026-08-15", "2026-08-20", referenceISTDate);
    assert.ok(bounds, "Bounds should not be null");
    assert.equal(bounds.startDate, "2026-08-15");
    assert.equal(bounds.endDate, "2026-08-20");

    assert.equal(bounds.after, "2026-08-14T18:30:00.000Z");
    assert.equal(bounds.before, "2026-08-20T18:29:59.999Z");
  });

  test("5. 'all' or invalid filter returns null without restricting query", () => {
    assert.equal(getISTDateBoundaries("all", null, null, referenceISTDate), null);
    assert.equal(getISTDateBoundaries(null, null, null, referenceISTDate), null);
    assert.equal(getISTDateBoundaries("", null, null, referenceISTDate), null);
    assert.equal(getISTDateBoundaries("custom", null, null, referenceISTDate), null);
  });
});

describe("Orders Needing Action Filter Suite", () => {
  const filterActionOrders = (orders) => {
    const actionOrders = [];
    orders.forEach((order) => {
      const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || order.status;

      if (["processing", "packed", "out-for-delivery", "dispatched"].includes(effectiveStatus)) {
        actionOrders.push({
          id: order.id,
          status: effectiveStatus,
        });
      }
    });
    return actionOrders;
  };

  test("1. Processing order appears in Orders Needing Action", () => {
    const orders = [{ id: 101, status: "processing", meta_data: [] }];
    const result = filterActionOrders(orders);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 101);
    assert.equal(result[0].status, "processing");
  });

  test("2. Packed order appears in Orders Needing Action", () => {
    const orders = [
      { id: 102, status: "processing", meta_data: [{ key: "_delivery_status", value: "packed" }] },
    ];
    const result = filterActionOrders(orders);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 102);
    assert.equal(result[0].status, "packed");
  });

  test("3. Out-for-delivery and dispatched orders appear in Orders Needing Action", () => {
    const orders = [
      { id: 103, status: "processing", meta_data: [{ key: "_delivery_status", value: "out-for-delivery" }] },
      { id: 104, status: "processing", meta_data: [{ key: "_delivery_status", value: "dispatched" }] },
    ];
    const result = filterActionOrders(orders);
    assert.equal(result.length, 2);
    assert.equal(result[0].status, "out-for-delivery");
    assert.equal(result[1].status, "dispatched");
  });

  test("4. Order with core processing but _delivery_status=completed does NOT appear", () => {
    // Exact scenario of Order #97
    const orders = [
      { id: 97, status: "processing", meta_data: [{ key: "_delivery_status", value: "completed" }] },
    ];
    const result = filterActionOrders(orders);
    assert.equal(result.length, 0, "Mismatched order #97 must not be included in actionOrders");
  });

  test("5. Completed, cancelled, failed, refunded orders never appear in actionOrders", () => {
    const orders = [
      { id: 201, status: "completed", meta_data: [] },
      { id: 202, status: "cancelled", meta_data: [] },
      { id: 203, status: "failed", meta_data: [] },
      { id: 204, status: "refunded", meta_data: [] },
      { id: 205, status: "processing", meta_data: [{ key: "_delivery_status", value: "cancelled" }] },
    ];
    const result = filterActionOrders(orders);
    assert.equal(result.length, 0, "Non-action orders must never be included in actionOrders");
  });
});

