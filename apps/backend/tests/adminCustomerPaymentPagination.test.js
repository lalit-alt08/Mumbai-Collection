import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdminCustomerPayments } from "../src/controllers/adminCustomerController.js";
import wp from "../src/services/wordpress.js";

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(data) { this.body = data; return this; } };
}

test("customer payment history forwards a valid cursor and rejects invalid cursors", async () => {
  const original = wp.get;
  let request;
  try {
    wp.get = async (path, options) => {
      request = { path, options };
      return { data: { success: true, payments: [{ rzp_order_id: "order_older" }], has_more: false, next_cursor: null } };
    };
    const res = response();
    await getAdminCustomerPayments({ params: { id: "42" }, query: { cursor: "order_previous" } }, res);
    assert.equal(request.path, "/wp-json/mumbai-auth/v1/admin/customers/42/payments");
    assert.equal(request.options.params.cursor, "order_previous");
    assert.equal(res.body.payments[0].rzp_order_id, "order_older");
    assert.equal(res.body.has_more, false);

    request = null;
    const invalid = response();
    await getAdminCustomerPayments({ params: { id: "42" }, query: { cursor: "invalid cursor!" } }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(request, null);
  } finally { wp.get = original; }
});
