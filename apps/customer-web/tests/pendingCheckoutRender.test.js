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
  } finally {
    await server.close();
  }
});
