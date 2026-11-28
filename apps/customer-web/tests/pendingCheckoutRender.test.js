import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

test("pending checkout renders while checking and when idle", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false }, appType: "custom", oxc: { jsx: { runtime: "automatic" } } });
  try {
    const { CheckoutBottomBar } = await server.ssrLoadModule("/src/components/checkout/CheckoutBottomBar.jsx");
    const props = { hasActivePendingPayment: true, addresses: [], finalTotal: 2388, checkoutAction: "payment_status", paymentStep: "" };
    const checking = renderToStaticMarkup(React.createElement(CheckoutBottomBar, { ...props, checkingPendingStatus: true }));
    const idle = renderToStaticMarkup(React.createElement(CheckoutBottomBar, { ...props, checkingPendingStatus: false }));
    assert.match(checking, /Verifying payment/);
    assert.match(idle, /Check payment status/);
    assert.doesNotMatch(idle, /Cancel checkout/);
    const cancellable = renderToStaticMarkup(React.createElement(CheckoutBottomBar, { ...props, canCancelPending: true }));
    assert.match(cancellable, /Cancel checkout/);
    const retryable = renderToStaticMarkup(React.createElement(CheckoutBottomBar, { ...props, checkoutAction: "payment_retry", isPaymentUnpaid: true, canCancelPending: true }));
    assert.match(retryable, /Try Paying Again/);
    assert.match(retryable, /Cancel checkout/);
    const confirming = renderToStaticMarkup(React.createElement(CheckoutBottomBar, { ...props, isConfirmingOrder: true, canCancelPending: false }));
    assert.match(confirming, /Payment received · Confirming your order/);
    assert.doesNotMatch(confirming, /Cancel checkout/);
    const refundPending = renderToStaticMarkup(React.createElement(CheckoutBottomBar, { ...props, isRefundPending: true, pendingStatusFeedback: "Refund pending — confirming your refund with Razorpay.", canCancelPending: false }));
    assert.match(refundPending, /Refund pending/);
    assert.doesNotMatch(refundPending, /Cancel checkout/);
  } finally {
    await server.close();
  }
});
