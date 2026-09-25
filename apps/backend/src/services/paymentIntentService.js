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

/**
 * Updates status of a payment intent using compare-and-set in WordPress MySQL.
 */
export const updatePaymentIntentStatus = async ({
  rzpOrderId,
  fromStatus,
  toStatus,
  rzpPaymentId = null,
  wcOrderId = null,
  refundId = null,
  errorReason = null,
  capturedAmountPaise = null,
  incrementAttempts = false,
}) => {
  if (!rzpOrderId || !toStatus) return false;

  const cacheKey = `payment_intent:${rzpOrderId}`;
  const inMemory = serverCache.get(cacheKey);
  if (inMemory) {
    serverCache.set(
      cacheKey,
      {
        ...inMemory,
        status: toStatus,
        ...(rzpPaymentId && { rzp_payment_id: rzpPaymentId }),
        ...(wcOrderId && { wc_order_id: wcOrderId }),
        ...(refundId && { refund_id: refundId }),
        error_reason: toStatus === "order_created" ? null : (errorReason ?? inMemory.error_reason),
        ...(capturedAmountPaise && { captured_amount_paise: capturedAmountPaise }),
      },
      3600 * 1000
    );
  }

  try {
    const res = await wpClient.post("/wp-json/mumbai-auth/v1/payment-intent/update-status", {
      rzp_order_id: rzpOrderId,
      from_status: fromStatus,
      to_status: toStatus,
      rzp_payment_id: rzpPaymentId,
      wc_order_id: wcOrderId,
      refund_id: refundId,
      error_reason: errorReason,
      captured_amount_paise: capturedAmountPaise,
      increment_attempts: incrementAttempts,
    });
    return res.data?.updated === true;
  } catch (err) {
    logger.warn(
      { rzpOrderId, fromStatus, toStatus, err: err.message },
      "[PaymentIntentService] Failed to update payment intent status"
    );
    return false;
  }
};

/**
 * Stores raw webhook event durably in WordPress MySQL.
 */
export const storeWebhookEvent = async ({
  eventId,
  eventType,
  rzpOrderId = null,
  rzpPaymentId = null,
  rawPayload,
}) => {
  if (!eventId || !eventType) return false;

  try {
    const res = await wpClient.post("/wp-json/mumbai-auth/v1/webhook-event/store", {
      event_id: eventId,
      event_type: eventType,
      rzp_order_id: rzpOrderId,
      rzp_payment_id: rzpPaymentId,
      raw_payload: rawPayload,
    });
    return res.data?.success === true;
  } catch (err) {
    logger.error(
      { eventId, eventType, err: err.message },
      "[PaymentIntentService] Critical error storing raw webhook event"
    );
    return false;
  }
};

/**
 * Fetches intents needing reconciliation from WordPress with pagination and watermark support.
 */
export const fetchReconciliationList = async ({ limit = 50, page = 1, olderThanMinutes = 2, watermark = "" } = {}) => {
  try {
    const res = await wpClient.post("/wp-json/mumbai-auth/v1/payment-intent/reconciliation-list", {
      limit,
      page,
      older_than_minutes: olderThanMinutes,
      watermark,
    });
    return {
      intents: Array.isArray(res.data?.intents) ? res.data.intents : [],
      page: res.data?.page || page,
      limit: res.data?.limit || limit,
      hasMore: Boolean(res.data?.has_more),
    };
  } catch (err) {
    logger.warn(
      { err: err.message },
      "[PaymentIntentService] Failed to fetch reconciliation list"
    );
    return { intents: [], page, limit, hasMore: false };
  }
};

/**
 * Retrieves persistent reconciliation watermark from WordPress options.
 */
export const getReconciliationWatermark = async () => {
  try {
    const res = await wpClient.get("/wp-json/mumbai-auth/v1/reconciliation/watermark");
    return res.data?.watermark || "";
  } catch (err) {
    logger.warn({ err: err.message }, "[PaymentIntentService] Failed to get reconciliation watermark");
    return "";
  }
};

/**
 * Persists reconciliation watermark to WordPress options.
 */
export const setReconciliationWatermark = async (watermark) => {
  try {
    const res = await wpClient.post("/wp-json/mumbai-auth/v1/reconciliation/watermark", {
      watermark,
    });
    return res.data?.watermark || watermark;
  } catch (err) {
    logger.warn({ err: err.message }, "[PaymentIntentService] Failed to set reconciliation watermark");
    return watermark;
  }
};

/**
 * Updates status of a stored webhook event (e.g. processed, orphan, failed).
 */
export const updateWebhookEventStatus = async ({ eventId, status }) => {
  if (!eventId || !status) return false;

  try {
    const res = await wpClient.post("/wp-json/mumbai-auth/v1/webhook-event/update-status", {
      event_id: eventId,
      status,
    });
    return res.data?.updated === true;
  } catch (err) {
    logger.warn(
      { eventId, status, err: err.message },
      "[PaymentIntentService] Failed to update webhook event status"
    );
    return false;
  }
};

/**
 * Fetches list and count of orphan webhook events.
 */
export const fetchOrphanWebhookEvents = async ({ limit = 50, page = 1 } = {}) => {
  try {
    const res = await wpClient.get("/wp-json/mumbai-auth/v1/webhook-events/orphans", {
      params: { limit, page },
    });
    return {
      count: res.data?.count || 0,
      orphans: Array.isArray(res.data?.orphans) ? res.data.orphans : [],
      page: res.data?.page || page,
      limit: res.data?.limit || limit,
    };
  } catch (err) {
    logger.warn(
      { err: err.message },
      "[PaymentIntentService] Failed to fetch orphan webhook events"
    );
    return { count: 0, orphans: [], page, limit };
  }
};

/**
 * Authoritative HPOS-safe lookup for WooCommerce order by _razorpay_order_id.
 */
export const findWcOrderByRazorpayOrderId = async (rzpOrderId) => {
  if (!rzpOrderId) return null;
  try {
    const res = await wpClient.get("/wp-json/mumbai-auth/v1/orders/by-razorpay-order-id", {
      params: { rzp_order_id: rzpOrderId },
    });
    return res.data?.order || null;
  } catch (err) {
    logger.warn(
      { rzpOrderId, err: err.message },
      "[PaymentIntentService] HPOS order lookup failed"
    );
    return null;
  }
};

export default {
  storePaymentIntent,
  getPaymentIntent,
  deletePaymentIntent,
  acquireLock,
  releaseLock,
  clearCustomerWcCart,
  updatePaymentIntentStatus,
  storeWebhookEvent,
  updateWebhookEventStatus,
  fetchOrphanWebhookEvents,
  findWcOrderByRazorpayOrderId,
  fetchReconciliationList,
  getReconciliationWatermark,
  setReconciliationWatermark,
};

