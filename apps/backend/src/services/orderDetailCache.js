import { getRedisClient, isRedisActive } from "../config/redis.js";
import { serverCache } from "../utils/memoryCache.js";
import { logger } from "../utils/logger.js";

const ORDER_DETAIL_TTL_MS = 20000;
const inFlightRedisReads = new Map();
const cacheGeneration = new Map();

const getOrderCacheKey = (orderId) => `order:detail:${encodeURIComponent(orderId)}`;

/**
 * Cache order details in shared Redis when available. Avoid the process-local
 * L1 cache in that case so a status invalidation from another worker is visible
 * immediately to subsequent reads. Keep the existing local cache as a fallback.
 */
export const getOrderDetail = async (orderId, fetchOrder) => {
  const key = getOrderCacheKey(orderId);
  const redis = getRedisClient();

  if (!redis || !isRedisActive()) {
    return serverCache.getOrFetch(key, fetchOrder, ORDER_DETAIL_TTL_MS);
  }

  try {
    const cached = await redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        await redis.del(key);
      }
    }
  } catch (error) {
    logger.debug({ err: error?.message }, "[Order Cache] Redis read failed; fetching order from WooCommerce");
    return fetchOrder();
  }

  if (inFlightRedisReads.has(key)) return inFlightRedisReads.get(key);

  const generation = cacheGeneration.get(key) || 0;
  const pending = (async () => {
    const order = await fetchOrder();
    if (order && generation === (cacheGeneration.get(key) || 0) && isRedisActive()) {
      try {
        await redis.set(key, JSON.stringify(order), "PX", ORDER_DETAIL_TTL_MS);
      } catch (error) {
        logger.debug({ err: error?.message }, "[Order Cache] Redis write failed");
      }
    }
    return order;
  })();

  inFlightRedisReads.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightRedisReads.get(key) === pending) {
      inFlightRedisReads.delete(key);
    }
    if (!inFlightRedisReads.has(key)) cacheGeneration.delete(key);
  }
};

/** Invalidate both the fallback L1 entry and the shared Redis entry. */
export const invalidateOrderDetailCache = async (orderId) => {
  if (!orderId) return;

  const key = getOrderCacheKey(orderId);
  cacheGeneration.set(key, (cacheGeneration.get(key) || 0) + 1);
  inFlightRedisReads.delete(key);
  serverCache.delete(key);

  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      await redis.del(key);
    } catch (error) {
      logger.warn({ err: error?.message }, "[Order Cache] Redis invalidation failed; entry will expire by TTL");
    }
  }
};
