import { finalizePaymentAndCreateOrder } from "../controllers/paymentController.js";
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

const RECONCILIATION_LOCK_ID = "cron_reconciler_worker";
const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERABLE_STATUSES = new Set(['created', 'cancelled', 'abandoned', 'paid', 'quarantined', 'orphan_payment', 'refund_pending', 'refund_failed']);
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
    incrementAttempts: increment, errorReason: isRefund ? `Refund recovery attempt ${attempts}: ${reason}` : `GATEWAY_LOOKUP_FAILURES:${attempts} | ${reason}`,
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

// All fulfillment uses the same per-payment lock and financial guards as browser verification.
export const runPaymentReconciliation = async ({ olderThanMinutes = 1 } = {}) => {
  const lease = await acquirePaymentLease(RECONCILIATION_LOCK_ID, 'reconciler', 2000);
  if (!lease) return { skipped: true, reason: 'locked' };
  const results = { processed: 0, healedOrders: 0, refundsExecuted: 0, refundsConfirmed: 0, escalated: 0, errorCount: 0, errors: [] };
  let cursor = '';
  try {
    while (true) {
      await lease.refresh();
      const batch = await paymentIntentService.fetchReconciliationList({ limit: 50, olderThanMinutes, cursor });
      for (const row of batch.intents || []) {
        results.processed++;
        const id = row.rzp_order_id;
        let stage = 'gateway_lookup';
        try {
          // Stop already-exhausted records before any fallible gateway request.
          if (recoveryAttempts(row) >= MAX_RECOVERY_ATTEMPTS) {
            const recovery = await recordRecoveryFailure(id, new Error('Automatic recovery retry limit reached'), { increment: false });
            if (recovery.escalated) results.escalated++;
            continue;
          }
          if (['refund_pending', 'refund_failed'].includes(row.status)) {
            stage = 'refund_recovery';
            const refundLease = await acquirePaymentLease(id, 'refund-retry');
            if (!refundLease) continue;
            try {
              const intent = await paymentIntentService.getPaymentIntent(id, { fresh: true });
              if (!intent || !['refund_pending', 'refund_failed'].includes(intent.status)) continue;
              if (Number(intent.attempts || 0) >= MAX_RECOVERY_ATTEMPTS) {
                const recovery = await persistRecoveryFailure(id, intent, new Error('Refund retry limit reached'), { increment: false });
                if (recovery.escalated) results.escalated++;
                continue;
              }
              const payment = await fetchRazorpayPayment(intent.rzp_payment_id || row.rzp_payment_id);
              const total = Number(payment.amount);
              if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Gateway payment amount is invalid; refund requires review');
              if (payment.refund_status === 'full' || (total > 0 && Number(payment.amount_refunded || 0) >= total)) {
                const updated = await paymentIntentService.updatePaymentIntentStatus({ rzpOrderId: id, fromStatus: intent.status, toStatus: 'refunded' });
                if (!updated) throw new Error('Could not durably record confirmed refund settlement');
                await paymentIntentService.releaseCheckoutStock(intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id || id);
                results.refundsConfirmed++;
                continue;
              }
              // A known order must be reviewed before automatic refund recovery.
              const order = await paymentIntentService.findWcOrderByRazorpayOrderId(id);
              if (order) {
                const updated = await paymentIntentService.updatePaymentIntentStatus({ rzpOrderId: id, fromStatus: intent.status, toStatus: 'refund_escalated', errorReason: 'Order exists: refund requires review' });
                if (!updated) throw new Error('Could not record refund escalation');
                results.escalated++;
                await alertStaffAnomaly({ type: 'RECONCILER_REFUND_ESCALATION', severity: 'critical', rzpOrderId: id, message: 'Refund requires staff review.' });
                continue;
              }
              await refundLease.refresh();
              const refund = await refundRazorpayPayment({ paymentId: payment.id, amountInPaise: total - Number(payment.amount_refunded || 0), notes: { rzp_order_id: id, reason: 'Automatic full-refund recovery' } });
              const latest = await fetchRazorpayPayment(payment.id);
              const full = isRefundFullySettled(refund, total, latest);
              const updated = await paymentIntentService.updatePaymentIntentStatus({ rzpOrderId: id, fromStatus: intent.status, toStatus: full ? 'refunded' : 'refund_pending', refundId: refund.id });
              if (!updated) throw new Error('Could not durably record gateway refund result; do not submit a duplicate refund');
              if (full) {
                await paymentIntentService.releaseCheckoutStock(intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id || id);
                results.refundsExecuted++;
              }
            } finally { await refundLease.release(); }
          } else {
            const payments = await fetchRazorpayOrderPayments(id);
            const payment = (payments.items || []).find(p => p.status === 'captured');
            if (payment) {
              stage = 'finalization';
              const result = await finalizePaymentAndCreateOrder({ rzpOrderId: id, rzpPaymentId: payment.id, source: 'reconciler' });
              if (result.success) results.healedOrders++;
              else if (!result.terminal && result.status !== 409) throw new Error(result.message || 'Captured payment remains pending fulfillment');
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
      }
      if (!batch.hasMore) break;
      if (!batch.nextCursor || batch.nextCursor === cursor) throw new Error('Reconciliation cursor did not advance');
      cursor = batch.nextCursor;
    }
    return results;
  } finally { await lease.release(); }
};
export default { runPaymentReconciliation };
