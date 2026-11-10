import test from "node:test";
import assert from "node:assert/strict";
import { getPendingPayment, setPendingPayment, clearPendingPayment } from "../src/utils/checkoutIdempotency.js";

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
