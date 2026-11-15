import test from "node:test";
import assert from "node:assert/strict";
import { clearDashboardCache, getDashboardCache, setDashboardCache, mergeDegradedOverview } from "../src/utils/dashboardCache.js";

test("dashboard cache is scoped to the employee and can be cleared at logout", () => {
  clearDashboardCache();
  setDashboardCache(1, { orders: [42] });
  assert.deepEqual(getDashboardCache("1"), { orders: [42] });
  assert.equal(getDashboardCache(2), null);
  clearDashboardCache();
  assert.equal(getDashboardCache(1), null);
});

test("only unavailable dashboard sections use previous values", () => {
  const previous = { summary: { ordersToPack: 4, receivedToday: 8 }, ordersNeedingAction: [{ id: 1 }] };
  const incoming = { is_degraded: true, unavailable_sections: ["order_summary", "action_orders"], summary: { ordersToPack: null, receivedToday: 9 }, ordersNeedingAction: [] };
  const result = mergeDegradedOverview(previous, incoming);
  assert.equal(result.summary.ordersToPack, 4);
  assert.equal(result.summary.receivedToday, 9);
  assert.deepEqual(result.ordersNeedingAction, [{ id: 1 }]);
  assert.equal(result.has_stale_data, true);
  assert.equal(mergeDegradedOverview(null, incoming).summary.ordersToPack, null);
});
