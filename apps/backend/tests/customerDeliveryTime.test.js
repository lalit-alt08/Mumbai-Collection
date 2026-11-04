import test from "node:test";
import assert from "node:assert/strict";
import { customerDeliveryTime } from "../src/utils/customerDeliveryTime.js";

test("delivery time prefers explicit delivery metadata over WooCommerce completion time", () => {
  assert.equal(customerDeliveryTime({ meta_data: [{ key: "_delivery_completed_at", value: "2026-11-02T18:40:00Z" }], date_completed_gmt: "2026-11-02T20:00:00" }), "2026-11-02T18:40:00.000Z");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date("2026-11-02T18:40:00Z"));
  assert.equal(parts, "00:10");
});

test("delivery time handles GMT fallback and refuses ambiguous local timestamps", () => {
  assert.equal(customerDeliveryTime({ date_completed_gmt: "2026-11-02T18:40:00" }), "2026-11-02T18:40:00.000Z");
  assert.equal(customerDeliveryTime({ date_completed: "2026-11-03T00:10:00" }), null);
  assert.equal(customerDeliveryTime({ date_completed_gmt: "invalid" }), null);
});
