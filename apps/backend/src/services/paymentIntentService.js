import axios from "axios";
import https from "https";
import { serverCache } from "../utils/memoryCache.js";
import { logger } from "../utils/logger.js";

const WP_BASE_URL = (process.env.WORDPRESS_URL || "http://localhost:8080").replace(/\/$/, "");
const INTERNAL_KEY = process.env.MUMBAI_INTERNAL_API_KEY || "";

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === "production",
});

const wpClient = axios.create({
  baseURL: WP_BASE_URL,
  headers: {
    "X-Mumbai-Internal-Key": INTERNAL_KEY,
    "Content-Type": "application/json",
  },
  httpsAgent,
  timeout: 8000,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stores payment intent in both fast local serverCache and persistent WordPress transients.
 */
export const storePaymentIntent = async (rzpOrderId, intent, expiresInSeconds = 3600) => {
  if (!rzpOrderId || !intent) return false;

  const cacheKey = `payment_intent:${rzpOrderId}`;
  serverCache.set(cacheKey, intent, expiresInSeconds * 1000);

  try {
    await wpClient.post("/wp-json/mumbai-auth/v1/payment-intent/store", {
      rzp_order_id: rzpOrderId,
      payload: intent,
      expires_in: expiresInSeconds,
    });
    return true;
  } catch (err) {
    logger.warn(
      { rzpOrderId, err: err.message },
      "[PaymentIntentService] Failed to persist intent to WordPress transient (in-memory cached)"
    );
    return false;
  }
};

/**
 * Retrieves payment intent by Razorpay order ID (checking memory first, then WordPress transient).
 */
export const getPaymentIntent = async (rzpOrderId) => {
  if (!rzpOrderId) return null;

  const cacheKey = `payment_intent:${rzpOrderId}`;
  const inMemory = serverCache.get(cacheKey);
  if (inMemory) {
    return inMemory;
  }

  try {
    const res = await wpClient.post("/wp-json/mumbai-auth/v1/payment-intent/get", {
      rzp_order_id: rzpOrderId,
    });
    const intent = res.data?.intent || null;
    if (intent) {
      serverCache.set(cacheKey, intent, 3600 * 1000);
    }
    return intent;
  } catch (err) {
    logger.warn(
      { rzpOrderId, err: err.message },
      "[PaymentIntentService] Upstream error retrieving intent from WordPress"
    );
    return null;
  }
};

/**
 * Deletes payment intent after WooCommerce order creation succeeds.
 */
export const deletePaymentIntent = async (rzpOrderId) => {
  if (!rzpOrderId) return false;

  const cacheKey = `payment_intent:${rzpOrderId}`;
  serverCache.delete(cacheKey);

  try {
    await wpClient.post("/wp-json/mumbai-auth/v1/payment-intent/delete", {
      rzp_order_id: rzpOrderId,
    });
    return true;
  } catch (err) {
    logger.warn(
      { rzpOrderId, err: err.message },
      "[PaymentIntentService] Failed to delete intent from WordPress"
    );
    return false;
  }
};

/**
 * Acquires a distributed atomic lock for the given Razorpay order ID using WordPress options table.
 * Supports stale lock self-healing (> 30 seconds) and retry polling.
 */
export const acquireLock = async (rzpOrderId, workerId, maxWaitMs = 4000) => {
  if (!rzpOrderId) return false;

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await wpClient.post("/wp-json/mumbai-auth/v1/payment-intent/lock", {
        rzp_order_id: rzpOrderId,
        worker_id: workerId || `worker_${process.pid}`,
      });
      if (res.data?.acquired === true) {
        return true;
      }
    } catch (err) {
      logger.warn(
        { rzpOrderId, err: err.message },
        "[PaymentIntentService] Lock check encountered upstream network warning"
      );
    }

    // Wait 150ms before retrying
    await sleep(150);
  }

  logger.warn(
    { rzpOrderId, maxWaitMs },
    "[PaymentIntentService] Timed out waiting to acquire lock"
  );
  return false;
};

/**
 * Releases the distributed atomic lock.
 */
export const releaseLock = async (rzpOrderId) => {
  if (!rzpOrderId) return false;

  try {
    await wpClient.post("/wp-json/mumbai-auth/v1/payment-intent/unlock", {
      rzp_order_id: rzpOrderId,
    });
    return true;
  } catch (err) {
    logger.warn(
      { rzpOrderId, err: err.message },
      "[PaymentIntentService] Failed to release lock in WordPress"
    );
    return false;
  }
};

/**
 * Clears the customer's WooCommerce session cart after order finalization.
 */
export const clearCustomerWcCart = async (userId) => {
  if (!userId) return false;

  try {
    await wpClient.post("/wp-json/mumbai-auth/v1/cart/clear", {
      user_id: Number(userId),
    });
    return true;
  } catch (err) {
    logger.warn(
      { userId, err: err.message },
      "[PaymentIntentService] Failed to clear customer session cart"
    );
    return false;
  }
};

export default {
  storePaymentIntent,
  getPaymentIntent,
  deletePaymentIntent,
  acquireLock,
  releaseLock,
  clearCustomerWcCart,
};
