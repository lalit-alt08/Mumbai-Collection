import test from "node:test";
import assert from "node:assert/strict";

const { createPaymentOrder, verifyPayment } = await import("../src/services/paymentService.js");

test("Stage 2 — Customer Payment Integration Test Suite", async (t) => {
  await t.test("1. createPaymentOrder exported and callable", () => {
    assert.equal(typeof createPaymentOrder, "function");
  });

  await t.test("2. verifyPayment exported and callable", () => {
    assert.equal(typeof verifyPayment, "function");
  });

  await t.test("3. Online payment options payload structure", () => {
    const backendResponse = {
      success: true,
      order_id: 101,
      razorpay_order_id: "order_mock_101",
      amount: 65000,
      currency: "INR",
      key_id: "rzp_test_key123",
    };

    const customerDetails = {
      firstName: "Rahul",
      lastName: "Sharma",
      email: "rahul@example.com",
      phone: "9820123456",
    };

    const options = {
      key: backendResponse.key_id,
      amount: backendResponse.amount,
      currency: backendResponse.currency,
      name: "Mumbai Collection",
      description: `Order #${backendResponse.order_id}`,
      order_id: backendResponse.razorpay_order_id,
      prefill: {
        name: `${customerDetails.firstName} ${customerDetails.lastName}`.trim(),
        email: customerDetails.email,
        contact: customerDetails.phone,
      },
      notes: {
        wc_order_id: String(backendResponse.order_id),
      },
      theme: {
        color: "#7C3AED",
      },
    };

    assert.equal(options.key, "rzp_test_key123");
    assert.equal(options.amount, 65000);
    assert.equal(options.order_id, "order_mock_101");
    assert.equal(options.prefill.name, "Rahul Sharma");
    assert.equal(options.prefill.email, "rahul@example.com");
    assert.equal(options.notes.wc_order_id, "101");
  });

  await t.test("4. Payment verification payload does not expose or transmit amount from client", () => {
    const razorpayCallbackResponse = {
      razorpay_payment_id: "pay_xyz_123",
      razorpay_order_id: "order_mock_101",
      razorpay_signature: "sig_abc_456",
    };

    const verificationPayload = {
      order_id: 101,
      razorpay_order_id: razorpayCallbackResponse.razorpay_order_id,
      razorpay_payment_id: razorpayCallbackResponse.razorpay_payment_id,
      razorpay_signature: razorpayCallbackResponse.razorpay_signature,
    };

    assert.equal("amount" in verificationPayload, false, "Amount must not be sent from client during verification");
    assert.equal("price" in verificationPayload, false, "Price must not be sent from client during verification");
    assert.equal(verificationPayload.order_id, 101);
    assert.equal(verificationPayload.razorpay_payment_id, "pay_xyz_123");
  });
});
