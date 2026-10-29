import { getRedisClient } from "../config/redis.js";
/**
 * Lightweight, zero-dependency in-memory rate limiter
 * Protects auth and upload routes from brute-force and spam attacks.
 */
import net from "net";

/**
 * Extracts client IP with support for Cloudflare's CF-Connecting-IP header.
 * Validates IP format (IPv4/IPv6) and ensures request is routed via Cloudflare
 * (or test environment), falling back safely to Express req.ip or socket address.
 */
export const getClientIp = (req) => {
  const cfIp = req?.headers?.["cf-connecting-ip"];
  if (typeof cfIp === "string") {
    const trimmed = cfIp.trim();
    if (net.isIP(trimmed)) {
      const isTestEnv = process.env.NODE_ENV === "test";
      const isExplicitlyTrusted = process.env.TRUST_CLOUDFLARE_PROXY === "true";
      // Trust CF-Connecting-IP only when proxy trust is explicitly configured or in test environments
      if (isTestEnv || isExplicitlyTrusted) {
        return trimmed;
      }
    }
  }
  return req?.ip || req?.socket?.remoteAddress || "unknown";
};

export const createRateLimiter = ({
  windowMs = 15 * 60 * 1000, // 15 minutes
  max = 15,                  // max attempts
  message = "Too many requests. Please try again later.",
  keyGenerator,
  maxStoreKeys = 10000,
} = {}) => {
  const requests = new Map();

  const purgeExpired = (now = Date.now()) => {
    for (const [key, data] of requests.entries()) {
      if (now - data.startTime > windowMs) {
        requests.delete(key);
      }
    }
  };

  // Periodic cleanup every 10 minutes to prevent memory growth
  const cleanupTimer = setInterval(() => {
    purgeExpired();
  }, 10 * 60 * 1000);

  if (cleanupTimer && typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }

  const limiter = async (req, res, next) => {
    // In local development or if disabled, pass through — but NEVER in production
    const isProduction = process.env.NODE_ENV === "production";
    if (process.env.DISABLE_RATE_LIMIT === "true") {
      if (isProduction) {
        console.error("[RateLimiter] CRITICAL: DISABLE_RATE_LIMIT=true is ignored in production mode.");
      } else {
        return next();
      }
    }

    let key;
    if (typeof keyGenerator === "function") {
      key = keyGenerator(req);
    }
    if (!key) {
      key = getClientIp(req);
    }

    // Try atomic distributed Redis limiter first if Redis is active
    const redis = getRedisClient();
    if (redis) {
      try {
        const redisKey = `ratelimit:${key}`;
        const count = await redis.incr(redisKey);
        if (count === 1) {
          await redis.pexpire(redisKey, windowMs);
        }
        if (count > max) {
          const ttlMs = await redis.pttl(redisKey);
          const remainingSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
          res.set("Retry-After", String(remainingSeconds));
          return res.status(429).json({
            success: false,
            message: `${message} (${remainingSeconds}s remaining)`,
            retryAfter: remainingSeconds,
          });
        }
        return next();
      } catch (_) {
        // Fall back gracefully to in-memory store
      }
    }

    const now = Date.now();
    const record = requests.get(key);

    if (!record || now - record.startTime > windowMs) {
      if (requests.size >= maxStoreKeys) {
        purgeExpired(now);
        // If still at or over capacity after expired purge, prune oldest 20%
        if (requests.size >= maxStoreKeys) {
          const pruneCount = Math.ceil(maxStoreKeys * 0.2);
          let deleted = 0;
          for (const k of requests.keys()) {
            requests.delete(k);
            deleted += 1;
            if (deleted >= pruneCount) break;
          }
        }
      }
      requests.set(key, { count: 1, startTime: now });
      return next();
    }

    if (record.count >= max) {
      const remainingSeconds = Math.ceil((record.startTime + windowMs - now) / 1000);
      res.set("Retry-After", String(remainingSeconds));

      return res.status(429).json({
        success: false,
        message: `${message} (${remainingSeconds}s remaining)`,
        retryAfter: remainingSeconds,
      });
    }

    record.count += 1;
    next();
  };

  limiter.reset = () => {
    requests.clear();
  };

  limiter.keyGenerator = keyGenerator;

  return limiter;
};

export const ipAuthLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60, // 60 total authentication attempts per 15 minutes per IP across all accounts
  message: "Too many authentication attempts from this IP. Please try again in a few minutes.",
  keyGenerator: (req) => `auth:ip:${getClientIp(req)}`,
});

export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 attempts per 15 minutes per identifier/IP compound
  message: "Too many authentication attempts. Please try again in a few minutes.",
  keyGenerator: (req) => {
    const rawIdentifier =
      req.body?.email ||
      req.body?.phone ||
      req.body?.credential?.slice(-32) ||
      "anon";
    const cleanIdentifier = String(rawIdentifier).trim().toLowerCase().slice(0, 64);
    const ip = getClientIp(req);
    return `auth:${cleanIdentifier}:${ip}`;
  },
});

export const uploadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30, // 30 uploads per 10 minutes per authenticated user (or per IP if unauthenticated)
  message: "Upload rate limit reached. Please wait a few minutes before uploading again.",
  keyGenerator: (req) => {
    const userId = req.user?.id || req.wpUserId;
    if (userId) {
      return `user:${userId}`;
    }
    const ip = getClientIp(req);
    return `ip:${ip}`;
  },
});

export const storeLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // 120 requests per minute per IP
  message: "Too many store requests. Please slow down.",
});

export const catalogLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 300,            // 300 requests per minute per IP (generous for browsing & search autocomplete)
  message: "Too many catalog requests. Please slow down.",
});

export const checkoutLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 15,                 // 15 checkout attempts per 5 minutes per IP/user (allows retries on flaky 4G)
  message: "Too many checkout attempts. Please try again in a few minutes.",
  keyGenerator: (req) => {
    const userId = req.user?.id || req.wpUserId;
    if (userId) {
      return `checkout:user:${userId}`;
    }
    const customerAuth =
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_admin_auth ||
      req.cookies?.mumbai_employee_auth ||
      req.cookies?.mumbai_wp_auth;
    if (customerAuth) {
      return `checkout:cookie:${customerAuth.slice(-32)}`;
    }
    const clientIp = getClientIp(req);
    return `checkout:ip:${clientIp}`;
  },
});

export const statusCheckLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 requests per 1 minute per user/IP
  message: "Too many payment status verification attempts. Please wait a moment.",
  keyGenerator: (req) => {
    const userId = req.user?.id || req.wpUserId;
    if (userId) {
      return `status_check:user:${userId}`;
    }
    const customerAuth =
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_admin_auth ||
      req.cookies?.mumbai_employee_auth ||
      req.cookies?.mumbai_wp_auth;
    if (customerAuth) {
      return `status_check:cookie:${customerAuth.slice(-32)}`;
    }
    const clientIp = getClientIp(req);
    return `status_check:ip:${clientIp}`;
  },
});

export const reviewLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                  // max 5 review submissions per 15 minutes per user/IP
  message: "Too many review submissions. Please wait a few minutes before submitting another review.",
  keyGenerator: (req) => {
    const userId = req.user?.id || req.wpUserId;
    if (userId) {
      return `review:user:${userId}`;
    }
    const customerAuth =
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_admin_auth ||
      req.cookies?.mumbai_employee_auth ||
      req.cookies?.mumbai_wp_auth;
    if (customerAuth) {
      return `review:cookie:${customerAuth.slice(-32)}`;
    }
    const clientIp = getClientIp(req);
    return `review:ip:${clientIp}`;
  },
});

