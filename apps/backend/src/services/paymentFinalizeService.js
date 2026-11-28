import crypto from "crypto";
import { acquirePaymentLease } from "./paymentLease.js";
import api from "../config/woocommerce.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import storeHoursService from "./storeHoursService.js";
import paymentIntentService, {
  updatePaymentIntentStatus,
  reserveCheckoutStock,
  releaseCheckoutStock,
} from "./paymentIntentService.js";
import {
  verifyPaymentSignature,
  fetchRazorpayPayment,
  refundRazorpayPayment,
  isRefundFullySettled,
} from "./razorpayService.js";
import { alertStaffAnomaly } from "./alertService.js";
import { ensureOrderCreatedNotification } from "./orderNotificationService.js";
import { invalidateOrderDetailCache } from "./orderDetailCache.js";
import {
  findOrderByRazorpayOrderId,
  paymentOwnershipFailure,
  verifiedPaymentMetadata,
  formatPaiseAsRupees,
  deleteActiveCartIntentId,
} from "../utils/paymentCheckoutUtils.js";

const ORDER_STATUS_TERMINAL = new Set(["refunded", "cancelled", "failed", "trash"]);

const hasOrderMetaFlag = (order, key, expectedValue = "yes") => {
  const meta = Array.isArray(order?.meta_data) ? order.meta_data : [];
  return meta.some((m) => m?.key === key && m?.value === expectedValue);
};

const invalidateOrderCachesAndNotify = async ({ order, customerId, rzpOrderId, rzpPaymentId, source }) => {
  if (customerId) {
    serverCache.invalidatePrefix(`customer:orders:${customerId}:`);
  }
  await notifyFulfillmentOrderCreated(order);

  serverCache.invalidatePrefix("employee:overview");
  serverCache.invalidatePrefix("admin:analytics");
  serverCache.invalidatePrefix("admin:customers");
  serverCache.delete("product_stock_counts");
  serverCache.invalidatePrefix("admin_products:");
  serverCache.invalidatePrefix("catalog:products:");
  serverCache.invalidatePrefix("catalog:category:");

  if (Array.isArray(order?.line_items)) {
    for (const item of order.line_items) {
      if (item.product_id) {
        serverCache.delete(`catalog:product:${item.product_id}`);
        serverCache.delete(`stock:enrichment:product:${item.product_id}`);
      }
      if (item.variation_id && item.variation_id !== item.product_id) {
        serverCache.delete(`stock:enrichment:product:${item.variation_id}`);
      }
    }
  }

  logger.info(
    { wc_order_id: order.id, razorpay_order_id: rzpOrderId, razorpay_payment_id: rzpPaymentId, source },
    "[Payment Finalize] SUCCESS: Exactly 1 WooCommerce order created in processing status"
  );
};

const holdOrderForMismatch = async ({ order, rzpOrderId, rzpPaymentId, capturedPaise, wcTotalPaise, wcCurrency }) => {
  const mismatchNote =
    `[AUDIT ALERT] Total/Currency Mismatch: Captured Razorpay payment is ₹${formatPaiseAsRupees(capturedPaise)} INR, ` +
    `but WooCommerce order total was ${wcCurrency} ₹${formatPaiseAsRupees(wcTotalPaise)}. Hold for administrative review.`;

  const syncFn = paymentIntentService.syncOrderRefundWithLock;
  const syncRes = typeof syncFn === "function"
    ? await syncFn({ wcOrderId: order.id, mode: "amount_mismatch_hold", note: mismatchNote })
    : { fallback: true };

  if (syncRes?.fallback) {
    if (String(order.status || "").toLowerCase() !== "on-hold") {
      await api.put(`orders/${order.id}`, {
        status: "on-hold",
        customer_note: "Order placed on hold for verification: payment amount discrepancy detected.",
      });
    }
    await invalidateOrderDetailCache(order.id);
    await api.post(`orders/${order.id}/notes`, {
      note: mismatchNote,
      customer_note: false,
    }).catch(() => {});
  } else {
    await invalidateOrderDetailCache(order.id);
  }
  order.status = "on-hold";
};

const promoteVerifiedOrderToProcessing = async ({ order, rzpOrderId, rzpPaymentId, capturedPaise, paymentMethodDetail, source }) => {
  if (String(order.status || "").toLowerCase() === "processing") {
    return order;
  }

  const promoteFn = paymentIntentService.promoteOrderToProcessing;
  const res = typeof promoteFn === "function"
    ? await promoteFn({
        wcOrderId: order.id,
        rzpOrderId,
        rzpPaymentId,
        capturedAmountPaise: capturedPaise,
        paymentMethodDetail,
        verifiedBy: source || "finalizer",
      })
    : { fallback: true };

  if (!res?.reconciled || res.orderStatus !== "processing" || res.action !== "updated_to_processing") {
    throw new Error("Order promotion was not confirmed");
  }

  await invalidateOrderDetailCache(order.id);
  order.status = "processing";
  return order;
};

const notifyFulfillmentOrderCreated = async (order, { fallbackTotal = null, suppressPush = null } = {}) => {
  if (!order?.id) return;
  const orderStatus = String(order.status || "processing").toLowerCase();
  if (orderStatus !== "processing") return;

  const meta = Array.isArray(order.meta_data) ? order.meta_data : [];
  const hasMetaFlag = (key) => meta.some((m) => m?.key === key && m?.value === "yes");
  const shouldSuppressPush =
    suppressPush ??
    (hasMetaFlag("_order_placed_after_hours") || hasMetaFlag("_payment_captured_without_delivery_slot"));

  await ensureOrderCreatedNotification({
    orderId: order.id,
    total: order.total ?? fallbackTotal ?? null,
    status: orderStatus,
    suppressPush: shouldSuppressPush,
  });
};

/**
 * Unified Payment Finalization Logic (Browser & Webhook & Recovery)
 *
 * Atomically verifies payment capture, acquires a distributed lock, checks idempotency,
 * revalidates inventory, creates ONE WooCommerce order directly in 'processing' status,
 * and cleans up intents, cart sessions, and caches.
 */
export const finalizePaymentAndCreateOrder = async ({
  rzpOrderId,
  rzpPaymentId,
  rzpSignature = null,
  expectedCustomerId = null,
  source = "browser",
  req = null,
}) => {
  if (!rzpOrderId || !rzpPaymentId) {
    return {
      success: false,
      status: 400,
      message: "Missing Razorpay order ID or payment ID.",
    };
  }

  // 1. Signature Verification (for browser verify requests)
  if (rzpSignature) {
    const isValid = verifyPaymentSignature({
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: rzpPaymentId,
      razorpay_signature: rzpSignature,
    });
    if (!isValid) {
      logger.warn({ rzpOrderId, rzpPaymentId }, "[Payment Finalize] Invalid payment signature");
      await alertStaffAnomaly({
        type: "CLIENT_SIGNATURE_MISMATCH",
        severity: "warning",
        rzpOrderId,
        rzpPaymentId,
        message: "Client payment signature verification failed",
        details: { rzpOrderId, rzpPaymentId },
      });
      return {
        success: false,
        status: 400,
        message: "Payment verification failed: invalid signature.",
      };
    }
  }

  // 2. Fetch Payment directly from Razorpay to verify status & amount
  let rzpPayment;
  try {
    rzpPayment = await fetchRazorpayPayment(rzpPaymentId);
  } catch (err) {
    logger.warn({ rzpOrderId, rzpPaymentId, err: err.message }, "[Payment Finalize] Failed to fetch payment from Razorpay");
    return {
      success: false,
      status: 502,
      message: "Unable to verify payment status with gateway. Please retry in a moment.",
    };
  }

  if (rzpPayment.order_id !== rzpOrderId) {
    logger.warn(
      { expected_order: rzpOrderId, payment_order: rzpPayment.order_id },
      "[Payment Finalize] Payment does not belong to expected Razorpay order"
    );
    return {
      success: false,
      status: 400,
      message: "Payment verification failed: payment does not belong to this order.",
    };
  }

  if (rzpPayment.status !== "captured") {
    logger.warn({ rzpOrderId, status: rzpPayment.status }, "[Payment Finalize] Payment is not yet captured");
    return {
      success: false,
      status: 400,
      message: `Payment is not yet confirmed (status: ${rzpPayment.status}). Please wait or retry.`,
    };
  }

  // 3. Acquire Distributed Atomic Lock for rzpOrderId
  let lease;
  try {
    lease = await acquirePaymentLease(rzpOrderId, source, 4000);
  } catch (lockErr) {
    if (lockErr?.code === "LOCK_STORAGE_UNAVAILABLE") {
      return {
        success: false,
        status: 503,
        confirming: true,
        paid: true,
        captured: true,
        message: "Payment received · Confirming your order",
      };
    }
    throw lockErr;
  }
  const lockAcquired = Boolean(lease);
  if (!lockAcquired) {
    // Check if concurrent thread already created and verified the order
    const existing = await findOrderByRazorpayOrderId(rzpOrderId);
    if (existing) {
      const existingStatus = String(existing.status || "").toLowerCase();
      if (existingStatus === "refunded") {
        return {
          success: false,
          status: 200,
          terminal: true,
          refunded: true,
          refund_status: "completed",
          order_id: existing.id,
          orderStatus: existingStatus,
          message: "Your payment was refunded.",
        };
      }
      if (["cancelled", "failed"].includes(existingStatus)) {
        return {
          success: false,
          status: 200,
          terminal: true,
          cancelled: true,
          order_id: existing.id,
          orderStatus: existingStatus,
          message: "This order was cancelled or failed.",
        };
      }
    }
    return {
      success: false,
      status: 409,
      confirming: true,
      paid: true,
      captured: true,
      message: "Payment finalization is currently in progress. Please wait a moment.",
    };
  }

  const settleVerifiedExistingOrder = async (existingOrder) => {
    const existingCustomerId = Number(existingOrder.customer_id || 0);
    if (expectedCustomerId && existingCustomerId && existingCustomerId !== Number(expectedCustomerId)) {
      return paymentOwnershipFailure();
    }

    const freshIntent = await paymentIntentService.getPaymentIntent(rzpOrderId, { fresh: true });
    const existingStatus = String(existingOrder.status || "").toLowerCase();
    const reservationId =
      freshIntent?.stock_reservation_id || freshIntent?.checkout_payload?.stock_reservation_id;

    if ((Number(rzpPayment.amount_refunded || 0) > 0 || rzpPayment.refund_status) && existingStatus !== "refunded" && freshIntent?.status !== "refunded") {
      const isFullGatewayRefund =
        rzpPayment.refund_status === "full" ||
        Number(rzpPayment.amount_refunded || 0) >= Number(rzpPayment.amount || Infinity);

      if (isFullGatewayRefund) {
        const fullNote = `[Payment Recovery] Full Razorpay refund detected for order #${existingOrder.id}. Order moved to refunded.`;
        const syncFn = paymentIntentService.syncOrderRefundWithLock;
        const syncRes = typeof syncFn === "function"
          ? await syncFn({ wcOrderId: existingOrder.id, mode: "full", note: fullNote })
          : { fallback: true };
        if (syncRes?.fallback && existingStatus !== "refunded") {
          await api.put(`orders/${existingOrder.id}`, {
            status: "refunded",
            meta_data: [{ key: "_delivery_status", value: "refunded" }],
          });
        }
        await invalidateOrderDetailCache(existingOrder.id);
        if (freshIntent && freshIntent.status !== "refunded") {
          await updatePaymentIntentStatus({
            rzpOrderId,
            fromStatus: freshIntent.status,
            toStatus: "refunded",
            rzpPaymentId,
            wcOrderId: existingOrder.id,
          });
        }
        if (reservationId) await releaseCheckoutStock(reservationId);
        return {
          success: false,
          status: 200,
          terminal: true,
          refunded: true,
          refund_status: "completed",
          order_id: existingOrder.id,
          orderStatus: "refunded",
          message: "Your payment was refunded.",
          _idempotent: true,
        };
      }

      if (
        ["pending", "processing", "packed"].includes(existingStatus) ||
        (existingStatus === "on-hold" && !hasOrderMetaFlag(existingOrder, "_payment_partial_refund_hold"))
      ) {
        const partialNote = `[AUDIT ALERT] Partial Razorpay refund detected during order recovery for #${existingOrder.id}. Order placed on-hold for owner review; do not dispatch.`;
        const syncFn = paymentIntentService.syncOrderRefundWithLock;
        const syncRes = typeof syncFn === "function"
          ? await syncFn({ wcOrderId: existingOrder.id, mode: "partial_hold", note: partialNote })
          : { fallback: true };
        if (syncRes?.fallback) {
          await api.put(`orders/${existingOrder.id}`, {
            status: "on-hold",
            meta_data: [
              { key: "_delivery_status", value: "on-hold" },
              { key: "_payment_partial_refund_hold", value: "yes" },
            ],
          });
        }
        await invalidateOrderDetailCache(existingOrder.id);
        await alertStaffAnomaly({
          type: "PARTIAL_OR_FAILED_REFUND",
          severity: "critical",
          rzpOrderId,
          rzpPaymentId,
          wcOrderId: existingOrder.id,
          message: `Partial refund detected during order recovery for #${existingOrder.id}. Dispatch blocked (on-hold).`,
          details: { amount_refunded: rzpPayment.amount_refunded, wcOrderId: existingOrder.id },
        });
      }

      return {
        success: false,
        status: 200,
        terminal: true,
        support_required: true,
        order_id: existingOrder.id,
        orderStatus: "on-hold",
        message: "A refund exists for this payment. Support must review it before the order can be completed.",
      };
    }

    if (existingStatus === "refunded" || freshIntent?.status === "refunded") {
      return {
        success: false,
        status: 200,
        terminal: true,
        refunded: true,
        refund_status: "completed",
        order_id: existingOrder.id,
        orderStatus: "refunded",
        message: "Your payment was refunded.",
        _idempotent: true,
      };
    }
    if (["cancelled", "failed"].includes(existingStatus)) {
      return {
        success: false,
        status: 200,
        terminal: true,
        cancelled: true,
        order_id: existingOrder.id,
        orderStatus: existingStatus,
        message: "This order was cancelled or failed.",
        _idempotent: true,
      };
    }
    if (["refund_pending", "refund_failed", "refund_escalated"].includes(freshIntent?.status)) {
      return {
        success: false,
        status: 200,
        terminal: freshIntent.status === "refund_escalated",
        support_required: freshIntent.status === "refund_escalated",
        refunded: false,
        refund_status: "pending",
        order_id: existingOrder.id,
        orderStatus: existingStatus,
        message: "Your refund is being processed and will reflect in 5-7 business days.",
        _idempotent: true,
      };
    }
    if (
      freshIntent?.status === "amount_mismatch" ||
      hasOrderMetaFlag(existingOrder, "_payment_amount_mismatch") ||
      hasOrderMetaFlag(existingOrder, "_payment_partial_refund_hold")
    ) {
      return {
        success: true,
        order_id: existingOrder.id,
        order_number: existingOrder.number || existingOrder.id,
        orderStatus: "on-hold",
        message: "Order is on hold for store verification.",
        _flagged: true,
        _idempotent: true,
      };
    }

    // Re-verify financial total and currency before confirming or notifying staff
    const wcCurrency = String(existingOrder.currency || "INR").toUpperCase();
    const wcTotalPaise = Math.round(Number(existingOrder.total || 0) * 100);
    const capturedPaise = Number(rzpPayment.amount);
    const currencyOk = wcCurrency === "INR" && String(rzpPayment.currency || "INR").toUpperCase() === "INR";
    const totalMatches = currencyOk && wcTotalPaise === capturedPaise;

    if (!totalMatches) {
      await holdOrderForMismatch({
        order: existingOrder,
        rzpOrderId,
        rzpPaymentId,
        capturedPaise,
        wcTotalPaise,
        wcCurrency,
      });
      await updatePaymentIntentStatus({
        rzpOrderId,
        toStatus: "amount_mismatch",
        rzpPaymentId,
        wcOrderId: existingOrder.id,
        capturedAmountPaise: capturedPaise,
        errorReason: `Total mismatch: WooCommerce ${wcCurrency} ₹${formatPaiseAsRupees(wcTotalPaise)} vs Paid ₹${formatPaiseAsRupees(capturedPaise)}`,
      });
      await alertStaffAnomaly({
        type: "PAYMENT_AMOUNT_MISMATCH",
        severity: "critical",
        rzpOrderId,
        rzpPaymentId,
        wcOrderId: existingOrder.id,
        message: `CRITICAL: Existing order #${existingOrder.id} total differs from captured payment. Placed on-hold for review.`,
        details: { capturedAmountPaise: capturedPaise, wcTotalPaise, wcCurrency, wcOrderId: existingOrder.id },
      });
      if (reservationId) await releaseCheckoutStock(reservationId);
      const cId = freshIntent?.customer_id || existingCustomerId;
      if (cId) await paymentIntentService.clearCustomerWcCart(cId);
      if (cId && freshIntent?.cart_fingerprint) await deleteActiveCartIntentId(cId, freshIntent.cart_fingerprint);
      return {
        success: true,
        order_id: existingOrder.id,
        order_number: existingOrder.number || existingOrder.id,
        orderStatus: "on-hold",
        message: "Payment captured, but an amount discrepancy was detected. Your order has been placed on hold for support review.",
        _flagged: true,
        _idempotent: true,
      };
    }

    // Only promote pre-verification holds (e.g. from an interrupted finalizer whose intent is still paid/created);
    // standalone on-hold orders with no matching active intent stay safely on-hold.
    if (
      (existingStatus === "on-hold" || existingStatus === "pending") &&
      freshIntent &&
      ["paid", "created"].includes(freshIntent.status)
    ) {
      await promoteVerifiedOrderToProcessing({
        order: existingOrder,
        rzpOrderId,
        rzpPaymentId,
        capturedPaise,
        paymentMethodDetail: rzpPayment.method || "online",
        source,
      });
    }

    let intentSynced = true;
    const customerIdToClean = freshIntent?.customer_id || existingCustomerId;
    if (freshIntent && freshIntent.status !== "order_created") {
      intentSynced = await updatePaymentIntentStatus({
        rzpOrderId,
        toStatus: "order_created",
        rzpPaymentId,
        wcOrderId: existingOrder.id,
        capturedAmountPaise: capturedPaise,
      });
      if (reservationId) await releaseCheckoutStock(reservationId);
      if (customerIdToClean) await paymentIntentService.clearCustomerWcCart(customerIdToClean);
      if (customerIdToClean && freshIntent?.cart_fingerprint) {
        await deleteActiveCartIntentId(customerIdToClean, freshIntent.cart_fingerprint);
      }
    }

    if (String(existingOrder.status || "").toLowerCase() === "processing") {
      await notifyFulfillmentOrderCreated(existingOrder);
    }

    return {
      success: true,
      order_id: existingOrder.id,
      order_number: existingOrder.number || existingOrder.id,
      orderStatus: existingOrder.status || "processing",
      message: "Payment already verified.",
      _idempotent: true,
      ...(intentSynced ? {} : { _intentPendingSync: true }),
    };
  };

  try {
    // 4. Idempotency Check (Double-checked inside lock)
    const existingOrder = await findOrderByRazorpayOrderId(rzpOrderId);
    if (existingOrder) {
      logger.info(
        { wc_order_id: existingOrder.id, rzpOrderId, source },
        "[Payment Finalize] Order already created — reconciling post-creation state"
      );
      return await settleVerifiedExistingOrder(existingOrder);
    }

    // 5. Retrieve Stored Payment Intent
    const intent = await paymentIntentService.getPaymentIntent(rzpOrderId, { fresh: true });
    if (intent && intent.status === "order_created" && intent.wc_order_id) {
      logger.info(
        { wc_order_id: intent.wc_order_id, rzpOrderId, source },
        "[Payment Finalize] Intent already in order_created state — returning idempotent success"
      );
      await ensureOrderCreatedNotification({
        orderId: Number(intent.wc_order_id),
        total: intent.amount_in_paise ? formatPaiseAsRupees(intent.amount_in_paise) : null,
        status: "processing",
      });
      return {
        success: true,
        order_id: Number(intent.wc_order_id),
        order_number: intent.wc_order_id,
        orderStatus: "processing",
        message: "Payment already verified.",
        _idempotent: true,
      };
    }
    if (!intent) {
      // Legacy order check: if notes contain a wc_order_id created before this deployment
      const legacyOrderId = rzpPayment.notes?.wc_order_id;
      if (legacyOrderId) {
        try {
          const legacyRes = await api.get(`orders/${encodeURIComponent(legacyOrderId)}`);
          const legacyOrder = legacyRes.data;
          if (legacyOrder && (legacyOrder.status === "pending" || legacyOrder.status === "on-hold")) {
            // Customer authorization guard on legacy recovery
            if (expectedCustomerId && Number(legacyOrder.customer_id) !== Number(expectedCustomerId)) {
              logger.warn(
                { expected: expectedCustomerId, actual: legacyOrder.customer_id, rzpOrderId },
                "[Payment Finalize] Legacy recovery customer ID mismatch"
              );
              return paymentOwnershipFailure();
            }

            // Financial integrity guard on legacy recovery
            const legacyTotalPaise = Math.round(Number(legacyOrder.total || 0) * 100);
            const capturedPaise = Number(rzpPayment.amount || 0);
            const currencyMatch = String(rzpPayment.currency || "").toUpperCase() === "INR";

            if (legacyTotalPaise !== capturedPaise || !currencyMatch) {
              logger.error(
                { rzpOrderId, legacyOrderId, legacyTotalPaise, capturedPaise },
                "[Payment Finalize] Legacy recovery amount or currency mismatch"
              );
              return {
                success: false,
                status: 400,
                message: "Payment amount does not match order total.",
              };
            }

            await api.put(`orders/${legacyOrder.id}`, {
              status: "processing",
              transaction_id: rzpPaymentId,
              meta_data: [
                ...verifiedPaymentMetadata(rzpOrderId, rzpPaymentId),
              ],
            });
            await invalidateOrderDetailCache(legacyOrder.id);
            await notifyFulfillmentOrderCreated({
              id: legacyOrder.id,
              total: legacyOrder.total,
              status: "processing",
              meta_data: legacyOrder.meta_data,
            });
            return {
              success: true,
              order_id: legacyOrder.id,
              orderStatus: "processing",
              message: "Payment verified successfully.",
            };
          }
        } catch (_) {}
      }

      logger.warn({ rzpOrderId, rzpPaymentId }, "[Payment Finalize] Payment intent not found or expired");
      return {
        success: false,
        status: 404,
        message: "Payment session expired or not found. If amount was debited, support will reconcile.",
      };
    }

    // 6. Customer Authorization & Amount Validation
    if (expectedCustomerId && Number(intent.customer_id) !== Number(expectedCustomerId)) {
      logger.warn(
        { expected: expectedCustomerId, actual: intent.customer_id },
        "[Payment Finalize] Customer ID mismatch"
      );
      return paymentOwnershipFailure();
    }

    const paymentMismatch = Number(rzpPayment.amount) !== Number(intent.amount_in_paise) ||
      String(rzpPayment.currency || "").toUpperCase() !== "INR";

    // Refund decisions are irreversible for fulfillment, including pending refunds.
    if (["reconciliation_escalated", "test_archived"].includes(intent.status)) {
      return {
        success: false,
        status: 200,
        terminal: true,
        support_required: true,
        message: "This payment requires staff review. Please do not pay again; contact support with your checkout reference.",
      };
    }
    if (["refund_pending", "refund_failed", "refund_escalated", "refunded", "amount_mismatch"].includes(intent.status)) {
      return {
        success: false,
        status: 200,
        terminal: true,
        refunded: intent.status === "refunded",
        refund_status: intent.status,
        message: intent.status === "refunded" ? "Your payment was refunded." : "Your payment requires refund/support review. Please do not pay again.",
      };
    }
    if (Number(rzpPayment.amount_refunded || 0) > 0 || rzpPayment.refund_status) {
      await updatePaymentIntentStatus({
        rzpOrderId,
        fromStatus: intent.status,
        toStatus: "refund_escalated",
        rzpPaymentId,
        errorReason: "Gateway reports a refund before order creation; staff review required.",
      });
      return {
        success: false,
        status: 200,
        terminal: true,
        refunded: false,
        message: "A refund exists for this payment. Support must review it before the order can be completed.",
      };
    }

    if (intent.status !== "paid" || !intent.first_paid_at) {
      const tracked = await updatePaymentIntentStatus({
        rzpOrderId,
        fromStatus: intent.status,
        toStatus: "paid",
        rzpPaymentId,
        capturedAmountPaise: rzpPayment.amount,
      });
      if (!tracked) return { success: false, status: 503, message: "Payment recovery is being recorded. Please do not pay again." };
      intent.status = "paid";
    }

    // 7. Revalidate Store Hours & Operating Constraints
    let finalizedAfterHours = Boolean(intent.checkout_payload?.is_after_hours);
    let finalizedDeliveryDate = intent.checkout_payload?.scheduled_delivery_date || null;
    let finalizedDeliveryLabel = intent.checkout_payload?.scheduled_delivery_label || null;
    let capturedDuringEmergencyWithoutSlot = false;
    try {
      const storeStatus = await storeHoursService.getStoreStatus();
      if (storeStatus && storeStatus.is_open === false) {
        if (storeStatus.next_opening?.date && storeStatus.next_opening?.time && storeStatus.next_opening?.day) {
          finalizedAfterHours = true;
          finalizedDeliveryDate = storeStatus.next_opening.date;
          finalizedDeliveryLabel = storeStatus.next_opening.label;
        } else {
          // A captured payment must still be finalized. Keep the order visible
          // to staff with an explicit review note when no safe slot is known.
          finalizedAfterHours = false;
          finalizedDeliveryDate = null;
          finalizedDeliveryLabel = null;
          capturedDuringEmergencyWithoutSlot = true;
        }
        logger.warn(
          { rzpOrderId, rzpPaymentId },
          "[Payment Finalize] Store closed during payment capture — proceeding with order creation to avoid stranded capture"
        );
      }
    } catch (_) {}

    // 8. Renew the durable stock hold before finalization. The successful
    // reservation is authoritative: WooCommerce's REST stock_quantity includes
    // this checkout's own hold and can therefore report 0 when the customer
    // legitimately reserved the last units.
    const lineItems = intent.checkout_payload?.line_items || [];
    let stockValid = true;
    const retryExpired = Boolean(intent.first_paid_at) &&
      Date.now() - Date.parse(String(intent.first_paid_at).replace(" ", "T") + "Z") >= 15 * 60 * 1000;
    if (retryExpired || paymentMismatch) stockValid = false;

    // Reacquire/renew the durable hold before finalization. A captured payment
    // without a valid hold must never be finalized as a successful order.
    const reservationId = intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id || crypto.randomUUID();
    try {
      if (!retryExpired && !paymentMismatch) await reserveCheckoutStock({ reservationId, lineItems });
    } catch (reservationErr) {
      if (reservationErr.response?.status === 409) {
        stockValid = false;
      } else {
        logger.error({ rzpOrderId, err: reservationErr.message }, "[Payment Finalize] Unable to verify inventory reservation");
        await updatePaymentIntentStatus({
          rzpOrderId,
          toStatus: "paid",
          rzpPaymentId,
          capturedAmountPaise: rzpPayment.amount,
          incrementAttempts: true,
          errorReason: `Inventory reservation unavailable: ${reservationErr.message}`,
        });
        return {
          success: false,
          status: 503,
          message: "Payment was received, but inventory confirmation is temporarily unavailable. We are safely retrying your order.",
        };
      }
    }

    if (!stockValid) {
      logger.error(
        { rzpOrderId, rzpPaymentId },
        "[Payment Finalize] Deterministic failure: Stock depleted during payment. Initiating refund."
      );

      // Transition to refund_pending FIRST via compare-and-set
      const refundTracked = await updatePaymentIntentStatus({
        rzpOrderId,
        fromStatus: intent.status,
        toStatus: "refund_pending",
        rzpPaymentId,
        errorReason: paymentMismatch ? "AMOUNT_MISMATCH" : retryExpired ? "FINALIZATION_TIMEOUT" : "ITEM_OUT_OF_STOCK",
      });

      if (!refundTracked) return { success: false, status: 503, message: "Payment recovery is pending. Please do not pay again." };
      await lease.refresh();
      let refundConfirmed = false;
      let refundId = null;
      let alreadyRefundedGateway = false;

      try {
        const refund = await refundRazorpayPayment({
          paymentId: rzpPaymentId,
          amountInPaise: rzpPayment.amount,
          notes: {
            reason: "Automatic full-refund recovery",
            rzp_order_id: rzpOrderId,
          },
        });
        if (refund?.already_refunded) {
          alreadyRefundedGateway = true;
        }
        if (refund?.id) {
          refundId = refund.id;
          let paymentData = null;
          if (refund.status !== "processed" || Number(refund.amount || 0) < Number(rzpPayment.amount || 0)) {
            try {
              paymentData = await fetchRazorpayPayment(rzpPaymentId);
            } catch (_) {}
          }
          if (isRefundFullySettled(refund, rzpPayment.amount, paymentData)) {
            refundConfirmed = true;
          } else {
            logger.warn(
              { rzpOrderId, rzpPaymentId, refundId: refund.id, refundStatus: refund.status },
              "[Payment Finalize] Refund returned pending/partial — remaining in refund_pending for reconciler"
            );
          }
        }
      } catch (refundErr) {
        logger.error(
          { rzpOrderId, rzpPaymentId, err: refundErr.message },
          "[Payment Finalize] Refund API attempt failed — reconciler will retry"
        );
        await updatePaymentIntentStatus({
          rzpOrderId,
          toStatus: "refund_failed",
          errorReason: `Refund API error: ${refundErr.message}`,
        });
      }

      if (refundConfirmed) {
        // Transition to refunded ONLY after confirmation
        await updatePaymentIntentStatus({
          rzpOrderId,
          fromStatus: "refund_pending",
          toStatus: "refunded",
          refundId,
          capturedAmountPaise: rzpPayment.amount,
        });

        await alertStaffAnomaly({
          type: "AUTO_REFUND_STOCK_DEPLETED",
          severity: "warning",
          rzpOrderId,
          rzpPaymentId,
          message: `Auto-refunded ₹${formatPaiseAsRupees(rzpPayment.amount)} due to stock depletion`,
          details: { refund_id: refundId },
        });
        await releaseCheckoutStock(reservationId);
      }

      return {
        success: false,
        status: 422,
        code: "ITEM_OUT_OF_STOCK",
        terminal: true,
        refunded: refundConfirmed,
        refund_status: refundConfirmed ? "completed" : "pending",
        message: refundConfirmed ? "Your payment has been refunded." : "Your order could not be completed. Refund recovery is pending; please do not pay again.",
        refund_id: refundId,
        ...(alreadyRefundedGateway ? { _alreadyRefunded: true } : {}),
      };
    }

    // 9. CREATE ONE WOOCOMMERCE ORDER IN NON-PACKABLE "on-hold" STATUS FIRST
    // Staff cannot see or pack it until total & currency verification succeeds.
    const isAfterHours = finalizedAfterHours;
    const scheduledDeliveryLabel = finalizedDeliveryLabel || "Scheduled fulfillment";
    const extraMeta = [];
    if (isAfterHours) {
      extraMeta.push(
        { key: "_order_placed_after_hours", value: "yes" },
        { key: "_delivery_slot", value: "scheduled" },
        { key: "_scheduled_delivery_label", value: scheduledDeliveryLabel },
        { key: "_scheduled_delivery_date", value: finalizedDeliveryDate || "" }
      );
    } else if (capturedDuringEmergencyWithoutSlot) {
      extraMeta.push({ key: "_payment_captured_without_delivery_slot", value: "yes" });
    }

    const wcOrderPayload = {
      ...intent.checkout_payload,
      status: "on-hold",
      payment_method: "razorpay",
      payment_method_title: "Online Payment",
      set_paid: false,
      transaction_id: rzpPaymentId,
      customer_note: isAfterHours
        ? `Order scheduled for fulfillment when the store opens: ${scheduledDeliveryLabel}.`
        : capturedDuringEmergencyWithoutSlot
          ? "Payment was captured during an emergency closure. The store team will contact you to confirm fulfillment."
          : intent.checkout_payload?.customer_note || "",
      meta_data: [
        ...verifiedPaymentMetadata(rzpOrderId, rzpPaymentId),
        { key: "_payment_method_detail", value: rzpPayment.method || "online" },
        { key: "_cart_fingerprint", value: intent.cart_fingerprint || "" },
        ...extraMeta,
      ],
    };

    // 9b. HPOS-safe lookup immediately before order creation (guards against slow worker exceeding lock TTL)
    const immediateExisting = await findOrderByRazorpayOrderId(rzpOrderId);
    if (immediateExisting) {
      logger.info(
        { wc_order_id: immediateExisting.id, rzpOrderId, source },
        "[Payment Finalize] Existing order detected immediately before creation — reconciling state"
      );
      return await settleVerifiedExistingOrder(immediateExisting);
    }

    let createdOrder;
    try {
      await lease.refresh();
      const orderResponse = await paymentIntentService.createPaidOrder(wcOrderPayload);
      createdOrder = orderResponse.data;
    } catch (orderErr) {
      logger.error(
        { rzpOrderId, rzpPaymentId, err: orderErr.message },
        "[Payment Finalize] CRITICAL: WooCommerce order creation failed after payment captured"
      );
      // RETAIN PAYMENT INTENT in 'paid' status so background reconciler keeps retrying finalization for ~15 min!
      await updatePaymentIntentStatus({
        rzpOrderId,
        toStatus: "paid",
        rzpPaymentId,
        capturedAmountPaise: rzpPayment.amount,
        incrementAttempts: true,
        errorReason: `WooCommerce order creation failed: ${orderErr.message}`,
      });

      await alertStaffAnomaly({
        type: "ORDER_CREATION_FAILED",
        severity: "critical",
        rzpOrderId,
        rzpPaymentId,
        message: "WooCommerce order creation failed after payment capture; reconciler will retry",
        details: { error: orderErr.message },
      });

      return {
        success: false,
        status: 502,
        confirming: true,
        paid: true,
        captured: true,
        message: "Payment received · Confirming your order",
      };
    }

    // Customer order-list responses are cached briefly; invalidate this
    // customer's pages as soon as a new WooCommerce order exists.
    if (intent?.customer_id) {
      serverCache.invalidatePrefix(`customer:orders:${intent.customer_id}:`);
    }

    // 9c. FINANCIAL INTEGRITY GUARD: Verify created WooCommerce order currency & total match captured payment
    const wcCurrency = String(createdOrder.currency || "INR").toUpperCase();
    const wcTotalPaise = Math.round(Number(createdOrder.total || 0) * 100);
    const capturedPaise = Number(rzpPayment.amount);
    const currencyMatch = wcCurrency === "INR" && String(rzpPayment.currency || "INR").toUpperCase() === "INR";

    if (!currencyMatch || wcTotalPaise !== capturedPaise) {
      logger.error(
        {
          rzpOrderId,
          rzpPaymentId,
          wcOrderId: createdOrder.id,
          wcTotalPaise,
          wcCurrency,
          capturedPaise,
          discrepancyPaise: wcTotalPaise - capturedPaise,
        },
        "[Payment Finalize] CRITICAL: WooCommerce order total/currency does NOT match captured Razorpay payment!"
      );

      // Fail-closed: only confirm hold to shopper after WooCommerce/WordPress hold write succeeds
      try {
        await holdOrderForMismatch({
          order: createdOrder,
          rzpOrderId,
          rzpPaymentId,
          capturedPaise,
          wcTotalPaise,
          wcCurrency,
        });
      } catch (holdErr) {
        logger.error({ err: holdErr.message, wcOrderId: createdOrder.id }, "[Payment Finalize] Failed to enforce on-hold after total mismatch");
        await updatePaymentIntentStatus({
          rzpOrderId,
          toStatus: "paid",
          rzpPaymentId,
          wcOrderId: createdOrder.id,
          capturedAmountPaise: capturedPaise,
          incrementAttempts: true,
          errorReason: `Mismatch hold update failed: ${holdErr.message}`,
        });
        await alertStaffAnomaly({
          type: "PAYMENT_AMOUNT_MISMATCH_HOLD_FAILED",
          severity: "critical",
          rzpOrderId,
          rzpPaymentId,
          wcOrderId: createdOrder.id,
          message: `URGENT: Order #${createdOrder.id} has a total mismatch and could not be forced on-hold automatically!`,
          details: { capturedAmountPaise: capturedPaise, wcTotalPaise, wcCurrency, error: holdErr.message },
        });
        return {
          success: false,
          status: 503,
          confirming: true,
          paid: true,
          captured: true,
          message: "Payment received · Confirming your order",
        };
      }

      await updatePaymentIntentStatus({
        rzpOrderId,
        toStatus: "amount_mismatch",
        rzpPaymentId,
        wcOrderId: createdOrder.id,
        capturedAmountPaise: capturedPaise,
        errorReason: `Total mismatch: WooCommerce ${wcCurrency} ₹${formatPaiseAsRupees(wcTotalPaise)} vs Paid ₹${formatPaiseAsRupees(capturedPaise)}`,
      });

      await alertStaffAnomaly({
        type: "PAYMENT_AMOUNT_MISMATCH",
        severity: "critical",
        rzpOrderId,
        rzpPaymentId,
        wcOrderId: createdOrder.id,
        message: `CRITICAL: Captured payment (₹${formatPaiseAsRupees(capturedPaise)}) differs from WooCommerce order total (${wcCurrency} ₹${formatPaiseAsRupees(wcTotalPaise)}). Order placed on-hold for review.`,
        details: {
          capturedAmountPaise: capturedPaise,
          wcTotalPaise,
          wcCurrency,
          wcOrderId: createdOrder.id,
          differencePaise: wcTotalPaise - capturedPaise,
        },
      });

      await releaseCheckoutStock(reservationId);
      await paymentIntentService.clearCustomerWcCart(intent.customer_id);

      if (intent?.customer_id && intent?.cart_fingerprint) {
        await deleteActiveCartIntentId(intent.customer_id, intent.cart_fingerprint);
      }

      return {
        success: true,
        order_id: createdOrder.id,
        order_number: createdOrder.number || createdOrder.id,
        orderStatus: "on-hold",
        message: "Payment captured, but an amount discrepancy was detected. Your order has been placed on hold for support review.",
        _flagged: true,
      };
    }

    // 9d. Total & currency verified -> release order to processing under shared lock
    try {
      await promoteVerifiedOrderToProcessing({
        order: createdOrder,
        rzpOrderId,
        rzpPaymentId,
        capturedPaise,
        paymentMethodDetail: rzpPayment.method || "online",
        source,
      });
    } catch (promoteErr) {
      logger.error(
        { rzpOrderId, wcOrderId: createdOrder.id, err: promoteErr.message },
        "[Payment Finalize] Verified order could not yet transition from on-hold to processing"
      );
      await updatePaymentIntentStatus({
        rzpOrderId,
        toStatus: "paid",
        rzpPaymentId,
        wcOrderId: createdOrder.id,
        capturedAmountPaise: capturedPaise,
        incrementAttempts: true,
        errorReason: `Processing promotion failed: ${promoteErr.message}`,
      });
      return {
        success: false,
        status: 502,
        confirming: true,
        paid: true,
        captured: true,
        message: "Payment received · Confirming your order",
      };
    }

    // 10. Post-Creation Cleanup (ONLY after WooCommerce order total/currency is verified and promoted to processing)
    const intentMarkedCreated = await updatePaymentIntentStatus({
      rzpOrderId,
      toStatus: "order_created",
      rzpPaymentId,
      wcOrderId: createdOrder.id,
      capturedAmountPaise: rzpPayment.amount,
    });
    await releaseCheckoutStock(reservationId);
    await paymentIntentService.clearCustomerWcCart(intent.customer_id);

    if (intent?.customer_id && intent?.cart_fingerprint) {
      await deleteActiveCartIntentId(intent.customer_id, intent.cart_fingerprint);
    }

    if (isAfterHours) createdOrder._suppressPush = true;
    await invalidateOrderCachesAndNotify({
      order: createdOrder,
      customerId: intent?.customer_id,
      rzpOrderId,
      rzpPaymentId,
      source,
    });

    return {
      success: true,
      order_id: createdOrder.id,
      order_number: createdOrder.number || createdOrder.id,
      orderStatus: createdOrder.status || "processing",
      message: "Payment verified successfully.",
      ...(intentMarkedCreated ? {} : { _intentPendingSync: true }),
    };
  } finally {
    // 11. Guarantee Distributed Lock Release
    await lease.release();
  }
};
