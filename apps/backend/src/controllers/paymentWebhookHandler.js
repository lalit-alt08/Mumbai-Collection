import crypto from "crypto";
import { logger, logError } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import api from "../config/woocommerce.js";
import paymentIntentService, {
  storeWebhookEvent,
  updateWebhookEventStatus,
  updatePaymentIntentStatus,
  releaseCheckoutStock,
} from "../services/paymentIntentService.js";
import {
  verifyWebhookSignature,
  fetchRazorpayPayment,
} from "../services/razorpayService.js";
import { alertStaffAnomaly } from "../services/alertService.js";
import { acquirePaymentLease } from "../services/paymentLease.js";
import { invalidateOrderDetailCache } from "../services/orderDetailCache.js";
import { publishOrderEvent } from "../services/orderNotificationService.js";
import { findOrderByRazorpayOrderId } from "../utils/paymentCheckoutUtils.js";
import { finalizePaymentAndCreateOrder } from "../services/paymentFinalizeService.js";

/**
 * Shared durable refund webhook processor used by both handleWebhook and
 * periodic reconciliation replay of stranded/orphan refund webhook events.
 */
export const processRefundWebhookEvent = async ({
  eventId,
  event = "refund.processed",
  rzpPaymentId = null,
  rzpOrderId = null,
  refundEntity = null,
  paymentEntity = null,
}) => {
  const refundPaymentId = rzpPaymentId || refundEntity?.payment_id || paymentEntity?.id;
  let refundRzpOrderId = rzpOrderId || paymentEntity?.order_id || refundEntity?.notes?.rzp_order_id;
  let refundLease;

  try {
    if (!refundPaymentId && !refundRzpOrderId) {
      throw new Error("Refund webhook missing payment and order identifiers");
    }
    const payment = await fetchRazorpayPayment(refundPaymentId);
    refundRzpOrderId = payment.order_id || refundRzpOrderId;
    if (!refundRzpOrderId) throw new Error("Refund payment has no order ID");

    refundLease = await acquirePaymentLease(refundRzpOrderId, "refund-event");
    if (!refundLease) throw new Error("Payment refund is already being processed");

    const intent = await paymentIntentService.getPaymentIntent(refundRzpOrderId, { fresh: true });
    if (!intent) throw new Error("Refund intent missing; requires staff review");

    const full =
      payment.refund_status === "full" ||
      Number(payment.amount_refunded || 0) >= Number(payment.amount || Infinity);

    if (full) {
      // Stage 1: Persist refund_pending BEFORE WooCommerce write so any store sync failure
      // stays visible to the automatic reconciliation loop rather than getting stranded as refunded.
      let currentIntentStatus = intent.status;
      if (currentIntentStatus !== "refunded" && currentIntentStatus !== "refund_pending") {
        const staged = await updatePaymentIntentStatus({
          rzpOrderId: refundRzpOrderId,
          fromStatus: currentIntentStatus,
          toStatus: "refund_pending",
          refundId: refundEntity?.id,
        });
        if (staged) {
          currentIntentStatus = "refund_pending";
        }
      }
      await releaseCheckoutStock(
        intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id || refundRzpOrderId
      );

      // Locate and transition existing WooCommerce order to refunded status to prevent dispatch
      const wcOrderId = intent.wc_order_id || (await findOrderByRazorpayOrderId(refundRzpOrderId))?.id;
      if (wcOrderId) {
        try {
          const existingOrder = await api.get(`orders/${wcOrderId}`);
          if (typeof existingOrder.data?.status !== "string") {
            throw new Error("Could not verify current WooCommerce order status");
          }
          if (existingOrder.data?.status !== "refunded") {
            await api.put(`orders/${wcOrderId}`, {
              status: "refunded",
              meta_data: [{ key: "_delivery_status", value: "refunded" }],
            });
            await api.post(`orders/${wcOrderId}/notes`, {
              note: `[Razorpay Webhook] Full gateway refund confirmed (${refundEntity?.id || "refunded"}). Order status moved to refunded.`,
              customer_note: false,
            });
          }
          await invalidateOrderDetailCache(wcOrderId);
          serverCache.invalidatePrefix("employee:overview");
          publishOrderEvent({ event: "ORDER_STATUS_UPDATED", orderId: wcOrderId, status: "refunded" });
          logger.info(
            { rzpOrderId: refundRzpOrderId, wcOrderId },
            "[Payment Webhook] WooCommerce order moved to refunded following full gateway refund"
          );
        } catch (wcRefundErr) {
          logger.error(
            { err: wcRefundErr.message, wcOrderId, rzpOrderId: refundRzpOrderId },
            "[Payment Webhook] Failed to transition WooCommerce order to refunded"
          );
          await updatePaymentIntentStatus({
            rzpOrderId: refundRzpOrderId,
            toStatus: "refund_pending",
            refundId: refundEntity?.id,
            errorReason: `WooCommerce order ${wcOrderId} sync to refunded failed: ${wcRefundErr.message}`,
            incrementAttempts: true,
          });
          throw new Error(`WooCommerce order ${wcOrderId} sync to refunded failed; queued for reconciliation`);
        }
      }

      const settled =
        currentIntentStatus === "refunded"
          ? true
          : await updatePaymentIntentStatus({
              rzpOrderId: refundRzpOrderId,
              fromStatus: currentIntentStatus,
              toStatus: "refunded",
              refundId: refundEntity?.id,
            });
      if (!settled && currentIntentStatus !== "refunded") {
        throw new Error("Could not transition payment intent to refunded");
      }
    } else {
      // Partial/manual refunds do not authorize refunding the remaining purchase.
      const alert = await alertStaffAnomaly({
        type: "PARTIAL_OR_FAILED_REFUND",
        severity: "warning",
        rzpOrderId: refundRzpOrderId,
        rzpPaymentId: refundPaymentId,
        message: "Refund event observed; existing refund recovery state preserved.",
        details: { event, amount_refunded: payment.amount_refunded },
      });
      if (!alert?.success) throw new Error("Could not queue refund review alert");
    }

    if (eventId) {
      const updated = await paymentIntentService.updateWebhookEventStatus({ eventId, status: "processed" });
      if (!updated) throw new Error("Could not durably record refund webhook processing");
      serverCache.set(`webhook:event:${eventId}`, true, 24 * 60 * 60 * 1000);
    }
    return { success: true, rzpOrderId: refundRzpOrderId };
  } finally {
    await refundLease?.release();
  }
};

/**
 * POST /api/payments/webhook
 *
 * Verifies Razorpay webhook signature, durably stores the raw webhook event,
 * acknowledges after durable storage with HTTP 200, and asynchronously finalizes orders
 * or manages full refunds with distributed lease protection.
 */
export const handleWebhook = async (req, res) => {
  let eventId = null;
  try {
    const signature = req.headers["x-razorpay-signature"];
    if (!signature) {
      logger.warn("[Payment Webhook] Missing X-Razorpay-Signature header");
      return res.status(400).json({
        success: false,
        message: "Missing signature header.",
      });
    }

    const rawBody = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    const isValid = verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.warn("[Payment Webhook] Invalid webhook signature");
      return res.status(400).json({
        success: false,
        message: "Invalid webhook signature.",
      });
    }

    const event = req.body?.event;
    eventId = req.headers["x-razorpay-event-id"] || req.body?.id || req.body?.event_id || `evt_${Date.now()}_${crypto.randomUUID()}`;

    const paymentEntity = req.body?.payload?.payment?.entity;
    const orderEntity = req.body?.payload?.order?.entity;
    const rzpOrderId = paymentEntity?.order_id || orderEntity?.id;
    const rzpPaymentId = paymentEntity?.id;

    // 1. Store raw webhook event durably FIRST in WordPress MySQL
    const eventStored = await storeWebhookEvent({
      eventId,
      eventType: event || "unknown",
      rzpOrderId,
      rzpPaymentId,
      rawPayload: req.body,
    });

    if (!eventStored) {
      logger.error(
        { eventId, event },
        "[Payment Webhook] Failed to durably store webhook event — returning 500 for gateway retry"
      );
      return res.status(500).json({
        success: false,
        message: "Failed to persist webhook event durably. Please retry.",
      });
    }

    if (eventId) {
      const cacheKey = `webhook:event:${eventId}`;
      if (serverCache.get(cacheKey)) {
        logger.info({ eventId }, "[Payment Webhook] Event already processed — returning idempotent 200");
        return res.status(200).json({
          success: true,
          message: "Event already processed.",
          _idempotent: true,
        });
      }
    }

    logger.info({ event, eventId }, "[Payment Webhook] Verified webhook received and stored durably");

    if (event === "payment.failed") {
      await updateWebhookEventStatus({ eventId, status: "processed" });
      return res.status(200).json({
        success: true,
        message: "Payment failure event acknowledged.",
      });
    }

    if (event === "order.paid" || event === "payment.captured") {
      const pEntity = req.body?.payload?.payment?.entity;
      const oEntity = req.body?.payload?.order?.entity;

      const paidRzpOrderId = pEntity?.order_id || oEntity?.id;
      const paidRzpPaymentId = pEntity?.id;

      if (!paidRzpOrderId) {
        logger.warn("[Payment Webhook] Webhook payload missing Razorpay order ID");
        return res.status(400).json({
          success: false,
          message: "Missing Razorpay order ID in payload.",
        });
      }

      // Acknowledge after the durable storage request; its latency is upstream-dependent.
      res.status(200).json({
        success: true,
        received: true,
        message: "Webhook received and queued for processing.",
      });

      // Offload order fulfillment to background worker
      setImmediate(async () => {
        try {
          const result = await finalizePaymentAndCreateOrder({
            rzpOrderId: paidRzpOrderId,
            rzpPaymentId: paidRzpPaymentId,
            source: "webhook",
          });

          if (result.success) {
            await updateWebhookEventStatus({ eventId, status: "processed" });
            if (eventId) serverCache.set(`webhook:event:${eventId}`, true, 24 * 60 * 60 * 1000);
            logger.info({ rzpOrderId: paidRzpOrderId, wc_order_id: result.order_id }, "[Payment Webhook] Finalized order successfully via webhook background worker");
            return;
          }

          if (result.status === 409 || result._idempotent) {
            await updateWebhookEventStatus({ eventId, status: "processed" });
            if (eventId) serverCache.set(`webhook:event:${eventId}`, true, 24 * 60 * 60 * 1000);
            logger.info({ rzpOrderId: paidRzpOrderId }, "[Payment Webhook] Order already finalized or in progress");
            return;
          }

          // Unknown intent or unfinalized order: Record orphan record, alert, reconciler handles it
          logger.warn({ rzpOrderId: paidRzpOrderId, rzpPaymentId: paidRzpPaymentId, result }, "[Payment Webhook] Webhook missing intent or failed order creation — recorded for reconciliation");
          await updateWebhookEventStatus({ eventId, status: "orphan" });

          await alertStaffAnomaly({
            type: "ORPHAN_PAYMENT_WEBHOOK",
            severity: "critical",
            rzpOrderId: paidRzpOrderId,
            rzpPaymentId: paidRzpPaymentId,
            message: "Payment captured on Razorpay webhook with unknown/missing intent; recorded for reconciliation",
            details: { result },
          });
        } catch (bgError) {
          logger.error({ err: bgError.message, eventId, rzpOrderId: paidRzpOrderId }, "[Payment Webhook] Unhandled error during background webhook processing");
          await updateWebhookEventStatus({ eventId, status: "failed" });
        }
      });

      return;
    }

    if (event === "refund.processed" || event === "refund.failed") {
      const refundEntity = req.body?.payload?.refund?.entity;
      const pEntity = req.body?.payload?.payment?.entity;
      const refundPaymentId = refundEntity?.payment_id || pEntity?.id;
      let refundRzpOrderId = pEntity?.order_id || refundEntity?.notes?.rzp_order_id;

      // Acknowledge after durable storage, before asynchronous refund processing.
      res.status(200).json({
        success: true,
        received: true,
        message: `Refund ${event} webhook received and queued for processing.`,
      });

      setImmediate(async () => {
        try {
          await processRefundWebhookEvent({
            eventId,
            event,
            rzpPaymentId: refundPaymentId,
            rzpOrderId: refundRzpOrderId,
            refundEntity,
            paymentEntity: pEntity,
          });
        } catch (err) {
          logger.error({ err: err.message, eventId, rzpOrderId: refundRzpOrderId }, "[Payment Webhook] Refund event requires retry/review");
          serverCache.delete("webhook:event:" + eventId);
          await updateWebhookEventStatus({ eventId, status: "orphan" });
        }
      });

      return;
    }

    await updateWebhookEventStatus({ eventId, status: "processed" });
    return res.status(200).json({
      success: true,
      message: "Webhook event ignored.",
    });
  } catch (error) {
    if (eventId) {
      await updateWebhookEventStatus({ eventId, status: "failed" });
    }
    logError(req, error, "[Payment Webhook] Unhandled error during webhook processing");
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};
