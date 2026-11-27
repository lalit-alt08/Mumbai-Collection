import { getRedisClient } from "../config/redis.js";
import { resolveContext } from "../utils/authCookieUtils.js";
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
  name = "generic",
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

    const baseKey = (typeof keyGenerator === "function" ? keyGenerator(req) : null) || getClientIp(req);
    const key = name ? `${name}:${baseKey}` : baseKey;
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
    const cred = typeof req.body?.credential === "string" ? req.body.credential.slice(-32) : undefined;
    const raw = req.body?.email || req.body?.phone || cred || "anon";
    const safeRaw = typeof raw === "string" || typeof raw === "number" ? String(raw) : "anon";
    return `auth:${safeRaw.trim().toLowerCase().slice(0, 64)}:${getClientIp(req)}`;
  },
});

const ACCOUNT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const PROGRESSIVE_COOLDOWNS_SEC = [15, 30, 60, 180, 300];
const VALID_AUTH_CONTEXTS = ["customer", "admin", "employee"];

const normalizeAccountKey = (email) =>
  String(email || "").trim().toLowerCase().slice(0, 128);

const normalizeAuthContext = (context) => {
  const normalized = String(context || "").trim().toLowerCase();
  return VALID_AUTH_CONTEXTS.includes(normalized) ? normalized : "customer";
};

const LUA_ACCOUNT_LOGIN_FAILURE = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local threshold = tonumber(ARGV[3])
local scheduleRaw = ARGV[4]
local cur = redis.call('GET', key)
local count = 1
local expiresAt = now + windowMs
if cur then
  local c, e = string.match(cur, '^(%d+)|(%d+)|')
  c = tonumber(c)
  e = tonumber(e)
  if c and e and now < e then
    count = c + 1
    expiresAt = e
  end
end
local cooldownSec = 0
if count >= threshold then
  local targetIdx = count - threshold + 1
  local i = 0
  for s in string.gmatch(scheduleRaw, '%d+') do
    i = i + 1
    cooldownSec = tonumber(s)
    if i >= targetIdx then break end
  end
end
local blockedUntil = cooldownSec > 0 and (now + cooldownSec * 1000) or 0
local maxEnd = math.max(expiresAt, blockedUntil)
local ttlMs = math.max(1000, maxEnd - now)
local packed = count .. '|' .. expiresAt .. '|' .. blockedUntil
redis.call('SET', key, packed, 'PX', ttlMs)
return { count, cooldownSec, blockedUntil }
`;

const parseAccountLoginRecord = (raw, now) => {
  if (!raw) return null;
  if (typeof raw === "string") {
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && (now < parsed.expiresAt || now < parsed.blockedUntil)) {
          return parsed;
        }
      } catch (_) {}
      return null;
    }
    const parts = raw.split("|");
    if (parts.length >= 3) {
      const count = Number(parts[0]);
      const expiresAt = Number(parts[1]);
      const blockedUntil = Number(parts[2]);
      if (
        Number.isFinite(count) &&
        Number.isFinite(expiresAt) &&
        Number.isFinite(blockedUntil) &&
        (now < expiresAt || now < blockedUntil)
      ) {
        return { count, expiresAt, blockedUntil };
      }
    }
  }
  return null;
};

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

  const buildScopedKey = (context, email) => `${normalizeAuthContext(context)}:${email}`;

  const getRecord = async (scopedKey, now) => {
    const redis = getRedisClient();
    if (redis) {
      try {
        const raw = await redis.get(`ratelimit:acct_login:${scopedKey}`);
        return parseAccountLoginRecord(raw, now);
      } catch (_) {}
    }
    const local = store.get(scopedKey);
    if (!local || (now >= local.expiresAt && now >= local.blockedUntil)) {
      store.delete(scopedKey);
      return null;
    }
    return local;
  };

  const middleware = async (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production") {
      return next();
    }
    const key = normalizeAccountKey(req.body?.email);
    if (!key) return next();

    const now = Date.now();
    const scopedKey = buildScopedKey(resolveContext(req), key);
    const record = await getRecord(scopedKey, now);
    const blockedUntil = record?.blockedUntil ?? 0;
    if (blockedUntil > now) {
      const remainingSeconds = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
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
    const normalizedEmail = normalizeAccountKey(email);
    if (!normalizedEmail) return { count: 0, cooldownSec: 0 };

    const normalizedContext = normalizeAuthContext(context);
    const scopedKey = buildScopedKey(normalizedContext, normalizedEmail);
    const isStaff = normalizedContext === "admin" || normalizedContext === "employee";
    const threshold = isStaff ? staffThreshold : customerThreshold;
    const now = Date.now();

    const redis = getRedisClient();
    if (redis) {
      try {
        const result = await redis.eval(
          LUA_ACCOUNT_LOGIN_FAILURE,
          1,
          `ratelimit:acct_login:${scopedKey}`,
          now,
          windowMs,
          threshold,
          cooldownScheduleSec.join(",")
        );
        if (Array.isArray(result) && result.length >= 2) {
          return {
            count: Number(result[0]) || 1,
            cooldownSec: Number(result[1]) || 0,
          };
        }
      } catch (_) {}
    }

    const existing = store.get(scopedKey);
    const activeExisting =
      existing && (now < existing.expiresAt || now < existing.blockedUntil)
        ? existing
        : null;
    const count = activeExisting && now < activeExisting.expiresAt ? activeExisting.count + 1 : 1;

    let cooldownSec = 0;
    if (count >= threshold) {
      const idx = Math.min(count - threshold, cooldownScheduleSec.length - 1);
      cooldownSec = cooldownScheduleSec[idx];
    }

    const record = {
      count,
      expiresAt: activeExisting && now < activeExisting.expiresAt ? activeExisting.expiresAt : now + windowMs,
      blockedUntil: cooldownSec > 0 ? now + cooldownSec * 1000 : 0,
    };

    if (store.size >= maxStoreKeys) {
      purgeExpired(now);
      if (store.size >= maxStoreKeys) {
        const firstKey = store.keys().next().value;
        if (firstKey) store.delete(firstKey);
      }
    }
    store.set(scopedKey, record);
    return { count, cooldownSec };
  };

  middleware.recordSuccess = async (email, context = null) => {
    const normalizedEmail = normalizeAccountKey(email);
    if (!normalizedEmail) return;
    const contexts = context ? [normalizeAuthContext(context)] : VALID_AUTH_CONTEXTS;
    const redis = getRedisClient();
    for (const ctx of contexts) {
      const scopedKey = buildScopedKey(ctx, normalizedEmail);
      store.delete(scopedKey);
      if (redis) {
        try {
          await redis.del(`ratelimit:acct_login:${scopedKey}`);
        } catch (_) {}
      }
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
  name: "store",
  windowMs: 60 * 1000,
  max: 120,
  message: "Too many store requests. Please slow down.",
});

export const catalogLimiter = createRateLimiter({
  name: "catalog",
  windowMs: 60 * 1000,
  max: 300,
  message: "Too many catalog requests. Please slow down.",
});

export const checkoutIpLimiter = createRateLimiter({
  name: "checkout_ip",
  windowMs: 60 * 1000,
  max: 120,
  message: "Too many checkout requests from this IP. Please wait a moment.",
  keyGenerator: (req) => getClientIp(req),
});

export const checkoutLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: "Too many checkout attempts. Please try again in a few minutes.",
  keyGenerator: makeScopedKeyGenerator("checkout"),
});

export const paymentRecoveryIpLimiter = createRateLimiter({
  name: "payment_recovery_ip",
  windowMs: 60 * 1000,
  max: 120,
  message: "Too many payment verification requests from this IP. Please wait a moment.",
  keyGenerator: (req) => getClientIp(req),
});

export const paymentCallbackLimiter = createRateLimiter({
  name: "payment_callback",
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many payment callback attempts. Please wait a moment.",
  keyGenerator: (req) => getClientIp(req),
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
