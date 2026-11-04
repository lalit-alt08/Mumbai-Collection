import crypto from "crypto";
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

const hashCookieKey = (cookie) => {
  if (!cookie) return "";
  return crypto.createHash("sha256").update(String(cookie)).digest("hex").slice(0, 32);
};

export const setSessionCache = (cookie, data) => {
  if (sessionCache.size >= SESSION_CACHE_MAX_SIZE) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey) {
      sessionCache.delete(oldestKey);
    }
  }
  sessionCache.set(cookie, data);

  // Sync with distributed Redis if active
  const redis = getRedisClient();
  if (redis && cookie && data) {
    try {
      const keyHash = hashCookieKey(cookie);
      redis.psetex(`sess:${keyHash}`, SESSION_CACHE_TTL, JSON.stringify(data)).catch(() => {});
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

export const invalidateSessionCache = async (cookie, { permanent = false } = {}) => {
  if (cookie) {
    sessionCache.delete(cookie);
    const redis = getRedisClient();
    if (redis) {
      try {
        const keyHash = hashCookieKey(cookie);
        // Fallback for dropped Pub/Sub or unconfirmed upstream revocation:
        // Use 30-day TTL (2592000s) if permanent, otherwise 65s for distributed broadcast
        const ttl = permanent ? 30 * 86400 : 65;
        await redis.set(`sess:revoked:${keyHash}`, "1", "EX", ttl);
        await redis.del(`sess:${keyHash}`);
        await redis.publish("mumbai:session:invalidate", JSON.stringify({ keyHash }));
        return true;
      } catch (error) { logger.warn({ err: error?.message }, "Session cache invalidation failed"); }
    }
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
    sessionCache.delete(cookie);
    const redis = getRedisClient();
    if (redis) {
      try {
        const keyHash = hashCookieKey(cookie);
        await redis.del(`sess:${keyHash}`);
        await redis.publish("mumbai:session:invalidate", JSON.stringify({ keyHash }));
        return true;
      } catch (error) {
        logger.warn({ err: error?.message }, "Session cache eviction failed");
      }
    }
  }
  return false;
};

export const invalidateUserSessionCache = (userId) => {
  if (!userId) return;
  const redis = getRedisClient();
  for (const [cookie, data] of sessionCache.entries()) {
    if (data.userId === userId || Number(data.userId) === Number(userId)) {
      sessionCache.delete(cookie);
      if (redis) {
        try {
          const keyHash = hashCookieKey(cookie);
          redis.del(`sess:${keyHash}`).catch(() => {});
        } catch (_) {}
      }
    }
  }
  if (redis) {
    try {
      const now = Date.now();
      redis.set(`sess:user_rev:${userId}`, now, "EX", 300).catch(() => {});
      redis.publish("mumbai:session:invalidate", JSON.stringify({ userId, revAt: now })).catch(() => {});
    } catch (_) {}
  }
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
          const { userId, keyHash } = JSON.parse(message);
          if (userId) {
            for (const [cookie, data] of sessionCache.entries()) {
              if (data.userId === userId || Number(data.userId) === Number(userId)) {
                sessionCache.delete(cookie);
              }
            }
          }
          if (keyHash) {
            for (const cookie of sessionCache.keys()) {
              if (hashCookieKey(cookie) === keyHash) {
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

    const keyHash = hashCookieKey(wpAuth);
    const redis = getRedisClient();

    // 1. Immediately block any session marked as revoked in distributed Redis
    if (redis) {
      try {
        const isRevoked = await redis.get(`sess:revoked:${keyHash}`);
        if (isRevoked) {
          sessionCache.delete(wpAuth);
          return res.status(401).json({
            success: false,
            message: "Session has been revoked.",
          });
        }
      } catch (_) {}
    }

    const now = Date.now();
    let cached = sessionCache.get(wpAuth);

    // If not in local process RAM, check distributed Redis cache across instances
    if (!cached && redis) {
      try {
        const redisData = await redis.get(`sess:${keyHash}`);
        if (redisData) {
          cached = JSON.parse(redisData);
          sessionCache.set(wpAuth, cached);
        }
      } catch (_) {}
    }

    // Check user-level revocation marker if session is in cache
    if (cached && redis && cached.userId) {
      try {
        const revTime = await redis.get(`sess:user_rev:${cached.userId}`);
        if (revTime && Number(revTime) >= cached.timestamp) {
          sessionCache.delete(wpAuth);
          return res.status(401).json({
            success: false,
            message: "Session has been revoked.",
          });
        }
      } catch (_) {}
    }

    if (cached && now - cached.timestamp < SESSION_CACHE_TTL) {
      if (!rolesMatchAuthContext(context, cached.roles)) {
        return res.status(403).json({
          success: false,
          message: "This account is not authorized for the requested application.",
        });
      }

      req.wpAuthCookie = wpAuth;
      req.wpRestNonce = req.cookies?.[cookieConfig.nonce] || (context === "customer" ? req.cookies?.mumbai_wp_nonce : undefined);
      req.wpUserId = cached.userId;
      req.wpUserEmail = cached.email || "";
      req.authContext = context;
      req.isPhoneVerified = cached.isPhoneVerified === true;
      req.isSuspended = cached.isSuspended === true;

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

    // 2. Validate session with WordPress custom auth plugin
    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
      {
        headers: {
          Cookie: wpAuth,
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
      sessionCache.delete(wpAuth);

      return res.status(401).json({
        success: false,
        message: "Session expired.",
      });
    }

    if (!rolesMatchAuthContext(context, roles)) {
      return res.status(403).json({
        success: false,
        message: "This account is not authorized for the requested application.",
      });
    }

    // 3. Cache validated session, roles, email, and name
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
      timestamp: now,
    });

    // 4. Attach authentication information to request
    req.wpAuthCookie = wpAuth;
    req.wpRestNonce = req.cookies?.[cookieConfig.nonce] || (context === "customer" ? req.cookies?.mumbai_wp_nonce : undefined);
    req.wpUserId = userId;
    req.wpUserEmail = email;
    req.authContext = context;
    req.isPhoneVerified = isPhoneVerified;
    req.isSuspended = isSuspended;

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

  const redis = getRedisClient();
  if (redis) {
    try {
      if (await redis.get(`sess:revoked:${hashCookieKey(wpAuth)}`)) {
        sessionCache.delete(wpAuth);
        return { valid: false, error: "AUTH_REQUIRED" };
      }
    } catch (_) { return { valid: false, error: "AUTH_UNAVAILABLE" }; }
  }

  const now = Date.now();
  const cached = sessionCache.get(wpAuth);
  if (cached && redis && cached.userId) {
    try {
      const revTime = await redis.get(`sess:user_rev:${cached.userId}`);
      if (revTime && Number(revTime) >= cached.timestamp) {
        sessionCache.delete(wpAuth);
        return { valid: false, error: "AUTH_REQUIRED" };
      }
    } catch (_) {
      return { valid: false, error: "AUTH_UNAVAILABLE" };
    }
  }
  if (
    cached &&
    now - cached.timestamp < SESSION_CACHE_TTL &&
    typeof cached.userId !== "undefined"
  ) {
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
    };
  }

  // Single-flight Promise deduplication
  if (inFlightValidation.has(wpAuth)) {
    return inFlightValidation.get(wpAuth);
  }

  const validationPromise = (async () => {
    try {
      const response = await axios.get(
        `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
        {
          headers: { Cookie: wpAuth },
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
        timestamp: Date.now(),
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

    const keyHash = hashCookieKey(wpAuth);
    const redis = getRedisClient();

    if (redis) {
      try {
        const isRevoked = await redis.get(`sess:revoked:${keyHash}`);
        if (isRevoked) {
          sessionCache.delete(wpAuth);
          return next();
        }
      } catch (_) {}
    }

    const now = Date.now();
    const cached = sessionCache.get(wpAuth);
    if (cached && now - cached.timestamp < SESSION_CACHE_TTL) {
      if (!rolesMatchAuthContext(context, cached.roles)) {
        return next();
      }

      req.wpAuthCookie = wpAuth;
      req.wpUserId = cached.userId;
      req.wpUserEmail = cached.email || "";
      req.isPhoneVerified = cached.isPhoneVerified === true;
      req.isSuspended = cached.isSuspended === true;
      req.user = {
        id: cached.userId,
        roles: cached.roles,
        email: cached.email || "",
        is_phone_verified: cached.isPhoneVerified === true,
        is_suspended: cached.isSuspended === true,
      };
      return next();
    }

    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
      {
        headers: { Cookie: wpAuth },
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
        timestamp: now,
      });
      req.wpAuthCookie = wpAuth;
      req.wpUserId = userId;
      req.wpUserEmail = email;
      req.isPhoneVerified = isPhoneVerified;
      req.isSuspended = isSuspended;
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
