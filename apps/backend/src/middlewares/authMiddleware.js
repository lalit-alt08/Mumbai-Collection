import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

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
      req.authContext = context;

      req.user = {
        id: cached.userId,
        roles: cached.roles,
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

    if (!response.data?.logged_in || !userId) {
      sessionCache.delete(wpAuth);

      return res.status(401).json({
        success: false,
        message: "Session expired.",
      });
    }

    // 3. Cache validated session and roles
    sessionCache.set(wpAuth, {
      userId,
      roles,
      timestamp: now,
    });

    // 4. Attach authentication information to request
    req.wpAuthCookie = wpAuth;
    req.wpRestNonce = req.cookies?.[cookieConfig.nonce] || req.cookies?.mumbai_wp_nonce;
    req.wpUserId = userId;
    req.authContext = context;

    req.user = {
      id: userId,
      roles,
    };

    return next();
  } catch (error) {
    console.error(
      `Auth middleware error [${context}]:`,
      error.response?.data || error.message
    );

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