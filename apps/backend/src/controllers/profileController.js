import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import wcApi from "../config/woocommerce.js";
import {
  COOKIE_NAMES,
  invalidateSessionCache,
} from "../middlewares/authMiddleware.js";
import { parseFirstAndLastName } from "../utils/nameFormatter.js";
import { logError } from "../utils/logger.js";

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

    res.json(response.data);
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
    const { age, phone } = req.body;
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

    const response = await axios.put(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
      {
        first_name: firstName,
        last_name: lastName,
        full_name: cleanFullName,
        age,
        phone,
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

    const cookieConfig = COOKIE_NAMES.customer;
    const wpAuth = req.cookies?.[cookieConfig.auth] || req.cookies?.mumbai_wp_auth;
    if (wpAuth) {
      invalidateSessionCache(wpAuth);
    }

    res.json(response.data);
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

    res.json(response.data);
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

    // 2. Permanently delete customer from WooCommerce & WordPress (force: true)
    // This permanently erases the user row and all associated user metadata
    await wcApi.delete(`customers/${userId}`, {
      force: true,
    });

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
      message: "Your account has been permanently deleted.",
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
