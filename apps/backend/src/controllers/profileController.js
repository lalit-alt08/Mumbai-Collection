import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import {
  COOKIE_NAMES,
  evictSessionUserCache,
  invalidateSessionCache,
  invalidateUserSessionCache,
  setSessionCache,
  parseWordPressAuthCookie,
  checkDurableUserRevocation,
} from "../middlewares/authMiddleware.js";
import { getRedisClient } from "../config/redis.js";
import { parseFirstAndLastName } from "../utils/nameFormatter.js";
import { logError } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";

const getProfileCookieOptions = (req) => {
  const isHttps =
    Boolean(req?.secure) ||
    req?.headers?.["x-forwarded-proto"] === "https" ||
    process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  };
};

export const checkPhoneAvailability = async (req, res) => {
  try {
    const rawPhone = String(req.query.phone || req.body?.phone || "").trim();
    if (!rawPhone) {
      return res.status(400).json({
        success: false,
        available: false,
        message: "Phone number is required.",
      });
    }

    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/check-phone`,
      {
        params: { phone: rawPhone },
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          ...(req.wpUserId ? { "X-Mumbai-User-ID": String(req.wpUserId) } : {}),
        },
        httpsAgent,
        timeout: 8000,
      }
    );

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.set("Pragma", "no-cache");
    }

    res.json(response.data);
  } catch (error) {
    logError(req, error, "Check phone availability error");
    const status = error.response?.status || 500;
    const data = error.response?.data || {
      success: false,
      available: false,
      message: "Unable to check phone availability.",
    };
    res.status(status).json(data);
  }
};

export const getProfile = async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(req.wpUserId),
        },
        httpsAgent,
        timeout: 8000,
      }
    );

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.set("Pragma", "no-cache");
    }

    const payload = response.data || {};
    if (payload.profile && typeof payload.profile === "object") {
      delete payload.profile.age;
      delete payload.profile.secondary_phone;
    }
    delete payload.secondary_phone;

    res.json(payload);
  } catch (error) {
    logError(req, error, "Get profile error");

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to get profile.",
      }
    );
  }
};

export const saveProfile = async (req, res) => {
  try {
    const { phone } = req.body;
    const { firstName, lastName } = parseFirstAndLastName(req.body);

    if (!firstName) {
      return res.status(400).json({
        success: false,
        message: "First name is required.",
      });
    }

    if (!lastName) {
      return res.status(400).json({
        success: false,
        message: "Last name is required.",
      });
    }

    const cleanFullName = `${firstName} ${lastName}`;
    const isGoogleUser = req.isGoogleUser === true || req.user?.is_google_user === true;
    const { password, current_password } = isGoogleUser ? {} : req.body;
    const rawPhone = String(phone || "").trim();
    const cleanPhone = rawPhone ? rawPhone.replace(/\D/g, "").slice(-10) : "";

    const response = await axios.put(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
      {
        first_name: firstName,
        last_name: lastName,
        full_name: cleanFullName,
        phone: cleanPhone || phone,
        ...(!isGoogleUser && password ? { password } : {}),
        ...(!isGoogleUser && current_password ? { current_password } : {}),
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(req.wpUserId),
          Cookie: req.cookies?.[COOKIE_NAMES.customer.auth] || req.cookies?.mumbai_wp_auth || "",
        },
        httpsAgent,
        timeout: 8000,
      }
    );

    serverCache.invalidatePrefix("admin:customers");

    const cookieConfig = COOKIE_NAMES.customer;
    const wpAuth = req.cookies?.[cookieConfig.auth] || req.cookies?.mumbai_wp_auth;

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.set("Pragma", "no-cache");
    }

    const payload = response.data || {};
    const cookieOptions = getProfileCookieOptions(req);
    const hasNewPasswordSession = Boolean(payload.session && payload.cookie_name);

    if (hasNewPasswordSession) {
      // Authoritative session version issued directly by WordPress for the replacement token
      const authoritativeVersion = payload.session_version !== undefined && payload.session_version !== null
        ? Number(payload.session_version)
        : null;

      // Invalidate previous sessions across all devices using WordPress authoritative version
      if (req.wpUserId) {
        await invalidateUserSessionCache(req.wpUserId, authoritativeVersion);
      }
      if (wpAuth) {
        await invalidateSessionCache(wpAuth, { permanent: true });
      }

      // Check whether a newer revocation already superseded this replacement session
      if (req.wpUserId && authoritativeVersion !== null) {
        const durableUserCheck = checkDurableUserRevocation(req.wpUserId, authoritativeVersion, Date.now());
        if (durableUserCheck.revoked) {
          throw new Error("Password updated, but replacement session was superseded by a newer revocation.");
        }
        const redis = getRedisClient();
        if (redis) {
          const currentRedisVerStr = await redis.get(`sess:user_ver:${req.wpUserId}`).catch(() => null);
          const currentRedisVer = currentRedisVerStr ? Number(currentRedisVerStr) : null;
          if (currentRedisVer !== null && authoritativeVersion < currentRedisVer) {
            throw new Error("Password updated, but replacement session was superseded by a newer revocation in Redis.");
          }
        }
      }

      // Issue replacement session to this client
      const newFullCookie = `${payload.cookie_name}=${payload.session}`;
      if (typeof res.cookie === "function") {
        res.cookie(cookieConfig.auth, newFullCookie, cookieOptions);
      }
      if (payload.rest_nonce && typeof res.cookie === "function") {
        res.cookie(cookieConfig.nonce, payload.rest_nonce, cookieOptions);
      }

      // Require authoritative expiration returned by authentication authority, falling back to verified cookie expiration
      const parsedReplCookie = parseWordPressAuthCookie(newFullCookie);
      const rawExp = payload.expires_at;
      const replExpiresAt = rawExp && Number.isFinite(Number(rawExp)) && Number(rawExp) > 0
        ? Number(rawExp) * 1000
        : (parsedReplCookie?.expiresAt && Number.isFinite(Number(parsedReplCookie.expiresAt)) && Number(parsedReplCookie.expiresAt) > 0
            ? Number(parsedReplCookie.expiresAt)
            : null);

      if (!replExpiresAt) {
        throw new Error("Password updated, but replacement session deadline could not be verified.");
      }

      setSessionCache(newFullCookie, {
        userId: req.wpUserId,
        name: cleanFullName,
        roles: ["customer"],
        phone: cleanPhone || phone,
        expiresAt: replExpiresAt,
        userVersion: authoritativeVersion,
        timestamp: Date.now(),
      });
    } else {
      // Ordinary contact details / profile update (no password changed):
      // Evict cached user details across memory and Redis without revoking the session!
      if (wpAuth) {
        await evictSessionUserCache(wpAuth);
      }
    }

    if (payload.profile && typeof payload.profile === "object") {
      delete payload.profile.age;
      delete payload.profile.secondary_phone;
    }
    delete payload.secondary_phone;
    delete payload.session;
    delete payload.cookie_name;
    delete payload.rest_nonce;

    res.json(payload);
  } catch (error) {
    logError(req, error, "Save profile error");

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to save profile.",
      }
    );
  }
};

export const checkProfileComplete = async (req, res) => {
  if (typeof res.set === "function") {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
  }

  try {
    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile/complete`,
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(req.wpUserId),
        },
        httpsAgent,
        timeout: 8000,
      },
    );

    const payload = response.data || {};
    if (payload.profile && typeof payload.profile === "object") {
      delete payload.profile.age;
      delete payload.profile.secondary_phone;
    }
    delete payload.secondary_phone;

    res.json(payload);
  } catch (error) {
    logError(req, error, "Check profile complete error");

    const upstreamStatus = error.response?.status;
    const isTimeout = error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
    const isUnavailable =
      isTimeout || !error.response || upstreamStatus === 502 || upstreamStatus === 503 || upstreamStatus === 504;

    if (upstreamStatus === 401) {
      return res.status(401).json({
        success: false,
        complete: false,
        message: "Session expired or invalid.",
      });
    }

    if (isUnavailable) {
      return res.status(503).json({
        success: false,
        complete: false,
        message: "Profile completion service is temporarily unavailable. Please retry.",
      });
    }

    return res.status(500).json({
      success: false,
      complete: false,
      message: "Unable to check profile completion.",
    });
  }
};

/**
 * Permanently delete customer account from WooCommerce/WordPress
 */
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.wpUserId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const reset_token = typeof req.body?.reset_token === "string" ? req.body.reset_token : "";
    if (!password && !reset_token) {
      return res.status(400).json({
        success: false,
        message: "Your current password is required to delete your account.",
      });
    }

    // 1. Preserve the current session until WordPress verifies the password and completes deletion
    const cookieConfig = COOKIE_NAMES.customer;
    const wpAuth =
      req.cookies?.[cookieConfig.auth] || req.cookies?.mumbai_wp_auth;

    // 2. Delegate password verification and account deletion to WordPress custom plugin,
    // which also enforces role protections, session revocation, and content reassignment
    const wpDeleteRes = await axios.delete(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
      {
        data: { password, reset_token },
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(userId),
        },
        httpsAgent,
        timeout: 10000,
      }
    );

    if (wpAuth) {
      await invalidateSessionCache(wpAuth, { permanent: true });
    }
    await invalidateUserSessionCache(userId);
    serverCache.invalidatePrefix("admin:customers");

    // 3. Clear customer auth cookies on response
    const isHttps =
      req.secure ||
      req.headers["x-forwarded-proto"] === "https" ||
      process.env.NODE_ENV === "production";

    const clearOptions = {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? "none" : "lax",
      path: "/",
    };

    res.clearCookie(cookieConfig.auth, clearOptions);
    res.clearCookie(cookieConfig.nonce, clearOptions);
    res.clearCookie("mumbai_wp_auth", clearOptions);
    res.clearCookie("mumbai_wp_nonce", clearOptions);

    res.json({
      success: true,
      message: wpDeleteRes.data?.message || "Your account has been permanently deleted.",
    });
  } catch (error) {
    logError(req, error, "Delete account error");

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to delete account. Please try again.",
      }
    );
  }
};
