import test from "node:test";
import assert from "node:assert/strict";
import { formatOrderPlacedDateTime } from "../src/utils/orderDateTime.js";

test("uses WooCommerce GMT creation time for the store time", () => {
  const result = formatOrderPlacedDateTime({
    date_created: "2026-11-09T08:43:00",
    date_created_gmt: "2026-11-09T08:43:00",
  });
  assert.match(result, /9 Nov 2026/);
  assert.match(result, /02:13\s*pm/i);
});

test("handles explicit offsets and older responses with local creation time", () => {
  assert.match(formatOrderPlacedDateTime({ date_created_gmt: "2026-11-09T08:43:00Z" }), /02:13\s*pm/i);
  assert.match(formatOrderPlacedDateTime({ date_created: "2026-11-09T14:13:00+05:30" }), /02:13\s*pm/i);
  assert.match(formatOrderPlacedDateTime({ date_created: "2026-11-09T14:13:00" }), /02:13\s*pm/i);
  assert.equal(formatOrderPlacedDateTime({ date_created_gmt: "bad" }), "");
});

test("uses the correct store date around midnight", () => {
  assert.match(formatOrderPlacedDateTime({ date_created_gmt: "2026-11-08T18:35:00" }), /9 Nov 2026/);
});
