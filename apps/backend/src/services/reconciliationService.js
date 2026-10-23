import { logger } from "../utils/logger.js";
import {
  getRazorpayInstance,
  refundRazorpayPayment,
  fetchRazorpayPayment,
  fetchRazorpayOrderPayments,
  isRefundFullySettled,
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
  reserveCheckoutStock,
  releaseCheckoutStock,
} from "./paymentIntentService.js";
import { alertStaffAnomaly } from "./alertService.js";
import { publishOrderEvent } from "./orderNotificationService.js";
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
  const _reserveStock = getFn("reserveCheckoutStock", reserveCheckoutStock);
  const _releaseStock = getFn("releaseCheckoutStock", releaseCheckoutStock);

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
        const checkoutDetails = extractCheckoutDetails(intentRow);
        const reservationId = checkoutDetails?.raw?.stock_reservation_id ||
          checkoutDetails?.raw?.checkout_payload?.stock_reservation_id || rzpOrderId;

        if (ageMinutes < MAX_FINALIZATION_RETRY_MINUTES) {
          // Retry WooCommerce order creation
          logger.info(
            { rzpOrderId, rzpPaymentId, ageMinutes: ageMinutes.toFixed(1) },
            "[Reconciler] Retrying order finalization for captured payment"
          );

          try {
            if (!checkoutDetails || !Array.isArray(checkoutDetails.lineItems) || checkoutDetails.lineItems.length === 0) {
              throw new Error("Invalid or empty checkout_payload in intent — line_items required");
            }
            await _reserveStock({ reservationId, lineItems: checkoutDetails.lineItems });

            // Create WooCommerce order
            const orderPayload = {
              payment_method: "razorpay",
              payment_method_title: "Razorpay (Online Payment - Reconciled)",
              set_paid: true,
              transaction_id: rzpPaymentId,
              customer_id: checkoutDetails.customerId,
              billing: checkoutDetails.billing,
              shipping: checkoutDetails.shipping,
              line_items: checkoutDetails.lineItems,
              ...(checkoutDetails.couponLines.length > 0 ? { coupon_lines: checkoutDetails.couponLines } : {}),
              ...(checkoutDetails.shippingLines.length > 0 ? { shipping_lines: checkoutDetails.shippingLines } : {}),
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
              await _clearCart(checkoutDetails.customerId);
              await _releaseStock(reservationId);
              results.healedOrders++;
              continue;
            }

            const wcRes = await api.post("orders", orderPayload);
            const wcOrderId = wcRes.data?.id;

            if (wcOrderId) {
              publishOrderEvent({ event: "ORDER_CREATED", orderId: wcOrderId });

              await _updateStatus({
                rzpOrderId,
                fromStatus: "paid",
                toStatus: "order_created",
                wcOrderId,
              });

              await _clearCart(checkoutDetails.customerId);
              await _releaseStock(reservationId);

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

            // Invariant: Transition to 'refunded' ONLY after full refund confirmation
            if (refund.id) {
              let refreshedPayment = null;
              if (refund.status !== "processed" || Number(refund.amount || 0) < capturedPaise) {
                try {
                  refreshedPayment = await fetchRazorpayPayment(rzpPaymentId);
                } catch (_) {}
              }
              const isFull = isRefundFullySettled(refund, capturedPaise, refreshedPayment);

              if (isFull) {
                await _updateStatus({
                  rzpOrderId,
                  fromStatus: "refund_pending",
                  toStatus: "refunded",
                  refundId: refund.id,
                });
                if (reservationId) {
                  await _releaseStock(reservationId);
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
              } else {
                logger.warn(
                  { rzpOrderId, rzpPaymentId, refundId: refund.id },
                  "[Reconciler] Timeout refund pending or partial on gateway — keeping in refund_pending for verification"
                );
              }
            }
          } catch (refundErr) {
            logger.error(
              { rzpOrderId, rzpPaymentId, err: refundErr.message },
              "[Reconciler] Refund API call failed"
            );
            await _updateStatus({
              rzpOrderId,
              toStatus: "refund_failed",
              incrementAttempts: true,
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
        const checkoutDetails = extractCheckoutDetails(intentRow);
        const reservationId = checkoutDetails?.raw?.stock_reservation_id ||
          checkoutDetails?.raw?.checkout_payload?.stock_reservation_id || rzpOrderId;

        try {
          const paymentData = await fetchRazorpayPayment(rzpPaymentId);
          const amountRefunded = Number(paymentData.amount_refunded || 0);
          const totalAmount = Number(paymentData.amount || intentRow.amount_paise || 0);
          const isFullyRefunded = paymentData.refund_status === "full" || (totalAmount > 0 && amountRefunded >= totalAmount);

          if (isFullyRefunded) {
            // Confirmed fully refunded on Razorpay!
            await _updateStatus({
              rzpOrderId,
              toStatus: "refunded",
              refundId: paymentData.refund_status === "full" ? "confirmed_full" : `rfnd_verified_${amountRefunded}`,
            });
            if (reservationId) {
              await _releaseStock(reservationId);
            }
            results.refundsConfirmed++;
          } else {
            // Check retry attempts to prevent infinite silent looping
            const currentAttempts = Number(intentRow.attempts || 0);
            const MAX_REFUND_ATTEMPTS = 3;

            if (currentAttempts >= MAX_REFUND_ATTEMPTS) {
              logger.error(
                { rzpOrderId, rzpPaymentId, attempts: currentAttempts, amountRefunded, totalAmount },
                "[Reconciler] Refund retry limit reached — escalating to staff anomaly"
              );
              await alertStaffAnomaly({
                type: "RECONCILER_REFUND_ESCALATION",
                severity: "critical",
                rzpOrderId,
                rzpPaymentId,
                message: `Refund retry limit reached (${currentAttempts} attempts). Manual intervention required for payment ${rzpPaymentId}`,
                details: {
                  amount_refunded: amountRefunded,
                  total_amount: totalAmount,
                  refund_status: paymentData.refund_status,
                  attempts: currentAttempts,
                },
              });
              await _updateStatus({
                rzpOrderId,
                toStatus: "refund_escalated",
                errorReason: `Exceeded maximum refund attempts (${MAX_REFUND_ATTEMPTS}). Escalated to staff.`,
              });
              results.errors.push({
                rzpOrderId,
                error: `Refund retry limit reached (${currentAttempts} attempts). Escalated to staff.`,
              });
              continue;
            }

            // Retry refund for remaining unrefunded amount
            const remainingPaise = totalAmount > amountRefunded ? (totalAmount - amountRefunded) : totalAmount;
            const refund = await refundRazorpayPayment({
              paymentId: rzpPaymentId,
              amountInPaise: remainingPaise,
              notes: {
                reason: "Retry refund: previous refund attempt pending/failed",
                rzp_order_id: rzpOrderId,
              },
            });

            if (refund.id) {
              const updatedPayment = await fetchRazorpayPayment(rzpPaymentId);
              const updatedRefunded = Number(updatedPayment.amount_refunded || 0);
              const nowFullyRefunded = updatedPayment.refund_status === "full" || (totalAmount > 0 && updatedRefunded >= totalAmount);

              if (nowFullyRefunded) {
                await _updateStatus({
                  rzpOrderId,
                  fromStatus: status,
                  toStatus: "refunded",
                  refundId: refund.id,
                });
                if (reservationId) {
                  await _releaseStock(reservationId);
                }
                results.refundsExecuted++;
              } else {
                logger.warn(
                  { rzpOrderId, rzpPaymentId, updatedRefunded, totalAmount },
                  "[Reconciler] Payment partially refunded on retry; remaining amount pending"
                );
                await _updateStatus({
                  rzpOrderId,
                  toStatus: "refund_pending",
                  incrementAttempts: true,
                  errorReason: `PARTIAL_REFUND: ${updatedRefunded}/${totalAmount} paise refunded`,
                });
              }
            }
          }
        } catch (err) {
          logger.warn(
            { rzpOrderId, err: err.message },
            "[Reconciler] Failed to verify/retry refund_pending payment"
          );
          await _updateStatus({
            rzpOrderId,
            toStatus: "refund_failed",
            incrementAttempts: true,
            errorReason: `Refund retry failed: ${err.message}`,
          });
          results.errors.push({ rzpOrderId, error: err.message });
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

              // Verify captured payment amount and currency match the persisted payment intent
              const expectedAmount = Number(intentRow.amount_paise);
              const capturedAmount = Number(captured.amount || 0);
              const capturedCurrency = String(captured.currency || "INR").toUpperCase();

              if (capturedAmount !== expectedAmount || capturedCurrency !== "INR") {
                logger.error(
                  {
                    rzpOrderId,
                    rzpPaymentId,
                    expectedAmount,
                    capturedAmount,
                    capturedCurrency,
                  },
                  "[Reconciler] Amount or currency mismatch on captured payment for created intent — initiating auto-refund recovery"
                );

                await alertStaffAnomaly({
                  type: "RECONCILER_AMOUNT_MISMATCH",
                  severity: "critical",
                  rzpOrderId,
                  rzpPaymentId,
                  message: `Reconciler detected amount/currency mismatch: expected ₹${(expectedAmount / 100).toFixed(2)} INR, got ${capturedCurrency} ₹${(capturedAmount / 100).toFixed(2)}`,
                  details: {
                    expected_amount_paise: expectedAmount,
                    captured_amount_paise: capturedAmount,
                    captured_currency: capturedCurrency,
                  },
                });

                // Release held stock reservations
                const checkoutDetails = extractCheckoutDetails(intentRow);
                const reservationId = checkoutDetails?.raw?.stock_reservation_id ||
                  checkoutDetails?.raw?.checkout_payload?.stock_reservation_id || rzpOrderId;
                if (reservationId) {
                  await _releaseStock(reservationId);
                }

                // Transition to refund_pending so it remains tracked in the reconciliation loop
                await _updateStatus({
                  rzpOrderId,
                  fromStatus: "created",
                  toStatus: "refund_pending",
                  rzpPaymentId,
                  capturedAmountPaise: capturedAmount,
                  errorReason: `AMOUNT_MISMATCH: expected ${expectedAmount} paise INR, got ${capturedAmount} ${capturedCurrency}`,
                });

                try {
                  const refund = await refundRazorpayPayment({
                    paymentId: rzpPaymentId,
                    amountInPaise: capturedAmount,
                    notes: {
                      reason: "Auto-refund: Amount/currency mismatch on captured payment",
                      rzp_order_id: rzpOrderId,
                    },
                  });

                  if (refund.id) {
                    let refreshedPayment = null;
                    if (refund.status !== "processed" || Number(refund.amount || 0) < capturedAmount) {
                      try {
                        refreshedPayment = await fetchRazorpayPayment(rzpPaymentId);
                      } catch (_) {}
                    }
                    const isFull = isRefundFullySettled(refund, capturedAmount, refreshedPayment);

                    if (isFull) {
                      await _updateStatus({
                        rzpOrderId,
                        fromStatus: "refund_pending",
                        toStatus: "refunded",
                        refundId: refund.id,
                      });
                      results.refundsExecuted++;
                      logger.info(
                        { rzpOrderId, rzpPaymentId, refundId: refund.id },
                        "[Reconciler] Auto-refunded mismatched captured payment successfully"
                      );
                    } else {
                      logger.warn(
                        { rzpOrderId, rzpPaymentId, refundId: refund.id },
                        "[Reconciler] Mismatched payment refund pending/partial — kept in refund_pending for verification"
                      );
                    }
                  }
                } catch (refundErr) {
                  logger.error(
                    { rzpOrderId, rzpPaymentId, err: refundErr.message },
                    "[Reconciler] Immediate refund failed for mismatched payment — kept in refund_pending for retry"
                  );
                  await _updateStatus({
                    rzpOrderId,
                    toStatus: "refund_failed",
                    incrementAttempts: true,
                    errorReason: `AMOUNT_MISMATCH_REFUND_FAILED: ${refundErr.message}`,
                  });
                }

                results.errors.push({
                  rzpOrderId,
                  error: `Payment amount or currency mismatch: expected ${expectedAmount} paise INR, got ${capturedAmount} ${capturedCurrency}`,
                });
                continue;
              }

              await _updateStatus({
                rzpOrderId,
                fromStatus: "created",
                toStatus: "paid",
                rzpPaymentId,
                capturedAmountPaise: capturedAmount,
              });

              // Check stock for line items
              const checkoutDetails = extractCheckoutDetails(intentRow);
              if (!checkoutDetails || !Array.isArray(checkoutDetails.lineItems) || checkoutDetails.lineItems.length === 0) {
                logger.error({ rzpOrderId }, "[Reconciler] Persisted checkout payload has 0 line items — cannot heal order");
                continue;
              }

              let stockValid = true;
              const reservationId = checkoutDetails.raw.stock_reservation_id ||
                checkoutDetails.raw.checkout_payload?.stock_reservation_id || rzpOrderId;
              try {
                await _reserveStock({ reservationId, lineItems: checkoutDetails.lineItems });
              } catch (reservationErr) {
                if (reservationErr.response?.status === 409) {
                  stockValid = false;
                } else {
                  throw reservationErr;
                }
              }
              // A successful atomic reservation is authoritative. Do not compare
              // REST stock_quantity here: the plugin subtracts active holds,
              // including this intent's own reservation.

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
                  let refreshedPayment = null;
                  if (refund.status !== "processed" || Number(refund.amount || 0) < capturedPaise) {
                    try {
                      refreshedPayment = await fetchRazorpayPayment(rzpPaymentId);
                    } catch (_) {}
                  }
                  const isFull = isRefundFullySettled(refund, capturedPaise, refreshedPayment);

                  if (isFull) {
                    await _updateStatus({
                      rzpOrderId,
                      fromStatus: "refund_pending",
                      toStatus: "refunded",
                      refundId: refund.id,
                    });

                    await _releaseStock(reservationId);

                    await alertStaffAnomaly({
                      type: "RECONCILER_OUT_OF_STOCK_REFUND",
                      severity: "warning",
                      rzpOrderId,
                      rzpPaymentId,
                      message: `Auto-refunded ₹${(capturedPaise / 100).toFixed(2)} due to out-of-stock on reconciler discovery`,
                      details: { refund_id: refund.id },
                    });

                    results.refundsExecuted++;
                  } else {
                    logger.warn(
                      { rzpOrderId, rzpPaymentId, refundId: refund.id },
                      "[Reconciler] Out-of-stock refund pending/partial on gateway — keeping in refund_pending for verification"
                    );
                  }
                }
              } else {
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
                  await _clearCart(checkoutDetails.customerId);
                  await _releaseStock(reservationId);
                  results.healedOrders++;
                } else {
                  const orderPayload = {
                    payment_method: "razorpay",
                    payment_method_title: "Razorpay (Online Payment - Reconciled)",
                    set_paid: true,
                    transaction_id: rzpPaymentId,
                    customer_id: checkoutDetails.customerId,
                    billing: checkoutDetails.billing,
                    shipping: checkoutDetails.shipping,
                    line_items: checkoutDetails.lineItems,
                    ...(checkoutDetails.couponLines.length > 0 ? { coupon_lines: checkoutDetails.couponLines } : {}),
                    ...(checkoutDetails.shippingLines.length > 0 ? { shipping_lines: checkoutDetails.shippingLines } : {}),
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
                    publishOrderEvent({ event: "ORDER_CREATED", orderId: wcOrderId });

                    await _updateStatus({
                      rzpOrderId,
                      fromStatus: "paid",
                      toStatus: "order_created",
                      wcOrderId,
                    });

                    await _clearCart(checkoutDetails.customerId);
                    await _releaseStock(reservationId);

                    logger.info(
                      { rzpOrderId, wcOrderId, rzpPaymentId },
                      "[Reconciler] Successfully finalized order via background reconciler"
                    );
                    results.healedOrders++;
                  }
                }
              }
            } else if (createdAgeMinutes >= 15) {
              // No captured payment discovered for an intent stuck in 'created' > 15 minutes.
              // Release the held stock and mark as abandoned to prevent inventory starvation.
              const checkoutDetails = extractCheckoutDetails(intentRow);
              const reservationId = checkoutDetails?.raw?.stock_reservation_id ||
                checkoutDetails?.raw?.checkout_payload?.stock_reservation_id || rzpOrderId;

              if (reservationId) {
                await _releaseStock(reservationId);
              }

              await _updateStatus({
                rzpOrderId,
                fromStatus: "created",
                toStatus: "abandoned",
                errorReason: "Abandoned checkout session: no payment captured after 15m",
              });

              logger.info(
                { rzpOrderId, createdAgeMinutes: createdAgeMinutes.toFixed(1) },
                "[Reconciler] Abandoned created intent cleaned up and stock released"
              );
              results.healedOrders++;
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
