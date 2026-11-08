import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { logError, logger } from "../utils/logger.js";
import { getRedisClient, getRedisSubscriber } from "../config/redis.js";

export const COOKIE_NAMES = {
  customer: {
    auth: "mumbai_customer_auth",
    nonce: "mumbai_customer_nonce",
  },
  admin: {
    auth: "mumbai_admin_auth",
    nonce: "mumbai_admin_nonce",
  },
  employee: {
    auth: "mumbai_employee_auth",
    nonce: "mumbai_employee_nonce",
  },
};

const PRIVILEGED_ROLES = new Set(["administrator", "employee", "shop_manager"]);

/**
 * Cookie names isolate browser storage, but they are not an authorization
 * boundary by themselves. Always bind the validated WordPress roles to the
 * server-selected panel context before accepting a session.
 */
export const rolesMatchAuthContext = (context, roles = []) => {
  const normalizedRoles = Array.isArray(roles) ? roles : [];

  if (context === "admin") {
    return normalizedRoles.includes("administrator");
  }

  if (context === "employee") {
    return normalizedRoles.some((role) => PRIVILEGED_ROLES.has(role));
  }

  const hasPrivilegedRole = normalizedRoles.some((role) => PRIVILEGED_ROLES.has(role));
  if (hasPrivilegedRole) {
    return false;
  }

  return true;
};

// 60-second session cache to eliminate double-hop latency
const sessionCache = new Map();
const SESSION_CACHE_TTL = 60 * 1000; // 60 seconds
const SESSION_CACHE_MAX_SIZE = 5000; // Hard memory cap to prevent unbounded growth

/**
 * Parses and strictly canonicalizes a single WordPress auth cookie credential.
 * Requires the expected cookie name and rejects malformed credentials.
 */
export const parseWordPressAuthCookie = (cookie, { allowTestTokens = process.env.NODE_ENV === "test" } = {}) => {
  if (!cookie || typeof cookie !== "string") return null;
  const trimmed = cookie.trim();
  if (!trimmed) return null;

  // Strict check: reject extra or ambiguous pairs (e.g. prepended "foo=bar; wordpress_logged_in_xyz=...")
  const segments = trimmed.split(";").map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    return null; // Ambiguous credentials rejected
  }

  const singlePair = segments[0];
  let cookieName = "";
  let cookieVal = singlePair;
  const eqIdx = singlePair.indexOf("=");
  if (eqIdx !== -1) {
    cookieName = singlePair.slice(0, eqIdx).trim();
    cookieVal = singlePair.slice(eqIdx + 1).trim();
  }

  // Require expected cookie name prefix (wordpress_logged_in_ in production, with test overrides in test runner)
  if (cookieName) {
    const isExpectedName =
      cookieName.startsWith("wordpress_logged_in_") ||
      (allowTestTokens && (cookieName.startsWith("test_") || cookieName.startsWith("token_") || cookieName.startsWith("mumbai_")));
    if (!isExpectedName) {
      return null;
    }
  }

  let decodedVal = cookieVal;
  try {
    decodedVal = decodeURIComponent(cookieVal);
  } catch (_) {}

  // WordPress auth cookie format: username|expiration|token|hmac
  let sessionToken = decodedVal;
  let expiresAt = null;
  let username = "";

  if (decodedVal.includes("|")) {
    const parts = decodedVal.split("|");
    if (parts.length !== 4) {
      return null; // Malformed: WordPress auth cookie must have exactly 4 parts
    }
    username = parts[0];
    const expSec = Number(parts[1]);
    sessionToken = parts[2];
    const hmac = parts[3];

    if (!username || !sessionToken || !hmac || !Number.isFinite(expSec) || expSec <= 0) {
      return null; // Malformed credential fields
    }
    expiresAt = expSec * 1000;
  } else if (!allowTestTokens) {
    // In production, WordPress credentials must be pipe-delimited
    return null;
  }

  const canonicalForward = cookieName ? `${cookieName}=${cookieVal}` : cookieVal;

  return {
    cookieName,
    cookieVal,
    decodedVal,
    sessionToken,
    expiresAt,
    username,
    canonicalForward,
  };
};

export const canonicalizeCookieKey = (cookie) => {
  const parsed = parseWordPressAuthCookie(cookie);
  if (!parsed) return "";
  return parsed.decodedVal;
};

/**
 * Returns:
 * - primary / tokenHash: hash of the underlying session token (used for revocation)
 * - authCacheKey: SHA-256 digest of the complete validated credential (used for authorization cache)
 * - allRevocationKeys: full set of token, cookie, and legacy hashes to check for revocation
 */
export const getSessionKeyHashes = (cookie) => {
  const rawTrimmed = String(cookie || "").trim();
  const fullCookieHash = rawTrimmed
    ? crypto.createHash("sha256").update(rawTrimmed).digest("hex").slice(0, 32)
    : "";

  const parsed = parseWordPressAuthCookie(cookie);
  if (!parsed) {
    return {
      primary: fullCookieHash,
      tokenHash: fullCookieHash,
      cookieValHash: fullCookieHash,
      fullCookieHash,
      canonicalHash: fullCookieHash,
      authCacheKey: fullCookieHash,
      legacy: fullCookieHash,
      allRevocationKeys: fullCookieHash ? [fullCookieHash] : [],
    };
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(parsed.sessionToken)
    .digest("hex")
    .slice(0, 32);

  const cookieValHash = crypto
    .createHash("sha256")
    .update(parsed.decodedVal)
    .digest("hex")
    .slice(0, 32);

  const canonicalHash = crypto
    .createHash("sha256")
    .update(parsed.canonicalForward)
    .digest("hex")
    .slice(0, 32);

  const allRevocationKeys = Array.from(
    new Set([tokenHash, cookieValHash, fullCookieHash, canonicalHash].filter(Boolean))
  );

  return {
    primary: tokenHash, // Token hash is the authoritative revocation key
    tokenHash,
    cookieValHash,
    fullCookieHash,
    canonicalHash,
    authCacheKey: canonicalHash, // Digest of the complete validated credential for authorization cache
    legacy: cookieValHash,
    allRevocationKeys,
  };
};

export const hashCookieKey = (cookie) => {
  const { primary } = getSessionKeyHashes(cookie);
  return primary;
};

const __authMiddlewareDir = path.dirname(fileURLToPath(import.meta.url));
const DURABLE_REV_DIR = path.resolve(__authMiddlewareDir, "../../var/durable_revocations");

const ensureDurableRevDir = () => {
  try {
    if (!fs.existsSync(DURABLE_REV_DIR)) {
      fs.mkdirSync(DURABLE_REV_DIR, { recursive: true });
    }
  } catch (err) {
    logger.error({ err: err?.message }, "[Auth] Failed to ensure durable revocation directory");
    throw err;
  }
};

/**
 * Returns the SHA-256 digest of the canonical session token.
 * Never logs, returns, or stores raw tokens or cookies.
 */
export const getCanonicalTokenDigest = (cookie) => {
  if (!cookie || typeof cookie !== "string") return null;
  const parsed = parseWordPressAuthCookie(cookie);
  if (!parsed || !parsed.sessionToken) return null;
  return crypto.createHash("sha256").update(parsed.sessionToken).digest("hex");
};

/**
 * Atomically writes a durable token revocation entry to shared filesystem storage.
 * Uses atomic rename to ensure multi-worker consistency and avoids snapshot races.
 */
export const recordDurableRevocation = (cookieOrDigest, { ttlSec = 30 * 86400, expiresAt = null } = {}) => {
  ensureDurableRevDir();
  let digest = cookieOrDigest;
  if (typeof cookieOrDigest === "string" && (cookieOrDigest.includes("=") || cookieOrDigest.includes("|"))) {
    digest = getCanonicalTokenDigest(cookieOrDigest);
  }
  if (!digest || typeof digest !== "string") {
    throw new Error("Valid canonical token digest required for durable revocation.");
  }

  const finalExp = (expiresAt && Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0)
    ? Number(expiresAt)
    : Date.now() + (ttlSec * 1000);

  const payload = JSON.stringify({
    tokenDigest: digest,
    expiresAt: finalExp,
    createdAt: Date.now(),
  });

  const finalPath = path.join(DURABLE_REV_DIR, `${digest}.json`);
  const tempPath = path.join(
    DURABLE_REV_DIR,
    `tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.json`
  );

  fs.writeFileSync(tempPath, payload, "utf-8");
  fs.renameSync(tempPath, finalPath);
  return true;
};

/**
 * Removes a durable token revocation file (e.g. after confirmed server destruction).
 */
export const removeDurableRevocation = (cookieOrDigest) => {
  try {
    let digest = cookieOrDigest;
    if (typeof cookieOrDigest === "string" && (cookieOrDigest.includes("=") || cookieOrDigest.includes("|"))) {
      digest = getCanonicalTokenDigest(cookieOrDigest);
    }
    if (!digest) return false;
    const finalPath = path.join(DURABLE_REV_DIR, `${digest}.json`);
    if (fs.existsSync(finalPath)) {
      fs.unlinkSync(finalPath);
      return true;
    }
  } catch (_) {}
  return false;
};

/**
 * Verifies whether a token is blocked in shared durable storage.
 * Returns { verified: boolean, revoked: boolean, reason?: string, error?: Error }.
 * If storage cannot be verified due to I/O error, verified is false (fail closed).
 */
export const checkDurableRevocation = (cookie) => {
  if (!cookie) return { verified: true, revoked: false };
  const digest = getCanonicalTokenDigest(cookie);
  if (!digest) {
    return { verified: true, revoked: false };
  }

  const filePath = path.join(DURABLE_REV_DIR, `${digest}.json`);
  try {
    if (!fs.existsSync(filePath)) {
      return { verified: true, revoked: false };
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const now = Date.now();
    if (parsed.expiresAt && Number.isFinite(Number(parsed.expiresAt))) {
      if (now < Number(parsed.expiresAt)) {
        return { verified: true, revoked: true, reason: "DURABLE_TOKEN_REVOKED" };
      } else {
        try { fs.unlinkSync(filePath); } catch (_) {}
        return { verified: true, revoked: false };
      }
    }
    return { verified: true, revoked: true, reason: "DURABLE_TOKEN_MALFORMED" };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { verified: true, revoked: false };
    }
    logger.error({ err: err?.message, digest }, "[Auth] Durable revocation storage read failure; cannot verify revocation status");
    return { verified: false, revoked: false, error: err };
  }
};

/**
 * Backward compatibility helper for legacy synchronous calls.
 */
export const isDurableRevoked = (cookie) => {
  const result = checkDurableRevocation(cookie);
  return result.revoked === true;
};

/**
 * Atomically writes a user's authoritative revocation version to shared durable storage.
 */
export const recordDurableUserRevocation = (userId, version, revokedAt = Date.now()) => {
  if (!userId) return false;
  ensureDurableRevDir();
  const payload = JSON.stringify({
    userId: Number(userId),
    version: Number(version),
    revokedAt: Number(revokedAt),
    updatedAt: Date.now(),
  });
  const finalPath = path.join(DURABLE_REV_DIR, `user_ver_${userId}.json`);
  const tempPath = path.join(
    DURABLE_REV_DIR,
    `tmp-u-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.json`
  );
  fs.writeFileSync(tempPath, payload, "utf-8");
  fs.renameSync(tempPath, finalPath);
  return true;
};

/**
 * Verifies whether a user session has been superseded in shared durable storage.
 */
export const checkDurableUserRevocation = (userId, sessionUserVersion, sessionTimestamp) => {
  if (!userId) return { verified: true, revoked: false };
  const filePath = path.join(DURABLE_REV_DIR, `user_ver_${userId}.json`);
  try {
    if (!fs.existsSync(filePath)) {
      return { verified: true, revoked: false, version: null };
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const durableVer = parsed.version !== undefined ? Number(parsed.version) : null;
    const revokedAt = parsed.revokedAt !== undefined ? Number(parsed.revokedAt) : null;

    if (durableVer !== null && sessionUserVersion !== undefined && sessionUserVersion !== null) {
      if (Number(sessionUserVersion) < durableVer) {
        return { verified: true, revoked: true, reason: "DURABLE_USER_SUPERSEDED", version: durableVer };
      }
    }
    if (revokedAt !== null && sessionTimestamp && Number(sessionTimestamp) < revokedAt) {
      return { verified: true, revoked: true, reason: "DURABLE_USER_REVOKED_TIMESTAMP", version: durableVer };
    }
    return { verified: true, revoked: false, version: durableVer };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { verified: true, revoked: false, version: null };
    }
    logger.error({ err: err?.message, userId }, "[Auth] Durable user revocation storage read failure; cannot verify status");
    return { verified: false, revoked: false, error: err };
  }
};

/**
 * Bounds in-memory cache size and sets entry WITHOUT overwriting the original validation timestamp.
 */
export const setLocalMemoryCache = (key, data) => {
  if (!key || !data) return;
  if (sessionCache.size >= SESSION_CACHE_MAX_SIZE) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey) {
      sessionCache.delete(oldestKey);
    }
  }
  sessionCache.set(key, data);
};

export const setSessionCache = (cookie, data) => {
  if (!cookie || !data) return;

  const now = Date.now();
  let effectiveTtl = SESSION_CACHE_TTL;
  if (data.expiresAt && Number.isFinite(Number(data.expiresAt))) {
    const remainingMs = Math.max(0, Number(data.expiresAt) - now);
    effectiveTtl = Math.min(SESSION_CACHE_TTL, remainingMs);
  }

  const { authCacheKey } = getSessionKeyHashes(cookie);

  if (effectiveTtl <= 0) {
    if (authCacheKey) sessionCache.delete(authCacheKey);
    sessionCache.delete(cookie);
    return;
  }

  // Preserve existing timestamp if valid (e.g. from validationStartedAt or Redis), otherwise assign now
  const entryTimestamp = data.timestamp && Number.isFinite(Number(data.timestamp)) ? Number(data.timestamp) : now;
  const entry = {
    ...data,
    timestamp: entryTimestamp,
    userVersion: data.userVersion !== undefined ? data.userVersion : null,
  };

  if (authCacheKey) {
    setLocalMemoryCache(authCacheKey, entry);
  }
  setLocalMemoryCache(cookie, entry);

  // Sync with distributed Redis if active, keyed by the complete validated credential digest
  const redis = getRedisClient();
  if (redis && authCacheKey) {
    try {
      redis.psetex(`sess:auth:${authCacheKey}`, effectiveTtl, JSON.stringify(entry)).catch(() => {});
    } catch (_) {}
  }
};

// Periodic cleanup every 5 minutes for local RAM
setInterval(() => {
  const now = Date.now();

  for (const [cookie, data] of sessionCache.entries()) {
    if (now - data.timestamp > SESSION_CACHE_TTL) {
      sessionCache.delete(cookie);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Evaluates session revocation status in Redis using all historical/token hashes,
 * atomic user revocation version, and the user-level revocation marker in a single atomic call.
 * Returns { available: boolean, revoked: boolean, reason?: string }.
 */
export const MONOTONIC_SET_USER_VER_LUA = `
  local current = redis.call('get', KEYS[1])
  local target = tonumber(ARGV[1])
  if not current or tonumber(current) < target then
    redis.call('set', KEYS[1], target)
    redis.call('expire', KEYS[1], tonumber(ARGV[2]))
    return target
  end
  return tonumber(current)
`;

/**
 * Evaluates session revocation status across shared durable storage and Redis.
 * Checks token markers and user-level revocation monotonically.
 * Returns { available: boolean, revoked: boolean, unverified?: boolean, reason?: string }.
 */
export const checkSessionRevocationInRedis = async (
  redis,
  cookie,
  userId,
  cachedTimestamp,
  cachedUserVersion
) => {
  // 1. Shared durable storage check (survives Redis outages & backend restarts)
  const durableToken = checkDurableRevocation(cookie);
  if (!durableToken.verified) {
    return { available: false, revoked: false, unverified: true, error: durableToken.error };
  }
  if (durableToken.revoked) {
    return { available: true, revoked: true, reason: durableToken.reason || "SESSION_REVOKED" };
  }

  if (userId) {
    const durableUser = checkDurableUserRevocation(userId, cachedUserVersion, cachedTimestamp);
    if (!durableUser.verified) {
      return { available: false, revoked: false, unverified: true, error: durableUser.error };
    }
    if (durableUser.revoked) {
      return { available: true, revoked: true, reason: durableUser.reason || "USER_REVOKED" };
    }
  }

  if (!redis) {
    return { available: false, revoked: false };
  }
  try {
    const { allRevocationKeys } = getSessionKeyHashes(cookie);
    const keysToCheck = (allRevocationKeys || []).map((k) => `sess:revoked:${k}`);
    if (userId) {
      keysToCheck.push(`sess:user_ver:${userId}`);
      keysToCheck.push(`sess:user_rev:${userId}`);
    }

    if (keysToCheck.length === 0) {
      return { available: true, revoked: false };
    }

    const results = await redis.mget(...keysToCheck);
    // Check if any of the token/cookie revocation markers exist
    for (let i = 0; i < (allRevocationKeys || []).length; i++) {
      if (results[i]) {
        return { available: true, revoked: true, reason: "SESSION_REVOKED" };
      }
    }

    // Check user-level revocation marker if userId was provided
    if (userId) {
      const verIndex = (allRevocationKeys || []).length;
      const revTimeIndex = verIndex + 1;
      const currentVerStr = results[verIndex];
      const currentVer = currentVerStr ? Number(currentVerStr) : null;
      const userRevTime = results[revTimeIndex];

      // 1. Authoritative version check: if session carries userVersion, verify it is current
      if (currentVer !== null && Number.isFinite(currentVer)) {
        if (cachedUserVersion !== undefined && cachedUserVersion !== null) {
          if (Number(cachedUserVersion) < currentVer) {
            return { available: true, revoked: true, reason: "USER_REVOKED" };
          }
        }
      }

      // 2. Fallback timestamp check: strictly greater than issuance
      if (userRevTime && cachedTimestamp && Number(userRevTime) > cachedTimestamp) {
        return { available: true, revoked: true, reason: "USER_REVOKED" };
      }
    }

    return { available: true, revoked: false };
  } catch (err) {
    logger.warn({ err: err?.message }, "[Auth] Failed to query Redis session revocation status");
    return { available: false, revoked: false };
  }
};

export const invalidateSessionCache = async (cookie, { permanent = false } = {}) => {
  if (cookie) {
    const { allRevocationKeys, authCacheKey } = getSessionKeyHashes(cookie);
    if (authCacheKey) sessionCache.delete(authCacheKey);
    sessionCache.delete(cookie);

    let durableWritten = true;
    if (permanent) {
      try {
        recordDurableRevocation(cookie, { ttlSec: 30 * 86400 });
      } catch (err) {
        logger.error({ err: err?.message }, "[Auth] Failed to write durable revocation to shared storage");
        durableWritten = false;
      }
    }

    const redis = getRedisClient();
    if (redis) {
      try {
        const ttl = permanent ? 30 * 86400 : 65;
        const pipeline = redis.pipeline();
        for (const key of allRevocationKeys) {
          pipeline.set(`sess:revoked:${key}`, "1", "EX", ttl);
          pipeline.del(`sess:${key}`);
        }
        if (authCacheKey) {
          pipeline.del(`sess:auth:${authCacheKey}`);
        }
        const results = await pipeline.exec();
        // Verify results of individual Redis writes!
        if (!results || results.some(([err]) => err !== null)) {
          logger.warn({ results }, "[Auth] Some Redis writes failed during session revocation");
          return false;
        }

        await redis.publish(
          "mumbai:session:invalidate",
          JSON.stringify({ allKeys: allRevocationKeys, authCacheKey })
        );
        return durableWritten;
      } catch (error) {
        logger.warn({ err: error?.message }, "Session cache invalidation failed");
        return false;
      }
    }
    return durableWritten;
  }
  return false;
};

/**
 * Evict cached user profile details from memory and Redis without revoking the session.
 * Used during non-security profile updates (name, phone) so subsequent requests
 * refresh user details from the source of truth without being blocked by revocation markers.
 */
export const evictSessionUserCache = async (cookie) => {
  if (cookie) {
    const { allRevocationKeys, authCacheKey } = getSessionKeyHashes(cookie);
    if (authCacheKey) sessionCache.delete(authCacheKey);
    sessionCache.delete(cookie);

    const redis = getRedisClient();
    if (redis) {
      try {
        const pipeline = redis.pipeline();
        if (authCacheKey) pipeline.del(`sess:auth:${authCacheKey}`);
        for (const key of allRevocationKeys) {
          pipeline.del(`sess:${key}`);
        }
        const results = await pipeline.exec();
        if (!results || results.some(([err]) => err !== null)) {
          return false;
        }
        await redis.publish(
          "mumbai:session:invalidate",
          JSON.stringify({ authCacheKey, allKeys: allRevocationKeys })
        );
        return true;
      } catch (error) {
        logger.warn({ err: error?.message }, "Session cache eviction failed");
      }
    }
  }
  return false;
};

export const invalidateUserSessionCache = async (userId, targetVersion = null) => {
  if (!userId) return false;

  const now = Date.now();
  let effectiveVersion = (targetVersion !== null && targetVersion !== undefined && Number.isFinite(Number(targetVersion)))
    ? Number(targetVersion)
    : null;

  // 1. Clear matching sessions from local process memory
  for (const [cookie, data] of sessionCache.entries()) {
    if (data.userId === userId || Number(data.userId) === Number(userId)) {
      sessionCache.delete(cookie);
    }
  }

  // 2. Persist to shared durable storage (atomic, survives Redis outage)
  if (effectiveVersion !== null) {
    try {
      recordDurableUserRevocation(userId, effectiveVersion, now);
    } catch (dErr) {
      logger.error({ userId, err: dErr?.message }, "[Auth] Failed recording durable user revocation version");
    }
  }

  // 3. Atomically and monotonically update Redis if active
  const redis = getRedisClient();
  if (redis) {
    try {
      if (effectiveVersion !== null) {
        const res = await redis.eval(
          MONOTONIC_SET_USER_VER_LUA,
          1,
          `sess:user_ver:${userId}`,
          effectiveVersion,
          30 * 86400
        );
        effectiveVersion = Number(res);
      } else {
        effectiveVersion = await redis.incr(`sess:user_ver:${userId}`);
        await redis.expire(`sess:user_ver:${userId}`, 30 * 86400);
        try {
          recordDurableUserRevocation(userId, effectiveVersion, now);
        } catch (_) {}
      }
      await redis.set(`sess:user_rev:${userId}`, now, "EX", 300);
      await redis.publish("mumbai:session:invalidate", JSON.stringify({ userId, revAt: now, userVersion: effectiveVersion }));
      return { success: true, version: effectiveVersion, revokedAt: now };
    } catch (error) {
      logger.warn({ userId, err: error?.message }, "Failed to persist user revocation marker to Redis");
    }
  } else {
    logger.warn({ userId }, "[Auth] Redis unavailable during invalidateUserSessionCache; durable store updated but Redis not contacted");
  }

  return { success: true, version: effectiveVersion, revokedAt: now };
};


// Distributed session cache invalidation listener across instances
try {
  const sub = getRedisSubscriber();
  if (sub && typeof sub.subscribe === "function") {
    const subscribeToSessionInvalidation = async () => {
      try {
        await sub.subscribe("mumbai:session:invalidate");
        logger.info("[Redis Sub] Subscribed to session invalidation channel");
      } catch (err) {
        logger.warn(
          { err: err?.message || err },
          "[Redis Sub] Failed to subscribe to session invalidation channel; local session cache remains active"
        );
      }
    };

    // Upstash may still be establishing its TLS connection while modules are
    // loading. Hostinger's local Redis is usually ready immediately. Support
    // both without issuing commands while ioredis' offline queue is disabled.
    sub.on("ready", () => { sessionCache.clear(); void subscribeToSessionInvalidation(); });
    if (sub.status === "ready") void subscribeToSessionInvalidation();

    sub.on("message", (channel, message) => {
      if (channel === "mumbai:session:invalidate") {
        try {
          const { userId, allKeys, keyHash, legacyHash, authCacheKey } = JSON.parse(message);
          if (userId) {
            for (const [key, data] of sessionCache.entries()) {
              if (data.userId === userId || Number(data.userId) === Number(userId)) {
                sessionCache.delete(key);
              }
            }
          }
          if (authCacheKey) {
            sessionCache.delete(authCacheKey);
          }
          const incomingKeys = new Set(
            [...(allKeys || []), keyHash, legacyHash, authCacheKey].filter(Boolean)
          );
          if (incomingKeys.size > 0) {
            for (const cookie of sessionCache.keys()) {
              const { allRevocationKeys, authCacheKey: cAuthKey } = getSessionKeyHashes(cookie);
              const hasMatch =
                (cAuthKey && incomingKeys.has(cAuthKey)) ||
                (allRevocationKeys || []).some((k) => incomingKeys.has(k));
              if (hasMatch) {
                sessionCache.delete(cookie);
              }
            }
          }
        } catch (_) {}
      }
    });
  }
} catch (_) {}

export const _setSessionCacheForTesting = (cookie, data) => {
  const { authCacheKey } = getSessionKeyHashes(cookie);
  const key = authCacheKey || cookie;
  sessionCache.set(key, data);
  sessionCache.set(cookie, data);
};

const executeAuth = async (context, req, res, next) => {
  try {
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;
    // Read only the specific cookie for this explicit server-side context
    const wpAuth = req.cookies?.[cookieConfig.auth] || (context === "customer" ? req.cookies?.mumbai_wp_auth : undefined);

    if (!wpAuth) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const parsedAuth = parseWordPressAuthCookie(wpAuth);
    if (!parsedAuth) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication credential.",
      });
    }

    const durableCheck = checkDurableRevocation(wpAuth);
    if (!durableCheck.verified) {
      return res.status(503).json({
        success: false,
        message: "Authentication service temporarily unavailable; unable to verify session state.",
      });
    }
    if (durableCheck.revoked) {
      const { authCacheKey } = getSessionKeyHashes(wpAuth);
      if (authCacheKey) sessionCache.delete(authCacheKey);
      sessionCache.delete(wpAuth);
      return res.status(401).json({
        success: false,
        message: "Session has been revoked.",
      });
    }

    const { authCacheKey } = getSessionKeyHashes(wpAuth);
    const redis = getRedisClient();

    // 1. Look up cached authorization by digest of the complete validated credential
    let cached = sessionCache.get(authCacheKey) || sessionCache.get(wpAuth);

    if (!cached && redis) {
      try {
        const redisData = await redis.get(`sess:auth:${authCacheKey}`);
        if (redisData) {
          const parsed = JSON.parse(redisData);
          if (parsed.expiresAt && Date.now() >= parsed.expiresAt) {
            cached = null;
          } else {
            cached = parsed;
            setLocalMemoryCache(authCacheKey, cached);
          }
        }
      } catch (_) {}
    }

    // 2. Perform combined revocation check across token markers and user marker
    let combinedRev = { available: false, revoked: false };
    if (cached) {
      combinedRev = await checkSessionRevocationInRedis(
        redis,
        wpAuth,
        cached.userId,
        cached.timestamp,
        cached.userVersion
      );

      if (combinedRev.revoked) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return res.status(401).json({
          success: false,
          message: "Session has been revoked.",
        });
      }
    }

    // 3. Authorize from cache ONLY IF:
    // - Combined revocation check was available and confirmed clean
    // - Deadline is finite and strictly in the future
    // - Local cache TTL is still fresh
    const now = Date.now();
    const hasFiniteExpiry = typeof cached?.expiresAt === "number" && Number.isFinite(cached.expiresAt) && cached.expiresAt > 0;

    if (
      cached &&
      combinedRev.available &&
      !combinedRev.revoked &&
      hasFiniteExpiry &&
      now < cached.expiresAt &&
      now - cached.timestamp < SESSION_CACHE_TTL
    ) {
      if (!rolesMatchAuthContext(context, cached.roles)) {
        return res.status(403).json({
          success: false,
          message: "This account is not authorized for the requested application.",
        });
      }

      // Check deadline immediately before granting access
      if (Date.now() >= cached.expiresAt) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return res.status(401).json({
          success: false,
          message: "Session has expired.",
        });
      }

      req.wpAuthCookie = wpAuth;
      req.wpRestNonce = req.cookies?.[cookieConfig.nonce] || (context === "customer" ? req.cookies?.mumbai_wp_nonce : undefined);
      req.wpUserId = cached.userId;
      req.wpUserEmail = cached.email || "";
      req.authContext = context;
      req.isPhoneVerified = cached.isPhoneVerified === true;
      req.isSuspended = cached.isSuspended === true;
      req.authExpiresAt = cached.expiresAt;
      req.authValidatedAt = cached.timestamp;
      req.userVersion = cached.userVersion || null;

      req.user = {
        id: cached.userId,
        name: cached.name || "",
        roles: cached.roles,
        email: cached.email || "",
        username: cached.username || "",
        first_name: cached.firstName || "",
        last_name: cached.lastName || "",
        phone: cached.phone || "",
        verified_phone: cached.verifiedPhone || "",
        is_google_user: cached.isGoogleUser === true,
        has_usable_password: cached.hasUsablePassword === true,
        is_phone_verified: cached.isPhoneVerified === true,
        is_suspended: cached.isSuspended === true,
      };

      return next();
    }

    // 4. Validate session with WordPress authority (cache miss or Redis revocation unavailable)
    const validationStartedAt = Date.now();
    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
      {
        headers: {
          Cookie: parsedAuth.canonicalForward,
        },
        httpsAgent,
        timeout: 8000,
      }
    );

    const userId = response.data?.current_user_id;
    const roles = Array.isArray(response.data?.roles) ? response.data.roles : [];
    const email = typeof response.data?.email === "string" ? response.data.email : "";
    const name = typeof response.data?.name === "string" && response.data.name.trim()
      ? response.data.name.trim()
      : (typeof response.data?.display_name === "string" ? response.data.display_name.trim() : "");
    const isPhoneVerified = response.data?.is_phone_verified === true;
    const isSuspended = response.data?.is_suspended === true;
    const username = typeof response.data?.username === "string" ? response.data.username : "";
    const firstName = typeof response.data?.first_name === "string" ? response.data.first_name : "";
    const lastName = typeof response.data?.last_name === "string" ? response.data.last_name : "";
    const phone = typeof response.data?.phone === "string" ? response.data.phone : "";
    const verifiedPhone = typeof response.data?.verified_phone === "string" ? response.data.verified_phone : "";
    const isGoogleUser = response.data?.is_google_user === true;
    const hasUsablePassword = response.data?.has_usable_password === true;

    if (!response.data?.logged_in || !userId) {
      sessionCache.delete(authCacheKey);
      sessionCache.delete(wpAuth);

      return res.status(401).json({
        success: false,
        message: "Session expired.",
      });
    }

    // Require authoritative finite deadline from WordPress, falling back to verified cookie expiration
    const rawExp = response.data?.expires_at;
    const expiresAt = rawExp && Number.isFinite(Number(rawExp)) && Number(rawExp) > 0
      ? Number(rawExp) * 1000
      : (parsedAuth?.expiresAt && Number.isFinite(Number(parsedAuth.expiresAt)) && Number(parsedAuth.expiresAt) > 0
          ? Number(parsedAuth.expiresAt)
          : null);

    if (!expiresAt) {
      sessionCache.delete(authCacheKey);
      sessionCache.delete(wpAuth);
      return res.status(401).json({
        success: false,
        message: "Session deadline could not be verified.",
      });
    }

    if (!rolesMatchAuthContext(context, roles)) {
      return res.status(403).json({
        success: false,
        message: "This account is not authorized for the requested application.",
      });
    }

    // Extract the verified token's own bound issuance version from WordPress authority
    const tokenSessionVersion = response.data?.session_version !== undefined && response.data.session_version !== null
      ? Number(response.data.session_version)
      : null;

    // Recheck durable storage after fresh validation
    const postDurableCheck = checkDurableRevocation(wpAuth);
    if (!postDurableCheck.verified) {
      return res.status(503).json({
        success: false,
        message: "Authentication service temporarily unavailable; unable to verify session state.",
      });
    }
    if (postDurableCheck.revoked) {
      sessionCache.delete(authCacheKey);
      sessionCache.delete(wpAuth);
      return res.status(401).json({
        success: false,
        message: "Session has been revoked.",
      });
    }

    const postDurableUser = checkDurableUserRevocation(userId, tokenSessionVersion, validationStartedAt);
    if (!postDurableUser.verified) {
      return res.status(503).json({
        success: false,
        message: "Authentication service temporarily unavailable; unable to verify session state.",
      });
    }
    if (postDurableUser.revoked) {
      sessionCache.delete(authCacheKey);
      sessionCache.delete(wpAuth);
      return res.status(401).json({
        success: false,
        message: "Session has been revoked.",
      });
    }

    // Monotonically verify and update user version in Redis
    let latestUserVersion = tokenSessionVersion;
    if (redis) {
      try {
        const currentVerStr = await redis.get(`sess:user_ver:${userId}`);
        const currentVer = currentVerStr ? Number(currentVerStr) : null;
        if (currentVer !== null && tokenSessionVersion !== null && tokenSessionVersion < currentVer) {
          // Token version N arrived after version N+1 already revoked it
          sessionCache.delete(authCacheKey);
          sessionCache.delete(wpAuth);
          return res.status(401).json({
            success: false,
            message: "Session has been revoked.",
          });
        }

        if (tokenSessionVersion !== null && (currentVer === null || tokenSessionVersion > currentVer)) {
          const resVer = await redis.eval(
            MONOTONIC_SET_USER_VER_LUA,
            1,
            `sess:user_ver:${userId}`,
            tokenSessionVersion,
            30 * 86400
          );
          latestUserVersion = Number(resVer);
        } else if (currentVer !== null) {
          latestUserVersion = currentVer;
        }
      } catch (_) {}

      const postRev = await checkSessionRevocationInRedis(
        redis,
        wpAuth,
        userId,
        validationStartedAt,
        tokenSessionVersion
      );
      if (postRev.revoked) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return res.status(401).json({
          success: false,
          message: "Session has been revoked.",
        });
      }
    }

    // Strictly enforce Date.now() >= expiresAt immediately before granting access
    if (Date.now() >= expiresAt) {
      sessionCache.delete(authCacheKey);
      sessionCache.delete(wpAuth);
      return res.status(401).json({
        success: false,
        message: "Session has expired.",
      });
    }

    // 5. Cache validated session keyed by authCacheKey (digest of complete validated credential)
    setSessionCache(wpAuth, {
      userId,
      name,
      roles,
      email,
      username,
      firstName,
      lastName,
      phone,
      verifiedPhone,
      isGoogleUser,
      hasUsablePassword,
      isPhoneVerified,
      isSuspended,
      expiresAt,
      userVersion: latestUserVersion,
      timestamp: validationStartedAt,
    });

    // 6. Attach authentication information to request
    req.wpAuthCookie = wpAuth;
    req.wpRestNonce = req.cookies?.[cookieConfig.nonce] || (context === "customer" ? req.cookies?.mumbai_wp_nonce : undefined);
    req.wpUserId = userId;
    req.wpUserEmail = email;
    req.authContext = context;
    req.isPhoneVerified = isPhoneVerified;
    req.isSuspended = isSuspended;
    req.authExpiresAt = expiresAt;
    req.authValidatedAt = validationStartedAt;
    req.userVersion = latestUserVersion;

    req.user = {
      id: userId,
      name,
      roles,
      email,
      username,
      first_name: firstName,
      last_name: lastName,
      phone,
      verified_phone: verifiedPhone,
      is_google_user: isGoogleUser,
      has_usable_password: hasUsablePassword,
      is_phone_verified: isPhoneVerified,
      is_suspended: isSuspended,
    };

    return next();
  } catch (error) {
    logError(req, error, `Auth middleware error [${context}]`);

    const isNetworkOrTimeout =
      error.code === "ECONNABORTED" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ETIMEDOUT" ||
      error.code === "ENOTFOUND" ||
      error.message?.includes("timeout") ||
      error.message?.includes("socket hang up");
    const is5xx = error.response?.status >= 500;

    if (isNetworkOrTimeout || is5xx) {
      return res.status(503).json({
        success: false,
        code: "AUTH_SERVICE_UNAVAILABLE",
        message: "Authentication service temporarily unavailable. Please retry shortly.",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Authentication failed.",
    });
  }
};

export const requireAuth = (contextOrReq = "customer", maybeRes, maybeNext) => {
  // If called directly as Express middleware: router.get("/", requireAuth, handler)
  if (maybeRes && typeof maybeNext === "function") {
    return executeAuth("customer", contextOrReq, maybeRes, maybeNext);
  }

  // If called with explicit context: router.get("/", requireAuth("admin"), handler)
  const context = typeof contextOrReq === "string" ? contextOrReq : "customer";
  return (req, res, next) => executeAuth(context, req, res, next);
};



export const requireVerifiedPhone = (req, res, next) => {
  if (!req.wpUserId || !req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  const payloadPhone =
    req.body?.billing_address?.phone ||
    req.body?.shipping_address?.phone ||
    req.body?.phone;
  const rawDigits = typeof payloadPhone === "string" ? payloadPhone.replace(/\D/g, "") : "";
  let cleanPhone = rawDigits;
  if (cleanPhone.length === 12 && cleanPhone.startsWith("91")) {
    cleanPhone = cleanPhone.slice(2);
  } else if (cleanPhone.length === 11 && cleanPhone.startsWith("0")) {
    cleanPhone = cleanPhone.slice(1);
  }
  const isPayloadPhoneValid = /^[6-9]\d{9}$/.test(cleanPhone);

  if (!isPayloadPhoneValid) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CONTACT_PHONE",
      message: "Please provide a valid 10-digit Indian mobile number for delivery contact.",
    });
  }

  return next();
};

// Single-flight Promise deduplication for concurrent session validation
const inFlightValidation = new Map();

/**
 * Unified Server-Side Customer Session Validation
 * Reuses validated sessionCache (60s TTL) and deduplicates concurrent upstream /me calls.
 * Combines userId, isSuspended, and isPhoneVerified into one authoritative result.
 * Strictly fail-closed: If /me fails, times out, or returns invalid session,
 * returns { valid: false, error: ... } so checkout and security guards reject safely.
 */
export const getSessionValidation = async (wpAuth) => {
  if (!wpAuth || typeof wpAuth !== "string") {
    return { valid: false, error: "AUTH_REQUIRED" };
  }

  const parsedAuth = parseWordPressAuthCookie(wpAuth);
  if (!parsedAuth) {
    return { valid: false, error: "AUTH_REQUIRED" };
  }

  const durableCheck = checkDurableRevocation(wpAuth);
  if (!durableCheck.verified) {
    return { valid: false, error: "AUTH_UNAVAILABLE" };
  }
  if (durableCheck.revoked) {
    const { authCacheKey } = getSessionKeyHashes(wpAuth);
    if (authCacheKey) sessionCache.delete(authCacheKey);
    sessionCache.delete(wpAuth);
    return { valid: false, error: "SESSION_REVOKED" };
  }

  const { authCacheKey } = getSessionKeyHashes(wpAuth);
  const redis = getRedisClient();

  // 1. Look up cached authorization by digest of the complete validated credential
  let cached = sessionCache.get(authCacheKey) || sessionCache.get(wpAuth);

  if (!cached && redis) {
    try {
      const redisData = await redis.get(`sess:auth:${authCacheKey}`);
      if (redisData) {
        const parsed = JSON.parse(redisData);
        if (parsed.expiresAt && Date.now() >= parsed.expiresAt) {
          cached = null;
        } else {
          cached = parsed;
          setLocalMemoryCache(authCacheKey, cached);
        }
      }
    } catch (_) {}
  }

  // 2. Combined revocation check across token markers and user marker
  let combinedRev = { available: false, revoked: false };
  if (cached) {
    combinedRev = await checkSessionRevocationInRedis(
      redis,
      wpAuth,
      cached.userId,
      cached.timestamp,
      cached.userVersion
    );

    if (combinedRev.revoked) {
      sessionCache.delete(authCacheKey);
      sessionCache.delete(wpAuth);
      return { valid: false, error: "AUTH_REQUIRED" };
    }
  }

  // 3. Authorize from cache ONLY IF:
  // - Combined revocation check was available and clean
  // - Deadline is finite and strictly in the future
  // - Local cache TTL is still fresh
  const now = Date.now();
  const hasFiniteExpiry = typeof cached?.expiresAt === "number" && Number.isFinite(cached.expiresAt) && cached.expiresAt > 0;

  if (
    cached &&
    combinedRev.available &&
    !combinedRev.revoked &&
    hasFiniteExpiry &&
    now < cached.expiresAt &&
    now - cached.timestamp < SESSION_CACHE_TTL &&
    typeof cached.userId !== "undefined"
  ) {
    // Check deadline immediately before returning valid session
    if (Date.now() >= cached.expiresAt) {
      sessionCache.delete(authCacheKey);
      sessionCache.delete(wpAuth);
      return { valid: false, error: "SESSION_EXPIRED" };
    }

    return {
      valid: true,
      userId: cached.userId,
      roles: cached.roles || [],
      email: cached.email || "",
      name: cached.name || "",
      username: cached.username || "",
      firstName: cached.firstName || "",
      lastName: cached.lastName || "",
      phone: cached.phone || "",
      verifiedPhone: cached.verifiedPhone || "",
      isGoogleUser: cached.isGoogleUser === true,
      hasUsablePassword: cached.hasUsablePassword === true,
      isPhoneVerified: cached.isPhoneVerified === true,
      isSuspended: cached.isSuspended === true,
      expiresAt: cached.expiresAt,
      userVersion: cached.userVersion !== undefined ? cached.userVersion : null,
    };
  }

  // Single-flight Promise deduplication for concurrent session validation
  if (inFlightValidation.has(wpAuth)) {
    return inFlightValidation.get(wpAuth);
  }

  const validationStartedAt = Date.now();
  const validationPromise = (async () => {
    try {
      const response = await axios.get(
        `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
        {
          headers: { Cookie: parsedAuth.canonicalForward },
          httpsAgent,
          timeout: 8000, // 8000ms upstream timeout
        }
      );

      const userId = response.data?.current_user_id;
      const isLoggedIn = response.data?.logged_in === true;
      const isVerified = response.data?.is_phone_verified === true;
      const isSuspended = response.data?.is_suspended === true;
      const roles = Array.isArray(response.data?.roles) ? response.data.roles : [];
      const email = typeof response.data?.email === "string" ? response.data.email : "";
      const name = typeof response.data?.name === "string" && response.data.name.trim()
        ? response.data.name.trim()
        : (typeof response.data?.display_name === "string" ? response.data.display_name.trim() : "");
      const username = typeof response.data?.username === "string" ? response.data.username : "";
      const firstName = typeof response.data?.first_name === "string" ? response.data.first_name : "";
      const lastName = typeof response.data?.last_name === "string" ? response.data.last_name : "";
      const phone = typeof response.data?.phone === "string" ? response.data.phone : "";
      const verifiedPhone = typeof response.data?.verified_phone === "string" ? response.data.verified_phone : "";
      const isGoogleUser = response.data?.is_google_user === true;
      const hasUsablePassword = response.data?.has_usable_password === true;

      if (!isLoggedIn || !userId) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return { valid: false, error: "SESSION_EXPIRED" };
      }

      // Require authoritative finite deadline from WordPress, falling back to verified cookie expiration
      const rawExp = response.data?.expires_at;
      const expiresAt = rawExp && Number.isFinite(Number(rawExp)) && Number(rawExp) > 0
        ? Number(rawExp) * 1000
        : (parsedAuth?.expiresAt && Number.isFinite(Number(parsedAuth.expiresAt)) && Number(parsedAuth.expiresAt) > 0
            ? Number(parsedAuth.expiresAt)
            : null);

      if (!expiresAt) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return { valid: false, error: "SESSION_EXPIRED" };
      }

      // Extract the verified token's own bound issuance version from WordPress authority
      const tokenSessionVersion = response.data?.session_version !== undefined && response.data.session_version !== null
        ? Number(response.data.session_version)
        : null;

      // Recheck durable storage after fresh validation
      const postDurableCheck = checkDurableRevocation(wpAuth);
      if (!postDurableCheck.verified) {
        return { valid: false, error: "AUTH_UNAVAILABLE" };
      }
      if (postDurableCheck.revoked) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return { valid: false, error: "SESSION_REVOKED" };
      }

      const postDurableUser = checkDurableUserRevocation(userId, tokenSessionVersion, validationStartedAt);
      if (!postDurableUser.verified) {
        return { valid: false, error: "AUTH_UNAVAILABLE" };
      }
      if (postDurableUser.revoked) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return { valid: false, error: "SESSION_REVOKED" };
      }

      // Monotonically verify and update user version in Redis
      let latestUserVersion = tokenSessionVersion;
      if (redis) {
        try {
          const currentVerStr = await redis.get(`sess:user_ver:${userId}`);
          const currentVer = currentVerStr ? Number(currentVerStr) : null;
          if (currentVer !== null && tokenSessionVersion !== null && tokenSessionVersion < currentVer) {
            sessionCache.delete(authCacheKey);
            sessionCache.delete(wpAuth);
            return { valid: false, error: "SESSION_REVOKED" };
          }

          if (tokenSessionVersion !== null && (currentVer === null || tokenSessionVersion > currentVer)) {
            const resVer = await redis.eval(
              MONOTONIC_SET_USER_VER_LUA,
              1,
              `sess:user_ver:${userId}`,
              tokenSessionVersion,
              30 * 86400
            );
            latestUserVersion = Number(resVer);
          } else if (currentVer !== null) {
            latestUserVersion = currentVer;
          }
        } catch (_) {}

        const postRev = await checkSessionRevocationInRedis(
          redis,
          wpAuth,
          userId,
          validationStartedAt,
          tokenSessionVersion
        );
        if (postRev.revoked) {
          sessionCache.delete(authCacheKey);
          sessionCache.delete(wpAuth);
          return { valid: false, error: "SESSION_REVOKED" };
        }
      }

      // Strictly enforce Date.now() >= expiresAt immediately before returning valid session
      if (Date.now() >= expiresAt) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return { valid: false, error: "SESSION_EXPIRED" };
      }

      setSessionCache(wpAuth, {
        userId,
        name,
        roles,
        email,
        username,
        firstName,
        lastName,
        phone,
        verifiedPhone,
        isGoogleUser,
        hasUsablePassword,
        isPhoneVerified: isVerified,
        isSuspended,
        expiresAt,
        userVersion: latestUserVersion,
        timestamp: validationStartedAt,
      });

      return {
        valid: true,
        userId,
        roles,
        email,
        name,
        username,
        firstName,
        lastName,
        phone,
        verifiedPhone,
        isGoogleUser,
        hasUsablePassword,
        isPhoneVerified: isVerified,
        isSuspended,
        expiresAt,
        userVersion: latestUserVersion,
      };
    } catch (error) {
      logError(null, error, "Session validation error");
      // Strictly fail-closed: do NOT treat customer as unsuspended or verified
      return {
        valid: false,
        error:
          error.code === "ECONNABORTED" || error.message?.includes("timeout")
            ? "AUTH_TIMEOUT"
            : "AUTH_UNAVAILABLE",
      };
    } finally {
      inFlightValidation.delete(wpAuth);
    }
  })();

  inFlightValidation.set(wpAuth, validationPromise);
  return validationPromise;
};

export const checkSessionSuspended = async (wpAuth) => {
  const session = await getSessionValidation(wpAuth);
  if (!session.valid) return false;
  return session.isSuspended === true;
};

export const checkSessionPhoneVerified = async (wpAuth) => {
  const session = await getSessionValidation(wpAuth);
  if (!session.valid) return false; // Fail closed: unvalidated/failed auth is not verified
  return session.isPhoneVerified === true;
};

const executeOptionalAuth = async (context, req, res, next) => {
  try {
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;
    // Strictly read only the cookie designated for this context (no staff fallback across boundaries)
    const wpAuth =
      req.cookies?.[cookieConfig.auth] ||
      (context === "customer" ? req.cookies?.mumbai_wp_auth : undefined);

    if (!wpAuth) {
      return next();
    }

    const parsedAuth = parseWordPressAuthCookie(wpAuth);
    if (!parsedAuth) {
      return next();
    }

    const durableCheck = checkDurableRevocation(wpAuth);
    if (!durableCheck.verified || durableCheck.revoked) {
      const { authCacheKey } = getSessionKeyHashes(wpAuth);
      if (authCacheKey) sessionCache.delete(authCacheKey);
      sessionCache.delete(wpAuth);
      return next();
    }

    const { authCacheKey } = getSessionKeyHashes(wpAuth);
    const redis = getRedisClient();

    // 1. Look up cached authorization by digest of the complete validated credential
    let cached = sessionCache.get(authCacheKey) || sessionCache.get(wpAuth);

    if (!cached && redis) {
      try {
        const redisData = await redis.get(`sess:auth:${authCacheKey}`);
        if (redisData) {
          const parsed = JSON.parse(redisData);
          if (parsed.expiresAt && Date.now() >= parsed.expiresAt) {
            cached = null;
          } else {
            cached = parsed;
            setLocalMemoryCache(authCacheKey, cached);
          }
        }
      } catch (_) {}
    }

    // 2. Combined revocation check across token markers and user marker
    let combinedRev = { available: false, revoked: false };
    if (cached) {
      combinedRev = await checkSessionRevocationInRedis(
        redis,
        wpAuth,
        cached.userId,
        cached.timestamp,
        cached.userVersion
      );

      if (combinedRev.revoked) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return next();
      }
    }

    // 3. Authorize from cache ONLY IF:
    // - Combined revocation check was available and clean
    // - Deadline is finite and strictly in the future
    // - Local cache TTL is still fresh
    const now = Date.now();
    const hasFiniteExpiry = typeof cached?.expiresAt === "number" && Number.isFinite(cached.expiresAt) && cached.expiresAt > 0;

    if (
      cached &&
      combinedRev.available &&
      !combinedRev.revoked &&
      hasFiniteExpiry &&
      now < cached.expiresAt &&
      now - cached.timestamp < SESSION_CACHE_TTL
    ) {
      if (!rolesMatchAuthContext(context, cached.roles)) {
        return next();
      }

      if (Date.now() >= cached.expiresAt) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return next();
      }

      req.wpAuthCookie = wpAuth;
      req.wpUserId = cached.userId;
      req.wpUserEmail = cached.email || "";
      req.isPhoneVerified = cached.isPhoneVerified === true;
      req.isSuspended = cached.isSuspended === true;
      req.authExpiresAt = cached.expiresAt;
      req.authValidatedAt = cached.timestamp;
      req.userVersion = cached.userVersion || null;
      req.user = {
        id: cached.userId,
        roles: cached.roles,
        email: cached.email || "",
        is_phone_verified: cached.isPhoneVerified === true,
        is_suspended: cached.isSuspended === true,
      };
      return next();
    }

    // 4. Validate with WordPress authority (cache miss or Redis unavailable)
    const validationStartedAt = Date.now();
    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
      {
        headers: { Cookie: parsedAuth.canonicalForward },
        httpsAgent,
        timeout: 4000,
      }
    );

    const userId = response.data?.current_user_id;
    const roles = Array.isArray(response.data?.roles) ? response.data.roles : [];
    const email = typeof response.data?.email === "string" ? response.data.email : "";
    const name = typeof response.data?.name === "string" && response.data.name.trim()
      ? response.data.name.trim()
      : (typeof response.data?.display_name === "string" ? response.data.display_name.trim() : "");
    const username = typeof response.data?.username === "string" ? response.data.username : "";
    const firstName = typeof response.data?.first_name === "string" ? response.data.first_name : "";
    const lastName = typeof response.data?.last_name === "string" ? response.data.last_name : "";
    const phone = typeof response.data?.phone === "string" ? response.data.phone : "";
    const verifiedPhone = typeof response.data?.verified_phone === "string" ? response.data.verified_phone : "";
    const isGoogleUser = response.data?.is_google_user === true;
    const hasUsablePassword = response.data?.has_usable_password === true;
    const isPhoneVerified = response.data?.is_phone_verified === true;
    const isSuspended = response.data?.is_suspended === true;

    if (response.data?.logged_in && userId) {
      if (!rolesMatchAuthContext(context, roles)) {
        return next();
      }

      const rawExp = response.data?.expires_at;
      const expiresAt = rawExp && Number.isFinite(Number(rawExp)) && Number(rawExp) > 0
        ? Number(rawExp) * 1000
        : (parsedAuth?.expiresAt && Number.isFinite(Number(parsedAuth.expiresAt)) && Number(parsedAuth.expiresAt) > 0
            ? Number(parsedAuth.expiresAt)
            : null);

      if (!expiresAt) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return next();
      }

      const tokenSessionVersion = response.data?.session_version !== undefined && response.data.session_version !== null
        ? Number(response.data.session_version)
        : null;

      const postDurableCheck = checkDurableRevocation(wpAuth);
      if (!postDurableCheck.verified || postDurableCheck.revoked) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return next();
      }

      const postDurableUser = checkDurableUserRevocation(userId, tokenSessionVersion, validationStartedAt);
      if (!postDurableUser.verified || postDurableUser.revoked) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return next();
      }

      let latestUserVersion = tokenSessionVersion;
      if (redis) {
        try {
          const currentVerStr = await redis.get(`sess:user_ver:${userId}`);
          const currentVer = currentVerStr ? Number(currentVerStr) : null;
          if (currentVer !== null && tokenSessionVersion !== null && tokenSessionVersion < currentVer) {
            sessionCache.delete(authCacheKey);
            sessionCache.delete(wpAuth);
            return next();
          }

          if (tokenSessionVersion !== null && (currentVer === null || tokenSessionVersion > currentVer)) {
            const resVer = await redis.eval(
              MONOTONIC_SET_USER_VER_LUA,
              1,
              `sess:user_ver:${userId}`,
              tokenSessionVersion,
              30 * 86400
            );
            latestUserVersion = Number(resVer);
          } else if (currentVer !== null) {
            latestUserVersion = currentVer;
          }
        } catch (_) {}

        const postRev = await checkSessionRevocationInRedis(
          redis,
          wpAuth,
          userId,
          validationStartedAt,
          tokenSessionVersion
        );
        if (postRev.revoked) {
          sessionCache.delete(authCacheKey);
          sessionCache.delete(wpAuth);
          return next();
        }
      }

      if (Date.now() >= expiresAt) {
        sessionCache.delete(authCacheKey);
        sessionCache.delete(wpAuth);
        return next();
      }

      setSessionCache(wpAuth, {
        userId,
        name,
        roles,
        email,
        username,
        firstName,
        lastName,
        phone,
        verifiedPhone,
        isGoogleUser,
        hasUsablePassword,
        isPhoneVerified,
        isSuspended,
        expiresAt,
        userVersion: latestUserVersion,
        timestamp: validationStartedAt,
      });

      req.wpAuthCookie = wpAuth;
      req.wpUserId = userId;
      req.wpUserEmail = email;
      req.isPhoneVerified = isPhoneVerified;
      req.isSuspended = isSuspended;
      req.authExpiresAt = expiresAt;
      req.authValidatedAt = validationStartedAt;
      req.user = {
        id: userId,
        name,
        roles,
        email,
        username,
        first_name: firstName,
        last_name: lastName,
        phone,
        verified_phone: verifiedPhone,
        is_google_user: isGoogleUser,
        has_usable_password: hasUsablePassword,
        is_phone_verified: isPhoneVerified,
        is_suspended: isSuspended,
      };
    }
  } catch (_) {
    // Non-blocking for optional auth
  }
  return next();
};

export const optionalAuth = (contextOrReq = "customer", maybeRes, maybeNext) => {
  if (maybeRes && typeof maybeNext === "function") {
    return executeOptionalAuth("customer", contextOrReq, maybeRes, maybeNext);
  }
  const context = typeof contextOrReq === "string" ? contextOrReq : "customer";
  return (req, res, next) => executeOptionalAuth(context, req, res, next);
};
