import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { logError } from "../utils/logger.js";

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

// 60-second session cache to eliminate double-hop latency
const sessionCache = new Map();
const SESSION_CACHE_TTL = 60 * 1000; // 60 seconds

// Periodic cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();

  for (const [cookie, data] of sessionCache.entries()) {
    if (now - data.timestamp > SESSION_CACHE_TTL) {
      sessionCache.delete(cookie);
    }
  }
}, 5 * 60 * 1000).unref();

export const invalidateSessionCache = (cookie) => {
  if (cookie) {
    sessionCache.delete(cookie);
  }
};

export const invalidateUserSessionCache = (userId) => {
  if (!userId) return;
  for (const [cookie, data] of sessionCache.entries()) {
    if (data.userId === userId || Number(data.userId) === Number(userId)) {
      sessionCache.delete(cookie);
    }
  }
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

    const now = Date.now();
    const cached = sessionCache.get(wpAuth);

    // 1. Use 60-second in-memory session cache
    if (cached && now - cached.timestamp < SESSION_CACHE_TTL) {
      req.wpAuthCookie = wpAuth;
      req.wpRestNonce = req.cookies?.[cookieConfig.nonce] || (context === "customer" ? req.cookies?.mumbai_wp_nonce : undefined);
      req.wpUserId = cached.userId;
      req.wpUserEmail = cached.email || "";
      req.authContext = context;
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
    const isPhoneVerified = response.data?.is_phone_verified === true;
    const isSuspended = response.data?.is_suspended === true;

    if (!response.data?.logged_in || !userId) {
      sessionCache.delete(wpAuth);

      return res.status(401).json({
        success: false,
        message: "Session expired.",
      });
    }

    // 3. Cache validated session, roles, and email
    sessionCache.set(wpAuth, {
      userId,
      roles,
      email,
      isPhoneVerified,
      isSuspended,
      timestamp: now,
    });

    // 4. Attach authentication information to request
    req.wpAuthCookie = wpAuth;
    req.wpRestNonce = req.cookies?.[cookieConfig.nonce] || req.cookies?.mumbai_wp_nonce;
    req.wpUserId = userId;
    req.wpUserEmail = email;
    req.authContext = context;
    req.isPhoneVerified = isPhoneVerified;
    req.isSuspended = isSuspended;

    req.user = {
      id: userId,
      roles,
      email,
      is_phone_verified: isPhoneVerified,
      is_suspended: isSuspended,
    };

    return next();
  } catch (error) {
    logError(req, error, `Auth middleware error [${context}]`);

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

  const isVerified = req.isPhoneVerified ?? req.user?.is_phone_verified ?? false;
  if (!isVerified) {
    return res.status(403).json({
      success: false,
      code: "PHONE_NOT_VERIFIED",
      message: "Please verify your mobile number with OTP before accessing this feature.",
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

  const now = Date.now();
  const cached = sessionCache.get(wpAuth);
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

      if (!isLoggedIn || !userId) {
        sessionCache.delete(wpAuth);
        return { valid: false, error: "SESSION_EXPIRED" };
      }

      sessionCache.set(wpAuth, {
        userId,
        roles,
        email,
        isPhoneVerified: isVerified,
        isSuspended,
        timestamp: Date.now(),
      });

      return {
        valid: true,
        userId,
        roles,
        email,
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

export const optionalAuth = async (req, res, next) => {
  try {
    const wpAuth =
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_admin_auth ||
      req.cookies?.mumbai_employee_auth ||
      req.cookies?.mumbai_wp_auth;
    if (!wpAuth) {
      return next();
    }

    const now = Date.now();
    const cached = sessionCache.get(wpAuth);
    if (cached && now - cached.timestamp < SESSION_CACHE_TTL) {
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
    const isPhoneVerified = response.data?.is_phone_verified === true;
    const isSuspended = response.data?.is_suspended === true;

    if (response.data?.logged_in && userId) {
      sessionCache.set(wpAuth, {
        userId,
        roles,
        email,
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
        roles,
        email,
        is_phone_verified: isPhoneVerified,
        is_suspended: isSuspended,
      };
    }
  } catch (_) {
    // Non-blocking for optional auth
  }
  return next();
};
