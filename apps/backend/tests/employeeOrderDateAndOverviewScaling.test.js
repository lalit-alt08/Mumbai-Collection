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
    assert.equal(getISTDateBoundaries("custom", "2026-02-30", "2026-03-01", referenceISTDate), null);
    assert.equal(getISTDateBoundaries("custom", "2026-08-21", "2026-08-20", referenceISTDate), null);
  });

  test("date shifting and IST day boundaries are independent of host timezone", () => {
    const justAfterISTMidnight = new Date("2026-09-06T18:31:00.000Z");
    const today = getISTDateBoundaries("today", null, null, justAfterISTMidnight);
    assert.equal(today.startDate, "2026-09-07");
    assert.equal(getISTDateBoundaries("7days", null, null, justAfterISTMidnight).startDate, "2026-09-01");
  });
});
