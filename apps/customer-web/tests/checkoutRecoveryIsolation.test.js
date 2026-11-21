import test from "node:test";
import assert from "node:assert/strict";
import {
  getPendingPayment,
  setPendingPayment,
  clearPendingPayment,
  isItemHeldForPendingCheckout,
  getHeldQuantityForPendingCheckout,
} from "../src/utils/checkoutIdempotency.js";

test("pending payments remain isolated by account and do not overwrite legacy references", () => {
  clearPendingPayment();
  clearPendingPayment(101);
  clearPendingPayment(202);
  setPendingPayment({ razorpay_order_id: "legacy" });
  setPendingPayment({ razorpay_order_id: "order_a" }, 101);
  setPendingPayment({ razorpay_order_id: "order_b" }, 202);
  assert.equal(getPendingPayment(101).razorpay_order_id, "order_a");
  assert.equal(getPendingPayment(202).razorpay_order_id, "order_b");
  clearPendingPayment(101);
  assert.equal(getPendingPayment(101), null);
  assert.equal(getPendingPayment(202).razorpay_order_id, "order_b");
  assert.equal(getPendingPayment().razorpay_order_id, "legacy");
  clearPendingPayment();
  clearPendingPayment(202);
});

test("held quantities are scoped to the original cart line", () => {
  const pending = { razorpay_order_id: "order_1", heldItems: [{ id: 253, key: "line-a", quantity: 1 }] };
  assert.equal(getHeldQuantityForPendingCheckout({ id: 253, key: "line-a", quantity: 2 }, pending), 1);
  assert.equal(getHeldQuantityForPendingCheckout({ id: 253, key: "line-b", quantity: 1 }, pending), 0);
  assert.equal(getHeldQuantityForPendingCheckout({ id: 253, key: "line-a" }, { ...pending, terminal: true }), 0);
});

test("isItemHeldForPendingCheckout identifies held items and distinguishes terminal states", () => {
  const activePendingWithHeldItems = {
    razorpay_order_id: "order_active_123",
    heldItems: [{ id: 253, quantity: 1 }, { id: 7510, quantity: 2 }],
  };

  assert.equal(
    isItemHeldForPendingCheckout({ id: 253 }, activePendingWithHeldItems),
    true,
    "Held item from heldItems list must return true"
  );
  assert.equal(
    isItemHeldForPendingCheckout({ id: "253" }, activePendingWithHeldItems),
    true,
    "String product ID must match number product ID"
  );
  assert.equal(
    isItemHeldForPendingCheckout({ id: 9999 }, activePendingWithHeldItems),
    false,
    "Non-held item must return false"
  );

  const activePendingLegacyFingerprint = {
    razorpay_order_id: "order_active_456",
    itemsFingerprint: "253::1|108::1",
  };
  assert.equal(
    isItemHeldForPendingCheckout({ id: 253 }, activePendingLegacyFingerprint),
    true,
    "Legacy itemsFingerprint must match held item"
  );
  assert.equal(
    isItemHeldForPendingCheckout({ id: 999 }, activePendingLegacyFingerprint),
    false,
    "Legacy itemsFingerprint must not match unheld item"
  );

  assert.equal(
    isItemHeldForPendingCheckout({ id: 253 }, { ...activePendingWithHeldItems, cancelled: true }),
    false,
    "Cancelled attempt must not hold items"
  );
  assert.equal(
    isItemHeldForPendingCheckout({ id: 253 }, { ...activePendingWithHeldItems, terminal: true }),
    false,
    "Terminal attempt must not hold items"
  );
  assert.equal(
    isItemHeldForPendingCheckout({ id: 253 }, null),
    false,
    "Null pending attempt must return false"
  );
});
