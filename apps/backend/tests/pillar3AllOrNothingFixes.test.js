import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.RAZORPAY_KEY_ID = "rzp_test_mock123";
process.env.RAZORPAY_KEY_SECRET = "mock_secret_key_456";
process.env.RAZORPAY_WEBHOOK_SECRET = "mock_webhook_secret_789";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wpPluginPath = path.resolve(__dirname, "../../wordpress-plugin/mumbai-auth.php");

const { default: api } = await import("../src/config/woocommerce.js");
const { default: wp } = await import("../src/services/wordpress.js");
const { default: storeHoursService } = await import("../src/services/storeHoursService.js");
const { serverCache } = await import("../src/utils/memoryCache.js");
const { default: paymentIntentService, _setWpClientForTesting } = await import("../src/services/paymentIntentService.js");
const {
  refundRazorpayPayment,
  _setRazorpayInstanceForTesting,
} = await import("../src/services/razorpayService.js");
const { _setAnomalyHandlerForTesting } = await import("../src/services/alertService.js");
const {
  createOrder,
  cancelPaymentOrder,
  checkPaymentStatus,
  finalizePaymentAndCreateOrder,
  handleWebhook,
  handlePaymentCallback,
  computeCartFingerprint,
} = await import("../src/controllers/paymentController.js");
const { runPaymentReconciliation } = await import("../src/services/reconciliationService.js");
const { operationalHealth } = await import("../src/services/operationalHealth.js");
const { createReconcilerIntervalCallback } = await import("../src/server.js");
const { default: axios } = await import("axios");

const makeMockRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set(key, val) {
      this.headers[key] = val;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    redirect(status, location) {
      this.statusCode = status;
      this.redirectUrl = location;
      return this;
    },
  };
  return res;
};

const signWebhook = (bodyObj) => {
  const raw = JSON.stringify(bodyObj);
  return {
    rawBuffer: Buffer.from(raw),
    signature: crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(raw)
      .digest("hex"),
  };
};

test("Pillar 3 & All-or-Nothing Payment Hardening Verification Suite", async (t) => {
  const originals = { ...paymentIntentService };
  const origApi = { get: api.get, post: api.post, put: api.put };
  const origWpGet = wp.get;
  const origWpPost = wp.post;
  const origAxiosGet = axios.get;
  const origAxiosPost = axios.post;
  const origStoreStatus = storeHoursService.getStoreStatus;

  const restoreAll = () => {
    Object.assign(paymentIntentService, originals);
    api.get = origApi.get;
    api.post = origApi.post;
    api.put = origApi.put;
    wp.get = origWpGet;
    wp.post = origWpPost;
    axios.get = origAxiosGet;
    axios.post = origAxiosPost;
    storeHoursService.getStoreStatus = origStoreStatus;
    _setWpClientForTesting(null);
    _setRazorpayInstanceForTesting(null);
    _setAnomalyHandlerForTesting(null);
    serverCache.clear();
  };

  t.afterEach(restoreAll);

  const validAddresses = {
    billing_address: {
      first_name: "Meera",
      last_name: "Nair",
      email: "meera@example.com",
      phone: "9876543210",
      address_1: "12 MG Road",
      city: "Vasai",
      state: "MH",
      postcode: "401201",
      country: "IN",
    },
    shipping_address: {
      first_name: "Meera",
      last_name: "Nair",
      phone: "9876543210",
      address_1: "12 MG Road",
      city: "Vasai",
      state: "MH",
      postcode: "401201",
      country: "IN",
    },
  };

  await t.test("1. createOrder rejects non-INR currency with 422 and reuse branch no longer throws ReferenceError", async () => {
    wp.get = async (url) => {
      if (String(url).includes("/customer-suspension/")) return { data: { is_suspended: false } };
      return { data: {} };
    };
    storeHoursService.getStoreStatus = async () => ({ is_open: true });

    // Non-INR currency cart -> 422 CURRENCY_MISMATCH
    const usdCart = {
      items: [{ id: 10, quantity: 1, totals: { line_total: "50000" } }],
      totals: { total_items: "50000", total_price: "50000", currency_code: "USD", currency_minor_unit: 2 },
    };
    axios.get = async () => ({ data: usdCart });
    axios.post = async () => ({ data: usdCart });

    const resCurrency = makeMockRes();
    await createOrder({
      wpUserId: 101,
      wpUserEmail: "meera@example.com",
      body: validAddresses,
      headers: {},
    }, resCurrency);
    assert.equal(resCurrency.statusCode, 422);
    assert.equal(resCurrency.body?.code, "CURRENCY_MISMATCH");

    // Reuse branch: active intent exists with matching cart fingerprint -> must reuse cleanly with normalized billing/shipping
    const inrCart = {
      items: [{ id: 10, quantity: 1, totals: { line_total: "50000" } }],
      totals: { total_items: "50000", total_price: "50000", currency_code: "INR", currency_minor_unit: 2 },
    };
    axios.get = async () => ({ data: inrCart });
    axios.post = async () => ({ data: inrCart });

    const intents = new Map([
      ["order_reuse_1", {
        rzp_order_id: "order_reuse_1",
        customer_id: 101,
        amount_in_paise: 50000,
        currency: "INR",
        status: "created",
        cart_fingerprint: computeCartFingerprint(inrCart),
        created_at: Date.now(),
        stock_reservation_id: "stock_res_1",
        checkout_payload: { line_items: [{ product_id: 10, quantity: 1 }] },
      }],
    ]);
    let storedPayload = null;
    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.findActiveCartIntent = async () => "order_reuse_1";
    paymentIntentService.getPaymentIntent = async (id) => intents.get(id) || null;
    paymentIntentService.reserveCheckoutStock = async () => ({ success: true });
    paymentIntentService.storePaymentIntent = async (id, payload) => {
      storedPayload = payload;
      intents.set(id, payload);
      return true;
    };
    _setRazorpayInstanceForTesting({
      orders: { fetch: async (id) => ({ id, status: "created", amount_paid: 0 }) },
    });

    const resReuse = makeMockRes();
    await createOrder({
      wpUserId: 101,
      wpUserEmail: "meera@example.com",
      body: { ...validAddresses, customer_note: "Call before delivery" },
      headers: {},
    }, resReuse);

    assert.equal(resReuse.statusCode, 200);
    assert.equal(resReuse.body?.razorpay_order_id, "order_reuse_1");
    assert.equal(resReuse.body?.reused, true);
    assert.equal(storedPayload?.checkout_payload?.billing?.first_name, "Meera");
    assert.equal(storedPayload?.checkout_payload?.customer_note, "Call before delivery");
  });

  await t.test("2. Pre-packing on-hold -> processing total verification and fail-closed promotion", async () => {
    const intent = {
      rzp_order_id: "order_prepack_1",
      customer_id: 22,
      amount_in_paise: 75000,
      status: "created",
      stock_reservation_id: "res_prepack_1",
      checkout_payload: { customer_id: 22, line_items: [{ product_id: 5, quantity: 1 }] },
    };
    let createdPayloadStatus = null;
    let promoted = false;
    let cartCleared = false;
    let createdOrderObj = null;

    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => null;
    paymentIntentService.getPaymentIntent = async () => ({ ...intent });
    paymentIntentService.reserveCheckoutStock = async () => ({ success: true });
    paymentIntentService.releaseCheckoutStock = async () => true;
    paymentIntentService.clearCustomerWcCart = async () => { cartCleared = true; return true; };
    paymentIntentService.updatePaymentIntentStatus = async (p) => {
      intent.status = p.toStatus;
      return true;
    };
    paymentIntentService.createPaidOrder = async (payload) => {
      createdPayloadStatus = payload.status;
      assert.equal(payload.set_paid, false, "Order must be created unpaid/on-hold before total verification");
      createdOrderObj = { id: 901, number: "901", status: payload.status, total: "750.00", currency: "INR", customer_id: 22, line_items: payload.line_items };
      return { data: createdOrderObj };
    };
    paymentIntentService.promoteOrderToProcessing = async () => {
      promoted = true;
      return { reconciled: true, action: "updated_to_processing", orderStatus: "processing" };
    };
    _setRazorpayInstanceForTesting({
      payments: { fetch: async () => ({ id: "pay_prepack_1", order_id: "order_prepack_1", status: "captured", amount: 75000, currency: "INR", method: "upi" }) },
    });
    storeHoursService.getStoreStatus = async () => ({ is_open: true });

    const okRes = await finalizePaymentAndCreateOrder({
      rzpOrderId: "order_prepack_1",
      rzpPaymentId: "pay_prepack_1",
      expectedCustomerId: 22,
    });

    assert.equal(createdPayloadStatus, "on-hold", "WC order must be created in non-packable on-hold status first");
    assert.equal(promoted, true, "Verified INR total must promote order to processing");
    assert.equal(okRes.success, true);
    assert.equal(okRes.orderStatus, "processing");
    assert.equal(intent.status, "order_created");
    assert.equal(cartCleared, true);

    // Now test promotion failure: must keep intent at paid and return confirming: true
    intent.status = "created";
    cartCleared = false;
    paymentIntentService.promoteOrderToProcessing = async () => {
      throw new Error("WordPress lock service unavailable");
    };
    const promoFailRes = await finalizePaymentAndCreateOrder({
      rzpOrderId: "order_prepack_1",
      rzpPaymentId: "pay_prepack_1",
      expectedCustomerId: 22,
    });
    assert.equal(promoFailRes.success, false);
    assert.equal(promoFailRes.status, 502);
    assert.equal(promoFailRes.confirming, true);
    assert.equal(intent.status, "paid");
    assert.equal(cartCleared, false, "Cart must not be cleared before promotion succeeds");
  });

  await t.test("3. Existing order retry cleans up stuck 'paid' intent & healedOrders counts only synced writes", async () => {
    const intent = {
      rzp_order_id: "order_stuck_paid",
      customer_id: 33,
      amount_in_paise: 60000,
      status: "paid",
      stock_reservation_id: "res_stuck_paid",
      cart_fingerprint: "fp_stuck_paid",
      checkout_payload: { customer_id: 33, line_items: [{ product_id: 9, quantity: 1 }] },
    };
    const existingOrder = {
      id: 777,
      number: "777",
      status: "processing",
      total: "600.00",
      currency: "INR",
      customer_id: 33,
      meta_data: [],
    };
    let allowIntentSync = false;
    let stockReleased = 0;
    let cartCleared = 0;

    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => existingOrder;
    paymentIntentService.getPaymentIntent = async () => ({ ...intent });
    paymentIntentService.releaseCheckoutStock = async () => { stockReleased++; return true; };
    paymentIntentService.clearCustomerWcCart = async () => { cartCleared++; return true; };
    paymentIntentService.updatePaymentIntentStatus = async (p) => {
      if (!allowIntentSync) return false;
      intent.status = p.toStatus;
      return true;
    };
    paymentIntentService.fetchReconciliationList = async ({ statusGroup }) => (
      statusGroup === "urgent"
        ? { intents: [{ rzp_order_id: "order_stuck_paid", status: intent.status }], hasMore: false }
        : { intents: [], hasMore: false }
    );
    paymentIntentService.fetchOrphanWebhookEvents = async () => ({ count: 0, orphans: [] });
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => [];
    _setRazorpayInstanceForTesting({
      orders: { fetchPayments: async () => ({ items: [{ id: "pay_stuck_1", status: "captured" }] }) },
      payments: { fetch: async () => ({ id: "pay_stuck_1", order_id: "order_stuck_paid", status: "captured", amount: 60000, currency: "INR" }) },
    });

    // Run 1: order_created write fails -> healedOrders MUST be 0, errorCount = 1
    const resFail = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(resFail.healedOrders, 0, "Must not increment healedOrders when intent update fails");
    assert.equal(resFail.errorCount, 1);

    // Run 2: order_created write succeeds -> heals intent, releases stock & cart, increments healedOrders
    allowIntentSync = true;
    const resOk = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(resOk.healedOrders, 1);
    assert.equal(intent.status, "order_created");
    assert.ok(stockReleased >= 1);
    assert.ok(cartCleared >= 1);
  });

  await t.test("4. Capture webhook keeps 409/transient errors retryable and reconciler replays capture orphans with backoff", async () => {
    const webhookUpdates = [];
    const alerts = [];
    const body = {
      event: "payment.captured",
      id: "evt_capture_replay_1",
      payload: { payment: { entity: { id: "pay_cap_replay_1", order_id: "order_cap_replay_1", amount: 50000 } } },
    };
    const { rawBuffer, signature } = signWebhook(body);

    paymentIntentService.storeWebhookEvent = async () => true;
    paymentIntentService.updateWebhookEventStatus = async (params) => {
      webhookUpdates.push(params);
      return true;
    };
    paymentIntentService.acquireLock = async () => false; // Force 409 busy during handleWebhook!
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => null;
    _setRazorpayInstanceForTesting({
      payments: { fetch: async () => ({ id: "pay_cap_replay_1", order_id: "order_cap_replay_1", status: "captured", amount: 50000, currency: "INR" }) },
    });

    const res = makeMockRes();
    await handleWebhook({
      headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_capture_replay_1" },
      rawBody: rawBuffer,
      body,
    }, res);
    for (let i = 0; webhookUpdates.length === 0 && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 15));
    }

    assert.equal(res.statusCode, 200);
    assert.equal(webhookUpdates.length, 1);
    assert.equal(webhookUpdates[0].status, "orphan", "Busy 409 must leave capture webhook retryable as orphan, NOT processed");
    assert.equal(webhookUpdates[0].incrementAttempts, true);
    assert.ok(webhookUpdates[0].nextRetrySeconds >= 60);

    webhookUpdates.length = 0;
    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => ({
      id: 501, status: "processing", customer_id: 42, currency: "INR", total: "500.00", meta_data: [],
    });
    paymentIntentService.getPaymentIntent = async () => ({ customer_id: 42, status: "paid", amount_in_paise: 50000 });
    paymentIntentService.updatePaymentIntentStatus = async () => false;
    paymentIntentService.clearCustomerWcCart = async () => true;
    const pendingSyncRes = makeMockRes();
    await handleWebhook({
      headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_capture_pending_sync" },
      rawBody: rawBuffer, body,
    }, pendingSyncRes);
    for (let i = 0; webhookUpdates.length === 0 && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(pendingSyncRes.statusCode, 200);
    assert.equal(webhookUpdates[0]?.status, "orphan", "unpersisted intent must leave the capture event retryable");

    // Now test capture orphan replay in reconciler: fail twice (backoff persisted), then succeed OR escalate on 3rd
    webhookUpdates.length = 0;
    _setAnomalyHandlerForTesting(async (a) => { alerts.push(a); return { success: true }; });
    let orphanAttempts = 0;
    paymentIntentService.acquireLock = async (id) => id === "cron_reconciler_worker" || id === "order_cap_replay_1";
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => null;
    paymentIntentService.getPaymentIntent = async () => null; // missing intent -> 404 on finalize -> triggers capture retry/escalation!
    paymentIntentService.fetchReconciliationList = async () => ({ intents: [], hasMore: false });
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => [];
    paymentIntentService.fetchOrphanWebhookEvents = async ({ eventGroup }) => {
      if (eventGroup === "capture") {
        return {
          count: 1,
          orphans: [{
            event_id: "evt_capture_orphan_esc",
            event_type: "payment.captured",
            rzp_order_id: "order_cap_replay_1",
            rzp_payment_id: "pay_cap_replay_1",
            attempts: orphanAttempts,
            next_retry_at: null,
            raw_payload: JSON.stringify(body),
          }],
          nextCursor: null,
        };
      }
      return { count: 0, orphans: [], nextCursor: null };
    };

    const r1 = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(r1.errorCount, 1);
    assert.equal(webhookUpdates[0].status, "orphan");
    assert.equal(webhookUpdates[0].nextRetrySeconds, 60);
    orphanAttempts = 1;

    const r2 = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(r2.errorCount, 1);
    assert.equal(webhookUpdates[1].nextRetrySeconds, 120);
    orphanAttempts = 2;

    const r3 = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(r3.escalated, 1);
    assert.equal(webhookUpdates[2].status, "failed");
    assert.equal(alerts.some((a) => a.type === "ORPHAN_PAYMENT_WEBHOOK_ESCALATED"), true);
  });

  await t.test("5. Partial refund blocks unfulfilled dispatch on-hold without auto-refund & dashboard sweep catches order_created refunds", async () => {
    const syncCalls = [];
    const alerts = [];
    let intentUpdates = 0;
    _setAnomalyHandlerForTesting(async (a) => { alerts.push(a); return { success: true }; });
    paymentIntentService.storeWebhookEvent = async () => true;
    paymentIntentService.updateWebhookEventStatus = async () => true;
    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_partial_hold",
      wc_order_id: 551,
      status: "order_created",
    });
    paymentIntentService.updatePaymentIntentStatus = async () => { intentUpdates++; return true; };
    paymentIntentService.syncOrderRefundWithLock = async (params) => {
      syncCalls.push(params);
      return { synced: true, action: "partial_hold", orderStatus: "on-hold" };
    };
    _setRazorpayInstanceForTesting({
      payments: {
        fetch: async () => ({ id: "pay_part_hold", order_id: "order_partial_hold", amount: 50000, amount_refunded: 15000, refund_status: "partial" }),
      },
    });

    const partialBody = {
      event: "refund.processed",
      id: "evt_part_hold_1",
      payload: {
        refund: { entity: { id: "rfnd_part_hold_1", payment_id: "pay_part_hold", amount: 15000 } },
      },
    };
    const { rawBuffer, signature } = signWebhook(partialBody);
    const res = makeMockRes();
    await handleWebhook({
      headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_part_hold_1" },
      rawBody: rawBuffer,
      body: partialBody,
    }, res);
    for (let i = 0; alerts.length === 0 && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 15));
    }

    assert.equal(res.statusCode, 200);
    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0].mode, "partial_hold");
    assert.equal(syncCalls[0].wcOrderId, 551);
    assert.equal(intentUpdates, 0, "Partial refund must not move order_created intent to refund_pending");
    assert.equal(alerts[0]?.type, "PARTIAL_OR_FAILED_REFUND");
    assert.equal(alerts[0]?.severity, "critical");

    // Reconciler dashboard sweep on order_created with unnotified full Razorpay refund
    syncCalls.length = 0;
    const syncedIntents = [];
    paymentIntentService.updatePaymentIntentStatus = async (p) => { syncedIntents.push(p); return true; };
    paymentIntentService.releaseCheckoutStock = async () => true;
    paymentIntentService.fetchReconciliationList = async () => ({ intents: [], hasMore: false });
    paymentIntentService.fetchOrphanWebhookEvents = async () => ({ count: 0, orphans: [], nextCursor: null });
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => [
      { id: 552, status: "processing", rzp_order_id: "order_dash_full_refund" },
    ];
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_dash_full_refund",
      wc_order_id: 552,
      status: "order_created",
    });
    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: "pay_dash_1", order_id: "order_dash_full_refund", amount: 50000, amount_refunded: 50000, refund_status: "full" }],
        }),
      },
    });

    const dashRes = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(dashRes.refundsConfirmed, 1);
    assert.equal(syncCalls[0]?.mode, "full");
    assert.equal(syncedIntents[0]?.toStatus, "refunded");
  });

  await t.test("6. refundRazorpayPayment forwards X-Refund-Idempotency via Razorpay HTTP client when available", async () => {
    const rqCalls = [];
    let savedOperation;
    _setWpClientForTesting({
      post: async (_url, body) => {
        savedOperation ||= { payment_id: body.payment_id, order_id: body.order_id,
          key: "refund_persisted_123", body: { amount: body.amount, speed: "optimum", notes: { rzp_order_id: body.order_id } } };
        return { data: { success: true, operation: savedOperation } };
      },
    });
    _setRazorpayInstanceForTesting({
      payments: {
        fetch: async () => ({ id: "pay_idem_1", order_id: "order_idem_1", amount: 40000, amount_refunded: 0 }),
        fetchMultipleRefund: async () => ({ items: [] }),
        refund: async () => { throw new Error("SDK .refund strips custom headers; rq.post must be preferred"); },
      },
      api: {
        rq: {
          post: async (url, body, config) => {
            rqCalls.push({ url, body, headers: config?.headers });
            if (rqCalls.length === 1) throw new Error("response lost");
            return { data: { id: "rfnd_idem_1", amount: 40000, status: "processed" } };
          },
        },
      },
    });

    await assert.rejects(() => refundRazorpayPayment({
      paymentId: "pay_idem_1", amountInPaise: 40000, notes: { rzp_order_id: "order_idem_1" },
    }));
    const rfnd = await refundRazorpayPayment({
      paymentId: "pay_idem_1",
      amountInPaise: 40000,
      notes: { rzp_order_id: "order_idem_1" },
    });
    assert.equal(rfnd.id, "rfnd_idem_1");
    assert.equal(rqCalls.length, 2);
    assert.equal(rqCalls[0].headers?.["X-Refund-Idempotency"], "refund_persisted_123");
    assert.deepEqual(rqCalls[1], rqCalls[0]);
  });

  await t.test("7. checkPaymentStatus prioritizes refund/hold/cancelled outcomes and confirms pending refunds", async () => {
    // 7a. Existing refunded order must NOT return already_paid success
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_chk_refunded",
      customer_id: 50,
      status: "refunded",
      wc_order_id: 801,
    });
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => ({ id: 801, status: "refunded", customer_id: 50 });
    const resRef = makeMockRes();
    await checkPaymentStatus({ wpUserId: 50, body: { razorpay_order_id: "order_chk_refunded" } }, resRef);
    assert.equal(resRef.body?.success, false);
    assert.equal(resRef.body?.refunded, true);

    // 7b. refund_pending must stay non-terminal with refund_status=pending for polling
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_chk_rfnd_pend",
      customer_id: 50,
      status: "refund_pending",
    });
    const resPend = makeMockRes();
    await checkPaymentStatus({ wpUserId: 50, body: { razorpay_order_id: "order_chk_rfnd_pend" } }, resPend);
    assert.equal(resPend.body?.terminal, false);
    assert.equal(resPend.body?.refund_status, "pending");
    assert.match(resPend.body?.message, /Refund pending/i);

    // 7c. On-hold / amount_mismatch WC order returns support_required instead of success
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_chk_hold",
      customer_id: 50,
      status: "amount_mismatch",
    });
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => ({ id: 802, status: "on-hold", customer_id: 50 });
    const resHold = makeMockRes();
    await checkPaymentStatus({ wpUserId: 50, body: { razorpay_order_id: "order_chk_hold" } }, resHold);
    assert.equal(resHold.body?.success, false);
    assert.equal(resHold.body?.support_required, true);

    // 7d. Captured payment with transient 503 returns confirming: true message
    paymentIntentService.getPaymentIntent = async () => ({ rzp_order_id: "order_chk_conf", customer_id: 50, status: "paid" });
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => null;
    _setRazorpayInstanceForTesting({
      orders: { fetchPayments: async () => { throw new Error("Razorpay temporary 503"); } },
    });
    const resConf = makeMockRes();
    await checkPaymentStatus({ wpUserId: 50, body: { razorpay_order_id: "order_chk_conf" } }, resConf);
    assert.equal(resConf.statusCode, 200);
    assert.equal(resConf.body?.confirming, true);
    assert.equal(resConf.body?.message, "Payment received · Confirming your order");
  });

  await t.test("8. Unpaid polling backoff + bounded pages, LOCK_STORAGE_UNAVAILABLE alert, & operationalHealth backlog alert", async () => {
    // 8a. Bounded unpaid pages (MAX=3) & exponential backoff without bumping attempts
    const listQueries = [];
    const unpaidUpdates = [];
    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.fetchReconciliationList = async ({ statusGroup, cursor }) => {
      listQueries.push({ statusGroup, cursor });
      if (statusGroup === "urgent") return { intents: [], hasMore: false };
      const idx = cursor ? Number(cursor.split("_")[1]) + 1 : 0;
      return {
        intents: [{ rzp_order_id: `order_unpaid_${idx}`, status: "created", attempts: 0, next_retry_at: null, error_reason: null }],
        hasMore: true,
        nextCursor: `cursor_${idx}`,
      };
    };
    paymentIntentService.updatePaymentIntentStatus = async (p) => { unpaidUpdates.push(p); return true; };
    paymentIntentService.fetchOrphanWebhookEvents = async () => ({ count: 0, orphans: [], nextCursor: null });
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => [];
    _setRazorpayInstanceForTesting({ orders: { fetchPayments: async () => ({ items: [] }) } });

    await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(listQueries.filter((q) => q.statusGroup === "unpaid").length, 3, "Unpaid poll must be capped at 3 pages per run");
    assert.equal(unpaidUpdates[0]?.nextRetrySeconds, 600);
    assert.equal(unpaidUpdates[0]?.incrementAttempts, undefined);

    // 8b. LOCK_STORAGE_UNAVAILABLE throws 503 from acquireLock & alerts in reportReconciliation
    const recAlerts = [];
    paymentIntentService.acquireLock = originals.acquireLock;
    paymentIntentService.releaseLock = originals.releaseLock;
    _setAnomalyHandlerForTesting(async (a) => { recAlerts.push(a); return { success: true }; });
    _setWpClientForTesting({
      post: async (p) => {
        if (p.endsWith("/payment-intent/lock")) {
          const e = new Error("DB lock unavailable");
          e.response = { status: 503 };
          throw e;
        }
        return { data: { success: true } };
      },
      get: async () => ({ data: {} }),
    });
    const runWithDbLockOutage = createReconcilerIntervalCallback(async () => {
      await paymentIntentService.acquireLock("cron_reconciler_worker", "reconciler", 150);
      return { processed: 0 };
    });
    await runWithDbLockOutage();
    assert.equal(recAlerts.some((a) => a.type === "RECONCILIATION_FAILURE"), true);

    // 8c. operationalHealth fails closed (503) when unresolved webhook/payment/refund age > 1800s
    const origKey = process.env.OPS_HEALTH_TOKEN;
    process.env.OPS_HEALTH_TOKEN = "health_secret_test";
    paymentIntentService.fetchOrphanWebhookEvents = async () => ({ count: 1, oldestUnresolvedSeconds: 1900, orphans: [] });
    paymentIntentService.fetchReconciliationList = async () => ({ intents: [], hasMore: false, oldestUnresolvedPaymentSeconds: 0, oldestUnresolvedRefundSeconds: 0 });
    const hRes = makeMockRes();
    const hReq = { headers: { authorization: "Bearer health_secret_test" }, get(name) { return this.headers[name.toLowerCase()]; } };
    await operationalHealth(hReq, hRes);
    assert.equal(hRes.statusCode, 503);
    assert.equal(hRes.body?.healthy, false);
    assert.equal(hRes.body?.payments?.oldestUnresolvedWebhookSeconds, 1900);
    if (origKey === undefined) delete process.env.OPS_HEALTH_TOKEN;
    else process.env.OPS_HEALTH_TOKEN = origKey;

    // 8d. Static check: WordPress plugin has sync-refund, unfulfilled-razorpay, and partial-refund packing block
    const php = fs.readFileSync(wpPluginPath, "utf8");
    assert.match(php, /\/internal\/orders\/\(\?P<id>\\d\+\)\/sync-refund/);
    assert.match(php, /\/internal\/orders\/unfulfilled-razorpay/);
    assert.match(php, /_payment_partial_refund_hold/);
    assert.match(php, /staff-order:/);
  });

  await t.test("9. Audit regressions: strict promotion fail-closed, existing-order partial refund block, callback hold guard, and cursor packed scan", async () => {
    // 9a. promoteOrderToProcessing must fail closed on action: 'none' (terminal order) and 404 (never fall back to api.put)
    let fallbackPutCalls = 0;
    api.put = async () => { fallbackPutCalls++; return { data: {} }; };
    _setWpClientForTesting({
      post: async (url) => {
        if (url.includes("/reconcile-payment")) {
          return { data: { reconciled: true, action: "none", order_status: "refunded", order_id: 901 } };
        }
        return { data: { success: true } };
      },
      get: async () => ({ data: { order: null } }),
    });
    await assert.rejects(() => paymentIntentService.promoteOrderToProcessing({
      wcOrderId: 901, rzpOrderId: "order_term_nop", rzpPaymentId: "pay_term_nop", capturedAmountPaise: 50000,
    }), /could not be confirmed/i);
    assert.equal(fallbackPutCalls, 0);

    _setWpClientForTesting({
      post: async (url) => {
        if (url.includes("/reconcile-payment")) {
          const err = new Error("Not Found");
          err.response = { status: 404 };
          throw err;
        }
        return { data: { success: true } };
      },
      get: async () => ({ data: { order: null } }),
    });
    await assert.rejects(() => paymentIntentService.promoteOrderToProcessing({
      wcOrderId: 901, rzpOrderId: "order_term_nop", rzpPaymentId: "pay_term_nop", capturedAmountPaise: 50000,
    }));
    assert.equal(fallbackPutCalls, 0);

    // 9b. Existing on-hold/processing order with partial Razorpay refund cannot promote even without webhook hold meta
    const syncModes = [];
    _setAnomalyHandlerForTesting(async () => ({ success: true }));
    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => ({
      id: 902, number: "902", status: "on-hold", total: "500.00", currency: "INR", customer_id: 44, meta_data: [],
    });
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_exist_partial", customer_id: 44, amount_in_paise: 50000, status: "paid",
    });
    paymentIntentService.syncOrderRefundWithLock = async (params) => {
      syncModes.push(params.mode);
      return { synced: true, action: "held_partial_refund", orderStatus: "on-hold" };
    };
    _setRazorpayInstanceForTesting({
      payments: {
        fetch: async () => ({
          id: "pay_exist_partial", order_id: "order_exist_partial", status: "captured",
          amount: 50000, amount_refunded: 12000, refund_status: "partial", currency: "INR",
        }),
      },
    });
    const existPartRes = await finalizePaymentAndCreateOrder({
      rzpOrderId: "order_exist_partial", rzpPaymentId: "pay_exist_partial", expectedCustomerId: 44,
    });
    assert.equal(existPartRes.success, false);
    assert.equal(existPartRes.support_required, true);
    assert.equal(existPartRes.orderStatus, "on-hold");
    assert.deepEqual(syncModes, ["partial_hold"], "an already held order must persist the partial refund review flag");

    // Same guard promotes nothing & locks a 'processing' order on missed webhook
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => ({
      id: 903, number: "903", status: "processing", total: "500.00", currency: "INR", customer_id: 44, meta_data: [],
    });
    await finalizePaymentAndCreateOrder({
      rzpOrderId: "order_exist_partial", rzpPaymentId: "pay_exist_partial", expectedCustomerId: 44,
    });
    assert.equal(syncModes.includes("partial_hold"), true);

    // 9c. handlePaymentCallback refuses to redirect _flagged / on-hold orders to /order-success
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => ({
      id: 904, number: "904", status: "on-hold", total: "600.00", currency: "INR", customer_id: 44, meta_data: [],
    });
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_cb_hold", customer_id: 44, amount_in_paise: 50000, status: "paid",
    });
    _setRazorpayInstanceForTesting({
      payments: { fetch: async () => ({ id: "pay_cb_hold", order_id: "order_cb_hold", status: "captured", amount: 50000, currency: "INR" }) },
    });
    const cbSig = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update("order_cb_hold|pay_cb_hold")
      .digest("hex");
    const cbRes = makeMockRes();
    await handlePaymentCallback({
      body: { razorpay_order_id: "order_cb_hold", razorpay_payment_id: "pay_cb_hold", razorpay_signature: cbSig },
    }, cbRes);
    assert.equal(cbRes.statusCode, 303);
    assert.match(cbRes.redirectUrl, /\/cart\?payment_error=verification_failed/);
    assert.doesNotMatch(cbRes.redirectUrl, /order-success/);

    // 9d. Dashboard refund scan includes 'packed' orders, advances cursor across pages, and reports scan errors
    const scanCursors = [];
    const packedHolds = [];
    paymentIntentService.fetchReconciliationList = async () => ({ intents: [], hasMore: false });
    paymentIntentService.fetchOrphanWebhookEvents = async () => ({ count: 0, orphans: [], nextCursor: null });
    paymentIntentService.syncOrderRefundWithLock = async (p) => { packedHolds.push(p); return { synced: true, orderStatus: "on-hold" }; };
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async ({ cursor }) => {
      scanCursors.push(cursor);
      if (!cursor) {
        return {
          orders: [{ id: 905, status: "processing", delivery_status: "packed", rzp_order_id: "order_packed_1" }],
          hasMore: true,
          nextCursor: "1795800000:905",
        };
      }
      return { orders: [], hasMore: false, nextCursor: "" };
    };
    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async (ordId) => ordId === "order_packed_1"
          ? { items: [{ id: "pay_packed_1", order_id: "order_packed_1", amount: 50000, amount_refunded: 10000, refund_status: "partial" }] }
          : { items: [] },
      },
    });
    await runPaymentReconciliation({ olderThanMinutes: 0 });
    await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.deepEqual(scanCursors, ["", "1795800000:905"]);
    assert.equal(packedHolds[0]?.wcOrderId, 905);
    assert.equal(packedHolds[0]?.mode, "partial_hold");

    paymentIntentService.fetchUnfulfilledRazorpayOrders = async ({ cursor }) => ({
      orders: [], hasMore: true, nextCursor: cursor || "1795800000:905",
    });
    await runPaymentReconciliation({ olderThanMinutes: 0 });
    const repeatedCursor = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(repeatedCursor.errors.some((e) => e.stage === "dashboard_refund_scan"), true);

    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => { throw new Error("Scan endpoint unavailable"); };
    const failScanRes = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.ok(failScanRes.errorCount >= 1);
    assert.equal(failScanRes.errors.some((e) => e.stage === "dashboard_refund_scan"), true);
  });

  await t.test("10. Latest audit regressions: _intentPendingSync webhook durability, >100 same-timestamp keyset scan, and unflagged on-hold partial refund sync", async () => {
    // 10a. Immediate capture webhook stays 'orphan' if settleVerifiedExistingOrder returns _intentPendingSync: true,
    //      then recovers to 'processed' during replay once intent sync succeeds.
    const webhookStatuses = [];
    let intentSyncSucceeds = false;
    _setAnomalyHandlerForTesting(async () => ({ success: true }));
    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => ({
      id: 950, number: "950", status: "processing", total: "500.00", currency: "INR", customer_id: 44, meta_data: [],
    });
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_wh_sync_1", customer_id: 44, amount_in_paise: 50000, status: "paid",
    });
    paymentIntentService.updatePaymentIntentStatus = async (params) => {
      if (params.toStatus === "order_created") return intentSyncSucceeds;
      return true;
    };
    paymentIntentService.clearCustomerWcCart = async () => true;
    paymentIntentService.storeWebhookEvent = async () => true;
    paymentIntentService.updateWebhookEventStatus = async (params) => {
      webhookStatuses.push(params);
      return true;
    };
    _setRazorpayInstanceForTesting({
      payments: {
        fetch: async () => ({
          id: "pay_wh_sync_1", order_id: "order_wh_sync_1", status: "captured", amount: 50000, currency: "INR",
        }),
      },
    });

    const capturePayload = {
      event: "payment.captured",
      id: "evt_wh_sync_1",
      payload: {
        payment: {
          entity: { id: "pay_wh_sync_1", order_id: "order_wh_sync_1", status: "captured", amount: 50000, currency: "INR" },
        },
      },
    };
    const rawCap = Buffer.from(JSON.stringify(capturePayload));
    const capSig = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(rawCap).digest("hex");
    const whRes = makeMockRes();
    await handleWebhook({ headers: { "x-razorpay-signature": capSig }, body: capturePayload, rawBody: rawCap }, whRes);
    const waitStart = Date.now();
    while (webhookStatuses.length === 0 && Date.now() - waitStart < 2000) {
      await new Promise((r) => setTimeout(r, 15));
    }

    assert.equal(whRes.statusCode, 200);
    assert.equal(webhookStatuses.some((s) => s.status === "processed"), false, "must NOT mark processed when intent sync failed");
    assert.equal(webhookStatuses.at(-1)?.status, "orphan");
    assert.equal(webhookStatuses.at(-1)?.incrementAttempts, true);

    // Next reconciler replay resolves once intent sync succeeds
    intentSyncSucceeds = true;
    paymentIntentService.fetchReconciliationList = async () => ({ intents: [], hasMore: false });
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => ({ orders: [], hasMore: false, nextCursor: "" });
    paymentIntentService.fetchOrphanWebhookEvents = async ({ eventGroup }) => (
      eventGroup === "capture"
        ? {
            count: 1,
            orphans: [{
              event_id: "evt_wh_sync_1",
              event_type: "payment.captured",
              rzp_order_id: "order_wh_sync_1",
              rzp_payment_id: "pay_wh_sync_1",
              attempts: 1,
              payload_json: JSON.stringify(capturePayload),
            }],
            nextCursor: null,
          }
        : { count: 0, orphans: [], nextCursor: null }
    );
    const replayRes = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(replayRes.orphanCapturesRecovered, 1);
    assert.equal(webhookStatuses.at(-1)?.status, "processed");

    // 10b. Keyset scan across >100 orders (130 orders) sharing the exact same second + empty nextCursor scan error
    const sameTs = 1795801234;
    const allOrders = Array.from({ length: 130 }, (_, idx) => {
      const id = 1130 - idx; // DESC order 1130 down to 1001
      return {
        id,
        ts: sameTs,
        status: id === 1001 ? "on-hold" : "processing",
        delivery_status: id === 1001 ? "on-hold" : "processing",
        rzp_order_id: `order_same_ts_${id}`,
        partial_refund_hold: false,
      };
    });
    const visitedIds = [];
    const partialHoldTargets = [];
    paymentIntentService.fetchOrphanWebhookEvents = async () => ({ count: 0, orphans: [], nextCursor: null });
    paymentIntentService.syncOrderRefundWithLock = async (p) => {
      partialHoldTargets.push(p.wcOrderId);
      return { synced: true, action: "held_partial_refund", orderStatus: "on-hold" };
    };
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async ({ limit = 25, cursor = "" }) => {
      let startTs = Infinity;
      let startId = Infinity;
      if (cursor) {
        const [tsStr, idStr] = cursor.split(":");
        startTs = Number(tsStr);
        startId = Number(idStr);
      }
      const matching = allOrders.filter((o) => o.ts < startTs || (o.ts === startTs && o.id < startId));
      const slice = matching.slice(0, limit);
      const hasMore = matching.length > limit;
      const last = slice.at(-1);
      for (const o of slice) visitedIds.push(o.id);
      return {
        orders: slice,
        hasMore,
        nextCursor: hasMore && last ? `${last.ts}:${last.id}` : "",
      };
    };
    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async (rzpOrderId) => ({
          items: rzpOrderId === "order_same_ts_1001"
            ? [{ id: "pay_same_ts_1001", order_id: rzpOrderId, amount: 50000, amount_refunded: 15000, refund_status: "partial" }]
            : [{ id: `pay_${rzpOrderId}`, order_id: rzpOrderId, amount: 50000, amount_refunded: 0, refund_status: null }],
        }),
      },
    });

    // Clear any prior dashboardRefundCursor first via a single empty non-hasMore pass, then scan 6 pages (130 orders)
    const origFetchFn = paymentIntentService.fetchUnfulfilledRazorpayOrders;
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => ({ orders: [], hasMore: false, nextCursor: "" });
    await runPaymentReconciliation({ olderThanMinutes: 0 });
    paymentIntentService.fetchUnfulfilledRazorpayOrders = origFetchFn;
    visitedIds.length = 0;

    for (let page = 0; page < 6; page++) {
      await runPaymentReconciliation({ olderThanMinutes: 0 });
    }
    assert.equal(visitedIds.length, 130, "must visit all 130 same-timestamp orders");
    assert.equal(new Set(visitedIds).size, 130, "must visit each same-timestamp order once without revisiting");
    assert.equal(visitedIds.at(-1), 1001);
    assert.deepEqual(partialHoldTargets, [1001], "unflagged on-hold order #1001 with partial refund must get partial_hold flag");

    // Empty nextCursor when hasMore=true must also report dashboard_refund_scan error
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => ({ orders: [], hasMore: true, nextCursor: "" });
    const missingCursorRes = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(missingCursorRes.errors.some((e) => e.stage === "dashboard_refund_scan"), true);

    // Reset dashboardRefundCursor cleanly after error test
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => ({ orders: [], hasMore: false, nextCursor: "" });
    await runPaymentReconciliation({ olderThanMinutes: 0 });

    // Static check: WP keyset helper uses (date_created_gmt, id) tuple and exposes partial_refund_hold
    const php = fs.readFileSync(wpPluginPath, "utf8");
    assert.match(php, /mumbai_apply_packing_alarm_clauses/);
    assert.match(php, /date_created_gmt < %s OR \(\{?\$table_orders\}?\.date_created_gmt = %s AND/);
    assert.match(php, /'partial_refund_hold'\s*=>/);

    // 10c. Already-flagged existing on-hold order skips duplicate partial_hold sync & alert spam
    let flaggedSyncCount = 0;
    let flaggedAlertCount = 0;
    _setAnomalyHandlerForTesting(async () => { flaggedAlertCount++; return { success: true }; });
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => ({
      id: 951,
      number: "951",
      status: "on-hold",
      total: "500.00",
      currency: "INR",
      customer_id: 44,
      meta_data: [{ key: "_payment_partial_refund_hold", value: "yes" }],
    });
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_already_flagged_partial", customer_id: 44, amount_in_paise: 50000, status: "paid",
    });
    paymentIntentService.syncOrderRefundWithLock = async () => { flaggedSyncCount++; return { synced: true }; };
    _setRazorpayInstanceForTesting({
      payments: {
        fetch: async () => ({
          id: "pay_already_flagged", order_id: "order_already_flagged_partial", status: "captured",
          amount: 50000, amount_refunded: 10000, refund_status: "partial", currency: "INR",
        }),
      },
    });
    const flaggedRes = await finalizePaymentAndCreateOrder({
      rzpOrderId: "order_already_flagged_partial", rzpPaymentId: "pay_already_flagged", expectedCustomerId: 44,
    });
    assert.equal(flaggedRes.success, false);
    assert.equal(flaggedRes.support_required, true);
    assert.equal(flaggedSyncCount, 0);
    assert.equal(flaggedAlertCount, 0);

    // 10d. Concurrent refund completing before refundRazorpayPayment submits increments refundsConfirmed, not refundsExecuted
    paymentIntentService.findWcOrderByRazorpayOrderId = async () => null;
    paymentIntentService.getPaymentIntent = async () => ({
      rzp_order_id: "order_already_rfnd_metric",
      customer_id: 44,
      amount_in_paise: 50000,
      status: "created",
      checkout_payload: { line_items: [{ product_id: 1, quantity: 1 }] },
    });
    paymentIntentService.reserveCheckoutStock = async () => {
      const err = new Error("Out of stock");
      err.response = { status: 409 };
      throw err;
    };
    paymentIntentService.releaseCheckoutStock = async () => true;
    paymentIntentService.updatePaymentIntentStatus = async () => true;
    paymentIntentService.fetchReconciliationList = async () => ({
      intents: [{ rzp_order_id: "order_already_rfnd_metric", status: "created", attempts: 0 }],
      hasMore: false,
    });
    paymentIntentService.fetchUnfulfilledRazorpayOrders = async () => ({ orders: [], hasMore: false, nextCursor: "" });
    let fetchCountMetric = 0;
    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: "pay_already_rfnd_metric", order_id: "order_already_rfnd_metric", status: "captured", amount: 50000, currency: "INR" }],
        }),
      },
      payments: {
        fetch: async () => {
          fetchCountMetric++;
          const refunded = fetchCountMetric > 1;
          return {
            id: "pay_already_rfnd_metric",
            order_id: "order_already_rfnd_metric",
            status: "captured",
            amount: 50000,
            amount_refunded: refunded ? 50000 : 0,
            refund_status: refunded ? "full" : null,
            currency: "INR",
          };
        },
        fetchMultipleRefund: async () => ({ items: [] }),
        refund: async () => { throw new Error("must not call Razorpay refund when already refunded"); },
      },
    });
    const metricRes = await runPaymentReconciliation({ olderThanMinutes: 0 });
    assert.equal(metricRes.refundsConfirmed, 1, "already-refunded race must increment refundsConfirmed");
    assert.equal(metricRes.refundsExecuted, 0, "already-refunded race must not increment refundsExecuted");
  });
});
