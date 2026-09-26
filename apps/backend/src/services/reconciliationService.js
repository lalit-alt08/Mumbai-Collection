import { logger } from "../utils/logger.js";
import {
  getRazorpayInstance,
  refundRazorpayPayment,
  fetchRazorpayPayment,
  fetchRazorpayOrderPayments,
} from "./razorpayService.js";
import paymentIntentService, {
  fetchReconciliationList,
  updatePaymentIntentStatus,
  getPaymentIntent,
  acquireLock,
  releaseLock,
  clearCustomerWcCart,
  getReconciliationWatermark,
  setReconciliationWatermark,
  findWcOrderByRazorpayOrderId,
} from "./paymentIntentService.js";
import { sendRefundEmail } from "./brevoService.js";
import { alertStaffAnomaly } from "./alertService.js";
import api from "../config/woocommerce.js";

const RECONCILIATION_LOCK_ID = "cron_reconciler_worker";
const MAX_FINALIZATION_RETRY_MINUTES = 15;

const parseUtcDate = (dateStr) => {
  if (!dateStr) return 0;
  if (typeof dateStr === "number") return dateStr;
  const s = String(dateStr).trim();
  const isoStr = s.includes("T") ? (s.endsWith("Z") ? s : `${s}Z`) : `${s.replace(" ", "T")}Z`;
  const parsed = new Date(isoStr).getTime();
  return isNaN(parsed) ? new Date(dateStr).getTime() : parsed;
};

/**
 * Runs a single reconciliation cycle with concurrency guard, persistent watermark, and pagination.
 */
export const runPaymentReconciliation = async ({ olderThanMinutes = 1 } = {}) => {
  const getFn = (name, fallback) =>
    paymentIntentService && typeof paymentIntentService[name] === "function"
      ? paymentIntentService[name]
      : fallback;

  const _acquireLock = getFn("acquireLock", acquireLock);
  const _releaseLock = getFn("releaseLock", releaseLock);
  const _fetchList = getFn("fetchReconciliationList", fetchReconciliationList);
  const _updateStatus = getFn("updatePaymentIntentStatus", updatePaymentIntentStatus);
  const _getWatermark = getFn("getReconciliationWatermark", getReconciliationWatermark);
  const _setWatermark = getFn("setReconciliationWatermark", setReconciliationWatermark);
  const _clearCart = getFn("clearCustomerWcCart", clearCustomerWcCart);
  const _findOrderByRzp = getFn("findWcOrderByRazorpayOrderId", findWcOrderByRazorpayOrderId);

  // 1. Concurrency guard: Acquire DB lock
  const lockAcquired = await _acquireLock(RECONCILIATION_LOCK_ID, "reconciler", 2000);
  if (!lockAcquired) {
    logger.debug("[Reconciler] Skipped: another reconciliation run is currently active");
    return { skipped: true, reason: "locked" };
  }

  logger.info("[Reconciler] Starting reconciliation run...");

  const results = {
    processed: 0,
    healedOrders: 0,
    refundsExecuted: 0,
    refundsConfirmed: 0,
    errors: [],
  };

  try {
    // 2. Load persistent watermark from WordPress options
    const persistentWatermark = await _getWatermark();
    let latestSeenWatermark = persistentWatermark;
    let page = 1;
    let hasMore = true;

    // 3. Paginated retrieval with overlapping window
    while (hasMore) {
      const pageResult = await _fetchList({
        limit: 50,
        page,
        olderThanMinutes,
        watermark: persistentWatermark,
      });

      const intents = pageResult.intents || [];
      results.processed += intents.length;

      for (const intentRow of intents) {
        if (intentRow.updated_at && (!latestSeenWatermark || intentRow.updated_at > latestSeenWatermark)) {
          latestSeenWatermark = intentRow.updated_at;
        }

        const rzpOrderId = intentRow.rzp_order_id;
        const status = intentRow.status;
        const rzpPaymentId = intentRow.rzp_payment_id;
        const updatedAt = parseUtcDate(intentRow.updated_at);
        const ageMinutes = (Date.now() - updatedAt) / (60 * 1000);

      // ─────────────────────────────────────────────────────────────
      // Case A: status = 'paid' (Payment was captured, but WC order not created yet)
      // ─────────────────────────────────────────────────────────────
      if (status === "paid") {
        if (ageMinutes < MAX_FINALIZATION_RETRY_MINUTES) {
          // Retry WooCommerce order creation
          logger.info(
            { rzpOrderId, rzpPaymentId, ageMinutes: ageMinutes.toFixed(1) },
            "[Reconciler] Retrying order finalization for captured payment"
          );

          try {
            const parsedPayload = intentRow.checkout_payload ? JSON.parse(intentRow.checkout_payload) : null;
            if (!parsedPayload) {
              throw new Error("Missing checkout_payload in intent");
            }

            // Create WooCommerce order
            const orderPayload = {
              payment_method: "razorpay",
              payment_method_title: "Razorpay (Online Payment - Reconciled)",
              set_paid: true,
              transaction_id: rzpPaymentId,
              customer_id: Number(parsedPayload.user_id) || 0,
              billing: parsedPayload.billing || {},
              shipping: parsedPayload.shipping || {},
              line_items: parsedPayload.line_items || [],
              meta_data: [
                { key: "_razorpay_order_id", value: rzpOrderId },
                { key: "_razorpay_payment_id", value: rzpPaymentId },
                { key: "_payment_verified_by", value: "reconciler" },
                { key: "_reconciled_at", value: new Date().toISOString() },
              ],
            };

            // Authoritative HPOS pre-check before order creation
            const existingOrder = await _findOrderByRzp(rzpOrderId);
            if (existingOrder) {
              logger.info(
                { rzpOrderId, wcOrderId: existingOrder.id },
                "[Reconciler] Existing order found via HPOS lookup before creation retry"
              );
              await _updateStatus({
                rzpOrderId,
                fromStatus: "paid",
                toStatus: "order_created",
                wcOrderId: existingOrder.id,
              });
              await _clearCart(parsedPayload.user_id);
              results.healedOrders++;
              continue;
            }

            const wcRes = await api.post("orders", orderPayload);
            const wcOrderId = wcRes.data?.id;

            if (wcOrderId) {
              await _updateStatus({
                rzpOrderId,
                fromStatus: "paid",
                toStatus: "order_created",
                wcOrderId,
              });

              await _clearCart(parsedPayload.user_id);

              logger.info(
                { rzpOrderId, wcOrderId, rzpPaymentId },
                "[Reconciler] Successfully finalized order via background reconciler"
              );
              results.healedOrders++;
            }
          } catch (err) {
            logger.warn(
              { rzpOrderId, err: err.message },
              "[Reconciler] Finalization retry failed - keeping in paid status for next retry"
            );
            await _updateStatus({
              rzpOrderId,
              toStatus: "paid",
              incrementAttempts: true,
              errorReason: err.message,
            });
          }
        } else {
          // Age >= 15 minutes: Auto-refund (retries exhausted)
          logger.error(
            { rzpOrderId, rzpPaymentId, ageMinutes: ageMinutes.toFixed(1) },
            "[Reconciler] Order finalization timed out (>15m) — initiating automated refund"
          );

          try {
            // Compare-and-set: Transition to refund_pending FIRST
            const markedPending = await _updateStatus({
              rzpOrderId,
              fromStatus: "paid",
              toStatus: "refund_pending",
              errorReason: "Reconciliation finalization timeout (>15 min)",
            });

            if (!markedPending) {
              logger.warn({ rzpOrderId }, "[Reconciler] Could not mark refund_pending — concurrent transition active");
              continue;
            }

            const paymentData = await fetchRazorpayPayment(rzpPaymentId);
            const capturedPaise = Number(paymentData.amount || intentRow.amount_paise);

            const refund = await refundRazorpayPayment({
              paymentId: rzpPaymentId,
              amountInPaise: capturedPaise,
              notes: {
                reason: "Auto-refund: Order finalization timed out in reconciliation",
                rzp_order_id: rzpOrderId,
              },
            });

            // Invariant: Transition to 'refunded' ONLY after Razorpay confirmation
            if (refund.id) {
              await _updateStatus({
                rzpOrderId,
                fromStatus: "refund_pending",
                toStatus: "refunded",
                refundId: refund.id,
              });

              // Notify customer by email
              const parsedPayload = intentRow.checkout_payload ? JSON.parse(intentRow.checkout_payload) : {};
              const customerEmail = parsedPayload.billing?.email;
              const customerName = `${parsedPayload.billing?.first_name || ""} ${parsedPayload.billing?.last_name || ""}`.trim();

              if (customerEmail) {
                await sendRefundEmail({
                  toEmail: customerEmail,
                  toName: customerName,
                  amountInInr: (capturedPaise / 100).toFixed(2),
                  rzpOrderId,
                  refundId: refund.id,
                  reason: "Store processing timeout — payment refunded automatically",
                });
              }

              await alertStaffAnomaly({
                type: "RECONCILER_AUTO_REFUND",
                severity: "warning",
                rzpOrderId,
                rzpPaymentId,
                message: `Payment of ₹${(capturedPaise / 100).toFixed(2)} refunded after 15m timeout`,
                details: { refund_id: refund.id },
              });

              results.refundsExecuted++;
            }
          } catch (refundErr) {
            logger.error(
              { rzpOrderId, rzpPaymentId, err: refundErr.message },
              "[Reconciler] Refund API call failed"
            );
            await _updateStatus({
              rzpOrderId,
              toStatus: "refund_failed",
              errorReason: `Refund API failed: ${refundErr.message}`,
            });
            results.errors.push({ rzpOrderId, error: refundErr.message });
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Case B: status = 'refund_pending' or 'refund_failed'
      // ─────────────────────────────────────────────────────────────
      if (status === "refund_pending" || status === "refund_failed") {
        try {
          const paymentData = await fetchRazorpayPayment(rzpPaymentId);
          if (Number(paymentData.amount_refunded || 0) > 0) {
            // Confirmed refunded on Razorpay!
            await _updateStatus({
              rzpOrderId,
              toStatus: "refunded",
              refundId: paymentData.refund_status === "full" ? "confirmed_full" : "partial_refund",
            });
            results.refundsConfirmed++;
          } else {
            // Retry refund
            const capturedPaise = Number(paymentData.amount || intentRow.amount_paise);
            const refund = await refundRazorpayPayment({
              paymentId: rzpPaymentId,
              amountInPaise: capturedPaise,
              notes: {
                reason: "Retry refund: previous refund attempt failed",
                rzp_order_id: rzpOrderId,
              },
            });

            if (refund.id) {
              await _updateStatus({
                rzpOrderId,
                fromStatus: status,
                toStatus: "refunded",
                refundId: refund.id,
              });
              results.refundsExecuted++;
            }
          }
        } catch (err) {
          logger.warn(
            { rzpOrderId, err: err.message },
            "[Reconciler] Failed to verify/retry refund_pending payment"
          );
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Case C: status = 'created' (Stuck in created > 10m; poll Razorpay)
      // ─────────────────────────────────────────────────────────────
      if (status === "created") {
        const createdAt = parseUtcDate(intentRow.created_at || intentRow.updated_at);
        const createdAgeMinutes = (Date.now() - createdAt) / (60 * 1000);

        if (createdAgeMinutes >= 10 || olderThanMinutes === 0) {
          logger.info(
            { rzpOrderId, createdAgeMinutes: createdAgeMinutes.toFixed(1) },
            "[Reconciler] Polling Razorpay for intent stuck in created status > 10m"
          );

          try {
            const paymentsRes = await fetchRazorpayOrderPayments(rzpOrderId);
            const items = paymentsRes?.items || (Array.isArray(paymentsRes) ? paymentsRes : []);
            const captured = items.find((p) => p.status === "captured");

            if (captured) {
              const rzpPaymentId = captured.id;
              logger.info(
                { rzpOrderId, rzpPaymentId },
                "[Reconciler] Discovered captured payment for stuck created intent — reconciling"
              );

              await _updateStatus({
                rzpOrderId,
                fromStatus: "created",
                toStatus: "paid",
                rzpPaymentId,
                capturedAmountPaise: Number(captured.amount || intentRow.amount_paise),
              });

              // Check stock for line items
              const parsedPayload = intentRow.checkout_payload ? JSON.parse(intentRow.checkout_payload) : null;
              let stockValid = true;

              if (parsedPayload?.line_items && Array.isArray(parsedPayload.line_items)) {
                for (const item of parsedPayload.line_items) {
                  try {
                    const prodRes = await api.get(`products/${item.product_id}`);
                    const prod = prodRes.data;
                    if (prod && prod.manage_stock && typeof prod.stock_quantity === "number") {
                      if (prod.stock_quantity < item.quantity && !prod.backorders_allowed) {
                        stockValid = false;
                        logger.error(
                          { product_id: item.product_id, available: prod.stock_quantity, requested: item.quantity },
                          "[Reconciler] Stock depleted during reconciler discovery"
                        );
                      }
                    }
                  } catch (_) {}
                }
              }

              if (!stockValid) {
                logger.warn(
                  { rzpOrderId, rzpPaymentId },
                  "[Reconciler] Item out of stock for captured payment — auto-refunding"
                );

                await _updateStatus({
                  rzpOrderId,
                  fromStatus: "paid",
                  toStatus: "refund_pending",
                  errorReason: "ITEM_OUT_OF_STOCK",
                });

                const capturedPaise = Number(captured.amount || intentRow.amount_paise);
                const refund = await refundRazorpayPayment({
                  paymentId: rzpPaymentId,
                  amountInPaise: capturedPaise,
                  notes: {
                    reason: "Auto-refund: Item out of stock discovered in reconciliation",
                    rzp_order_id: rzpOrderId,
                  },
                });

                if (refund?.id) {
                  await _updateStatus({
                    rzpOrderId,
                    fromStatus: "refund_pending",
                    toStatus: "refunded",
                    refundId: refund.id,
                  });

                  if (parsedPayload?.billing?.email) {
                    await sendRefundEmail({
                      toEmail: parsedPayload.billing.email,
                      toName: `${parsedPayload.billing.first_name || ""} ${parsedPayload.billing.last_name || ""}`.trim(),
                      amountInInr: (capturedPaise / 100).toFixed(2),
                      rzpOrderId,
                      refundId: refund.id,
                      reason: "Item went out of stock before order finalization",
                    });
                  }

                  await alertStaffAnomaly({
                    type: "RECONCILER_OUT_OF_STOCK_REFUND",
                    severity: "warning",
                    rzpOrderId,
                    rzpPaymentId,
                    message: `Auto-refunded ₹${(capturedPaise / 100).toFixed(2)} due to out-of-stock on reconciler discovery`,
                    details: { refund_id: refund.id },
                  });

                  results.refundsExecuted++;
                }
              } else if (parsedPayload) {
                // Stock available: HPOS-safe check before order creation
                const existingOrder = await _findOrderByRzp(rzpOrderId);
                if (existingOrder) {
                  logger.info({ rzpOrderId, wcOrderId: existingOrder.id }, "[Reconciler] Order already exists — updating intent");
                  await _updateStatus({
                    rzpOrderId,
                    fromStatus: "paid",
                    toStatus: "order_created",
                    wcOrderId: existingOrder.id,
                  });
                  await _clearCart(parsedPayload.user_id);
                  results.healedOrders++;
                } else {
                  const orderPayload = {
                    payment_method: "razorpay",
                    payment_method_title: "Razorpay (Online Payment - Reconciled)",
                    set_paid: true,
                    transaction_id: rzpPaymentId,
                    customer_id: Number(parsedPayload.user_id) || 0,
                    billing: parsedPayload.billing || {},
                    shipping: parsedPayload.shipping || {},
                    line_items: parsedPayload.line_items || [],
                    meta_data: [
                      { key: "_razorpay_order_id", value: rzpOrderId },
                      { key: "_razorpay_payment_id", value: rzpPaymentId },
                      { key: "_payment_verified_by", value: "reconciler" },
                      { key: "_reconciled_at", value: new Date().toISOString() },
                    ],
                  };

                  const wcRes = await api.post("orders", orderPayload);
                  const wcOrderId = wcRes.data?.id;

                  if (wcOrderId) {
                    await _updateStatus({
                      rzpOrderId,
                      fromStatus: "paid",
                      toStatus: "order_created",
                      wcOrderId,
                    });

                    await _clearCart(parsedPayload.user_id);

                    logger.info(
                      { rzpOrderId, wcOrderId, rzpPaymentId },
                      "[Reconciler] Successfully finalized order via background reconciler"
                    );
                    results.healedOrders++;
                  }
                }
              }
            }
          } catch (err) {
            logger.warn(
              { rzpOrderId, err: err.message },
              "[Reconciler] Failed to query Razorpay order payments for stuck created intent"
            );
          }
        }
      }
    } // end for intentRow

    if (pageResult.hasMore && intents.length > 0) {
      page++;
    } else {
      hasMore = false;
    }
  } // end while (hasMore)

  // 4. Update persistent watermark if newer records were observed
  if (latestSeenWatermark && latestSeenWatermark !== persistentWatermark) {
    await _setWatermark(latestSeenWatermark);
  }

  logger.info({ results }, "[Reconciler] Run completed");
  return results;
} finally {
  // 5. Always release distributed lock
  await _releaseLock(RECONCILIATION_LOCK_ID);
}
};

export default { runPaymentReconciliation };
