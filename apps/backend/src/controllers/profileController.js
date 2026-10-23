import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import {
  COOKIE_NAMES,
  invalidateSessionCache,
  invalidateUserSessionCache,
} from "../middlewares/authMiddleware.js";
import { parseFirstAndLastName } from "../utils/nameFormatter.js";
import { logError } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";

const getProfileCookieOptions = (req) => {
  const isHttps =
    req.secure ||
    req.headers["x-forwarded-proto"] === "https" ||
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
    const { password } = req.body;

    const response = await axios.put(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
      {
        first_name: firstName,
        last_name: lastName,
        full_name: cleanFullName,
        phone,
        ...(password ? { password } : {}),
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(req.wpUserId),
        },
        httpsAgent,
        timeout: 8000,
      }
    );

    serverCache.invalidatePrefix("admin:customers");

    const cookieConfig = COOKIE_NAMES.customer;
    const wpAuth = req.cookies?.[cookieConfig.auth] || req.cookies?.mumbai_wp_auth;
    if (wpAuth) {
      invalidateSessionCache(wpAuth);
    }
    if (req.wpUserId) {
      invalidateUserSessionCache(req.wpUserId);
    }

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.set("Pragma", "no-cache");
    }

    const payload = response.data || {};
    const cookieOptions = getProfileCookieOptions(req);

    // Setting a WordPress password invalidates cookies derived from the old
    // password hash. WordPress returns a replacement session so profile setup
    // can continue saving the address and refreshing the signed-in user.
    if (payload.session && payload.cookie_name && typeof res.cookie === "function") {
      res.cookie(
        cookieConfig.auth,
        `${payload.cookie_name}=${payload.session}`,
        cookieOptions
      );
    }
    if (payload.rest_nonce && typeof res.cookie === "function") {
      res.cookie(cookieConfig.nonce, payload.rest_nonce, cookieOptions);
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
    logError(req, error, "Check profile complete error");

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to check profile completion.",
      },
    );
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

    // 1. Invalidate session cache & WordPress token
    const cookieConfig = COOKIE_NAMES.customer;
    const wpAuth =
      req.cookies?.[cookieConfig.auth] || req.cookies?.mumbai_wp_auth;

    if (wpAuth) {
      invalidateSessionCache(wpAuth);

      // Invalidate session on WordPress server-side
      await axios
        .post(
          `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/logout`,
          {},
          {
            headers: {
              Cookie: wpAuth,
            },
            httpsAgent,
            timeout: 5000,
          }
        )
        .catch(() => {});
    }

    invalidateUserSessionCache(userId);

    // 2. Delegate account deletion to WordPress custom plugin to enforce role protections,
    // session revocation, and content reassignment
    const wpDeleteRes = await axios.delete(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(userId),
        },
        httpsAgent,
        timeout: 10000,
      }
    );

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
