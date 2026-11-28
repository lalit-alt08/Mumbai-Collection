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
  const lease = await acquirePaymentLease(rzpOrderId, source, 4000);
  const lockAcquired = Boolean(lease);
  if (!lockAcquired) {
    // Check if concurrent thread already created the order
    const existing = await findOrderByRazorpayOrderId(rzpOrderId);
    if (existing) {
      await notifyFulfillmentOrderCreated(existing);
      return {
        success: true,
        order_id: existing.id,
        orderStatus: existing.status || "processing",
        message: "Payment already verified.",
        _idempotent: true,
      };
    }
    return {
      success: false,
      status: 409,
      message: "Payment finalization is currently in progress. Please wait a moment.",
    };
  }

  try {
    // 4. Idempotency Check (Double-checked inside lock)
    const existingOrder = await findOrderByRazorpayOrderId(rzpOrderId);
    if (existingOrder) {
      logger.info(
        { wc_order_id: existingOrder.id, rzpOrderId, source },
        "[Payment Finalize] Order already created — returning idempotent success"
      );
      await notifyFulfillmentOrderCreated(existingOrder);
      return {
        success: true,
        order_id: existingOrder.id,
        order_number: existingOrder.number || existingOrder.id,
        orderStatus: existingOrder.status || "processing",
        message: "Payment already verified.",
        _idempotent: true,
      };
    }

    // 5. Retrieve Stored Payment Intent
    const intent = await paymentIntentService.getPaymentIntent(rzpOrderId, { fresh: true });
    if (intent && (intent.status === "order_created" || intent.wc_order_id)) {
      logger.info(
        { wc_order_id: intent.wc_order_id, rzpOrderId, source },
        "[Payment Finalize] Intent already in order_created state — returning idempotent success"
      );
      if (intent.status === "order_created" && intent.wc_order_id) {
        await ensureOrderCreatedNotification({
          orderId: Number(intent.wc_order_id),
          total: intent.amount_in_paise ? formatPaiseAsRupees(intent.amount_in_paise) : null,
          status: "processing",
        });
      }
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

      try {
        const refund = await refundRazorpayPayment({
          paymentId: rzpPaymentId,
          amountInPaise: rzpPayment.amount,
          notes: {
            reason: "Auto-refund: Item out of stock during payment capture",
            rzp_order_id: rzpOrderId,
          },
        });
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
      };
    }

    // 9. CREATE ONE WOOCOMMERCE ORDER DIRECTLY IN "processing" STATUS
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
      status: "processing",
      payment_method: "razorpay",
      payment_method_title: "Online Payment",
      set_paid: true,
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
        "[Payment Finalize] Existing order detected immediately before creation — returning idempotent success"
      );
      await updatePaymentIntentStatus({
        rzpOrderId,
        toStatus: "order_created",
        rzpPaymentId,
        wcOrderId: immediateExisting.id,
      });
      await releaseCheckoutStock(reservationId);
      await notifyFulfillmentOrderCreated(immediateExisting);
      return {
        success: true,
        order_id: immediateExisting.id,
        orderStatus: immediateExisting.status || "processing",
        message: "Payment already verified.",
        _idempotent: true,
      };
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
        message: "Payment captured, but order registration encountered an error. Support has been notified.",
      };
    }

    // Customer order-list responses are cached briefly; invalidate this
    // customer's pages as soon as a new WooCommerce order exists.
    if (intent?.customer_id) {
      serverCache.invalidatePrefix(`customer:orders:${intent.customer_id}:`);
    }

    // 9c. FINANCIAL INTEGRITY GUARD: Verify created WooCommerce order total matches captured payment
    const wcTotalPaise = Math.round(Number(createdOrder.total || 0) * 100);
    const capturedPaise = Number(rzpPayment.amount);

    if (wcTotalPaise !== capturedPaise) {
      logger.error(
        {
          rzpOrderId,
          rzpPaymentId,
          wcOrderId: createdOrder.id,
          wcTotalPaise,
          capturedPaise,
          discrepancyPaise: wcTotalPaise - capturedPaise,
        },
        "[Payment Finalize] CRITICAL: WooCommerce order total does NOT match captured Razorpay payment!"
      );

      // Immediately hold order so fulfillment/dispatch is blocked
      try {
        await api.put(`orders/${createdOrder.id}`, {
          status: "on-hold",
          customer_note: "Order placed on hold for verification: payment amount discrepancy detected.",
        });
        await invalidateOrderDetailCache(createdOrder.id);
        await api.post(`orders/${createdOrder.id}/notes`, {
          note: `[AUDIT ALERT] Total Mismatch: Captured Razorpay payment is ₹${formatPaiseAsRupees(capturedPaise)}, but WooCommerce order total was calculated as ₹${formatPaiseAsRupees(wcTotalPaise)} (difference of ₹${formatPaiseAsRupees(wcTotalPaise - capturedPaise)}). Hold for administrative review.`,
          customer_note: false,
        });
      } catch (holdErr) {
        logger.error({ err: holdErr.message, wcOrderId: createdOrder.id }, "[Payment Finalize] Failed to set order to on-hold after total mismatch");
      }

      await updatePaymentIntentStatus({
        rzpOrderId,
        toStatus: "amount_mismatch",
        rzpPaymentId,
        wcOrderId: createdOrder.id,
        capturedAmountPaise: capturedPaise,
        errorReason: `Total mismatch: WooCommerce ₹${formatPaiseAsRupees(wcTotalPaise)} vs Paid ₹${formatPaiseAsRupees(capturedPaise)}`,
      });

      await alertStaffAnomaly({
        type: "PAYMENT_AMOUNT_MISMATCH",
        severity: "critical",
        rzpOrderId,
        rzpPaymentId,
        wcOrderId: createdOrder.id,
        message: `CRITICAL: Captured payment (₹${formatPaiseAsRupees(capturedPaise)}) differs from WooCommerce order total (₹${formatPaiseAsRupees(wcTotalPaise)}). Order placed on-hold for review.`,
        details: {
          capturedAmountPaise: capturedPaise,
          wcTotalPaise,
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

    // 10. Post-Creation Cleanup (ONLY after WooCommerce order is securely created and total verified)
    await updatePaymentIntentStatus({
      rzpOrderId,
      toStatus: "order_created",
      rzpPaymentId,
      wcOrderId: createdOrder.id,
      capturedAmountPaise: rzpPayment.amount,
    });
    await releaseCheckoutStock(reservationId);
    await paymentIntentService.clearCustomerWcCart(intent.customer_id);

    // Publish real-time event for employee dashboard & durable background push outbox
    await notifyFulfillmentOrderCreated(createdOrder, {
      suppressPush: isAfterHours || capturedDuringEmergencyWithoutSlot,
    });

    serverCache.invalidatePrefix("employee:overview");
    serverCache.invalidatePrefix("admin:analytics");
    serverCache.invalidatePrefix("admin:customers");
    serverCache.delete("product_stock_counts");
    serverCache.invalidatePrefix("admin_products:");
    serverCache.invalidatePrefix("catalog:products:");
    serverCache.invalidatePrefix("catalog:category:");
    if (intent?.customer_id && intent?.cart_fingerprint) {
      await deleteActiveCartIntentId(intent.customer_id, intent.cart_fingerprint);
    }

    if (Array.isArray(createdOrder.line_items)) {
      for (const item of createdOrder.line_items) {
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
      { wc_order_id: createdOrder.id, razorpay_order_id: rzpOrderId, razorpay_payment_id: rzpPaymentId, source },
      "[Payment Finalize] SUCCESS: Exactly 1 WooCommerce order created in processing status"
    );

    return {
      success: true,
      order_id: createdOrder.id,
      order_number: createdOrder.number || createdOrder.id,
      orderStatus: "processing",
      message: "Payment verified successfully.",
    };
  } finally {
    // 11. Guarantee Distributed Lock Release
    await lease.release();
  }
};
