import test from "node:test";
import assert from "node:assert/strict";
import { _setWpClientForTesting } from "../src/services/paymentIntentService.js";
import { reserveStockForCheckout } from "../src/utils/paymentCheckoutUtils.js";

test("checkout stock reservation preserves safe response contracts", async (t) => {
  t.after(async () => {
    _setWpClientForTesting(null);
    const { closeRedis } = await import("../src/config/redis.js");
    await closeRedis();
  });
  const lineItems = [{ product_id: 1, quantity: 1 }];
  _setWpClientForTesting({ post: async () => ({ data: { success: true } }) });
  assert.equal(await reserveStockForCheckout("reservation", lineItems), null);

  _setWpClientForTesting({ post: async () => {
    const error = new Error("conflict");
    error.response = { status: 409 };
    throw error;
  } });
  assert.deepEqual(await reserveStockForCheckout("reservation", lineItems), {
    status: 422,
    code: "ITEM_OUT_OF_STOCK",
    message: "An item in your cart is no longer available in the requested quantity. Please update your cart.",
  });
  assert.deepEqual(await reserveStockForCheckout("reservation", lineItems, { reusingIntent: true }), {
    status: 422,
    code: "ITEM_OUT_OF_STOCK",
    message: "An item in your cart is no longer available in the requested quantity.",
  });

  _setWpClientForTesting({ post: async () => { throw new Error("private-path-example"); } });
  const failure = await reserveStockForCheckout("reservation", lineItems);
  assert.deepEqual(failure, {
    status: 503,
    code: "INVENTORY_UNAVAILABLE",
    message: "We could not confirm inventory. Please try again shortly.",
  });
  assert.ok(!JSON.stringify(failure).includes("private-path-example"));
});
