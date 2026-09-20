/**
 * Payment Controller — Stage 1: Backend Payment Foundation
 *
 * Handles:
 * - POST /api/payments/create-order  → Creates WooCommerce pending order + Razorpay order
 * - POST /api/payments/verify        → Verifies Razorpay payment and marks WC order processing
 *
 * Architecture:
 * 1. WooCommerce is the authoritative source for order totals, prices, stock, and inventory.
 * 2. Razorpay handles payment transactions.
 * 3. Node orchestrates, validates, and verifies.
 *
 * SECURITY:
 * - Amount is NEVER accepted from the frontend.
 * - Signature verification uses HMAC SHA256 with timing-safe comparison.
 * - Payment amount is cross-verified against WooCommerce order total.
 * - Customer ownership is validated before any order modification.
 * - No secrets, signatures, or sensitive payment data are logged.
 */

import api from "../config/woocommerce.js";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { logError, logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import storeHoursService from "../services/storeHoursService.js";
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  fetchRazorpayPayment,
  getPublicKeyId,
  verifyWebhookSignature,
  fetchRazorpayOrderPayments,
} from "../services/razorpayService.js";

const WP_BASE_URL = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
const MIN_ORDER_VALUE_INR = 500;

// Safe last-known store-hours fallback cache with maximum 5-minute TTL
let lastKnownStoreStatus = null;
const STORE_HOURS_FALLBACK_MAX_AGE_MS = 5 * 60 * 1000;

export const _resetPaymentStoreHoursFallbackForTesting = () => {
  lastKnownStoreStatus = null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the customer's live WooCommerce Store API cart using their auth cookie.
 */
const getCustomerCart = async (wpAuthCookie) => {
  const response = await axios.get(
    `${WP_BASE_URL}/wp-json/wc/store/v1/cart`,
    {
      headers: { Cookie: wpAuthCookie },
      httpsAgent,
      timeout: 10000,
    }
  );
  return response.data;
};

/**
 * Reads an existing Razorpay order ID from WooCommerce order meta.
 */
const getExistingRazorpayOrderId = (order) => {
  if (!order?.meta_data || !Array.isArray(order.meta_data)) return null;
  const meta = order.meta_data.find((m) => m.key === "_razorpay_order_id");
  return meta?.value || null;
};

/**
 * Converts WooCommerce order total (string like "1250.00") to paise (integer 125000).
 */
const totalToPaise = (total) => {
  const parsed = parseFloat(total);
  if (isNaN(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/create-order
// ─────────────────────────────────────────────────────────────────────────────

export const createOrder = async (req, res) => {
  try {
    const userId = req.wpUserId;

    // ── 1. Verify customer is not suspended ────────────────────────────────
    if (req.isSuspended) {
      return res.status(403).json({
        success: false,
        code: "CUSTOMER_SUSPENDED",
        message: "Your account is currently suspended and you cannot place new orders.",
      });
    }

    // ── 2. Store Hours Guard ───────────────────────────────────────────────
    try {
      const storeStatus = await storeHoursService.getStoreStatus();
      if (!storeStatus || typeof storeStatus.is_open !== "boolean") {
        throw new Error("Invalid store status payload");
      }

      // Record last known valid store status
      lastKnownStoreStatus = {
        status: storeStatus,
        timestamp: Date.now(),
      };

      if (!storeStatus.is_open) {
        return res.status(403).json({
          success: false,
          code: "STORE_CLOSED",
          message: storeStatus.message || "Our store is currently closed for new orders.",
          next_opening: storeStatus.next_opening,
        });
      }
    } catch (statusErr) {
      logger.warn({ err: statusErr.message }, "[Payment] Store hours evaluation warning, checking fallback cache");

      const hasValidFallback =
        lastKnownStoreStatus &&
        Date.now() - lastKnownStoreStatus.timestamp <= STORE_HOURS_FALLBACK_MAX_AGE_MS;

      if (hasValidFallback) {
        const fallback = lastKnownStoreStatus.status;
        if (!fallback || !fallback.is_open) {
          return res.status(403).json({
            success: false,
            code: "STORE_CLOSED",
            message: fallback?.message || "Our store is currently closed for new orders.",
            next_opening: fallback?.next_opening || null,
          });
        }
        // Fallback state is valid within 5 minutes and store was open: allow checkout
      } else {
        // Fail closed: no valid cached state exists within 5 minutes
        return res.status(503).json({
          success: false,
          code: "STORE_HOURS_UNAVAILABLE",
          message: "Unable to verify store operating hours. Please try again in a few moments.",
        });
      }
    }

    // ── 3. Handle Retry for Existing Pending Order ─────────────────────────
    const existingOrderId = req.body.order_id;
    if (existingOrderId) {
      let existingOrder;
      try {
        const orderRes = await api.get(`orders/${encodeURIComponent(existingOrderId)}`);
        existingOrder = orderRes.data;
      } catch (err) {
        logError(req, err, "[Payment] Order lookup failed for retry");
        return res.status(404).json({
          success: false,
          message: "Order not found.",
        });
      }

      // Customer ownership check
      if (Number(existingOrder.customer_id) !== Number(userId)) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to access this order.",
        });
      }

      // Check order status is pending or on-hold
      if (existingOrder.status !== "pending" && existingOrder.status !== "on-hold") {
        return res.status(409).json({
          success: false,
          message: `Order cannot be paid in its current status (${existingOrder.status}).`,
        });
      }

      const existingRzpOrderId = getExistingRazorpayOrderId(existingOrder);
      const amountInPaise = totalToPaise(existingOrder.total);

      if (amountInPaise <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid order total.",
        });
      }

      // Reuse existing Razorpay order if present
      if (existingRzpOrderId) {
        logger.info(
          { wc_order_id: existingOrder.id, razorpay_order_id: existingRzpOrderId },
          "[Payment] Reusing existing Razorpay order for order retry"
        );
        return res.json({
          success: true,
          order_id: existingOrder.id,
          razorpay_order_id: existingRzpOrderId,
          amount: amountInPaise,
          currency: "INR",
          key_id: getPublicKeyId(),
        });
      }

      // Create new Razorpay order for this existing WooCommerce order
      let rzpOrder;
      try {
        rzpOrder = await createRazorpayOrder({
          amountInPaise,
          currency: "INR",
          receipt: `wc_order_${existingOrder.id}`,
          notes: {
            wc_order_id: String(existingOrder.id),
            customer_id: String(userId),
          },
        });
      } catch (rzpErr) {
        logError(req, rzpErr, "[Payment] Razorpay order creation failed during retry");
        return res.status(502).json({
          success: false,
          message: "Unable to initialize payment. Please try again.",
        });
      }

      // Attach Razorpay order ID to WooCommerce order
      try {
        await api.put(`orders/${existingOrder.id}`, {
          meta_data: [{ key: "_razorpay_order_id", value: rzpOrder.id }],
        });
      } catch (metaErr) {
        logger.warn(
          { wc_order_id: existingOrder.id, razorpay_order_id: rzpOrder.id },
          "[Payment] Failed to update Razorpay order ID on retry order"
        );
      }

      return res.status(201).json({
        success: true,
        order_id: existingOrder.id,
        razorpay_order_id: rzpOrder.id,
        amount: amountInPaise,
        currency: "INR",
        key_id: getPublicKeyId(),
      });
    }

    // ── 4. Validate request body for new checkout ─────────────────────────
    const { billing_address, shipping_address } = req.body;
    if (!billing_address || !shipping_address) {
      return res.status(400).json({
        success: false,
        message: "Billing and shipping addresses are required.",
      });
    }

    // ── 4. Get customer's cart from WooCommerce Store API ─────────────────
    let cart;
    try {
      cart = await getCustomerCart(req.wpAuthCookie);
    } catch (cartErr) {
      logError(req, cartErr, "[Payment] Failed to fetch customer cart");
      return res.status(502).json({
        success: false,
        message: "Unable to load your cart. Please try again.",
      });
    }

    if (!cart?.items || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Your cart is empty.",
      });
    }

    // ── 5. Minimum order value check ──────────────────────────────────────
    const itemsSubtotal = cart.totals?.total_items
      ? Number(cart.totals.total_items) / 100
      : 0;

    if (itemsSubtotal < MIN_ORDER_VALUE_INR) {
      const shortfall = Math.max(0, MIN_ORDER_VALUE_INR - itemsSubtotal);
      return res.status(400).json({
        success: false,
        code: "MIN_ORDER_VALUE",
        message: `Minimum product order value of ₹${MIN_ORDER_VALUE_INR} is required. Please add ₹${shortfall} more.`,
      });
    }

    // ── 6. Build WooCommerce order payload from cart ───────────────────────
    const lineItems = cart.items.map((item) => {
      const entry = {
        product_id: item.id,
        quantity: item.quantity,
      };
      // Preserve variation selection if present
      if (item.variation && Array.isArray(item.variation) && item.variation.length > 0) {
        const variationId = item.variation_id || item.id;
        if (variationId !== item.id) {
          entry.variation_id = variationId;
        }
      }
      return entry;
    });

    // Extract applied coupons from cart
    const couponLines = Array.isArray(cart.coupons)
      ? cart.coupons.map((c) => ({ code: c.code }))
      : [];

    // Extract shipping from cart (if available)
    const shippingLines = [];
    if (Array.isArray(cart.shipping_rates)) {
      for (const pkg of cart.shipping_rates) {
        if (Array.isArray(pkg.shipping_rates)) {
          const selected = pkg.shipping_rates.find((r) => r.selected);
          if (selected) {
            shippingLines.push({
              method_id: selected.method_id,
              method_title: selected.name || selected.method_id,
              total: String((Number(selected.price) / 100).toFixed(2)),
            });
          }
        }
      }
    }

    const wcOrderPayload = {
      status: "pending",
      payment_method: "razorpay",
      payment_method_title: "Online Payment",
      set_paid: false,
      customer_id: Number(userId),
      billing: {
        first_name: billing_address.first_name || "",
        last_name: billing_address.last_name || "",
        email: billing_address.email || req.wpUserEmail || "",
        phone: billing_address.phone || "",
        address_1: billing_address.address_1 || "",
        address_2: billing_address.address_2 || "",
        city: billing_address.city || "",
        state: billing_address.state || "",
        postcode: billing_address.postcode || "",
        country: billing_address.country || "IN",
      },
      shipping: {
        first_name: shipping_address.first_name || "",
        last_name: shipping_address.last_name || "",
        phone: shipping_address.phone || "",
        address_1: shipping_address.address_1 || "",
        address_2: shipping_address.address_2 || "",
        city: shipping_address.city || "",
        state: shipping_address.state || "",
        postcode: shipping_address.postcode || "",
        country: shipping_address.country || "IN",
      },
      line_items: lineItems,
      coupon_lines: couponLines,
      ...(shippingLines.length > 0 && { shipping_lines: shippingLines }),
    };

    // ── 7. Create WooCommerce order ───────────────────────────────────────
    let wcOrder;
    try {
      const orderResponse = await api.post("orders", wcOrderPayload);
      wcOrder = orderResponse.data;
    } catch (wcErr) {
      logError(req, wcErr, "[Payment] WooCommerce order creation failed");

      const wcMessage = wcErr.response?.data?.message;
      if (wcMessage && typeof wcMessage === "string" && wcMessage.toLowerCase().includes("stock")) {
        return res.status(409).json({
          success: false,
          code: "INSUFFICIENT_STOCK",
          message: "Some items in your cart are no longer available in the requested quantity.",
        });
      }

      return res.status(502).json({
        success: false,
        message: "Unable to create your order. Please try again.",
      });
    }

    // ── 8. Read authoritative order total from WooCommerce ────────────────
    const amountInPaise = totalToPaise(wcOrder.total);
    if (amountInPaise <= 0) {
      // Safety: cancel orphan order if total is invalid
      try {
        await api.put(`orders/${wcOrder.id}`, { status: "cancelled" });
      } catch { /* cleanup best-effort */ }

      return res.status(400).json({
        success: false,
        message: "Invalid order total calculated. Please review your cart and try again.",
      });
    }

    // ── 9. Check for existing Razorpay order (reuse) ──────────────────────
    const existingRzpOrderId = getExistingRazorpayOrderId(wcOrder);
    if (existingRzpOrderId) {
      logger.info(
        { wc_order_id: wcOrder.id, razorpay_order_id: existingRzpOrderId },
        "[Payment] Reusing existing Razorpay order"
      );

      return res.json({
        success: true,
        order_id: wcOrder.id,
        razorpay_order_id: existingRzpOrderId,
        amount: amountInPaise,
        currency: "INR",
        key_id: getPublicKeyId(),
      });
    }

    // ── 10. Create Razorpay order ─────────────────────────────────────────
    let rzpOrder;
    try {
      rzpOrder = await createRazorpayOrder({
        amountInPaise,
        currency: "INR",
        receipt: `wc_order_${wcOrder.id}`,
        notes: {
          wc_order_id: String(wcOrder.id),
          customer_id: String(userId),
        },
      });
    } catch (rzpErr) {
      // ── Orphan Order Cleanup ────────────────────────────────────────────
      // WooCommerce order was created, but Razorpay failed.
      // Attempt to cancel the WooCommerce order to release held stock.
      logger.error(
        { wc_order_id: wcOrder.id },
        "[Payment] Razorpay order creation failed — attempting WooCommerce order cleanup"
      );

      try {
        await api.put(`orders/${wcOrder.id}`, { status: "cancelled" });
        logger.info(
          { wc_order_id: wcOrder.id },
          "[Payment] Orphan WooCommerce order cancelled successfully"
        );
      } catch (cleanupErr) {
        logger.error(
          { wc_order_id: wcOrder.id, cleanup_error: cleanupErr.message },
          "[Payment] Failed to cancel orphan WooCommerce order — manual review required"
        );
      }

      return res.status(502).json({
        success: false,
        message: "Unable to initialize payment. Please try again.",
      });
    }

    // ── 11. Store Razorpay order ID in WooCommerce metadata ───────────────
    try {
      await api.put(`orders/${wcOrder.id}`, {
        meta_data: [
          { key: "_razorpay_order_id", value: rzpOrder.id },
        ],
      });
    } catch (metaErr) {
      logger.warn(
        { wc_order_id: wcOrder.id, razorpay_order_id: rzpOrder.id },
        "[Payment] Failed to store Razorpay order ID in WooCommerce meta — payment can still proceed"
      );
    }

    // ── 12. Invalidate caches ─────────────────────────────────────────────
    serverCache.invalidatePrefix("employee:overview");
    serverCache.invalidatePrefix("admin:analytics");
    serverCache.delete("product_stock_counts");

    // ── 13. Return payment initiation data ────────────────────────────────
    logger.info(
      { wc_order_id: wcOrder.id, razorpay_order_id: rzpOrder.id, amount: amountInPaise },
      "[Payment] Order created successfully"
    );

    return res.status(201).json({
      success: true,
      order_id: wcOrder.id,
      razorpay_order_id: rzpOrder.id,
      amount: amountInPaise,
      currency: "INR",
      key_id: getPublicKeyId(),
    });
  } catch (error) {
    logError(req, error, "[Payment] Unexpected error in create-order");
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred. Please try again.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/verify
// ─────────────────────────────────────────────────────────────────────────────

export const verifyPayment = async (req, res) => {
  try {
    const userId = req.wpUserId;
    const {
      order_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    // ── 1. Validate required fields ───────────────────────────────────────
    if (!order_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Missing required payment verification parameters.",
      });
    }

    // ── 2. Fetch WooCommerce order ────────────────────────────────────────
    let wcOrder;
    try {
      const orderResponse = await api.get(`orders/${encodeURIComponent(order_id)}`);
      wcOrder = orderResponse.data;
    } catch (wcErr) {
      logError(req, wcErr, "[Payment] Failed to fetch WooCommerce order for verification");
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // ── 3. Verify customer owns the order ─────────────────────────────────
    if (Number(wcOrder.customer_id) !== Number(userId)) {
      logger.warn(
        { wc_order_id: order_id, expected_customer: userId, actual_customer: wcOrder.customer_id },
        "[Payment] Ownership mismatch during payment verification"
      );
      return res.status(403).json({
        success: false,
        message: "You are not authorized to verify this payment.",
      });
    }

    // ── 4. Idempotent success: order already paid ─────────────────────────
    const currentStatus = wcOrder.status;
    if (currentStatus === "processing" || currentStatus === "completed") {
      logger.info(
        { wc_order_id: order_id, status: currentStatus },
        "[Payment] Order already verified — returning idempotent success"
      );
      return res.json({
        success: true,
        order_id: wcOrder.id,
        status: currentStatus,
        message: "Payment already verified.",
        _idempotent: true,
      });
    }

    // ── 5. Reject if order is not in a payable state ──────────────────────
    if (currentStatus !== "pending" && currentStatus !== "on-hold") {
      return res.status(409).json({
        success: false,
        message: `Order cannot be verified in its current state (${currentStatus}).`,
      });
    }

    // ── 6. Verify WooCommerce order contains expected Razorpay order ID ───
    const storedRzpOrderId = getExistingRazorpayOrderId(wcOrder);
    if (!storedRzpOrderId || storedRzpOrderId !== razorpay_order_id) {
      logger.warn(
        { wc_order_id: order_id, expected_rzp: storedRzpOrderId, received_rzp: razorpay_order_id },
        "[Payment] Razorpay order ID mismatch"
      );
      return res.status(400).json({
        success: false,
        message: "Payment verification failed: order mismatch.",
      });
    }

    // ── 7. Verify Razorpay signature (HMAC SHA256) ────────────────────────
    const isSignatureValid = verifyPaymentSignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    if (!isSignatureValid) {
      logger.warn(
        { wc_order_id: order_id, razorpay_order_id },
        "[Payment] Razorpay signature verification failed"
      );
      return res.status(400).json({
        success: false,
        message: "Payment verification failed: invalid signature.",
      });
    }

    // ── 8. Fetch payment directly from Razorpay ───────────────────────────
    let rzpPayment;
    try {
      rzpPayment = await fetchRazorpayPayment(razorpay_payment_id);
    } catch (fetchErr) {
      logError(req, fetchErr, "[Payment] Failed to fetch Razorpay payment details");
      return res.status(502).json({
        success: false,
        message: "Unable to verify payment status. Please try again.",
      });
    }

    // ── 9. Cross-verify payment integrity ─────────────────────────────────
    const expectedAmountPaise = totalToPaise(wcOrder.total);

    // 9a. Verify payment belongs to the expected Razorpay order
    if (rzpPayment.order_id !== razorpay_order_id) {
      logger.warn(
        { wc_order_id: order_id, expected_order: razorpay_order_id, payment_order: rzpPayment.order_id },
        "[Payment] Payment order_id mismatch"
      );
      return res.status(400).json({
        success: false,
        message: "Payment verification failed: payment does not belong to this order.",
      });
    }

    // 9b. Verify payment amount matches WooCommerce order total
    if (rzpPayment.amount !== expectedAmountPaise) {
      logger.warn(
        { wc_order_id: order_id, expected_amount: expectedAmountPaise, actual_amount: rzpPayment.amount },
        "[Payment] Amount mismatch detected"
      );
      return res.status(400).json({
        success: false,
        message: "Payment verification failed: amount mismatch.",
      });
    }

    // 9c. Verify currency
    if ((rzpPayment.currency || "").toUpperCase() !== "INR") {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed: currency mismatch.",
      });
    }

    // 9d. Verify payment is captured
    if (rzpPayment.status !== "captured") {
      logger.warn(
        { wc_order_id: order_id, payment_status: rzpPayment.status },
        "[Payment] Payment not captured"
      );
      return res.status(400).json({
        success: false,
        message: `Payment is not yet confirmed (status: ${rzpPayment.status}). Please wait or retry.`,
      });
    }

    // ── 10. All checks passed — update WooCommerce order ──────────────────
    try {
      await api.put(`orders/${wcOrder.id}`, {
        status: "processing",
        transaction_id: razorpay_payment_id,
        meta_data: [
          { key: "_razorpay_payment_id", value: razorpay_payment_id },
          { key: "_razorpay_order_id", value: razorpay_order_id },
          { key: "_payment_verified_at", value: new Date().toISOString() },
          { key: "_payment_method_detail", value: rzpPayment.method || "online" },
        ],
      });
    } catch (updateErr) {
      logError(req, updateErr, "[Payment] Failed to update WooCommerce order after payment verification");
      return res.status(502).json({
        success: false,
        message: "Payment was successful, but order update failed. Please contact support with your order ID.",
      });
    }

    // ── 11. Invalidate operational caches ──────────────────────────────────
    serverCache.invalidatePrefix("employee:overview");
    serverCache.invalidatePrefix("admin:analytics");
    serverCache.invalidatePrefix("admin:customers");
    serverCache.delete("product_stock_counts");

    // Invalidate product detail caches for ordered items
    if (Array.isArray(wcOrder.line_items)) {
      for (const item of wcOrder.line_items) {
        const productId = item.product_id;
        if (productId) {
          serverCache.delete(`catalog:product:${productId}`);
        }
      }
    }

    logger.info(
      { wc_order_id: wcOrder.id, razorpay_payment_id },
      "[Payment] Payment verified and order marked processing"
    );

    return res.json({
      success: true,
      order_id: wcOrder.id,
      status: "processing",
      message: "Payment verified successfully.",
    });
  } catch (error) {
    logError(req, error, "[Payment] Unexpected error in verify-payment");
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred during payment verification. Please try again.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/webhook
// ─────────────────────────────────────────────────────────────────────────────

export const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      logger.warn("[Payment Webhook] Missing X-Razorpay-Signature header");
      return res.status(400).json({
        success: false,
        message: "Missing signature header.",
      });
    }

    // Exact raw body for HMAC SHA256 verification
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
    const eventId = req.headers["x-razorpay-event-id"] || req.body?.id || req.body?.event_id;

    // Event-level idempotency
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
      // Cache event for 24 hours
      serverCache.set(cacheKey, true, 24 * 60 * 60 * 1000);
    }

    logger.info({ event, eventId }, "[Payment Webhook] Verified webhook received");

    // ── Handle Payment Failure ──────────────────────────────────────────────
    if (event === "payment.failed") {
      const paymentEntity = req.body?.payload?.payment?.entity;
      logger.warn(
        {
          event,
          razorpay_payment_id: paymentEntity?.id,
          razorpay_order_id: paymentEntity?.order_id,
          error_code: paymentEntity?.error_code,
        },
        "[Payment Webhook] Individual payment attempt failed on gateway — preserving pending order for retry"
      );
      return res.status(200).json({
        success: true,
        message: "Payment failure event acknowledged.",
      });
    }

    // ── Handle Successful Captured Payment ──────────────────────────────────
    if (event === "order.paid" || event === "payment.captured") {
      const paymentEntity = req.body?.payload?.payment?.entity;
      const orderEntity = req.body?.payload?.order?.entity;

      const rzpOrderId = paymentEntity?.order_id || orderEntity?.id;
      const rzpPaymentId = paymentEntity?.id;

      if (!rzpOrderId) {
        logger.warn("[Payment Webhook] Webhook payload missing Razorpay order ID");
        return res.status(400).json({
          success: false,
          message: "Missing Razorpay order ID in payload.",
        });
      }

      // Resolve WooCommerce order
      const wcOrderIdCandidate =
        paymentEntity?.notes?.wc_order_id ||
        orderEntity?.notes?.wc_order_id ||
        (orderEntity?.receipt?.startsWith("wc_order_")
          ? orderEntity.receipt.replace("wc_order_", "")
          : null);

      let wcOrder = null;

      if (wcOrderIdCandidate) {
        try {
          const orderRes = await api.get(`orders/${encodeURIComponent(wcOrderIdCandidate)}`);
          if (orderRes.data && getExistingRazorpayOrderId(orderRes.data) === rzpOrderId) {
            wcOrder = orderRes.data;
          }
        } catch (err) {
          // If candidate lookup fails due to network/5xx, fail with 502 so Razorpay retries
          if (err.response?.status >= 500 || err.code === "ECONNABORTED" || err.code === "ECONNRESET") {
            logError(req, err, "[Payment Webhook] Upstream WooCommerce connection error");
            return res.status(502).json({
              success: false,
              message: "Upstream error resolving order. Retry required.",
            });
          }
        }
      }

      // Fallback search by Razorpay order ID if candidate didn't match
      if (!wcOrder) {
        try {
          const searchRes = await api.get("orders", { search: rzpOrderId });
          if (Array.isArray(searchRes.data)) {
            wcOrder = searchRes.data.find(
              (o) => getExistingRazorpayOrderId(o) === rzpOrderId
            ) || null;
          }
        } catch (searchErr) {
          logError(req, searchErr, "[Payment Webhook] Order search failed");
          return res.status(502).json({
            success: false,
            message: "Upstream search failed. Retry required.",
          });
        }
      }

      if (!wcOrder) {
        logger.warn(
          { razorpay_order_id: rzpOrderId, razorpay_payment_id: rzpPaymentId },
          "[Payment Webhook] No matching WooCommerce order found for Razorpay order"
        );
        return res.status(200).json({
          success: true,
          message: "Order not found in store — recorded for reconciliation.",
        });
      }

      // Order-level idempotency: already paid/processing
      if (wcOrder.status === "processing" || wcOrder.status === "completed") {
        logger.info(
          { wc_order_id: wcOrder.id, status: wcOrder.status },
          "[Payment Webhook] Order already marked paid — returning idempotent 200"
        );
        return res.status(200).json({
          success: true,
          order_id: wcOrder.id,
          status: wcOrder.status,
          message: "Order already verified and processed.",
          _idempotent: true,
        });
      }

      // Verify payable state
      if (wcOrder.status !== "pending" && wcOrder.status !== "on-hold") {
        logger.warn(
          { wc_order_id: wcOrder.id, status: wcOrder.status },
          "[Payment Webhook] Order is in non-payable state"
        );
        return res.status(200).json({
          success: true,
          message: `Order in non-payable status (${wcOrder.status}).`,
        });
      }

      // Amount Integrity Check
      const expectedAmountPaise = totalToPaise(wcOrder.total);
      if (paymentEntity?.amount && Number(paymentEntity.amount) !== expectedAmountPaise) {
        logger.error(
          {
            wc_order_id: wcOrder.id,
            expected: expectedAmountPaise,
            actual: paymentEntity.amount,
          },
          "[Payment Webhook] CRITICAL: Amount mismatch on payment webhook"
        );
        return res.status(400).json({
          success: false,
          message: "Amount mismatch detected.",
        });
      }

      // Currency check
      if (paymentEntity?.currency && paymentEntity.currency.toUpperCase() !== "INR") {
        logger.warn({ currency: paymentEntity.currency }, "[Payment Webhook] Invalid currency");
        return res.status(400).json({
          success: false,
          message: "Invalid currency.",
        });
      }

      // Update WooCommerce order to processing
      try {
        await api.put(`orders/${wcOrder.id}`, {
          status: "processing",
          transaction_id: rzpPaymentId || wcOrder.transaction_id || "",
          meta_data: [
            ...(rzpPaymentId ? [{ key: "_razorpay_payment_id", value: rzpPaymentId }] : []),
            { key: "_razorpay_order_id", value: rzpOrderId },
            { key: "_payment_verified_at", value: new Date().toISOString() },
            { key: "_payment_verified_by", value: "webhook" },
            { key: "_payment_method_detail", value: paymentEntity?.method || "online" },
            { key: "_webhook_processed_at", value: new Date().toISOString() },
          ],
        });
      } catch (updateErr) {
        logError(req, updateErr, "[Payment Webhook] Failed to transition order to processing");
        return res.status(502).json({
          success: false,
          message: "Failed to update order state. Retry required.",
        });
      }

      // Invalidate caches
      serverCache.invalidatePrefix("employee:overview");
      serverCache.invalidatePrefix("admin:analytics");
      serverCache.invalidatePrefix("admin:customers");
      serverCache.delete("product_stock_counts");

      if (Array.isArray(wcOrder.line_items)) {
        for (const item of wcOrder.line_items) {
          if (item.product_id) {
            serverCache.delete(`catalog:product:${item.product_id}`);
          }
        }
      }

      logger.info(
        { wc_order_id: wcOrder.id, razorpay_payment_id: rzpPaymentId },
        "[Payment Webhook] Order successfully updated to processing via webhook"
      );

      return res.status(200).json({
        success: true,
        order_id: wcOrder.id,
        status: "processing",
        message: "Order successfully processed via webhook.",
      });
    }

    // Acknowledge other unhandled events safely with 200
    return res.status(200).json({
      success: true,
      message: `Event ${event} acknowledged.`,
    });
  } catch (error) {
    logError(req, error, "[Payment Webhook] Unexpected webhook error");
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred processing the webhook.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/reconcile/:id (Admin Reconciliation Endpoint)
// ─────────────────────────────────────────────────────────────────────────────

export const reconcileOrder = async (req, res) => {
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

    // If order is already completed or processing, no reconciliation mutation needed
    if (wcOrder.status === "processing" || wcOrder.status === "completed") {
      return res.json({
        reconciled: true,
        action: "none",
        message: "Order is already in a completed/processing state.",
        order_status: wcOrder.status,
      });
    }

    // Fetch payments for this order from Razorpay
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

    // Case 1: Razorpay payment captured BUT WooCommerce order still pending
    if (capturedPayment && (wcOrder.status === "pending" || wcOrder.status === "on-hold")) {
      if (capturedPayment.amount !== expectedAmountPaise) {
        logger.error(
          { orderId, expected: expectedAmountPaise, actual: capturedPayment.amount },
          "[Payment Reconcile] Amount mismatch detected during reconciliation"
        );
        return res.status(409).json({
          reconciled: false,
          anomaly: "AMOUNT_MISMATCH",
          message: "Payment captured on Razorpay but amount does not match WooCommerce total.",
          expected_amount_paise: expectedAmountPaise,
          actual_amount_paise: capturedPayment.amount,
        });
      }

      // Synchronize WooCommerce order to processing
      await api.put(`orders/${wcOrder.id}`, {
        status: "processing",
        transaction_id: capturedPayment.id,
        meta_data: [
          { key: "_razorpay_payment_id", value: capturedPayment.id },
          { key: "_payment_verified_at", value: new Date().toISOString() },
          { key: "_payment_verified_by", value: "reconciliation" },
          { key: "_payment_method_detail", value: capturedPayment.method || "online" },
        ],
      });

      serverCache.invalidatePrefix("employee:overview");
      serverCache.invalidatePrefix("admin:analytics");
      serverCache.invalidatePrefix("admin:customers");
      serverCache.delete("product_stock_counts");

      logger.info(
        { orderId, payment_id: capturedPayment.id },
        "[Payment Reconcile] Order reconciled and updated to processing"
      );

      return res.json({
        reconciled: true,
        action: "updated_to_processing",
        payment_id: capturedPayment.id,
        order_status: "processing",
      });
    }

    // Case 2: WooCommerce order is processing or completed
    if (wcOrder.status === "processing" || wcOrder.status === "completed") {
      return res.json({
        reconciled: true,
        action: "none",
        message: "Order is already in a completed/processing state.",
        order_status: wcOrder.status,
        has_captured_payment: Boolean(capturedPayment),
      });
    }

    // Case 3: No captured payment found in Razorpay
    return res.json({
      reconciled: true,
      action: "none",
      message: "No captured payment found in Razorpay for this order.",
      order_status: wcOrder.status,
      payments_count: payments.length,
    });
  } catch (error) {
    logError(req, error, "[Payment Reconcile] Unexpected error during reconciliation");
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred during reconciliation.",
    });
  }
};
