import { getRedisClient } from "../config/redis.js";
import net from "net";

/**
 * Extracts client IP with support for Cloudflare's CF-Connecting-IP header.
 */
export const getClientIp = (req) => {
  const cfIp = req?.headers?.["cf-connecting-ip"];
  if (typeof cfIp === "string") {
    const trimmed = cfIp.trim();
    if (net.isIP(trimmed)) {
      if (process.env.NODE_ENV === "test" || process.env.TRUST_CLOUDFLARE_PROXY === "true") {
        return trimmed;
      }
    }
  }
  return req?.ip || req?.socket?.remoteAddress || "unknown";
};

const LUA_RATELIMIT = `local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) else local t = redis.call('PTTL', KEYS[1]) if t == -1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end end return c`;

export const createRateLimiter = ({
  windowMs = 15 * 60 * 1000,
  max = 15,
  message = "Too many requests. Please try again later.",
  keyGenerator,
  maxStoreKeys = 10000,
} = {}) => {
  const requests = new Map();

  const purgeExpired = (now = Date.now()) => {
    for (const [key, data] of requests.entries()) {
      if (now - data.startTime > windowMs) requests.delete(key);
    }
  };

  const cleanupTimer = setInterval(purgeExpired, 10 * 60 * 1000);
  if (cleanupTimer?.unref) cleanupTimer.unref();

  const limiter = async (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === "true") {
      if (process.env.NODE_ENV === "production") {
        console.error("[RateLimiter] CRITICAL: DISABLE_RATE_LIMIT=true is ignored in production mode.");
      } else {
        return next();
      }
    }

    const key = (typeof keyGenerator === "function" ? keyGenerator(req) : null) || getClientIp(req);
    const redis = getRedisClient();

    if (redis) {
      try {
        const redisKey = `ratelimit:${key}`;
        const count = Number(await redis.eval(LUA_RATELIMIT, 1, redisKey, windowMs));
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
      } catch (_) {}
    }

    const now = Date.now();
    const record = requests.get(key);

    if (!record || now - record.startTime > windowMs) {
      if (requests.size >= maxStoreKeys) {
        purgeExpired(now);
        if (requests.size >= maxStoreKeys) {
          const pruneCount = Math.ceil(maxStoreKeys * 0.2);
          let deleted = 0;
          for (const k of requests.keys()) {
            requests.delete(k);
            if (++deleted >= pruneCount) break;
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

  limiter.reset = () => requests.clear();
  limiter.keyGenerator = keyGenerator;
  return limiter;
};

const makeScopedKeyGenerator = (prefix) => (req) => {
  const userId = req.user?.id || req.wpUserId;
  if (userId) return `${prefix}:user:${userId}`;
  const authCookie =
    req.cookies?.mumbai_customer_auth ||
    req.cookies?.mumbai_admin_auth ||
    req.cookies?.mumbai_employee_auth ||
    req.cookies?.mumbai_wp_auth;
  if (authCookie) return `${prefix}:cookie:${authCookie.slice(-32)}`;
  return `${prefix}:ip:${getClientIp(req)}`;
};

export const ipAuthLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many authentication attempts from this IP. Please try again in a few minutes.",
  keyGenerator: (req) => `auth:ip:${getClientIp(req)}`,
});

export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many authentication attempts. Please try again in a few minutes.",
  keyGenerator: (req) => {
    const raw = req.body?.email || req.body?.phone || req.body?.credential?.slice(-32) || "anon";
    return `auth:${String(raw).trim().toLowerCase().slice(0, 64)}:${getClientIp(req)}`;
  },
});

const ACCOUNT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const PROGRESSIVE_COOLDOWNS_SEC = [15, 30, 60, 180, 300];

const normalizeAccountKey = (email) =>
  String(email || "").trim().toLowerCase().slice(0, 128);

export const createAccountLoginThrottle = ({
  windowMs = ACCOUNT_LOGIN_WINDOW_MS,
  staffThreshold = 3,
  customerThreshold = 5,
  cooldownScheduleSec = PROGRESSIVE_COOLDOWNS_SEC,
  maxStoreKeys = 10000,
} = {}) => {
  const store = new Map();

  const purgeExpired = (now = Date.now()) => {
    for (const [k, v] of store.entries()) {
      if (now >= v.expiresAt && now >= v.blockedUntil) store.delete(k);
    }
  };

  const cleanupTimer = setInterval(purgeExpired, 10 * 60 * 1000);
  if (cleanupTimer?.unref) cleanupTimer.unref();

  const getRecord = async (key, now) => {
    const redis = getRedisClient();
    if (redis) {
      try {
        const raw = await redis.get(`ratelimit:acct_login:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && (now < parsed.expiresAt || now < parsed.blockedUntil)) {
            return parsed;
          }
        }
        return null;
      } catch (_) {}
    }
    const local = store.get(key);
    if (!local || (now >= local.expiresAt && now >= local.blockedUntil)) {
      store.delete(key);
      return null;
    }
    return local;
  };

  const setRecord = async (key, record, now) => {
    const ttlMs = Math.max(1000, Math.max(record.expiresAt, record.blockedUntil) - now);
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.set(`ratelimit:acct_login:${key}`, JSON.stringify(record), "PX", ttlMs);
        return;
      } catch (_) {}
    }
    if (store.size >= maxStoreKeys) {
      purgeExpired(now);
      if (store.size >= maxStoreKeys) {
        const firstKey = store.keys().next().value;
        if (firstKey) store.delete(firstKey);
      }
    }
    store.set(key, record);
  };

  const middleware = async (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production") {
      return next();
    }
    const key = normalizeAccountKey(req.body?.email);
    if (!key) return next();

    const now = Date.now();
    const record = await getRecord(key, now);
    if (record && record.blockedUntil > now) {
      const remainingSeconds = Math.max(1, Math.ceil((record.blockedUntil - now) / 1000));
      res.set("Retry-After", String(remainingSeconds));
      return res.status(429).json({
        success: false,
        message: `Too many failed sign-in attempts for this account. Please try again in ${remainingSeconds}s.`,
        retryAfter: remainingSeconds,
      });
    }
    return next();
  };

  middleware.recordFailure = async (email, context = "customer") => {
    if (process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production") {
      return { count: 0, cooldownSec: 0 };
    }
    const key = normalizeAccountKey(email);
    if (!key) return { count: 0, cooldownSec: 0 };

    const now = Date.now();
    const existing = await getRecord(key, now);
    const count = existing && now < existing.expiresAt ? existing.count + 1 : 1;
    const isStaff = context === "admin" || context === "employee";
    const threshold = isStaff ? staffThreshold : customerThreshold;

    let cooldownSec = 0;
    if (count >= threshold) {
      const idx = Math.min(count - threshold, cooldownScheduleSec.length - 1);
      cooldownSec = cooldownScheduleSec[idx];
    }

    const record = {
      count,
      expiresAt: now + windowMs,
      blockedUntil: cooldownSec > 0 ? now + cooldownSec * 1000 : 0,
    };
    await setRecord(key, record, now);
    return { count, cooldownSec };
  };

  middleware.recordSuccess = async (email) => {
    const key = normalizeAccountKey(email);
    if (!key) return;
    store.delete(key);
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.del(`ratelimit:acct_login:${key}`);
      } catch (_) {}
    }
  };

  middleware.reset = () => store.clear();
  return middleware;
};

export const accountLoginThrottle = createAccountLoginThrottle();

export const uploadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Upload rate limit reached. Please wait a few minutes before uploading again.",
  keyGenerator: (req) => {
    const userId = req.user?.id || req.wpUserId;
    return userId ? `user:${userId}` : `ip:${getClientIp(req)}`;
  },
});

export const storeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: "Too many store requests. Please slow down.",
});

export const catalogLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: "Too many catalog requests. Please slow down.",
});

export const checkoutLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: "Too many checkout attempts. Please try again in a few minutes.",
  keyGenerator: makeScopedKeyGenerator("checkout"),
});

export const statusCheckLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many payment status verification attempts. Please wait a moment.",
  keyGenerator: makeScopedKeyGenerator("status_check"),
});

export const reviewLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many review submissions. Please wait a few minutes before submitting another review.",
  keyGenerator: makeScopedKeyGenerator("review"),
});
