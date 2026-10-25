/**
 * Idempotency Middleware for Mutation Endpoints (e.g. employee catalog changes)
 *
 * Prevents accidental duplicate creations caused by network retries, connection resets,
 * or concurrent client requests by tracking a unique X-Idempotency-Key. Employee
 * catalog writes use Redis when available and retain the local bounded fallback.
 */

import { createHash, randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import paymentIntentService from "../services/paymentIntentService.js";
import { getRedisClient } from "../config/redis.js";

const idempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL
const MAX_IDEMPOTENCY_STORE_SIZE = 2000;
const MAX_KEY_LENGTH = 128;
const MAX_PROCESSING_TIMEOUT_MS = 30 * 1000; // 30s max processing wait
const CATALOG_IDEMPOTENCY_TTL_MS = 15 * 60 * 1000;
const CATALOG_PROCESSING_TTL_MS = 2 * 60 * 1000;

// Periodic cleanup of expired and abandoned keys
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore.entries()) {
    const isExpired = now - entry.timestamp > IDEMPOTENCY_TTL_MS;
    const isAbandonedProcessing = entry.status === "processing" && (now - entry.timestamp > MAX_PROCESSING_TIMEOUT_MS);
    if (isExpired || isAbandonedProcessing) {
      idempotencyStore.delete(key);
    }
  }
}, 30 * 1000).unref();

export const requireIdempotency = async (req, res, next) => {
  const idempotencyKey =
    req.headers["x-idempotency-key"] ||
    req.headers["idempotency-key"] ||
    req.body?.idempotency_key;

  if (
    !idempotencyKey ||
    typeof idempotencyKey !== "string" ||
    !idempotencyKey.trim() ||
    idempotencyKey.trim().length > MAX_KEY_LENGTH
  ) {
    return next();
  }

  const rawKey = idempotencyKey.trim();
  const verifiedUserId = req.wpUserId || req.user?.id;
  const customerAuth =
    req.cookies?.mumbai_customer_auth ||
    req.cookies?.mumbai_admin_auth ||
    req.cookies?.mumbai_employee_auth ||
    req.cookies?.mumbai_wp_auth;
  const cookieScope = customerAuth ? `cookie:${customerAuth.slice(-32)}` : null;
  const userScope = verifiedUserId ? `user:${verifiedUserId}` : (cookieScope || `ip:${req.ip || "anon"}`);
  const routePath = `${req.baseUrl || ""}${req.path || ""}`;
  const key = `${userScope}:${req.method}:${routePath}:${rawKey}`;
  const isEmployeeCatalogMutation =
    /(?:^|\/)employee\/(?:categories|products)(?:\/|$)/i.test(routePath);
  const redis = isEmployeeCatalogMutation && !idempotencyStore.has(key) ? getRedisClient() : null;
  const redisKey = redis
    ? `idempotency:employee-catalog:${createHash("sha256").update(key).digest("hex")}`
    : null;
  const redisOwner = redis ? randomUUID() : null;

  if (redis) {
    try {
      const sharedRaw = await redis.get(redisKey);
      if (sharedRaw) {
        let shared;
        try {
          shared = JSON.parse(sharedRaw);
        } catch {
          shared = null;
        }
        if (shared?.status === "completed") {
          return res.status(shared.statusCode || 200).json({
            ...(shared.body || {}),
            _idempotent: true,
          });
        }
        return res.status(409).json({
          success: false,
          message: "This catalog change is already being processed. Please wait and retry.",
        });
      }

      const acquired = await redis.set(
        redisKey,
        JSON.stringify({ status: "processing", owner: redisOwner }),
        "PX",
        CATALOG_PROCESSING_TTL_MS,
        "NX"
      );
      if (acquired !== "OK") {
        return res.status(409).json({
          success: false,
          message: "This catalog change is already being processed. Please wait and retry.",
        });
      }
    } catch (redisError) {
      logger.warn({ err: redisError?.message }, "[Idempotency] Shared catalog idempotency unavailable; using process-local protection");
    }
  }

  // Enforce bounded store size before adding
  if (idempotencyStore.size >= MAX_IDEMPOTENCY_STORE_SIZE && !idempotencyStore.has(key)) {
    const oldestKey = idempotencyStore.keys().next().value;
    if (oldestKey) idempotencyStore.delete(oldestKey);
  }

  const cached = idempotencyStore.get(key);

  if (cached) {
    if (cached.status === "completed") {
      const cachedRzpOrderId = cached.body?.razorpay_order_id;
      const isCreateOrderRoute =
        (req.path && req.path.includes("create-order")) ||
        (req.originalUrl && req.originalUrl.includes("create-order"));

      if (cachedRzpOrderId && isCreateOrderRoute) {
        let intent = null;
        try {
          intent = await paymentIntentService.getPaymentIntent(cachedRzpOrderId);
        } catch (intentErr) {
          logger.warn({ rzpOrderId: cachedRzpOrderId, err: intentErr.message }, "[Idempotency] Failed to load intent for cache hit");
        }

        // If intent is missing or status is anything but 'created' (paid, order_created, refund_pending, refunded, failed),
        // discard the cached entry so a fresh Razorpay order is created.
        if (!intent || intent.status !== "created") {
          logger.info(
            { rzpOrderId: cachedRzpOrderId, intentStatus: intent?.status },
            "[Idempotency] Discarding stale create-order cache: intent is missing or no longer in 'created' status"
          );
          idempotencyStore.delete(key);
          // Fall through to proceed with a fresh order creation!
        } else {
          logger.info({ route: req.route?.path || req.path, method: req.method }, "Returning active cached idempotent response");
          return res.status(cached.statusCode).json({
            ...cached.body,
            _idempotent: true,
          });
        }
      } else {
        logger.info({ route: req.route?.path || req.path, method: req.method }, "Returning cached idempotent response");
        return res.status(cached.statusCode).json({
          ...cached.body,
          _idempotent: true,
        });
      }
    }

    if (cached.status === "processing") {
      logger.info({ route: req.route?.path || req.path, method: req.method }, "Concurrent idempotent request detected");
      // Wait for ongoing request to finish
      const checkInterval = setInterval(() => {
        const latest = idempotencyStore.get(key);
        if (!latest || latest.status !== "processing") {
          clearInterval(checkInterval);
          if (latest && latest.status === "completed") {
            return res.status(latest.statusCode).json({
              ...latest.body,
              _idempotent: true,
            });
          }
          return res.status(409).json({
            success: false,
            message: "Request is currently being processed. Please wait.",
          });
        }
      }, 200);

      setTimeout(() => {
        clearInterval(checkInterval);
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            message: "Request processing timed out. Please retry.",
          });
        }
      }, 15000);
      return;
    }
  }

  // Mark key as processing
  idempotencyStore.set(key, {
    status: "processing",
    timestamp: Date.now(),
  });

  const originalJson = res.json.bind(res);
  let capturedStatusCode = 200;

  const originalStatus = res.status.bind(res);
  res.status = function (code) {
    capturedStatusCode = code;
    return originalStatus(code);
  };

  res.json = function (body) {
    if (capturedStatusCode >= 200 && capturedStatusCode < 300) {
      idempotencyStore.set(key, {
        status: "completed",
        statusCode: capturedStatusCode,
        body,
        timestamp: Date.now(),
      });
    } else {
      // Upon legitimate error, release key so user can retry
      idempotencyStore.delete(key);
    }

    if (redis && redisOwner) {
      const script = capturedStatusCode >= 200 && capturedStatusCode < 300
        ? `local current = redis.call('GET', KEYS[1])
           if not current then return 0 end
           local parsed = cjson.decode(current)
           if parsed.owner ~= ARGV[1] then return 0 end
           redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
           return 1`
        : `local current = redis.call('GET', KEYS[1])
           if not current then return 0 end
           local parsed = cjson.decode(current)
           if parsed.owner == ARGV[1] then return redis.call('DEL', KEYS[1]) end
           return 0`;
      const args = capturedStatusCode >= 200 && capturedStatusCode < 300
        ? [
            redisKey,
            redisOwner,
            JSON.stringify({
              status: "completed",
              statusCode: capturedStatusCode,
              body,
            }),
            String(CATALOG_IDEMPOTENCY_TTL_MS),
          ]
        : [redisKey, redisOwner];

      Promise.resolve()
        .then(() => redis.eval(script, 1, ...args.slice(0, 1), ...args.slice(1)))
        .catch((err) => {
          logger.warn({ err: err?.message, routePath }, "[Idempotency] Failed to persist shared catalog idempotency result");
        })
        .finally(() => originalJson(body));
      return res;
    }
    return originalJson(body);
  };

  next();
};

export const _clearIdempotencyStoreForTesting = () => {
  idempotencyStore.clear();
};

export default requireIdempotency;
