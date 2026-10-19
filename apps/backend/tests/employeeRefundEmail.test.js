import test from "node:test";
import assert from "node:assert/strict";

process.env.MOCK_EMAIL = "true";
process.env.NODE_ENV = "test";

const { default: api } = await import("../src/config/woocommerce.js");
const { _setWpClientForTesting } = await import("../src/services/paymentIntentService.js");
const { sendOrderRefundEmail } = await import("../src/controllers/employeeController.js");

test("employee refund email is an explicit, one-time action", async () => {
  const originalGet = api.get;
  const originalPut = api.put;
  const order = {
    id: 439,
    number: "439",
    total: "836.00",
    status: "completed",
    billing: { email: "customer@example.com", first_name: "Test", last_name: "Customer" },
    meta_data: [],
  };
  const wpCalls = [];
  _setWpClientForTesting({
    post: async (path, body) => {
      wpCalls.push({ path, body });
      if (path.endsWith("/payment-intent/lock")) return { data: { acquired: true } };
      return { data: { success: true } };
    },
  });
  api.get = async () => ({ data: order });
  api.put = async (_path, payload) => {
    order.meta_data = payload.meta_data;
    return { data: order };
  };

  const response = () => ({
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  });

  try {
    const first = response();
    await sendOrderRefundEmail({ params: { id: "439" }, user: { id: 1 } }, first);
    assert.equal(first.code, 200);
    assert.equal(first.body.success, true);
    assert.ok(order.meta_data.some((meta) => meta.key === "_manual_refund_email_sent_at"));

    const second = response();
    await sendOrderRefundEmail({ params: { id: "439" }, user: { id: 1 } }, second);
    assert.equal(second.code, 409);
    assert.equal(wpCalls.filter(({ path }) => path.endsWith("/payment-intent/lock")).length, 2);
  } finally {
    api.get = originalGet;
    api.put = originalPut;
    _setWpClientForTesting(null);
  }
});
