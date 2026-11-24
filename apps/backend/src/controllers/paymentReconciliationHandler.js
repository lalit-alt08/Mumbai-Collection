import api from "../config/woocommerce.js";
import wp from "../services/wordpress.js";
import { logger, logError } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import { acquirePaymentLease } from "../services/paymentLease.js";
import { fetchRazorpayOrderPayments } from "../services/razorpayService.js";
import { invalidateOrderDetailCache } from "../services/orderDetailCache.js";
import { publishOrderEvent } from "../services/orderNotificationService.js";
import {
  getExistingRazorpayOrderId,
  totalToPaise,
} from "../utils/paymentCheckoutUtils.js";

/**
 * POST /api/payments/reconcile/:id (Admin Reconciliation)
 *
 * Acquires a distributed payment lease, fetches payments from Razorpay,
 * validates captured amounts and currency, and executes a safe compare-and-update
 * under WordPress shared staff order lock with complete cache invalidation.
 */
export const reconcileOrder = async (req, res) => {
  let lease = null;
  try {
    const orderId = req.params.id;
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Order ID required." });
    }

    let wcOrder;
    try {
      const orderRes = await api.get(`orders/${encodeURIComponent(orderId)}`);
      wcOrder = orderRes.data;
    } catch (err) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const rzpOrderId = getExistingRazorpayOrderId(wcOrder);
    if (!rzpOrderId) {
      return res.json({
        reconciled: true,
        action: "none",
        message: "Order does not have an associated Razorpay order ID.",
        order_status: wcOrder.status,
      });
    }

    if (wcOrder.status === "processing" || wcOrder.status === "completed") {
      return res.json({
        reconciled: true,
        action: "none",
        message: "Order is already in a completed/processing state.",
        order_status: wcOrder.status,
      });
    }

    // Acquire shared payment lease to prevent race conditions with webhooks or other verification flows
    lease = await acquirePaymentLease(rzpOrderId, "reconcile", 5000);
    if (!lease) {
      return res.status(409).json({
        success: false,
        message: "A payment verification or reconciliation request is already in progress for this order.",
      });
    }

    let payments;
    try {
      const paymentsRes = await fetchRazorpayOrderPayments(rzpOrderId);
      payments = paymentsRes?.items || [];
    } catch (fetchErr) {
      logError(req, fetchErr, "[Payment Reconcile] Failed to fetch payments from Razorpay");
      return res.status(502).json({
        success: false,
        message: "Failed to communicate with Razorpay.",
      });
    }

    const capturedPayment = payments.find((p) => p.status === "captured");
    const expectedAmountPaise = totalToPaise(wcOrder.total);

    if (capturedPayment) {
      if (Number(capturedPayment.amount_refunded || 0) > 0 || Boolean(capturedPayment.refund_status)) {
        return res.status(409).json({
          reconciled: false,
          anomaly: "PAYMENT_REFUNDED",
          message: "Captured payment has been partially or fully refunded on Razorpay. Review before releasing for fulfillment.",
          amount_refunded_paise: Number(capturedPayment.amount_refunded || 0),
          refund_status: capturedPayment.refund_status || null,
        });
      }

      // Currency and amount verification (matching payment verification flow)
      const isCurrencyValid = String(capturedPayment.currency || "").toUpperCase() === "INR";
      const isAmountValid = Number(capturedPayment.amount) === expectedAmountPaise;

      if (!isCurrencyValid || !isAmountValid) {
        logger.error(
          {
            orderId,
            expected: expectedAmountPaise,
            actual: capturedPayment.amount,
            currency: capturedPayment.currency,
          },
          "[Payment Reconcile] Amount or currency mismatch detected during reconciliation"
        );
        return res.status(409).json({
          reconciled: false,
          anomaly: !isCurrencyValid ? "CURRENCY_MISMATCH" : "AMOUNT_MISMATCH",
          message: !isCurrencyValid
            ? "Payment captured on Razorpay but currency is not INR."
            : "Payment captured on Razorpay but amount does not match WooCommerce total.",
          expected_amount_paise: expectedAmountPaise,
          actual_amount_paise: capturedPayment.amount,
          currency: capturedPayment.currency,
        });
      }

      // Verify the lease is still held before attempting the write
      const leaseHeld = await lease.isHeld();
      if (!leaseHeld) {
        logger.error(
          { orderId, rzpOrderId },
          "[Payment Reconcile] Payment lease expired or lost before updating order status"
        );
        return res.status(409).json({
          success: false,
          message: "Payment lease expired or lost before updating order.",
        });
      }

      // Safe compare-and-update under WordPress shared staff order lock
      let wpReconcileRes;
      try {
        wpReconcileRes = await wp.post(
          `/wp-json/mumbai-auth/v1/internal/orders/${encodeURIComponent(orderId)}/reconcile-payment`,
          {
            razorpay_order_id: rzpOrderId,
            razorpay_payment_id: capturedPayment.id,
            captured_amount_paise: capturedPayment.amount,
            currency: capturedPayment.currency || "INR",
            payment_method_detail: capturedPayment.method || "online",
          },
          {
            headers: {
              "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
            },
            timeout: 8000,
          }
        );
      } catch (wpErr) {
        const status = wpErr.response?.status;
        const errData = wpErr.response?.data;

        if (status === 503) {
          logger.warn(
            { orderId, err: wpErr.message },
            "[Payment Reconcile] Store database could not read current order state; returning retryable 503"
          );
          return res.status(503).json({
            success: false,
            retryable: true,
            message: errData?.message || "Could not read current order state from store database.",
          });
        }

        if (status === 409) {
          logger.info(
            { orderId, code: errData?.code, message: errData?.message },
            "[Payment Reconcile] Conflict or validation rejection under order lock"
          );
          return res.status(409).json(errData || { success: false, message: wpErr.message });
        }

        logger.error(
          { orderId, err: wpErr.message, status },
          "[Payment Reconcile] Internal reconciliation write failed unexpectedly"
        );
        return res.status(status && status >= 400 && status < 600 ? status : 500).json({
          success: false,
          message: errData?.message || "Failed to safely reconcile order status in store database.",
        });
      }

      const reconcileData = wpReconcileRes?.data;
      if (reconcileData?.action === "none") {
        logger.info(
          { orderId, message: reconcileData?.message, status: reconcileData?.order_status },
          "[Payment Reconcile] Order was already settled or cannot transition; safe no-op"
        );
        return res.json(reconcileData);
      }

      // Require explicit update action and matching order and payment IDs before confirming success
      const isConfirmedUpdate =
        reconcileData?.reconciled === true &&
        reconcileData?.action === "updated_to_processing" &&
        Number(reconcileData?.order_id) === Number(orderId) &&
        reconcileData?.payment_id === capturedPayment.id &&
        reconcileData?.order_status === "processing";

      if (!isConfirmedUpdate) {
        logger.error(
          { orderId, reconcileData },
          "[Payment Reconcile] Store response did not explicitly confirm processing update or mismatched IDs"
        );
        return res.status(502).json({
          success: false,
          message: "Payment reconciliation write could not be confirmed by store database.",
        });
      }

      await invalidateOrderDetailCache(wcOrder.id);
      if (wcOrder.customer_id) {
        serverCache.invalidatePrefix(`customer:orders:${wcOrder.customer_id}:`);
      }

      // Publish minimal real-time event for employee dashboard
      publishOrderEvent({ event: "ORDER_STATUS_UPDATED", orderId: wcOrder.id, status: "processing" });

      serverCache.invalidatePrefix("employee:overview");
      serverCache.invalidatePrefix("admin:analytics");
      serverCache.invalidatePrefix("admin:customers");
      serverCache.delete("product_stock_counts");
      serverCache.invalidatePrefix("admin_products:");
      serverCache.invalidatePrefix("catalog:products:");
      serverCache.invalidatePrefix("catalog:category:");

      // Explicitly handle failed Redis distributed cache flush while preserving successful outcome
      let cachePropagationDegraded = false;
      try {
        await serverCache.flushPendingInvalidations();
      } catch (flushErr) {
        cachePropagationDegraded = true;
        logger.warn(
          { orderId, err: flushErr.message },
          "[Payment Reconcile] Redis distributed invalidation failed; cache propagation degraded"
        );
      }

      logger.info(
        { orderId, payment_id: capturedPayment.id, cachePropagationDegraded },
        "[Payment Reconcile] Order reconciled and updated to processing"
      );

      return res.json({
        reconciled: true,
        action: "updated_to_processing",
        payment_id: capturedPayment.id,
        order_status: "processing",
        ...(cachePropagationDegraded ? { cache_propagation_degraded: true } : {}),
      });
    }

    return res.json({
      reconciled: true,
      action: "none",
      message: "No un-reconciled captured payment found in Razorpay for this order.",
      order_status: wcOrder.status,
      payments_count: payments.length,
    });
  } catch (error) {
    logError(req, error, "[Payment Reconcile] Unexpected error during reconciliation");
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred during reconciliation.",
    });
  } finally {
    if (lease) {
      await lease.release().catch(() => {});
    }
  }
};
