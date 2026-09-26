/**
 * Payment Controller — Deferred WooCommerce Order Creation for Razorpay
 *
 * Architecture:
 * 1. createOrder (New Checkout):
 *    - Validates all guards (suspension, store hours, address, stock, min ₹500, phone verification).
 *    - Calculates authoritative amount in paise directly from live cart.
 *    - Creates Razorpay order ONLY (receipt: rcpt_<userId>_<timestamp>).
 *    - Stores signed/sanitized payment intent with 1-hour expiry in fast memory cache & WordPress transient.
 *    - Returns Razorpay order details with order_id: null.
 *    - INVARIANT: 0 WooCommerce orders created before payment capture.
 *
 * 2. finalizePaymentAndCreateOrder (Browser Verify & Webhook & App-Switch Recovery):
 *    - Verifies HMAC SHA256 signature / payment capture state / exact amount.
 *    - Acquires WordPress-backed atomic lock for rzp_order_id (with stale-lock self-healing).
 *    - Re-checks if WooCommerce order was already created for this rzp_order_id (idempotent duplicate prevention).
 *    - Revalidates checkout state (stock, suspension, store hours, amount, customer ID).
 *    - If validation fails, records recoverable anomaly state and never creates corrupt order.
 *    - Creates ONE WooCommerce order directly with status: "processing", set_paid: true, transaction_id.
 *    - ONLY after WooCommerce order creation succeeds:
 *      - Deletes payment intent.
 *      - Clears customer WooCommerce cart session.
 *      - Invalidates operational caches.
 *    - Releases lock in finally block.
 *    - Returns created WooCommerce order ID.
 */

import crypto from "crypto";
import axios from "axios";
import https from "https";
import api from "../config/woocommerce.js";
import { logger, logError } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import storeHoursService from "../services/storeHoursService.js";
import paymentIntentService, {
  storePaymentIntent,
  getPaymentIntent,
  deletePaymentIntent,
  acquireLock,
  releaseLock,
  clearCustomerWcCart,
  updatePaymentIntentStatus,
  storeWebhookEvent,
  updateWebhookEventStatus,
  findWcOrderByRazorpayOrderId,
} from "../services/paymentIntentService.js";
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  fetchRazorpayPayment,
  getPublicKeyId,
  verifyWebhookSignature,
  fetchRazorpayOrderPayments,
  refundRazorpayPayment,
} from "../services/razorpayService.js";
import { sendRefundEmail } from "../services/brevoService.js";
import { alertStaffAnomaly } from "../services/alertService.js";

const WP_BASE_URL = (process.env.WORDPRESS_URL || "https://mumbai-collection.local").replace(/\/$/, "");
const MIN_ORDER_VALUE_INR = 500;

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === "production",
});

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
export const getExistingRazorpayOrderId = (order) => {
  if (!order?.meta_data || !Array.isArray(order.meta_data)) return null;
  const meta = order.meta_data.find((m) => m.key === "_razorpay_order_id");
  return meta?.value || null;
};

/**
 * Converts WooCommerce order total (string like "1250.00") to paise (integer 125000).
 */
export const totalToPaise = (total) => {
  const parsed = parseFloat(total);
  if (isNaN(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
};

/**
 * Computes a stable cart fingerprint based on sorted items, variation, quantities, and totals.
 */
export const computeCartFingerprint = (cart) => {
  if (!cart) return "";
  const items = (cart.items || []).map((i) => ({
    id: i.id,
    variation_id: i.variation_id || null,
    quantity: i.quantity,
    totals: i.totals?.line_total || null,
  }));
  items.sort((a, b) => a.id - b.id);
  const data = {
    items,
    total_price: cart.totals?.total_price || null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
};

/**
 * Looks up an existing WooCommerce order matching a given Razorpay order ID in order meta.
 */
export const findOrderByRazorpayOrderId = async (rzpOrderId) => {
  if (!rzpOrderId) return null;
  try {
    // 1. Fast durable check in payment_intents table
    const intent = await paymentIntentService.getPaymentIntent(rzpOrderId);
    if (intent && intent.wc_order_id) {
      return {
        id: Number(intent.wc_order_id),
        status: intent.status === "order_created" ? "processing" : intent.status,
      };
    }

    // 2. Authoritative HPOS-safe lookup via wc_get_orders meta
    const hposOrder = await paymentIntentService.findWcOrderByRazorpayOrderId(rzpOrderId);
    if (hposOrder) {
      return {
        id: Number(hposOrder.id),
        status: hposOrder.status,
      };
    }

    // 3. Upstream WooCommerce query fallback
    const res = await api.get("orders", {
      search: rzpOrderId,
      per_page: 5,
    });
    const orders = Array.isArray(res.data) ? res.data : [];
    return orders.find((o) => getExistingRazorpayOrderId(o) === rzpOrderId) || null;
  } catch (err) {
    logger.warn({ rzpOrderId, err: err.message }, "[Payment] Notice: Lookup for order by Razorpay order ID error");
    return null;
  }
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
      } else {
        return res.status(503).json({
          success: false,
          code: "STORE_HOURS_UNAVAILABLE",
          message: "Unable to verify store operating hours. Please try again in a few moments.",
        });
      }
    }

    // ── 3. Handle Retry for Legacy Existing WooCommerce Order ──────────────
    // Only used when client explicitly passes a pre-existing WooCommerce order_id
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

      // If order is already paid, return idempotent success
      if (existingOrder.status === "processing" || existingOrder.status === "completed") {
        logger.info(
          { wc_order_id: existingOrder.id, status: existingOrder.status },
          "[Payment] Retry on already-paid order — returning idempotent success"
        );
        return res.json({
          success: true,
          already_paid: true,
          order_id: existingOrder.id,
          status: existingOrder.status,
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
          "[Payment] Reusing existing Razorpay order for legacy order retry"
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
          message: "Unable to initialize payment gateway. Please try again.",
        });
      }

      try {
        await api.put(`orders/${existingOrder.id}`, {
          meta_data: [{ key: "_razorpay_order_id", value: rzpOrder.id }],
        });
      } catch (metaErr) {
        logger.warn(
          { wc_order_id: existingOrder.id, razorpay_order_id: rzpOrder.id },
          "[Payment] Notice: Failed to attach Razorpay order ID to existing WooCommerce order"
        );
      }

      return res.json({
        success: true,
        order_id: existingOrder.id,
        razorpay_order_id: rzpOrder.id,
        amount: amountInPaise,
        currency: "INR",
        key_id: getPublicKeyId(),
      });
    }

    // ── 4. New Online Checkout Flow (DEFERRED WC ORDER CREATION) ────────────
    const { billing_address, shipping_address } = req.body;
    if (!billing_address || !shipping_address) {
      return res.status(400).json({
        success: false,
        message: "Billing and shipping addresses are required.",
      });
    }

    // ── 5. Get customer's cart from WooCommerce Store API ──────────────────
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

    // ── 6. Minimum order value check (₹500 on product subtotal) ────────────
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

    // ── 7. Build and validate line items from live cart ─────────────────────
    const lineItems = cart.items.map((item) => {
      const entry = {
        product_id: item.id,
        quantity: item.quantity,
      };
      if (item.variation && Array.isArray(item.variation) && item.variation.length > 0) {
        const variationId = item.variation_id || item.id;
        if (variationId !== item.id) {
          entry.variation_id = variationId;
        }
      }
      return entry;
    });

    const couponLines = Array.isArray(cart.coupons)
      ? cart.coupons.map((c) => ({ code: c.code }))
      : [];

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

    // Authoritative total price directly from WooCommerce cart
    const amountInPaise = Number(cart.totals?.total_price || 0);
    if (amountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid cart total calculated. Please review your cart and try again.",
      });
    }

    const cartFingerprint = computeCartFingerprint(cart);

    // ── 8. Create Razorpay Order ONLY (No WooCommerce order created yet) ───
    const receipt = `rcpt_${userId}_${Date.now()}`;
    let rzpOrder;
    try {
      rzpOrder = await createRazorpayOrder({
        amountInPaise,
        currency: "INR",
        receipt,
        notes: {
          customer_id: String(userId),
          cart_fingerprint: cartFingerprint,
        },
      });
    } catch (rzpErr) {
      logError(req, rzpErr, "[Payment] Razorpay order creation failed");
      return res.status(502).json({
        success: false,
        message: "Unable to initialize payment gateway. Please try again.",
      });
    }

    // ── 9. Store Payment Intent for Post-Payment Finalization ───────────────
    const paymentIntent = {
      rzp_order_id: rzpOrder.id,
      customer_id: Number(userId),
      customer_email: req.wpUserEmail || billing_address.email || "",
      amount_in_paise: amountInPaise,
      currency: "INR",
      cart_fingerprint: cartFingerprint,
      created_at: Date.now(),
      expires_at: Date.now() + 3600 * 1000,
      checkout_payload: {
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
        shipping_lines: shippingLines,
      },
    };

    await paymentIntentService.storePaymentIntent(rzpOrder.id, paymentIntent);

    logger.info(
      { customer_id: userId, razorpay_order_id: rzpOrder.id, amount: amountInPaise },
      "[Payment] Razorpay order created and payment intent stored — 0 WooCommerce orders created before payment"
    );

    return res.status(200).json({
      success: true,
      order_id: null, // Explicitly null: WooCommerce order will be created upon verified payment capture
      razorpay_order_id: rzpOrder.id,
      amount: amountInPaise,
      currency: "INR",
      key_id: getPublicKeyId(),
    });
  } catch (error) {
    logError(req, error, "[Payment] Unhandled error during createOrder");
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while initializing payment. Please try again.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Unified Payment Finalization Logic (Browser & Webhook & Recovery)
// ─────────────────────────────────────────────────────────────────────────────

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

  if ((rzpPayment.currency || "").toUpperCase() !== "INR") {
    return {
      success: false,
      status: 400,
      message: "Payment verification failed: currency mismatch.",
    };
  }

  // 3. Acquire Distributed Atomic Lock for rzpOrderId
  const workerId = `${source}_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const lockAcquired = await paymentIntentService.acquireLock(rzpOrderId, workerId, 4000);
  if (!lockAcquired) {
    // Check if concurrent thread already created the order
    const existing = await findOrderByRazorpayOrderId(rzpOrderId);
    if (existing) {
      return {
        success: true,
        order_id: existing.id,
        status: existing.status,
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
      return {
        success: true,
        order_id: existingOrder.id,
        status: existingOrder.status,
        message: "Payment already verified.",
        _idempotent: true,
      };
    }

    // 5. Retrieve Stored Payment Intent
    const intent = await paymentIntentService.getPaymentIntent(rzpOrderId);
    if (intent && (intent.status === "order_created" || intent.wc_order_id)) {
      logger.info(
        { wc_order_id: intent.wc_order_id, rzpOrderId, source },
        "[Payment Finalize] Intent already in order_created state — returning idempotent success"
      );
      return {
        success: true,
        order_id: Number(intent.wc_order_id),
        status: "processing",
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
            await api.put(`orders/${legacyOrder.id}`, {
              status: "processing",
              transaction_id: rzpPaymentId,
              meta_data: [
                { key: "_razorpay_payment_id", value: rzpPaymentId },
                { key: "_razorpay_order_id", value: rzpOrderId },
                { key: "_payment_verified_at", value: new Date().toISOString() },
              ],
            });
            return {
              success: true,
              order_id: legacyOrder.id,
              status: "processing",
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
      return {
        success: false,
        status: 403,
        message: "You are not authorized to verify this payment.",
      };
    }

    if (rzpPayment.amount !== intent.amount_in_paise) {
      logger.error(
        { expected_amount: intent.amount_in_paise, actual_amount: rzpPayment.amount },
        "[Payment Finalize] Amount mismatch detected"
      );
      return {
        success: false,
        status: 400,
        message: "Payment verification failed: amount mismatch.",
      };
    }

    // 7. Revalidate Store Hours & Operating Constraints
    try {
      const storeStatus = await storeHoursService.getStoreStatus();
      if (storeStatus && storeStatus.is_open === false) {
        logger.warn(
          { rzpOrderId, rzpPaymentId },
          "[Payment Finalize] Store closed during payment capture — proceeding with order creation to avoid stranded capture"
        );
      }
    } catch (_) {}

    // 8. Revalidate Stock for Line Items (Safety Check)
    const lineItems = intent.checkout_payload?.line_items || [];
    let stockValid = true;
    for (const item of lineItems) {
      try {
        const prodRes = await api.get(`products/${item.product_id}`);
        const prod = prodRes.data;
        if (prod && prod.manage_stock && typeof prod.stock_quantity === "number") {
          if (prod.stock_quantity < item.quantity && !prod.backorders_allowed) {
            stockValid = false;
            logger.error(
              { product_id: item.product_id, available: prod.stock_quantity, requested: item.quantity },
              "[Payment Finalize] Stock depleted between checkout initiation and capture"
            );
          }
        }
      } catch (_) {
        // Upstream product check network blip should not strand a captured payment
      }
    }

    if (!stockValid) {
      logger.error(
        { rzpOrderId, rzpPaymentId },
        "[Payment Finalize] Deterministic failure: Stock depleted during payment. Initiating refund."
      );

      // Transition to refund_pending FIRST via compare-and-set
      await updatePaymentIntentStatus({
        rzpOrderId,
        toStatus: "refund_pending",
        rzpPaymentId,
        errorReason: "ITEM_OUT_OF_STOCK",
      });

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
          refundConfirmed = true;
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

        const customerEmail = intent.checkout_payload?.billing?.email;
        const customerName = `${intent.checkout_payload?.billing?.first_name || ""} ${intent.checkout_payload?.billing?.last_name || ""}`.trim();
        if (customerEmail) {
          await sendRefundEmail({
            toEmail: customerEmail,
            toName: customerName,
            amountInInr: (rzpPayment.amount / 100).toFixed(2),
            rzpOrderId,
            refundId,
            reason: "Item out of stock during checkout completion",
          });
        }

        await alertStaffAnomaly({
          type: "AUTO_REFUND_STOCK_DEPLETED",
          severity: "warning",
          rzpOrderId,
          rzpPaymentId,
          message: `Auto-refunded ₹${(rzpPayment.amount / 100).toFixed(2)} due to stock depletion`,
          details: { refund_id: refundId },
        });
      }

      return {
        success: false,
        status: 422,
        code: "ITEM_OUT_OF_STOCK",
        message: "An item in your order went out of stock during payment. Your payment has been refunded automatically.",
        refund_id: refundId,
      };
    }

    // 9. CREATE ONE WOOCOMMERCE ORDER DIRECTLY IN "processing" STATUS
    const wcOrderPayload = {
      ...intent.checkout_payload,
      status: "processing",
      payment_method: "razorpay",
      payment_method_title: "Online Payment",
      set_paid: true,
      transaction_id: rzpPaymentId,
      meta_data: [
        { key: "_razorpay_payment_id", value: rzpPaymentId },
        { key: "_razorpay_order_id", value: rzpOrderId },
        { key: "_payment_verified_at", value: new Date().toISOString() },
        { key: "_payment_method_detail", value: rzpPayment.method || "online" },
        { key: "_cart_fingerprint", value: intent.cart_fingerprint || "" },
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
      return {
        success: true,
        order_id: immediateExisting.id,
        status: immediateExisting.status || "processing",
        message: "Payment already verified.",
        _idempotent: true,
      };
    }

    let createdOrder;
    try {
      const orderResponse = await api.post("orders", wcOrderPayload);
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

    // 10. Post-Creation Cleanup (ONLY after WooCommerce order is securely created)
    await updatePaymentIntentStatus({
      rzpOrderId,
      toStatus: "order_created",
      rzpPaymentId,
      wcOrderId: createdOrder.id,
      capturedAmountPaise: rzpPayment.amount,
    });
    await paymentIntentService.clearCustomerWcCart(intent.customer_id);

    serverCache.invalidatePrefix("employee:overview");
    serverCache.invalidatePrefix("admin:analytics");
    serverCache.invalidatePrefix("admin:customers");
    serverCache.delete("product_stock_counts");

    if (Array.isArray(createdOrder.line_items)) {
      for (const item of createdOrder.line_items) {
        if (item.product_id) {
          serverCache.delete(`catalog:product:${item.product_id}`);
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
      status: "processing",
      message: "Payment verified successfully.",
    };
  } finally {
    // 11. Guarantee Distributed Lock Release
    await paymentIntentService.releaseLock(rzpOrderId);
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

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Missing required payment verification parameters.",
      });
    }

    // ── Handle Legacy Order Verification (if order_id is provided and exists) ──
    if (order_id) {
      let wcOrder;
      try {
        const orderResponse = await api.get(`orders/${encodeURIComponent(order_id)}`);
        wcOrder = orderResponse.data;
      } catch (wcErr) {
        // If not found as legacy order, fall through to deferred finalization
        wcOrder = null;
      }

      if (wcOrder) {
        if (Number(wcOrder.customer_id) !== Number(userId)) {
          return res.status(403).json({
            success: false,
            message: "You are not authorized to verify this payment.",
          });
        }

        if (wcOrder.status === "processing" || wcOrder.status === "completed") {
          return res.json({
            success: true,
            order_id: wcOrder.id,
            status: wcOrder.status,
            message: "Payment already verified.",
            _idempotent: true,
          });
        }

        const isSignatureValid = verifyPaymentSignature({
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
        });

        if (!isSignatureValid) {
          return res.status(400).json({
            success: false,
            message: "Payment verification failed: invalid signature.",
          });
        }

        const rzpPayment = await fetchRazorpayPayment(razorpay_payment_id);
        if (rzpPayment.order_id !== razorpay_order_id || rzpPayment.status !== "captured") {
          return res.status(400).json({
            success: false,
            message: "Payment verification failed.",
          });
        }

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

        serverCache.invalidatePrefix("employee:overview");
        serverCache.invalidatePrefix("admin:analytics");
        serverCache.invalidatePrefix("admin:customers");
        serverCache.delete("product_stock_counts");

        return res.json({
          success: true,
          order_id: wcOrder.id,
          status: "processing",
          message: "Payment verified successfully.",
        });
      }
    }

    // ── Deferred Order Creation Verification ───────────────────────────────
    const result = await finalizePaymentAndCreateOrder({
      rzpOrderId: razorpay_order_id,
      rzpPaymentId: razorpay_payment_id,
      rzpSignature: razorpay_signature,
      expectedCustomerId: userId,
      source: "browser",
      req,
    });

    const statusCode = result.status || (result.success ? 200 : 400);
    return res.status(statusCode).json(result);
  } catch (error) {
    logError(req, error, "[Payment] Unhandled error during verifyPayment");
    return res.status(500).json({
      success: false,
      message: "Payment verification could not be completed. Please try again.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/check-status (Browser Reload / App-Switch Recovery)
// ─────────────────────────────────────────────────────────────────────────────

export const checkPaymentStatus = async (req, res) => {
  try {
    const userId = req.wpUserId;
    const { razorpay_order_id } = req.body;

    if (!razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: "Missing razorpay_order_id.",
      });
    }

    // 1. Check if order was already created
    const existing = await findOrderByRazorpayOrderId(razorpay_order_id);
    if (existing) {
      return res.json({
        success: true,
        order_id: existing.id,
        status: existing.status,
        already_paid: true,
      });
    }

    // 2. Fetch payments from Razorpay
    let paymentsRes;
    try {
      paymentsRes = await fetchRazorpayOrderPayments(razorpay_order_id);
    } catch (err) {
      return res.status(502).json({
        success: false,
        message: "Failed to query payment status from gateway.",
      });
    }

    const items = paymentsRes?.items || [];
    const captured = items.find((p) => p.status === "captured");

    if (captured) {
      const result = await finalizePaymentAndCreateOrder({
        rzpOrderId: razorpay_order_id,
        rzpPaymentId: captured.id,
        expectedCustomerId: userId,
        source: "app_switch_recovery",
        req,
      });
      return res.status(result.status || (result.success ? 200 : 400)).json(result);
    }

    return res.json({
      success: false,
      paid: false,
      message: "Payment not completed or still processing.",
    });
  } catch (error) {
    logError(req, error, "[Payment] Error in checkPaymentStatus");
    return res.status(500).json({
      success: false,
      message: "Unable to check payment status.",
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
    const eventId = req.headers["x-razorpay-event-id"] || req.body?.id || req.body?.event_id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const paymentEntity = req.body?.payload?.payment?.entity;
    const orderEntity = req.body?.payload?.order?.entity;
    const rzpOrderId = paymentEntity?.order_id || orderEntity?.id;
    const rzpPaymentId = paymentEntity?.id;

    // 1. Store raw webhook event durably FIRST in WordPress MySQL
    await storeWebhookEvent({
      eventId,
      eventType: event || "unknown",
      rzpOrderId,
      rzpPaymentId,
      rawPayload: req.body,
    });

    if (eventId) {
      const cacheKey = `webhook:event:${eventId}`;
      if (serverCache.get(cacheKey)) {
        await updateWebhookEventStatus({ eventId, status: "processed" });
        logger.info({ eventId }, "[Payment Webhook] Event already processed — returning idempotent 200");
        return res.status(200).json({
          success: true,
          message: "Event already processed.",
          _idempotent: true,
        });
      }
      serverCache.set(cacheKey, true, 24 * 60 * 60 * 1000);
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

      // Check if this webhook corresponds to an existing WooCommerce order (e.g. order retry or legacy checkout)
      const wcOrderId = paymentEntity?.notes?.wc_order_id || orderEntity?.notes?.wc_order_id;
      if (wcOrderId) {
        let wcOrder;
        try {
          const orderRes = await api.get(`orders/${encodeURIComponent(wcOrderId)}`);
          wcOrder = orderRes.data;
        } catch (fetchErr) {
          logError(req, fetchErr, "[Payment Webhook] Failed to fetch order from WooCommerce");
          return res.status(502).json({
            success: false,
            message: "Failed to communicate with store backend.",
          });
        }

        if (!wcOrder) {
          return res.status(404).json({
            success: false,
            message: "Referenced WooCommerce order not found.",
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

        await updateWebhookEventStatus({ eventId, status: "processed" });

        return res.status(200).json({
          success: true,
          order_id: wcOrder.id,
          status: "processing",
          message: "Order successfully processed via webhook.",
        });
      }

      // Deferred order creation (no wc_order_id before payment)
      const result = await finalizePaymentAndCreateOrder({
        rzpOrderId,
        rzpPaymentId,
        source: "webhook",
        req,
      });

      if (result.success) {
        await updateWebhookEventStatus({ eventId, status: "processed" });
        logger.info({ rzpOrderId, wc_order_id: result.order_id }, "[Payment Webhook] Finalized order successfully via webhook");
        return res.status(200).json({
          success: true,
          order_id: result.order_id,
          message: "Webhook processed successfully.",
        });
      }

      if (result.status === 409 || result._idempotent) {
        await updateWebhookEventStatus({ eventId, status: "processed" });
        return res.status(200).json({
          success: true,
          message: "Order already finalized or in progress.",
        });
      }

      // Unknown intent or unfinalized order: Record orphan record, alert, and return 200 (reconciler handles it)
      logger.warn({ rzpOrderId, rzpPaymentId, result }, "[Payment Webhook] Webhook missing intent or failed order creation — recorded for reconciliation");
      await updateWebhookEventStatus({ eventId, status: "orphan" });
      await updatePaymentIntentStatus({
        rzpOrderId,
        toStatus: "orphan_payment",
        rzpPaymentId,
        errorReason: result?.message || "Missing intent on webhook capture",
      });

      await alertStaffAnomaly({
        type: "ORPHAN_PAYMENT_WEBHOOK",
        severity: "critical",
        rzpOrderId,
        rzpPaymentId,
        message: "Payment captured on Razorpay webhook with unknown/missing intent; recorded for reconciliation",
        details: { result },
      });

      return res.status(200).json({
        success: false,
        message: result.message || "Webhook acknowledged and recorded for reconciliation.",
        recorded_as_orphan: true,
      });
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/reconcile/:id (Admin Reconciliation)
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

    if (wcOrder.status === "processing" || wcOrder.status === "completed") {
      return res.json({
        reconciled: true,
        action: "none",
        message: "Order is already in a completed/processing state.",
        order_status: wcOrder.status,
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
  }
};
