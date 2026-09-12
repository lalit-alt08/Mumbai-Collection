import crypto from "crypto";
import axios from "axios";
import wp from "../services/wordpress.js";
import wcApi from "../config/woocommerce.js";
import { httpsAgent } from "../config/httpAgent.js";
import { COOKIE_NAMES, invalidateSessionCache } from "../middlewares/authMiddleware.js";
import { OAuth2Client } from "google-auth-library";
import { sendOtpSms, normalizePhoneNumber } from "../services/brevoService.js";
import { formatCustomerDisplayName, parseFirstAndLastName } from "../utils/nameFormatter.js";
import { logError } from "../utils/logger.js";

const resolveContext = (req) => {
  const panel = req.body?.context || req.query?.context || req.headers["x-mumbai-panel"];
  if (panel === "admin") return "admin";
  if (panel === "employee") return "employee";
  if (panel === "customer") return "customer";

  const origin = req.headers.origin;
  const isDev = process.env.NODE_ENV === "development";

  if (origin && (origin === process.env.ADMIN_ORIGIN || (isDev && origin.includes(":5174")))) {
    return "admin";
  }
  if (origin && (origin === process.env.EMPLOYEE_ORIGIN || (isDev && origin.includes(":5175")))) {
    return "employee";
  }

  return "customer";
};

const getCookieOptions = (req) => {
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

const getClearCookieOptions = (req) => {
  const isHttps =
    req.secure ||
    req.headers["x-forwarded-proto"] === "https" ||
    process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    path: "/",
  };
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const context = resolveContext(req);
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;
    const cookieOptions = getCookieOptions(req);

    const response = await wp.post("/wp-json/mumbai-auth/v1/login", {
      email,
      password,
    });

    const data = response.data;

    if (data.success && data.session && data.cookie_name) {
      res.cookie(
        cookieConfig.auth,
        `${data.cookie_name}=${data.session}`,
        cookieOptions
      );
    }

    if (data.rest_nonce) {
      res.cookie(cookieConfig.nonce, data.rest_nonce, cookieOptions);
    }

    res.json({
      success: data.success,
      message: data.message,
      user: data.user,
      context,
    });
  } catch (error) {
    const status = error.response?.status || 500;

    // 401 and 429 are expected authentication responses.
    if (status !== 401 && status !== 429) {
      logError(req, error, "Login error");
    }

    res.status(status).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Unable to login.",
    });
  }
};

export const logout = async (req, res) => {
  try {
    const context = resolveContext(req);
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;
    const wpAuth = req.cookies?.[cookieConfig.auth] || (context === "customer" ? req.cookies?.mumbai_wp_auth : undefined);
    const clearOptions = getClearCookieOptions(req);

    if (wpAuth) {
      invalidateSessionCache(wpAuth);

      // Invalidate session on WordPress server-side specifically for this session token
      await axios.post(
        `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/logout`,
        {},
        {
          headers: {
            Cookie: wpAuth,
          },
          httpsAgent,
          timeout: 5000,
        }
      ).catch(() => {});
    }

    // Clear only this panel's cookies, leaving other panels untouched
    res.clearCookie(cookieConfig.auth, clearOptions);
    res.clearCookie(cookieConfig.nonce, clearOptions);

    res.json({
      success: true,
      message: "Logged out successfully.",
      context,
    });
  } catch (error) {
    logError(req, error, "Logout error");

    res.status(500).json({
      success: false,
      message: "Unable to logout.",
    });
  }
};

export const register = async (req, res) => {
  try {
    const { email, password } = req.body;
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

    const response = await wp.post("/wp-json/mumbai-auth/v1/register", {
      name: cleanFullName,
      first_name: firstName,
      last_name: lastName,
      email,
      password,
    });

    res.status(200).json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Registration failed",
      },
    );
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const response = await wp.post("/wp-json/mumbai-auth/v1/forgot-password", {
      email,
    });

    res.json(response.data);
  } catch (error) {
    logError(req, error, "Forgot password error");

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to process password reset request.",
      },
    );
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: "Reset token and password are required.",
      });
    }

    const response = await wp.post("/wp-json/mumbai-auth/v1/reset-password", {
      token,
      password,
    });

    res.json(response.data);
  } catch (error) {
    logError(req, error, "Reset password error");

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to reset password.",
      },
    );
  }
};

export const me = async (req, res) => {
  try {
    const context = resolveContext(req);
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;
    const wpAuth = req.cookies?.[cookieConfig.auth] || (context === "customer" ? req.cookies?.mumbai_wp_auth : undefined);

    if (!wpAuth) {
      return res.status(401).json({
        success: false,
        logged_in: false,
        user: null,
        message: "No authentication cookie provided.",
      });
    }

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
    const loggedIn = response.data?.logged_in === true && !!userId;

    if (!loggedIn) {
      return res.status(401).json({
        success: false,
        logged_in: false,
        user: null,
        message: "Session expired or invalid.",
      });
    }

    let userDetails = {
      id: userId,
      roles,
      name: "",
      username: "",
      email: "",
    };

    try {
      const customerRes = await wcApi.get(`customers/${userId}`);
      if (customerRes.data) {
        const c = customerRes.data;
        const fullName = formatCustomerDisplayName(c.first_name, c.last_name, "");
        const isSystemUsername = (c.username || "").toLowerCase() === "mumbaicollection" || (c.username || "").toLowerCase() === "mumbai collection";
        userDetails.first_name = c.first_name || "";
        userDetails.last_name = c.last_name || "";
        userDetails.name = fullName || (!isSystemUsername ? c.username : "") || "";
        userDetails.username = (!isSystemUsername ? c.username : "") || "";
        userDetails.email = c.email || "";
        userDetails.phone = response.data?.phone || c.billing?.phone || "";
      }
    } catch (wcErr) {
      // Fallback: If customer endpoint returns 404 (e.g. administrator/shop_manager), keep default user details
    }

    if (!userDetails.phone && response.data?.phone) {
      userDetails.phone = response.data.phone;
    }
    userDetails.is_phone_verified = response.data?.is_phone_verified === true;
    userDetails.verified_phone = response.data?.verified_phone || "";

    res.json({
      success: true,
      logged_in: true,
      current_user_id: userId,
      roles,
      user: userDetails,
      is_phone_verified: response.data?.is_phone_verified === true,
      verified_phone: response.data?.verified_phone || "",
    });
  } catch (error) {
    res.status(error.response?.status || 401).json({
      success: false,
      logged_in: false,
      user: null,
      message: "Session verification failed.",
    });
  }
};

export const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;
    
    if (!credential) {
      return res.status(400).json({ success: false, message: "Google credential is required" });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ success: false, message: "Google Auth is not configured on the server" });
    }

    const client = new OAuth2Client(clientId);
    
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    
    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      return res.status(400).json({ success: false, message: "Invalid Google token payload" });
    }

    if (payload.email_verified !== true) {
      return res.status(400).json({ success: false, message: "Google email is not verified" });
    }

    const email = payload.email;
    const name = payload.name || "Customer";
    const google_sub = payload.sub;

    const context = resolveContext(req);
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;
    const cookieOptions = getCookieOptions(req);

    // Call the internal SSO endpoint in our WordPress plugin
    const response = await axios.post(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/sso`,
      { email, name, google_sub },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
        httpsAgent,
        timeout: 10000,
      }
    );

    const data = response.data;

    if (data.success && data.session && data.cookie_name) {
      res.cookie(
        cookieConfig.auth,
        `${data.cookie_name}=${data.session}`,
        cookieOptions
      );
    }

    if (data.rest_nonce) {
      res.cookie(cookieConfig.nonce, data.rest_nonce, cookieOptions);
    }

    res.json({
      success: data.success,
      message: data.message,
      user: data.user,
      context,
    });
  } catch (error) {
    logError(req, error, "Google login error");
    res.status(500).json({
      success: false,
      message: "Unable to authenticate with Google.",
    });
  }
};


export const sendOtp = async (req, res) => {
  try {
    const { phone, purpose } = req.body;
    if (!phone || !["verify_phone", "reset_password"].includes(purpose)) {
      return res.status(400).json({ success: false, message: "Invalid phone or purpose." });
    }

    const normalized = normalizePhoneNumber(phone);
    if (!normalized) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit Indian mobile number.",
      });
    }
    const cleanPhone = normalized.local;

    if (process.env.NODE_ENV !== "production") {
      const inputMasked = `...${String(phone).trim().slice(-4)}`;
      const normalizedMasked = `...${cleanPhone.slice(-4)}`;
      console.log(
        `[OTP Flow] input: ${inputMasked} | normalized: ${normalizedMasked} | purpose: ${purpose}`
      );
    }

    // Hardening: verify_phone OTP send strictly requires an authenticated customer session.
    // Customer identity must be derived solely from the authenticated session.
    // Never accept arbitrary user_id from req.body.
    let userId = 0;
    if (purpose === "verify_phone") {
      userId = req.wpUserId || req.user?.id || 0;
      if (!userId && req.cookies) {
        const cookieConfig = COOKIE_NAMES.customer;
        const wpAuth = req.cookies?.[cookieConfig.auth] || req.cookies?.mumbai_wp_auth;
        if (wpAuth) {
          try {
            const meRes = await axios.get(
              `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
              {
                headers: { Cookie: wpAuth },
                httpsAgent,
                timeout: 4000,
              }
            );
            if (meRes.data?.current_user_id) {
              userId = meRes.data.current_user_id;
            }
          } catch (_) {}
        }
      }

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required to verify phone number.",
        });
      }
    }

    // Generate secure 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    // Store OTP state in WordPress
    const storeResponse = await wp.post(
      "/wp-json/mumbai-auth/v1/otp/store",
      {
        phone: cleanPhone,
        purpose,
        otp_hash: otpHash,
        user_id: userId,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    if (!storeResponse.data?.success) {
      return res.status(400).json({
        success: false,
        message: storeResponse.data?.message || "Failed to request OTP.",
      });
    }

    // Account enumeration prevention: if reset_password and user was not found or is in cooldown, return generic success without sending SMS
    if (purpose === "reset_password" && (storeResponse.data?.user_found === false || storeResponse.data?.rate_limited === true)) {
      return res.status(200).json({
        success: true,
        message: storeResponse.data.message || "If the number is registered, an OTP has been sent.",
      });
    }

    // Attempt SMS dispatch via Brevo
    try {
      await sendOtpSms({
        phone: cleanPhone,
        otp,
      });
    } catch (smsError) {
      logError(req, smsError, "Brevo SMS send failure. Invalidating stored OTP");

      // Invalidate stored OTP in WordPress so no active OTP is left behind
      try {
        await wp.post(
          "/wp-json/mumbai-auth/v1/otp/invalidate",
          {
            phone: cleanPhone,
            purpose,
            user_id: userId,
          },
          {
            headers: {
              "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
            },
          }
        );
      } catch (invalidateErr) {
        logError(req, invalidateErr, "Failed to invalidate OTP after SMS failure");
      }

      return res.status(500).json({
        success: false,
        message: "Unable to send verification code. Please try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: storeResponse.data.message || (purpose === "reset_password"
        ? "If the number is registered, an OTP has been sent."
        : "Verification code sent successfully."),
    });
  } catch (error) {
    return res.status(error.response?.status || 500).json(
      error.response?.data || { success: false, message: "Failed to send OTP" }
    );
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { phone, otp, purpose } = req.body;
    if (!phone || !otp || !purpose) {
      return res.status(400).json({ success: false, message: "Missing parameters." });
    }

    const normalized = normalizePhoneNumber(phone);
    const cleanPhone = normalized ? normalized.local : String(phone).replace(/\D/g, "");

    // Hardening: verify_phone OTP verify strictly requires an authenticated customer session.
    // Customer identity must be derived solely from the authenticated session.
    // Never accept arbitrary user_id from req.body.
    let userId = 0;
    if (purpose === "verify_phone") {
      userId = req.wpUserId || req.user?.id || 0;
      if (!userId && req.cookies) {
        const cookieConfig = COOKIE_NAMES.customer;
        const wpAuth = req.cookies?.[cookieConfig.auth] || req.cookies?.mumbai_wp_auth;
        if (wpAuth) {
          try {
            const meRes = await axios.get(
              `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
              {
                headers: { Cookie: wpAuth },
                httpsAgent,
                timeout: 4000,
              }
            );
            if (meRes.data?.current_user_id) {
              userId = meRes.data.current_user_id;
            }
          } catch (_) {}
        }
      }

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required to verify phone number.",
        });
      }
    }

    const otpHash = crypto.createHash("sha256").update(String(otp).trim()).digest("hex");

    const verifyResponse = await wp.post(
      "/wp-json/mumbai-auth/v1/otp/verify",
      {
        phone: cleanPhone,
        purpose,
        otp_hash: otpHash,
        user_id: userId,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    if (purpose === "verify_phone" && verifyResponse.data?.success) {
      const cookieConfig = COOKIE_NAMES.customer;
      const wpAuth = req.cookies?.[cookieConfig.auth] || req.cookies?.mumbai_wp_auth;
      if (wpAuth) {
        invalidateSessionCache(wpAuth);
      }
    }

    return res.status(200).json(verifyResponse.data);
  } catch (error) {
    return res.status(error.response?.status || 400).json(
      error.response?.data || { success: false, message: "OTP verification failed" }
    );
  }
};

export const resetPasswordOtp = async (req, res) => {
  try {
    const { phone, reset_token, new_password } = req.body;
    if (!phone || !reset_token || !new_password) {
      return res.status(400).json({ success: false, message: "Missing parameters." });
    }

    const normalized = normalizePhoneNumber(phone);
    const cleanPhone = normalized ? normalized.local : String(phone).replace(/\D/g, "");

    const resetResponse = await wp.post(
      "/wp-json/mumbai-auth/v1/otp/reset-password",
      {
        phone: cleanPhone,
        reset_token,
        new_password,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    return res.status(200).json(resetResponse.data);
  } catch (error) {
    return res.status(error.response?.status || 400).json(
      error.response?.data || { success: false, message: "Password reset failed" }
    );
  }
};
