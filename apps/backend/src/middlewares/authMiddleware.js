import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

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

export const requireAuth = async (req, res, next) => {
  try {
    const wpAuth = req.cookies?.mumbai_wp_auth;

    if (!wpAuth) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const now = Date.now();
    const cached = sessionCache.get(wpAuth);

    if (cached && now - cached.timestamp < SESSION_CACHE_TTL) {
      req.wpAuthCookie = wpAuth;
      req.wpRestNonce = req.cookies?.mumbai_wp_nonce;
      req.wpUserId = cached.userId;
      return next();
    }

    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
      {
        headers: {
          Cookie: wpAuth,
        },
        httpsAgent,
        timeout: 8000,
      },
    );

    if (!response.data?.logged_in || !response.data?.current_user_id) {
      sessionCache.delete(wpAuth);
      return res.status(401).json({
        success: false,
        message: "Session expired.",
      });
    }

    sessionCache.set(wpAuth, {
      userId: response.data.current_user_id,
      timestamp: now,
    });

    req.wpAuthCookie = wpAuth;
    req.wpRestNonce = req.cookies?.mumbai_wp_nonce;
    req.wpUserId = response.data.current_user_id;

    next();
  } catch (error) {
    console.error(
      "❌ Auth Middleware Error:",
      error.response?.status || error.message,
    );

    return res.status(error.response?.status || 401).json({
      success: false,
      message: "Authentication required.",
    });
  }
};
