import crypto from "crypto";
import https from "https";
import axios from "axios";
import { logger, sanitizeError } from "./logger.js";
import { serverCache } from "./memoryCache.js";
import { getRedisClient, isRedisActive } from "../config/redis.js";
import { acquirePaymentLease } from "../services/paymentLease.js";
import paymentIntentService, {
  findWcOrderByRazorpayOrderId,
  reserveCheckoutStock,
} from "../services/paymentIntentService.js";

const WP_BASE_URL = (process.env.WORDPRESS_URL || "https://mumbai-collection.local").replace(/\/$/, "");
export const MIN_ORDER_VALUE_INR = 500;

export const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === "production",
});

export const formatPaiseAsRupees = (paise) => (paise / 100).toFixed(2);

export const checkoutScheduleFields = (storeGuard) => ({
  is_after_hours: Boolean(storeGuard.is_after_hours),
  is_next_day_delivery: Boolean(storeGuard.is_next_day_delivery),
  scheduled_delivery_date: storeGuard.scheduled_delivery_date || null,
  scheduled_delivery_label: storeGuard.scheduled_delivery_label || null,
});

export const verifiedPaymentMetadata = (rzpOrderId, rzpPaymentId) => [
  { key: "_razorpay_payment_id", value: rzpPaymentId },
  { key: "_razorpay_order_id", value: rzpOrderId },
  { key: "_payment_verified_at", value: new Date().toISOString() },
];

export const paymentOwnershipFailure = () => ({
  success: false,
  status: 403,
  message: "You are not authorized to verify this payment.",
});

export const sendCartTokenMismatch = (res, message = "Invalid cart session token.") =>
  res.status(403).json({ success: false, code: "CART_TOKEN_MISMATCH", message });

export const sendPaymentOrderNotFound = (res) =>
  res.status(404).json({ success: false, message: "Payment order not found." });

export const sendFinalizationResult = (res, result) => {
  const statusCode = typeof result.status === "number" ? result.status : (result.success ? 200 : 400);
  return res.status(statusCode).json(result);
};

export const customerFrontendOrigin = () =>
  process.env.CUSTOMER_ORIGIN ||
  process.env.CLIENT_ORIGIN ||
  process.env.FRONTEND_URL ||
  "http://localhost:5173";

export const reserveStockForCheckout = async (reservationId, lineItems, { reusingIntent = false } = {}) => {
  try {
    await reserveCheckoutStock({ reservationId, lineItems });
    return null;
  } catch (error) {
    if (error.response?.status === 409) {
      return {
        status: 422,
        code: "ITEM_OUT_OF_STOCK",
        message: reusingIntent
          ? "An item in your cart is no longer available in the requested quantity."
          : "An item in your cart is no longer available in the requested quantity. Please update your cart.",
      };
    }
    logger.error({ err: sanitizeError(error) }, "[Payment] Inventory reservation unavailable; checkout denied");
    return {
      status: 503,
      code: "INVENTORY_UNAVAILABLE",
      message: "We could not confirm inventory. Please try again shortly.",
    };
  }
};

/**
 * Acquires a distributed checkout concurrency lock across servers.
 * Uses Redis distributed mutex (SET NX PX) if Redis is active.
 * If Redis is not active, uses shared database lock (wp_mumbai_locks via acquireLock).
 * Prevents dual checkout creation across multiple server processes.
 */
export const acquireCheckoutConcurrencyLock = async (userId, cartFingerprint, timeoutMs = 3000) => {
  const lease = await acquirePaymentLease("checkout:" + userId + ":" + cartFingerprint, "checkout", timeoutMs);
  return { acquired: Boolean(lease), lease };
};

export const releaseCheckoutConcurrencyLock = async (handle) => handle?.lease?.release();

/**
 * Retrieves the active checkout order ID across servers.
 * Checks Redis first, then serverCache.
 */
export const getActiveCartIntentId = async (userId, cartFingerprint) => {
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
export const setActiveCartIntentId = async (userId, cartFingerprint, rzpOrderId, ttlSeconds = 900) => {
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
export const deleteActiveCartIntentId = async (userId, cartFingerprint) => {
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

/**
 * Reads the customer's live WooCommerce Store API cart using their auth cookie,
 * Cart-Token, and delivery addresses (to calculate accurate shipping and totals).
 */
export const getCustomerCart = async (wpAuthCookie, cartToken = null, addresses = null, nonce = null) => {
  const headers = {};
  if (wpAuthCookie) {
    headers.Cookie = wpAuthCookie;
  }
  if (cartToken) {
    headers["Cart-Token"] = cartToken;
  }
  if (nonce) {
    headers.Nonce = nonce;
  }

  // If shipping/billing address is provided, sync it with Store API to ensure authoritative shipping calculation
  if (addresses?.shipping_address || addresses?.billing_address) {
    try {
      const updateRes = await axios.post(
        `${WP_BASE_URL}/wp-json/wc/store/v1/cart/update-customer`,
        {
          billing_address: addresses.billing_address || addresses.shipping_address,
          shipping_address: addresses.shipping_address || addresses.billing_address,
        },
        {
          headers,
          httpsAgent,
          timeout: 10000,
        }
      );
      if (updateRes.data?.totals) {
        return updateRes.data;
      }
      throw new Error("Invalid response from cart/update-customer");
    } catch (updateErr) {
      logger.error({ err: updateErr.message }, "[Payment] cart/update-customer failed for address pricing");
      const err = new Error("Unable to calculate address-based pricing for delivery. Please retry.");
      err.code = "ADDRESS_PRICING_FAILED";
      err.statusCode = 502;
      throw err;
    }
  }

  const response = await axios.get(
    `${WP_BASE_URL}/wp-json/wc/store/v1/cart`,
    {
      headers,
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
