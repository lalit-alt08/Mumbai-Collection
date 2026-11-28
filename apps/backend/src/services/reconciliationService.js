import { finalizePaymentAndCreateOrder } from "../controllers/paymentController.js";
import { processRefundWebhookEvent } from "../controllers/paymentWebhookHandler.js";
import { acquirePaymentLease } from "./paymentLease.js";
import { logger, getErrorMessage, sanitizeError } from "../utils/logger.js";
import {
  refundRazorpayPayment,
  fetchRazorpayPayment,
  fetchRazorpayOrderPayments,
  isRefundFullySettled,
} from "./razorpayService.js";
import paymentIntentService from "./paymentIntentService.js";
import { alertStaffAnomaly } from "./alertService.js";
import api from "../config/woocommerce.js";
import { invalidateOrderDetailCache } from "./orderDetailCache.js";
import { publishOrderEvent } from "./orderNotificationService.js";
import { serverCache } from "../utils/memoryCache.js";
import { getRedisClient } from "../config/redis.js";

const RECONCILIATION_LOCK_ID = "cron_reconciler_worker";
let dashboardRefundCursor = "";
const MAX_RECOVERY_ATTEMPTS = 3;
const MAX_UNPAID_PAGES_PER_RUN = 3;
const UNPAID_BACKOFF_SECONDS = [600, 1800, 7200, 21600, 43200];
const RECOVERABLE_STATUSES = new Set(['created', 'cancelled', 'abandoned', 'paid', 'quarantined', 'orphan_payment', 'refund_pending', 'refund_failed']);
const REFUND_WEBHOOK_EVENTS = new Set(["refund.processed", "refund.failed"]);
const CAPTURE_WEBHOOK_EVENTS = new Set(["payment.captured", "order.paid"]);
const TERMINAL_UNFULFILLED_WC_STATUSES = new Set(["refunded", "cancelled", "failed", "completed", "dispatched", "out-for-delivery"]);
const localOrphanAttempts = new Map();
let orphanRefundCursor = null;
let orphanCaptureCursor = null;

const nextOrphanAttempt = async (kind, eventId) => {
  const redis = getRedisClient();
  const attemptKey = `${kind}:${eventId}`;
  if (redis) {
    try {
      const key = `reconciler:orphan_${kind}_attempts:${eventId}`;
      const count = Number(await redis.incr(key));
      if (count === 1) await redis.expire(key, 24 * 60 * 60);
      return count;
    } catch (_) {}
  }
  if (localOrphanAttempts.size >= 1000 && !localOrphanAttempts.has(attemptKey)) {
    const firstKey = localOrphanAttempts.keys().next().value;
    if (firstKey) localOrphanAttempts.delete(firstKey);
  }
  const next = (localOrphanAttempts.get(attemptKey) || 0) + 1;
  localOrphanAttempts.set(attemptKey, next);
  return next;
};

const clearOrphanAttempt = async (kind, eventId) => {
  localOrphanAttempts.delete(`${kind}:${eventId}`);
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(`reconciler:orphan_${kind}_attempts:${eventId}`);
    } catch (_) {}
  }
};
const recoveryAttempts = (intent) => ['refund_pending', 'refund_failed'].includes(intent.status)
  ? Number(intent.attempts || 0)
  : Number(String(intent.error_reason || '').match(/^GATEWAY_LOOKUP_FAILURES:(\d+)/)?.[1] || 0);

// Caller holds the payment lease. A failed gateway lookup counts too: it must not
// bypass the retry limit simply because no refund API call was reached.
const persistRecoveryFailure = async (id, intent, error, { increment = true } = {}) => {
  if (!intent || !RECOVERABLE_STATUSES.has(intent.status)) return { skipped: true };
  // Fulfillment also uses attempts. Keep gateway discovery's limit separate so
  // transient WooCommerce failures retain their existing paid-recovery deadline.
  const attempts = recoveryAttempts(intent) + (increment ? 1 : 0);
  if (!increment && attempts < MAX_RECOVERY_ATTEMPTS) return { skipped: true };
  const isRefund = ['refund_pending', 'refund_failed'].includes(intent.status);
  const escalated = attempts >= MAX_RECOVERY_ATTEMPTS;
  const toStatus = escalated ? (isRefund ? 'refund_escalated' : 'reconciliation_escalated') : (isRefund ? 'refund_failed' : intent.status);
  const reason = getErrorMessage(error);
  const updated = await paymentIntentService.updatePaymentIntentStatus({
    rzpOrderId: id, fromStatus: intent.status, toStatus,
    incrementAttempts: increment,
    ...(!escalated && isRefund ? { nextRetrySeconds: 60 * Math.pow(2, attempts - 1) } : {}),
    errorReason: isRefund ? `Refund recovery attempt ${attempts}: ${reason}` : `GATEWAY_LOOKUP_FAILURES:${attempts} | ${reason}`,
  });
  if (!updated) throw new Error('Could not durably record reconciliation failure; state must be reviewed');
  if (escalated) await alertStaffAnomaly({
    type: isRefund ? 'RECONCILER_REFUND_ESCALATION' : 'RECONCILER_PAYMENT_ESCALATION',
    severity: 'critical', rzpOrderId: id,
    message: 'Automatic payment recovery has paused after repeated failures. Staff review is required; no new refund was submitted by this escalation.',
    details: { attempts, reason },
  });
  return { escalated, attempts };
};

const recordRecoveryFailure = async (id, error, options) => {
  const lease = await acquirePaymentLease(id, 'recovery-failure');
  if (!lease) throw new Error('Could not record recovery failure because payment processing is busy');
  try {
    await lease.refresh();
    const intent = await paymentIntentService.getPaymentIntent(id, { fresh: true });
    return await persistRecoveryFailure(id, intent, error, options);
  } finally { await lease.release(); }
};

/**
 * Normalizes persisted intent checkout payload whether stored at root or nested under checkout_payload.
 */
export const extractCheckoutDetails = (intentRow) => {
  if (!intentRow?.checkout_payload) return null;
  let parsed = null;
  try {
    parsed = typeof intentRow.checkout_payload === "string"
      ? JSON.parse(intentRow.checkout_payload)
      : intentRow.checkout_payload;
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  // Support both nested production payload (paymentIntent.checkout_payload) and flat mock payload
  const checkout = (parsed.checkout_payload && typeof parsed.checkout_payload === "object")
    ? parsed.checkout_payload
    : parsed;

  const customerId = Number(
    checkout.customer_id ||
    checkout.user_id ||
    parsed.customer_id ||
    parsed.user_id ||
    intentRow.user_id
  ) || 0;

  const billing = (checkout.billing && typeof checkout.billing === "object")
    ? checkout.billing
    : (parsed.billing && typeof parsed.billing === "object" ? parsed.billing : {});

  const shipping = (checkout.shipping && typeof checkout.shipping === "object")
    ? checkout.shipping
    : (parsed.shipping && typeof parsed.shipping === "object" ? parsed.shipping : {});

  const lineItems = Array.isArray(checkout.line_items)
    ? checkout.line_items
    : (Array.isArray(parsed.line_items) ? parsed.line_items : []);

  const couponLines = Array.isArray(checkout.coupon_lines)
    ? checkout.coupon_lines
    : (Array.isArray(parsed.coupon_lines) ? parsed.coupon_lines : []);

  const shippingLines = Array.isArray(checkout.shipping_lines)
    ? checkout.shipping_lines
    : (Array.isArray(parsed.shipping_lines) ? parsed.shipping_lines : []);

  const customerEmail = billing.email || parsed.customer_email || intentRow.customer_email || "";
  const customerName = `${billing.first_name || ""} ${billing.last_name || ""}`.trim() || parsed.customer_name || "Customer";

  return {
    customerId,
    customerEmail,
    customerName,
    billing,
    shipping,
    lineItems,
    couponLines,
    shippingLines,
    raw: parsed,
  };
};

const syncWcOrderRefunded = async (wcOrder, { refundId = null, note, sourceLabel = 'Reconciler' }) => {
  if (!wcOrder || wcOrder.status === 'refunded') return false;
  const syncFn = paymentIntentService.syncOrderRefundWithLock;
  const syncRes = typeof syncFn === 'function'
    ? await syncFn({ wcOrderId: wcOrder.id, mode: 'full', refundId, note })
    : { fallback: true };

  if (syncRes?.fallback) {
    if (wcOrder.status !== 'refunded') {
      await api.put(`orders/${wcOrder.id}`, {
        status: 'refunded',
        meta_data: [{ key: '_delivery_status', value: 'refunded' }],
      });
      await api.post(`orders/${wcOrder.id}/notes`, {
        note,
        customer_note: false,
      }).catch(() => {});
    }
  }
  await invalidateOrderDetailCache(wcOrder.id);
  serverCache.invalidatePrefix('employee:overview');
  publishOrderEvent({ event: 'ORDER_STATUS_UPDATED', orderId: wcOrder.id, status: 'refunded' });
  logger.info({ wcOrderId: wcOrder.id }, `[${sourceLabel}] WooCommerce order moved to refunded following gateway refund confirmation`);
  return true;
};

const reconcileUnfulfilledDashboardRefunds = async ({ lease, results }) => {
  if (typeof paymentIntentService.fetchUnfulfilledRazorpayOrders !== 'function') return;
  let unfulfilledOrders = [];
  try {
    const scanRes = await paymentIntentService.fetchUnfulfilledRazorpayOrders({
      limit: 25,
      days: 14,
      cursor: dashboardRefundCursor,
    });
    if (Array.isArray(scanRes)) {
      unfulfilledOrders = scanRes;
      dashboardRefundCursor = "";
    } else {
      unfulfilledOrders = Array.isArray(scanRes?.orders) ? scanRes.orders : [];
      if (scanRes?.hasMore && (!scanRes?.nextCursor || scanRes.nextCursor === dashboardRefundCursor)) {
        throw new Error('Dashboard refund scan cursor did not advance');
      }
      dashboardRefundCursor =
        scanRes?.hasMore && scanRes?.nextCursor && scanRes.nextCursor !== dashboardRefundCursor
          ? scanRes.nextCursor
          : "";
    }
  } catch (err) {
    results.errorCount++;
    results.errors.push({ stage: 'dashboard_refund_scan', error: getErrorMessage(err) });
    logger.warn({ err: getErrorMessage(err) }, '[Reconciler] Failed to scan unfulfilled orders for dashboard refunds');
    return;
  }
  if (!Array.isArray(unfulfilledOrders) || unfulfilledOrders.length === 0) return;

  for (const wcOrder of unfulfilledOrders) {
    const rzpOrderId = wcOrder?.rzp_order_id;
    const wcOrderId = wcOrder?.id;
    const wcStatus = String(wcOrder?.status || '').toLowerCase();
    if (!wcOrderId || !rzpOrderId || TERMINAL_UNFULFILLED_WC_STATUSES.has(wcStatus) ||
        TERMINAL_UNFULFILLED_WC_STATUSES.has(String(wcOrder?.delivery_status || '').toLowerCase())) continue;

    await lease.refresh();
    let orderLease;
    try {
      orderLease = await acquirePaymentLease(rzpOrderId, 'reconciler-dashboard-refund');
    } catch (_) {
      continue;
    }
    if (!orderLease) continue;

    try {
      const paymentsRes = await fetchRazorpayOrderPayments(rzpOrderId);
      const refundedPayment = (paymentsRes?.items || []).find((p) => {
        const refundedAmt = Number(p?.amount_refunded || 0);
        return refundedAmt > 0 || p?.refund_status === 'full' || p?.refund_status === 'partial';
      });
      if (!refundedPayment) continue;

      const total = Number(refundedPayment.amount || 0);
      const refundedAmt = Number(refundedPayment.amount_refunded || 0);
      const isFullRefund = refundedPayment.refund_status === 'full' || (total > 0 && refundedAmt >= total);

      if (isFullRefund) {
        if (wcOrder.status !== 'refunded') {
          await syncWcOrderRefunded(wcOrder, {
            note: '[Reconciler] Full dashboard Razorpay refund detected for unfulfilled order. Order moved to refunded.',
            sourceLabel: 'Reconciler Dashboard Refund',
          });
        }
        const intent = await paymentIntentService.getPaymentIntent(rzpOrderId, { fresh: true }).catch(() => null);
        if (intent && intent.status !== 'refunded') {
          await paymentIntentService.updatePaymentIntentStatus({
            rzpOrderId,
            fromStatus: intent.status,
            toStatus: 'refunded',
          });
          const reservationId = intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id || rzpOrderId;
          await paymentIntentService.releaseCheckoutStock(reservationId).catch(() => {});
        }
        results.refundsConfirmed++;
      } else if (refundedAmt > 0 && (wcStatus !== 'on-hold' || !wcOrder.partial_refund_hold)) {
        const partialNote = `[AUDIT ALERT] Manual partial Razorpay refund (${refundedAmt}/${total} paise) detected by reconciler. Order held on-hold for owner review; do not dispatch.`;
        const syncFn = paymentIntentService.syncOrderRefundWithLock;
        const syncRes = typeof syncFn === 'function'
          ? await syncFn({ wcOrderId, mode: 'partial_hold', note: partialNote })
          : { fallback: true };
        if (syncRes?.fallback) {
          await api.put(`orders/${wcOrderId}`, {
            status: 'on-hold',
            meta_data: [
              { key: '_delivery_status', value: 'on-hold' },
              { key: '_payment_partial_refund_hold', value: 'yes' },
            ],
          });
          await api.post(`orders/${wcOrderId}/notes`, { note: partialNote, customer_note: false }).catch(() => {});
        }
        await invalidateOrderDetailCache(wcOrderId);
        serverCache.invalidatePrefix('employee:overview');
        publishOrderEvent({ event: 'ORDER_STATUS_UPDATED', orderId: wcOrderId, status: 'on-hold' });
        await alertStaffAnomaly({
          type: 'PARTIAL_OR_FAILED_REFUND',
          severity: 'critical',
          rzpOrderId,
          rzpPaymentId: refundedPayment.id,
          wcOrderId,
          message: `Manual partial refund detected for unfulfilled order #${wcOrderId}. Dispatch blocked (on-hold) for owner review.`,
          details: { amount_refunded: refundedAmt, total },
        });
      }
    } catch (err) {
      results.errorCount++;
      if (results.errors.length < 50) {
        results.errors.push({ rzpOrderId, wcOrderId, stage: 'dashboard_refund_sync', error: getErrorMessage(err) });
      }
      logger.warn({ rzpOrderId, wcOrderId, err: getErrorMessage(err) }, '[Reconciler] Failed to sync dashboard refund for unfulfilled order');
    } finally {
      await orderLease.release();
    }
  }
};

const replayOrphanWebhookLoop = async ({
  lease,
  results,
  kind,
  getCursor,
  setCursor,
  fetchParams,
  seenEventIds,
  eventSet,
  persistRetryTimingOnMockRows = false,
  processRow,
  onRecovered,
  escalationType,
  escalationMessage,
}) => {
  try {
    for (let iter = 0; iter < 10; iter++) {
      await lease.refresh();
      const orphanBatch = await paymentIntentService.fetchOrphanWebhookEvents({
        limit: 50,
        ...fetchParams,
        cursor: getCursor(),
      });
      const orphans = Array.isArray(orphanBatch?.orphans) ? orphanBatch.orphans : [];
      for (const row of orphans) {
        if (!row?.event_id || seenEventIds.has(row.event_id)) continue;
        if (!eventSet.has(row.event_type)) continue;
        seenEventIds.add(row.event_id);
        results.processed++;
        let parsedPayload = null;
        if (row.raw_payload) {
          try {
            parsedPayload = typeof row.raw_payload === "string" ? JSON.parse(row.raw_payload) : row.raw_payload;
          } catch (_) {}
        }
        try {
          await processRow(row, parsedPayload);
          await clearOrphanAttempt(kind, row.event_id);
          onRecovered();
        } catch (rowErr) {
          const prevAttempts = Number(row.attempts || 0);
          const localCount = await nextOrphanAttempt(kind, row.event_id);
          const attempts = Math.max(prevAttempts + 1, localCount);
          let escalated = false;
          let recordedError = rowErr;
          if (attempts >= MAX_RECOVERY_ATTEMPTS) {
            try {
              const alert = await alertStaffAnomaly({
                type: escalationType,
                severity: "critical",
                rzpOrderId: row.rzp_order_id,
                rzpPaymentId: row.rzp_payment_id,
                message: escalationMessage,
                details: { eventId: row.event_id, eventType: row.event_type, attempts, reason: getErrorMessage(rowErr) },
              });
              if (!alert?.success) {
                throw new Error(`Could not queue orphan ${kind} escalation alert`);
              }
              const updated = await paymentIntentService.updateWebhookEventStatus({ eventId: row.event_id, status: "failed" });
              if (!updated) throw new Error(`Could not durably record orphan ${kind} escalation`);
              await clearOrphanAttempt(kind, row.event_id);
              escalated = true;
              results.escalated++;
            } catch (escalationErr) {
              recordedError = escalationErr;
              logger.error(
                { eventId: row.event_id, rzpOrderId: row.rzp_order_id, err: sanitizeError(escalationErr) },
                `[Reconciler] Failed to escalate orphan ${kind} webhook event; keeping eligible for retry`
              );
            }
          } else if (persistRetryTimingOnMockRows || Object.prototype.hasOwnProperty.call(row, "next_retry_at")) {
            await paymentIntentService.updateWebhookEventStatus({
              eventId: row.event_id,
              status: "orphan",
              incrementAttempts: true,
              nextRetrySeconds: 60 * Math.pow(2, attempts - 1),
            }).catch(() => {});
          }
          results.errorCount++;
          if (results.errors.length < 50) {
            results.errors.push({
              eventId: row.event_id,
              rzpOrderId: row.rzp_order_id,
              error: getErrorMessage(recordedError),
              escalated,
            });
          }
        }
      }
      setCursor(orphanBatch.nextCursor || null);
      if (!getCursor()) break;
    }
  } catch (orphanFetchErr) {
    results.errorCount++;
    if (results.errors.length < 50) {
      results.errors.push({ stage: `orphan_${kind}_fetch`, error: getErrorMessage(orphanFetchErr) });
    }
    logger.error({ err: sanitizeError(orphanFetchErr) }, `[Reconciler] Failed to scan orphan ${kind} webhook events`);
  }
};

// All fulfillment uses the same per-payment lock and financial guards as browser verification.
export const runPaymentReconciliation = async ({ olderThanMinutes = 1 } = {}) => {
  const lease = await acquirePaymentLease(RECONCILIATION_LOCK_ID, 'reconciler', 2000);
  if (!lease) return { skipped: true, reason: 'locked' };
  const results = {
    processed: 0,
    healedOrders: 0,
    refundsExecuted: 0,
    refundsConfirmed: 0,
    orphanRefundsRecovered: 0,
    orphanCapturesRecovered: 0,
    escalated: 0,
    errorCount: 0,
    errors: [],
  };
  const seenIntentIds = new Set();

  const processIntentRow = async (row) => {
    const id = row?.rzp_order_id;
    if (!id || seenIntentIds.has(id)) return;
    seenIntentIds.add(id);
    results.processed++;
    let stage = 'gateway_lookup';
    try {
      // Stop already-exhausted records before any fallible gateway request.
      if (recoveryAttempts(row) >= MAX_RECOVERY_ATTEMPTS) {
        const recovery = await recordRecoveryFailure(id, new Error('Automatic recovery retry limit reached'), { increment: false });
        if (recovery.escalated) results.escalated++;
        return;
      }
      if (['refund_pending', 'refund_failed'].includes(row.status)) {
        stage = 'refund_recovery';
        const refundLease = await acquirePaymentLease(id, 'refund-retry');
        if (!refundLease) return;
        try {
          const intent = await paymentIntentService.getPaymentIntent(id, { fresh: true });
          if (!intent || !['refund_pending', 'refund_failed'].includes(intent.status)) return;
          if (Number(intent.attempts || 0) >= MAX_RECOVERY_ATTEMPTS) {
            const recovery = await persistRecoveryFailure(id, intent, new Error('Refund retry limit reached'), { increment: false });
            if (recovery.escalated) results.escalated++;
            return;
          }
          const payment = await fetchRazorpayPayment(intent.rzp_payment_id || row.rzp_payment_id);
          const total = Number(payment.amount);
          if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Gateway payment amount is invalid; refund requires review');
          if (payment.refund_status === 'full' || (total > 0 && Number(payment.amount_refunded || 0) >= total)) {
            // Ensure existing WooCommerce order is moved to refunded before marking intent settled
            const wcOrder = await paymentIntentService.findWcOrderByRazorpayOrderId(id);
            if (wcOrder && wcOrder.status !== 'refunded') {
              await syncWcOrderRefunded(wcOrder, {
                note: '[Reconciler] Full gateway refund verified. Order status synced to refunded.',
                sourceLabel: 'Reconciler',
              });
            }
            const updated = await paymentIntentService.updatePaymentIntentStatus({ rzpOrderId: id, fromStatus: intent.status, toStatus: 'refunded' });
            if (!updated) throw new Error('Could not durably record confirmed refund settlement');
            await paymentIntentService.releaseCheckoutStock(intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id || id);
            results.refundsConfirmed++;
            return;
          }
          // A known order must be reviewed before automatic refund recovery.
          const order = await paymentIntentService.findWcOrderByRazorpayOrderId(id);
          if (order) {
            const updated = await paymentIntentService.updatePaymentIntentStatus({ rzpOrderId: id, fromStatus: intent.status, toStatus: 'refund_escalated', errorReason: 'Order exists: refund requires review' });
            if (!updated) throw new Error('Could not record refund escalation');
            results.escalated++;
            await alertStaffAnomaly({ type: 'RECONCILER_REFUND_ESCALATION', severity: 'critical', rzpOrderId: id, message: 'Refund requires staff review.' });
            return;
          }
          await refundLease.refresh();
          const refund = await refundRazorpayPayment({ paymentId: payment.id, amountInPaise: total - Number(payment.amount_refunded || 0), notes: { rzp_order_id: id, reason: 'Auto-refund: Item out of stock during payment capture' } });
          const latest = await fetchRazorpayPayment(payment.id);
          const full = isRefundFullySettled(refund, total, latest);
          const updated = await paymentIntentService.updatePaymentIntentStatus({
            rzpOrderId: id,
            fromStatus: intent.status,
            toStatus: full ? 'refunded' : 'refund_pending',
            refundId: refund.id,
            ...(!full ? { nextRetrySeconds: 120 } : {}),
          });
          if (!updated) throw new Error('Could not durably record gateway refund result; do not submit a duplicate refund');
          if (full) {
            await paymentIntentService.releaseCheckoutStock(intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id || id);
            results.refundsExecuted++;
          }
        } finally { await refundLease.release(); }
      } else {
        const payments = await fetchRazorpayOrderPayments(id);
        const items = payments.items || [];
        const payment = items.find(p => p.status === 'captured');
        if (payment) {
          stage = 'finalization';
          const result = await finalizePaymentAndCreateOrder({ rzpOrderId: id, rzpPaymentId: payment.id, source: 'reconciler' });
          if (result.success) {
            if (result._intentPendingSync) {
              results.errorCount++;
              if (results.errors.length < 50) {
                results.errors.push({ rzpOrderId: id, stage: 'intent_sync', error: 'WooCommerce order confirmed but payment intent order_created update failed' });
              }
            } else {
              results.healedOrders++;
            }
          } else if (result.refunded && !result._idempotent && !result._alreadyRefunded) {
            results.refundsExecuted++;
          } else if (result.refunded && (result._idempotent || result._alreadyRefunded)) {
            results.refundsConfirmed++;
          } else if (!result.terminal && result.status !== 409) {
            throw new Error(result.message || 'Captured payment remains pending fulfillment');
          }
        } else if (['created', 'cancelled', 'abandoned'].includes(row.status) && Object.prototype.hasOwnProperty.call(row, 'next_retry_at')) {
          const hasAuthorized = items.some((p) => p.status === 'authorized');
          const prevPolls = Number(String(row.error_reason || '').match(/^UNPAID_POLLS:(\d+)/)?.[1] || 0);
          const nextRetrySeconds = hasAuthorized
            ? 120
            : UNPAID_BACKOFF_SECONDS[Math.min(prevPolls, UNPAID_BACKOFF_SECONDS.length - 1)];
          await paymentIntentService.updatePaymentIntentStatus({
            rzpOrderId: id,
            fromStatus: row.status,
            toStatus: row.status,
            nextRetrySeconds,
            ...(hasAuthorized ? {} : { errorReason: `UNPAID_POLLS:${prevPolls + 1}` }),
          }).catch(() => {});
        }
      }
    } catch (err) {
      let escalated = false;
      if (stage !== 'finalization') {
        try {
          const recovery = await recordRecoveryFailure(id, err);
          escalated = Boolean(recovery.escalated);
          if (escalated) results.escalated++;
        } catch (persistError) {
          logger.error({ rzpOrderId: id, err: sanitizeError(persistError) }, '[Reconciler] Failure counter/escalation could not be persisted');
        }
      }
      results.errorCount++;
      if (results.errors.length < 50) results.errors.push({ rzpOrderId: id, error: getErrorMessage(err), code: err?.error?.code || err?.code, status: err?.statusCode || err?.response?.status, escalated });
      logger.error({ rzpOrderId: id, err: sanitizeError(err), escalated }, '[Reconciler] Payment recovery failed; check durable retry/review state');
    }
  };

  try {
    // Pass 1: Exhaust all urgent paid/refund/quarantined recovery queues before polling unpaid checkouts.
    let urgentCursor = '';
    while (true) {
      await lease.refresh();
      const batch = await paymentIntentService.fetchReconciliationList({
        limit: 50,
        olderThanMinutes,
        cursor: urgentCursor,
        statusGroup: 'urgent',
      });
      for (const row of batch.intents || []) {
        await processIntentRow(row);
      }
      if (!batch.hasMore) break;
      if (!batch.nextCursor || batch.nextCursor === urgentCursor) throw new Error('Reconciliation cursor did not advance');
      urgentCursor = batch.nextCursor;
    }

    // Pass 2: Bounded sweep of unpaid checkouts with exponential backoff so abandoned traffic cannot starve refunds.
    let unpaidCursor = '';
    for (let page = 0; page < MAX_UNPAID_PAGES_PER_RUN; page++) {
      await lease.refresh();
      const batch = await paymentIntentService.fetchReconciliationList({
        limit: 50,
        olderThanMinutes,
        cursor: unpaidCursor,
        statusGroup: 'unpaid',
      });
      for (const row of batch.intents || []) {
        await processIntentRow(row);
      }
      if (!batch.hasMore) break;
      if (!batch.nextCursor || batch.nextCursor === unpaidCursor) throw new Error('Reconciliation cursor did not advance');
      unpaidCursor = batch.nextCursor;
    }

    // Pass 3: Sweep unfulfilled orders created earlier (order_created) for dashboard full or partial Razorpay refunds.
    await reconcileUnfulfilledDashboardRefunds({ lease, results });

    // Pass 4: Replay unresolved/orphan webhook events (both refund and capture queues).
    if (typeof paymentIntentService.fetchOrphanWebhookEvents === "function") {
      const seenOrphanEventIds = new Set();

      await replayOrphanWebhookLoop({
        lease,
        results,
        kind: "refund",
        getCursor: () => orphanRefundCursor,
        setCursor: (next) => { orphanRefundCursor = next; },
        fetchParams: { refundOnly: true },
        seenEventIds: seenOrphanEventIds,
        eventSet: REFUND_WEBHOOK_EVENTS,
        persistRetryTimingOnMockRows: false,
        processRow: async (row, parsedPayload) => {
          const refundEntity = parsedPayload?.payload?.refund?.entity || null;
          const paymentEntity = parsedPayload?.payload?.payment?.entity || null;
          await processRefundWebhookEvent({
            eventId: row.event_id,
            event: row.event_type,
            rzpPaymentId: row.rzp_payment_id || refundEntity?.payment_id || paymentEntity?.id,
            rzpOrderId: row.rzp_order_id || paymentEntity?.order_id || refundEntity?.notes?.rzp_order_id,
            refundEntity,
            paymentEntity,
          });
        },
        onRecovered: () => { results.orphanRefundsRecovered++; },
        escalationType: "ORPHAN_REFUND_WEBHOOK_ESCALATED",
        escalationMessage: "Automatic retry of a refund webhook event failed repeatedly. Staff review is required.",
      });

      await replayOrphanWebhookLoop({
        lease,
        results,
        kind: "capture",
        getCursor: () => orphanCaptureCursor,
        setCursor: (next) => { orphanCaptureCursor = next; },
        fetchParams: { eventGroup: "capture" },
        seenEventIds: seenOrphanEventIds,
        eventSet: CAPTURE_WEBHOOK_EVENTS,
        persistRetryTimingOnMockRows: true,
        processRow: async (row, parsedPayload) => {
          const paymentEntity = parsedPayload?.payload?.payment?.entity || null;
          const orderEntity = parsedPayload?.payload?.order?.entity || null;
          const rzpOrderId = row.rzp_order_id || paymentEntity?.order_id || orderEntity?.id;
          let rzpPaymentId = row.rzp_payment_id || paymentEntity?.id;
          if (!rzpPaymentId && rzpOrderId) {
            const paymentsRes = await fetchRazorpayOrderPayments(rzpOrderId);
            const captured = (paymentsRes?.items || []).find((p) => p.status === "captured");
            rzpPaymentId = captured?.id || null;
          }
          if (!rzpOrderId || !rzpPaymentId) {
            throw new Error("Capture webhook event missing Razorpay order or payment reference");
          }
          const result = await finalizePaymentAndCreateOrder({
            rzpOrderId,
            rzpPaymentId,
            source: "webhook_replay",
          });
          const resolved =
            ((result.success && (result.order_id || result.terminal || result._flagged)) || result.terminal) &&
            !result._intentPendingSync;
          if (!resolved) {
            throw new Error(result.message || `Capture finalization deferred (status: ${result.status || "pending"})`);
          }
          const updated = await paymentIntentService.updateWebhookEventStatus({
            eventId: row.event_id,
            status: "processed",
          });
          if (!updated) {
            throw new Error("Could not durably mark capture webhook event as processed");
          }
          serverCache.set(`webhook:event:${row.event_id}`, true, 24 * 60 * 60 * 1000);
        },
        onRecovered: () => { results.orphanCapturesRecovered++; },
        escalationType: "ORPHAN_PAYMENT_WEBHOOK_ESCALATED",
        escalationMessage: "Automatic retry of a captured payment webhook event failed repeatedly. Staff review is required.",
      });
    }

    return results;
  } finally { await lease.release(); }
};
export default { runPaymentReconciliation };
