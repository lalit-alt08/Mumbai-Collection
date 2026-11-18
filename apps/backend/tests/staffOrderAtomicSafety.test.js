import test from "node:test";
import assert from "node:assert/strict";

process.env.REDIS_URL = "";
process.env.REDIS_HOST = "";
const { default: api } = await import("../src/config/woocommerce.js");
const { default: wp } = await import("../src/services/wordpress.js");
const { mutateStaffOrder } = await import("../src/services/staffOrderService.js");
const { isOnlineOrderUnpaid } = await import("../src/utils/orderStatusTransition.js");

test("staff status writes never bypass the WordPress lock and guards", async (t) => {
  const originals = { get: api.get, put: api.put, post: wp.post };
  t.after(() => { api.get = originals.get; api.put = originals.put; wp.post = originals.post; });
  api.get = async () => ({ data: { id: 501, status: "processing", payment_method: "cod", meta_data: [] } });
  let unguardedWrites = 0;
  api.put = async () => { unguardedWrites++; throw new Error("Unexpected direct write"); };

  for (const code of ["order_busy", "order_changed", "order_location_changed", "delivery_review_required", "unpaid_order"]) {
    await t.test(`preserves ${code} conflict`, async () => {
      wp.post = async () => { const e = new Error("conflict"); e.response = { status: 409, data: { code } }; throw e; };
      await assert.rejects(mutateStaffOrder(501, "packed"), (e) => e.response?.status === 409 && e.response?.data?.code === code);
      assert.equal(unguardedWrites, 0);
    });
  }
  await t.test("an ambiguous timeout does not retry the mutation", async () => {
    wp.post = async () => { const e = new Error("timeout"); e.code = "ECONNABORTED"; throw e; };
    await assert.rejects(mutateStaffOrder(501, "packed"), (e) => e.response?.status === 503 && /refresh/i.test(e.message));
    assert.equal(unguardedWrites, 0);
  });
  await t.test("a malformed success response is not reported as confirmed", async () => {
    wp.post = async () => ({ data: { success: true } });
    await assert.rejects(mutateStaffOrder(501, "packed"), (e) => e.response?.status === 503);
    assert.equal(unguardedWrites, 0);
  });
  await t.test("a confirmed guarded write succeeds", async () => {
    let submitted;
    wp.post = async (_url, body) => {
      submitted = body;
      return { data: { id: 501, status: "processing", meta_data: [{ key: "_delivery_status", value: "packed" }] } };
    };
    const result = await mutateStaffOrder(501, "packed", { expectedLocation: "vasai-west" });
    assert.equal(result.id, 501);
    assert.equal(submitted.expected_status, "processing");
    assert.equal(submitted.expected_delivery_status, "processing");
    assert.equal(submitted.expected_location, "vasai-west");
    assert.equal(unguardedWrites, 0);
  });
});

test("payment status alone or a gateway reference cannot establish payment", () => {
  const order = { status: "processing", payment_method: "razorpay", meta_data: [{ key: "_razorpay_payment_id", value: "pay_123" }] };
  assert.equal(isOnlineOrderUnpaid(order), true);
  assert.equal(isOnlineOrderUnpaid({ ...order, payment_method: "" }), true);
  assert.equal(isOnlineOrderUnpaid({ ...order, payment_method: "cod" }), false);
  assert.equal(isOnlineOrderUnpaid({ ...order, date_paid: "2026-11-17T12:00:00" }), false);
  assert.equal(isOnlineOrderUnpaid({ ...order, transaction_id: "pay_123" }), false);
  assert.equal(isOnlineOrderUnpaid({ ...order, meta_data: [{ key: "_payment_verified_at", value: "2026-11-17" }] }), false);
});
