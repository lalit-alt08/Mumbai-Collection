import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "crypto";

process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
process.env.CUSTOMER_ORIGIN = "http://localhost:5173";

const { default: app } = await import("../src/app.js");
const { _setFinalizeHandlerForTesting } = await import("../src/controllers/paymentController.js");

const generateTestSignature = (orderId, paymentId) => {
  return crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
};

test("POST /api/payments/callback Server-Side Redirect", async (t) => {
  let server;
  let baseUrl;

  t.before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  t.after(async () => {
    _setFinalizeHandlerForTesting?.(null);
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test("Valid signature POST payload results in 303 redirect to /order-success?order=<id> without leaking keys/signatures", async () => {
    const rzpOrderId = "order_mock_cb_101";
    const rzpPaymentId = "pay_mock_cb_202";
    const validSignature = generateTestSignature(rzpOrderId, rzpPaymentId);

    _setFinalizeHandlerForTesting(async ({ rzpOrderId: oid, rzpPaymentId: pid, rzpSignature: sig }) => {
      assert.equal(oid, rzpOrderId);
      assert.equal(pid, rzpPaymentId);
      assert.equal(sig, validSignature);
      return {
        success: true,
        order_id: 88214,
        orderStatus: "processing",
      };
    });

    const res = await fetch(`${baseUrl}/api/payments/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: rzpPaymentId,
        razorpay_signature: validSignature,
      }),
      redirect: "manual",
    });

    assert.equal(res.status, 303, `Expected status 303 See Other, got ${res.status}`);
    const location = res.headers.get("location");
    assert.ok(location, "Location header must be present on 303 response");
    assert.equal(location, "http://localhost:5173/order-success?order=88214");
    assert.ok(!location.includes("signature"), "Signature must not appear in redirect URL");
    assert.ok(!location.includes("pay_"), "Payment ID must not appear in redirect URL");
    assert.ok(!location.includes("order_mock"), "Razorpay order ID must not appear in redirect URL");
  });

  await t.test("URL-encoded form POST (from standard gateway submit) is parsed and 303 redirects correctly", async () => {
    const rzpOrderId = "order_mock_cb_urlencoded";
    const rzpPaymentId = "pay_mock_cb_urlencoded";
    const validSignature = generateTestSignature(rzpOrderId, rzpPaymentId);

    _setFinalizeHandlerForTesting(async () => ({
      success: true,
      order_id: 99312,
      orderStatus: "processing",
    }));

    const formParams = new URLSearchParams({
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: rzpPaymentId,
      razorpay_signature: validSignature,
    });

    const res = await fetch(`${baseUrl}/api/payments/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formParams.toString(),
      redirect: "manual",
    });

    assert.equal(res.status, 303);
    const location = res.headers.get("location");
    assert.equal(location, "http://localhost:5173/order-success?order=99312");
  });

  await t.test("Invalid or mismatched signature redirects to /cart?payment_error=verification_failed", async () => {
    _setFinalizeHandlerForTesting(async () => ({
      success: false,
      status: 400,
      message: "Payment verification failed: invalid signature.",
    }));

    const res = await fetch(`${baseUrl}/api/payments/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        razorpay_order_id: "order_mock_invalid",
        razorpay_payment_id: "pay_mock_invalid",
        razorpay_signature: "bad_signature_abc123",
      }),
      redirect: "manual",
    });

    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "http://localhost:5173/cart?payment_error=verification_failed");
  });

  await t.test("Missing required parameters in POST redirects to /cart?payment_error=missing_parameters", async () => {
    const res = await fetch(`${baseUrl}/api/payments/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        razorpay_order_id: "order_mock_partial",
      }),
      redirect: "manual",
    });

    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "http://localhost:5173/cart?payment_error=missing_parameters");
  });
});
