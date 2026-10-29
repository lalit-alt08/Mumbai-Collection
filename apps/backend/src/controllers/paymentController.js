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
import { acquirePaymentLease } from "../services/paymentLease.js";
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
  reserveCheckoutStock,
  releaseCheckoutStock,
} from "../services/paymentIntentService.js";
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  fetchRazorpayPayment,
  fetchRazorpayOrder,
  getPublicKeyId,
  verifyWebhookSignature,
  fetchRazorpayOrderPayments,
  refundRazorpayPayment,
  isRefundFullySettled,
} from "../services/razorpayService.js";
import { getRedisClient, isRedisActive } from "../config/redis.js";
import { alertStaffAnomaly } from "../services/alertService.js";
import { publishOrderEvent } from "../services/orderNotificationService.js";
import { invalidateOrderDetailCache } from "../services/orderDetailCache.js";

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

let _finalizePaymentOverrideForTesting = null;
export const _setFinalizeHandlerForTesting = (fn) => {
  _finalizePaymentOverrideForTesting = fn;
};

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Server Distributed Coordination Helpers (Redis & Shared DB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Acquires a distributed checkout concurrency lock across servers.
 * Uses Redis distributed mutex (SET NX PX) if Redis is active.
 * If Redis is not active, uses shared database lock (wp_mumbai_locks via acquireLock).
 * Prevents dual checkout creation across multiple server processes.
 */
const acquireCheckoutConcurrencyLock = async (userId, cartFingerprint, timeoutMs = 3000) => {
  const lease = await acquirePaymentLease('checkout:' + userId + ':' + cartFingerprint, 'checkout', timeoutMs);
  return { acquired: Boolean(lease), lease };
};
const releaseCheckoutConcurrencyLock = async (handle) => handle?.lease?.release();

/**
 * Retrieves the active checkout order ID across servers.
 * Checks Redis first, then serverCache.
 */
const getActiveCartIntentId = async (userId, cartFingerprint) => {
  const cacheKey = `active_cart_intent:${userId}:${cartFingerprint}`;
  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      const rzpOrderId = await redis.get(cacheKey);
      if (rzpOrderId) return rzpOrderId;
    } catch (_) {}
  }
  return await paymentIntentService.findActiveCartIntent(userId, cartFingerprint);
};

/**
 * Sets the active checkout order ID across shared servers.
 */
const setActiveCartIntentId = async (userId, cartFingerprint, rzpOrderId, ttlSeconds = 900) => {
  const cacheKey = `active_cart_intent:${userId}:${cartFingerprint}`;
  serverCache.set(cacheKey, rzpOrderId, ttlSeconds * 1000);
  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      await redis.set(cacheKey, rzpOrderId, "EX", ttlSeconds);
    } catch (_) {}
  }
};

/**
 * Deletes the active checkout order ID across servers.
 */
const deleteActiveCartIntentId = async (userId, cartFingerprint) => {
  if (!userId || !cartFingerprint) return;
  const cacheKey = `active_cart_intent:${userId}:${cartFingerprint}`;
  serverCache.delete(cacheKey);
  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      await redis.del(cacheKey);
    } catch (_) {}
  }
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
  // Lookup failure is not evidence that an order does not exist.
  return paymentIntentService.findWcOrderByRazorpayOrderId(rzpOrderId);
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

    // ── 3. Online Checkout Flow (DEFERRED WC ORDER CREATION) ────────────────
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

    // Acquire shared distributed mutex across servers (Redis / DB)
    const lockHandle = await acquireCheckoutConcurrencyLock(userId, cartFingerprint, 3000);
    if (!lockHandle.acquired) {
      return res.status(409).json({
        success: false,
        code: "CHECKOUT_IN_PROGRESS",
        message: "A checkout request is already being processed for this cart. Please wait a moment.",
      });
    }

    try {
      // 7a. Reuse existing active unpaid payment intent across servers
      const existingRzpOrderId = await getActiveCartIntentId(userId, cartFingerprint);
      if (existingRzpOrderId) {
        const existingIntent = await paymentIntentService.getPaymentIntent(existingRzpOrderId, { fresh: true });
        if (existingIntent && !['created', 'cancelled', 'abandoned', 'refunded'].includes(existingIntent.status)) {
          return res.status(409).json({ success: false, code: 'ORDER_PROCESSING', message: 'A previous payment for this cart is still being resolved. Please check its status before paying again.' });
        }
        if (
          existingIntent &&
          existingIntent.status === "created" &&
          Number(existingIntent.customer_id) === Number(userId) &&
          existingIntent.cart_fingerprint === cartFingerprint &&
          existingIntent.amount_in_paise === amountInPaise &&
          existingIntent.stock_reservation_id &&
          Date.now() - (existingIntent.created_at || 0) < 15 * 60 * 1000
        ) {
          try {
            await reserveCheckoutStock({
              reservationId: existingIntent.stock_reservation_id,
              lineItems,
            });
          } catch (reservationErr) {
            const status = reservationErr.response?.status;
            if (status === 409) {
              return res.status(422).json({
                success: false,
                code: "ITEM_OUT_OF_STOCK",
                message: "An item in your cart is no longer available in the requested quantity.",
              });
            }
            return res.status(503).json({
              success: false,
              code: "INVENTORY_UNAVAILABLE",
              message: "We could not confirm inventory. Please try again shortly.",
            });
          }
          logger.info(
            { customer_id: userId, razorpay_order_id: existingRzpOrderId, cart_fingerprint: cartFingerprint },
            "[Payment] Reusing existing active unpaid payment intent for identical user & cart"
          );
          return res.status(200).json({
            success: true,
            order_id: null,
            razorpay_order_id: existingRzpOrderId,
            amount: existingIntent.amount_in_paise,
            currency: existingIntent.currency || "INR",
            key_id: getPublicKeyId(),
            reused: true,
          });
        }
      }

      // ── 7b. Check live stock for cart lines (Batched Pre-Payment Guard) ────────
      const cartItemIds = [...new Set((cart.items || []).map((item) => Number(item.id)).filter(Boolean))];
      let productsMap = new Map();
      if (cartItemIds.length > 0) {
        try {
          const batchRes = await api.get("products", {
            include: cartItemIds.join(","),
            per_page: Math.min(100, cartItemIds.length),
            _fields: "id,name,manage_stock,stock_quantity,stock_status,backorders_allowed",
          });
          const list = Array.isArray(batchRes?.data) ? batchRes.data : (batchRes?.data ? [batchRes.data] : []);
          for (const p of list) {
            if (p && p.id) productsMap.set(Number(p.id), p);
          }
        } catch (batchErr) {
          logger.warn({ err: batchErr.message }, "[Payment] Notice: Batched pre-checkout stock check upstream error");
        }
      }

      const stockShortages = [];
      const stockShortageDetails = [];
      for (const item of cart.items || []) {
        const prod = productsMap.get(Number(item.id));
        if (prod && typeof prod.manage_stock !== "undefined") {
          const isShort =
            (prod.manage_stock && typeof prod.stock_quantity === "number" && prod.stock_quantity < item.quantity && !prod.backorders_allowed) ||
            (prod.stock_status === "outofstock" && !prod.backorders_allowed);
          if (isShort) {
            const name = item.name || prod.name || `Product #${item.id}`;
            stockShortages.push(name);
            stockShortageDetails.push({
              id: item.id,
              key: item.key,
              name,
              requested: item.quantity,
              available:
                prod.manage_stock && typeof prod.stock_quantity === "number"
                  ? Math.max(0, prod.stock_quantity)
                  : 0,
            });
          }
        }
      }

      if (stockShortages.length > 0) {
        logger.warn(
          { customer_id: userId, stockShortages },
          "[Payment] Order creation blocked: Item(s) out of stock in cart"
        );
        return res.status(422).json({
          success: false,
          code: "ITEM_OUT_OF_STOCK",
          message: `The following item(s) are out of stock or have insufficient quantity: ${stockShortages.join(", ")}. Please update your cart.`,
          out_of_stock_items: stockShortages,
          out_of_stock_details: stockShortageDetails,
        });
      }

      // Reserve stock atomically in WordPress before allowing payment to start.
      // The pre-check above is only for a friendly product-specific response; this
      // transactional reservation is the authoritative concurrency guard.
      const stockReservationId = crypto.randomUUID();
      try {
        await reserveCheckoutStock({ reservationId: stockReservationId, lineItems });
      } catch (reservationErr) {
        if (reservationErr.response?.status === 409) {
          return res.status(422).json({
            success: false,
            code: "ITEM_OUT_OF_STOCK",
            message: "An item in your cart is no longer available in the requested quantity. Please update your cart.",
          });
        }
        logger.error({ err: reservationErr.message }, "[Payment] Inventory reservation unavailable; checkout denied");
        return res.status(503).json({
          success: false,
          code: "INVENTORY_UNAVAILABLE",
          message: "We could not confirm inventory. Please try again shortly.",
        });
      }

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
        await releaseCheckoutStock(stockReservationId);
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
        status: "created",
        stock_reservation_id: stockReservationId,
        cart_fingerprint: cartFingerprint,
        created_at: Date.now(),
        expires_at: Date.now() + 3600 * 1000,
        checkout_payload: {
          stock_reservation_id: stockReservationId,
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

      const storedDurable = await paymentIntentService.storePaymentIntent(rzpOrder.id, paymentIntent);
      if (!storedDurable && process.env.NODE_ENV === "production") {
        await releaseCheckoutStock(stockReservationId);
        logError(req, new Error("Failed to persist payment intent to database"), "[Payment] Payment session persistence failure");
        return res.status(503).json({
          success: false,
          message: "Unable to initialize payment session. Please try again in a moment.",
        });
      }
      await setActiveCartIntentId(userId, cartFingerprint, rzpOrder.id, 15 * 60);

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
    } finally {
      await releaseCheckoutConcurrencyLock(lockHandle);
    }
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
            await api.put(`orders/${legacyOrder.id}`, {
              status: "processing",
              transaction_id: rzpPaymentId,
              meta_data: [
                { key: "_razorpay_payment_id", value: rzpPaymentId },
                { key: "_razorpay_order_id", value: rzpOrderId },
                { key: "_payment_verified_at", value: new Date().toISOString() },
              ],
            });
            await invalidateOrderDetailCache(legacyOrder.id);
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
      return {
        success: false,
        status: 403,
        message: "You are not authorized to verify this payment.",
      };
    }

    const paymentMismatch = Number(rzpPayment.amount) !== Number(intent.amount_in_paise) ||
      String(rzpPayment.currency || '').toUpperCase() !== 'INR';

    // Refund decisions are irreversible for fulfillment, including pending refunds.
    if (["reconciliation_escalated", "test_archived"].includes(intent.status)) {
      return { success: false, status: 200, terminal: true, support_required: true,
        message: "This payment requires staff review. Please do not pay again; contact support with your checkout reference." };
    }
    if (["refund_pending", "refund_failed", "refund_escalated", "refunded", "amount_mismatch"].includes(intent.status)) {
      return { success: false, status: 200, terminal: true, refunded: intent.status === "refunded",
        refund_status: intent.status, message: intent.status === "refunded" ? "Your payment was refunded." : "Your payment requires refund/support review. Please do not pay again." };
    }
    if (Number(rzpPayment.amount_refunded || 0) > 0 || rzpPayment.refund_status) {
      await updatePaymentIntentStatus({ rzpOrderId, fromStatus: intent.status, toStatus: 'refund_escalated',
        rzpPaymentId, errorReason: 'Gateway reports a refund before order creation; staff review required.' });
      return { success: false, status: 200, terminal: true, refunded: false,
        message: 'A refund exists for this payment. Support must review it before the order can be completed.' };
    }

    if (intent.status !== 'paid' || !intent.first_paid_at) {
      const tracked = await updatePaymentIntentStatus({ rzpOrderId, fromStatus: intent.status,
        toStatus: 'paid', rzpPaymentId, capturedAmountPaise: rzpPayment.amount });
      if (!tracked) return { success: false, status: 503, message: 'Payment recovery is being recorded. Please do not pay again.' };
      intent.status = 'paid';
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

    // 8. Renew the durable stock hold before finalization. The successful
    // reservation is authoritative: WooCommerce's REST stock_quantity includes
    // this checkout's own hold and can therefore report 0 when the customer
    // legitimately reserved the last units.
    const lineItems = intent.checkout_payload?.line_items || [];
    let stockValid = true;
    const retryExpired = Boolean(intent.first_paid_at) &&
      Date.now() - Date.parse(String(intent.first_paid_at).replace(' ', 'T') + 'Z') >= 15 * 60 * 1000;
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
          message: `Auto-refunded ₹${(rzpPayment.amount / 100).toFixed(2)} due to stock depletion`,
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
      await releaseCheckoutStock(reservationId);
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
          note: `[AUDIT ALERT] Total Mismatch: Captured Razorpay payment is ₹${(capturedPaise / 100).toFixed(2)}, but WooCommerce order total was calculated as ₹${(wcTotalPaise / 100).toFixed(2)} (difference of ₹${((wcTotalPaise - capturedPaise) / 100).toFixed(2)}). Hold for administrative review.`,
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
        errorReason: `Total mismatch: WooCommerce ₹${(wcTotalPaise / 100).toFixed(2)} vs Paid ₹${(capturedPaise / 100).toFixed(2)}`,
      });

      await alertStaffAnomaly({
        type: "PAYMENT_AMOUNT_MISMATCH",
        severity: "critical",
        rzpOrderId,
        rzpPaymentId,
        wcOrderId: createdOrder.id,
        message: `CRITICAL: Captured payment (₹${(capturedPaise / 100).toFixed(2)}) differs from WooCommerce order total (₹${(wcTotalPaise / 100).toFixed(2)}). Order placed on-hold for review.`,
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

    // Publish minimal real-time event for employee dashboard (fire-and-forget, never throws)
    publishOrderEvent({ event: "ORDER_CREATED", orderId: createdOrder.id });

    serverCache.invalidatePrefix("employee:overview");
    serverCache.invalidatePrefix("admin:analytics");
    serverCache.invalidatePrefix("admin:customers");
    serverCache.delete("product_stock_counts");
    serverCache.invalidatePrefix("catalog:products:");
    if (intent?.customer_id && intent?.cart_fingerprint) {
      await deleteActiveCartIntentId(intent.customer_id, intent.cart_fingerprint);
    }

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
      order_number: createdOrder.number || createdOrder.id,
      orderStatus: "processing",
      message: "Payment verified successfully.",
    };
  } finally {
    // 11. Guarantee Distributed Lock Release
    await lease.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/verify
// ─────────────────────────────────────────────────────────────────────────────

export const verifyPayment = async (req, res) => {
  try {
    const userId = req.wpUserId;
    const {
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

    const finalizeFn = _finalizePaymentOverrideForTesting || finalizePaymentAndCreateOrder;
    const result = await finalizeFn({
      rzpOrderId: razorpay_order_id,
      rzpPaymentId: razorpay_payment_id,
      rzpSignature: razorpay_signature,
      expectedCustomerId: userId,
      source: "browser",
      req,
    });

    const statusCode = typeof result.status === "number" ? result.status : (result.success ? 200 : 400);
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
// POST /api/payments/callback (Server-Side Razorpay Form / App Redirect Callback)
// ─────────────────────────────────────────────────────────────────────────────

export const handlePaymentCallback = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    const frontendOrigin =
      process.env.CUSTOMER_ORIGIN ||
      process.env.CLIENT_ORIGIN ||
      process.env.FRONTEND_URL ||
      "http://localhost:5173";

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      logger.warn({ body: req.body }, "[Payment Callback] Missing parameters in callback request");
      return res.redirect(303, `${frontendOrigin}/cart?payment_error=missing_parameters`);
    }

    const finalizeFn = _finalizePaymentOverrideForTesting || finalizePaymentAndCreateOrder;
    const result = await finalizeFn({
      rzpOrderId: razorpay_order_id,
      rzpPaymentId: razorpay_payment_id,
      rzpSignature: razorpay_signature,
      expectedCustomerId: null,
      source: "callback",
      req,
    });

    if (result.success && result.order_id) {
      // 303 See Other redirect to success page without signature or payment ID in URL
      return res.redirect(303, `${frontendOrigin}/order-success?order=${result.order_id}`);
    }

    logger.warn({ result }, "[Payment Callback] Finalization unsuccessful in callback");
    return res.redirect(303, `${frontendOrigin}/cart?payment_error=verification_failed`);
  } catch (error) {
    logError(req, error, "[Payment Callback] Unexpected error during payment callback");
    const frontendOrigin =
      process.env.CUSTOMER_ORIGIN ||
      process.env.CLIENT_ORIGIN ||
      process.env.FRONTEND_URL ||
      "http://localhost:5173";
    return res.redirect(303, `${frontendOrigin}/cart?payment_error=server_error`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/check-status (Browser Reload / App-Switch Recovery)
// ─────────────────────────────────────────────────────────────────────────────

export const checkPaymentStatus = async (req, res) => {
  try {
    const userId = Number(req.wpUserId || req.user?.id || 0);
    const { razorpay_order_id } = req.body;

    if (!razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: "Missing razorpay_order_id.",
      });
    }

    // 0. Authorization check on stored payment intent (if present)
    const intent = await paymentIntentService.getPaymentIntent(razorpay_order_id, { fresh: true });
    if (intent) {
      const intentCustomerId = Number(intent.customer_id || intent.user_id || 0);
      if (userId && intentCustomerId && intentCustomerId !== userId) {
        return res.status(404).json({
          success: false,
          message: "Payment order not found.",
        });
      }
    }

    // 1. Check if order was already created
    const existing = await findOrderByRazorpayOrderId(razorpay_order_id);
    if (existing) {
      const existingCustomerId = Number(existing.customer_id || 0);
      if (userId && existingCustomerId && existingCustomerId !== userId) {
        return res.status(404).json({
          success: false,
          message: "Payment order not found.",
        });
      }
      return res.json({
        success: true,
        order_id: existing.id,
        orderStatus: existing.status,
        status: existing.status,
        already_paid: true,
      });
    }

    // 1b. Check if payment intent reached a terminal refunded status
    if (intent && ["reconciliation_escalated", "test_archived"].includes(intent.status)) {
      return res.json({ success: false, terminal: true, support_required: true,
        message: "This payment requires staff review. Please do not pay again; contact support with your checkout reference." });
    }
    if (intent && intent.status === "refunded") {
      return res.json({
        success: false,
        paid: false,
        terminal: true,
        refunded: true,
        refund_status: "completed",
        error_reason: intent.error_reason || "ITEM_OUT_OF_STOCK",
        refund_id: intent.refund_id || null,
        message: intent.error_reason === "ITEM_OUT_OF_STOCK"
          ? "An item in your order went out of stock during payment. Your payment was automatically refunded."
          : "Payment was refunded.",
      });
    }

    if (intent && ["refund_pending", "refund_failed", "refund_escalated"].includes(intent.status)) {
      return res.json({
        success: false,
        paid: false,
        terminal: true,
        refunded: false,
        refund_status: "pending",
        error_reason: intent.error_reason || "ITEM_OUT_OF_STOCK",
        refund_id: intent.refund_id || null,
        message: intent.error_reason === "ITEM_OUT_OF_STOCK"
          ? "An item in your order went out of stock during payment. Your refund is being processed and will reflect in 5-7 business days."
          : "Your refund is being processed and will reflect in 5-7 business days.",
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
      const statusCode = typeof result.status === "number" ? result.status : (result.success ? 200 : 400);
      return res.status(statusCode).json(result);
    }

    const processing = items.some(payment => payment.status === 'authorized');
    if (!processing && intent && ['cancelled', 'abandoned'].includes(intent.status)) {
      return res.json({ success: false, terminal: true, cancelled: true, paid: false, message: 'This checkout has no confirmed payment. You can start a new checkout.' });
    }
    const createdAt = typeof intent?.created_at === 'number' ? intent.created_at : Date.parse(String(intent?.created_at || '').replace(' ', 'T') + 'Z');
    if (!processing && intent?.status === 'created' && Date.now() - createdAt >= 15 * 60000) {
      return cancelPaymentOrder(req, res);
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

      // Immediately acknowledge receipt to Razorpay with HTTP 200 (< 50ms)
      // to satisfy Razorpay's 5-second webhook timeout and avoid duplicate retries
      res.status(200).json({
        success: true,
        received: true,
        message: "Webhook received and queued for processing.",
      });

      // Offload order fulfillment to background worker
      setImmediate(async () => {
        try {
          const result = await finalizePaymentAndCreateOrder({
            rzpOrderId,
            rzpPaymentId,
            source: "webhook",
          });

          if (result.success) {
            await updateWebhookEventStatus({ eventId, status: "processed" });
            logger.info({ rzpOrderId, wc_order_id: result.order_id }, "[Payment Webhook] Finalized order successfully via webhook background worker");
            return;
          }

          if (result.status === 409 || result._idempotent) {
            await updateWebhookEventStatus({ eventId, status: "processed" });
            logger.info({ rzpOrderId }, "[Payment Webhook] Order already finalized or in progress");
            return;
          }

          // Unknown intent or unfinalized order: Record orphan record, alert, reconciler handles it
          logger.warn({ rzpOrderId, rzpPaymentId, result }, "[Payment Webhook] Webhook missing intent or failed order creation — recorded for reconciliation");
          await updateWebhookEventStatus({ eventId, status: "orphan" });


          await alertStaffAnomaly({
            type: "ORPHAN_PAYMENT_WEBHOOK",
            severity: "critical",
            rzpOrderId,
            rzpPaymentId,
            message: "Payment captured on Razorpay webhook with unknown/missing intent; recorded for reconciliation",
            details: { result },
          });
        } catch (bgError) {
          logger.error({ err: bgError.message, eventId, rzpOrderId }, "[Payment Webhook] Unhandled error during background webhook processing");
          await updateWebhookEventStatus({ eventId, status: "failed" });
        }
      });

      return;
    }

    if (event === "refund.processed" || event === "refund.failed") {
      const refundEntity = req.body?.payload?.refund?.entity;
      const paymentEntity = req.body?.payload?.payment?.entity;
      const rzpPaymentId = refundEntity?.payment_id || paymentEntity?.id;
      let rzpOrderId = paymentEntity?.order_id || refundEntity?.notes?.rzp_order_id;

      // Fast ACK to gateway (< 50ms)
      res.status(200).json({
        success: true,
        received: true,
        message: `Refund ${event} webhook received and queued for processing.`,
      });

      setImmediate(async () => {
        let refundLease;
        try {
          const payment = await fetchRazorpayPayment(rzpPaymentId);
          rzpOrderId = payment.order_id || rzpOrderId;
          if (!rzpOrderId) throw new Error('Refund payment has no order ID');
          refundLease = await acquirePaymentLease(rzpOrderId, 'refund-event');
          if (!refundLease) throw new Error('Payment refund is already being processed');
          const intent = await paymentIntentService.getPaymentIntent(rzpOrderId, { fresh: true });
          if (!intent) throw new Error('Refund intent missing; requires staff review');
          const full = payment.refund_status === 'full' || Number(payment.amount_refunded || 0) >= Number(payment.amount || Infinity);
          if (full) {
            await updatePaymentIntentStatus({ rzpOrderId, fromStatus: intent.status, toStatus: 'refunded', refundId: refundEntity?.id });
            await releaseCheckoutStock(intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id || rzpOrderId);
          } else {
            // Partial/manual refunds do not authorize refunding the remaining purchase.
            await alertStaffAnomaly({ type: 'PARTIAL_OR_FAILED_REFUND', severity: 'warning', rzpOrderId, rzpPaymentId,
              message: 'Refund event observed; existing refund recovery state preserved.', details: { event, amount_refunded: payment.amount_refunded } });
          }
          await updateWebhookEventStatus({ eventId, status: 'processed' });
        } catch (err) {
          logger.error({ err: err.message, eventId, rzpOrderId }, '[Payment Webhook] Refund event requires retry/review');
          serverCache.delete('webhook:event:' + eventId);
          await updateWebhookEventStatus({ eventId, status: 'orphan' });
        } finally { await refundLease?.release(); }
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
      serverCache.invalidatePrefix("catalog:products:");

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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/cancel (Customer Dismisses Checkout / Explicit Cancel)
// ─────────────────────────────────────────────────────────────────────────────

export const cancelPaymentOrder = async (req, res) => {
  let lease;
  try {
    const { razorpay_order_id } = req.body;
    if (!razorpay_order_id) {
      return res.status(400).json({ success: false, message: "razorpay_order_id is required." });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required to cancel checkout session.",
      });
    }

    lease = await acquirePaymentLease(razorpay_order_id, "cancel");
    if (!lease) return res.status(409).json({ success: false, message: "Payment processing is in progress. Please check its status." });
    const intent = await paymentIntentService.getPaymentIntent(razorpay_order_id, { fresh: true });
    if (!intent) {
      return res.status(404).json({ success: false, message: "Checkout intent not found. Please check payment status." });
    }

    // 1. Authorize: Intent must belong to the requesting authenticated customer
    if (intent.customer_id && Number(intent.customer_id) !== Number(userId)) {
      logger.warn(
        { rzpOrderId: razorpay_order_id, requestingUser: userId, intentCustomer: intent.customer_id },
        "[Payment Cancel] Unauthorized cancellation attempt: user does not own payment intent"
      );
      return res.status(403).json({
        success: false,
        message: "You are not authorized to cancel this checkout session.",
      });
    }

    // 2. State Guard: Cannot cancel a payment that is already completed or processing
    if (["reconciliation_escalated", "test_archived"].includes(intent.status)) {
      return res.status(409).json({ success: false, code: "PAYMENT_REVIEW_REQUIRED",
        message: "This checkout requires staff review and cannot be cancelled automatically." });
    }
    if (intent.status === "paid" || intent.status === "order_created") {
      logger.warn(
        { rzpOrderId: razorpay_order_id, status: intent.status },
        "[Payment Cancel] Rejection: attempt to cancel an already finalized or paid intent"
      );
      return res.status(409).json({
        success: false,
        code: "CHECKOUT_ALREADY_PAID",
        message: "Cannot cancel a checkout session that has already been paid or completed.",
      });
    }

    // 3. Upstream Gateway Guard: Confirm payment hasn't already been captured on Razorpay
    try {
      const rzpOrder = await fetchRazorpayOrder(razorpay_order_id);
      if (rzpOrder && (rzpOrder.status === "paid" || (rzpOrder.amount_paid && rzpOrder.amount_paid > 0))) {
        logger.warn(
          { rzpOrderId: razorpay_order_id, rzpStatus: rzpOrder.status, amount_paid: rzpOrder.amount_paid },
          "[Payment Cancel] Upstream Razorpay order already marked paid/captured. Refusing cancellation and stock release."
        );
        return res.status(409).json({
          success: false,
          code: "PAYMENT_ALREADY_CAPTURED",
          message: "Payment has already been processed by the gateway. This session cannot be cancelled.",
        });
      }
      const payments = await fetchRazorpayOrderPayments(razorpay_order_id);
      if ((payments.items || []).some(payment => ['authorized', 'captured'].includes(payment.status))) {
        return res.status(409).json({ success: false, message: 'A payment is processing. Please check status before paying again.' });
      }
    } catch (rzpErr) {
      logger.warn({ rzpOrderId: razorpay_order_id, err: rzpErr.message }, "[Payment Cancel] Gateway unavailable; retaining payment recovery");
      return res.status(503).json({ success: false, message: "Payment status is uncertain. Please check again; do not pay again yet." });
    }

    // 4. Safe Cancellation & Stock Release
    if (intent.status === "created") {
      const cancelled = await updatePaymentIntentStatus({ rzpOrderId: razorpay_order_id, fromStatus: "created", toStatus: "cancelled", errorReason: "Customer dismissed checkout; late captures remain recoverable." });
      if (!cancelled) return res.status(409).json({ success: false, message: "Payment state changed. Please check status." });
      const reservationId = intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id;
      if (reservationId) {
        await (paymentIntentService.releaseCheckoutStock || releaseCheckoutStock)(reservationId);
      }



      if (intent.customer_id && intent.cart_fingerprint) {
        await deleteActiveCartIntentId(intent.customer_id, intent.cart_fingerprint);
      }
    }

    return res.status(200).json({
      success: true,
      cancelled: intent.status === 'created',
      terminal: intent.status === 'created',
      message: "Checkout session cancelled and reserved stock released.",
    });
  } catch (err) {
    logError(req, err, "[Payment Cancel] Error cancelling payment intent");
    return res.status(500).json({ success: false, message: "Failed to cancel checkout session." });
  } finally {
    await lease?.release();
  }
};

