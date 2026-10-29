import crypto from "crypto";
import axios from "axios";
import wp from "../services/wordpress.js";
import wcApi from "../config/woocommerce.js";
import { httpsAgent } from "../config/httpAgent.js";
import { COOKIE_NAMES, invalidateSessionCache, invalidateUserSessionCache, setSessionCache } from "../middlewares/authMiddleware.js";
import { OAuth2Client } from "google-auth-library";
import { sendOtpEmail, normalizePhoneNumber } from "../services/brevoService.js";
import { formatCustomerDisplayName, parseFirstAndLastName } from "../utils/nameFormatter.js";
import { logError } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";

/**
 * Sanitizes upstream WordPress auth errors to prevent information disclosure (paths, SQL, WP internals).
 * Strips HTML tags and preserves clean user-facing error messages for legitimate client feedback.
 */
export const sanitizeAuthError = (error, defaultMessage = "Authentication request failed", fallbackStatus = 500) => {
  const status = error.response?.status || error.status || fallbackStatus;
  const upstreamData = error.response?.data;
  let message = defaultMessage;

  if (typeof upstreamData?.message === "string" && upstreamData.message.trim().length > 0) {
    const cleanMsg = upstreamData.message.replace(/<[^>]*>/g, "").trim();
    if (!/database error|sql|wpdb|syntax error|stack trace|fatal error|wp-content/i.test(cleanMsg)) {
      message = cleanMsg;
    }
  }

  const payload = {
    success: false,
    message,
  };

  if (typeof upstreamData?.code === "string") {
    payload.code = upstreamData.code;
  }

  return { status, payload };
};

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

const getCookieOptions = (req, role = "customer") => {
  const isHttps =
    req.secure ||
    req.headers["x-forwarded-proto"] === "https" ||
    process.env.NODE_ENV === "production";

  const roles = Array.isArray(role) ? role : [role];
  const isStaffSession = roles.some((value) =>
    ["admin", "administrator", "employee", "shop_manager"].includes(value)
  );

  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    maxAge: isStaffSession
      ? 12 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000,
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
    const { password } = req.body;
    const email = String(req.body.email || "").trim().toLowerCase();
    const context = resolveContext(req);
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;

    const response = await wp.post("/wp-json/mumbai-auth/v1/login", {
      email,
      password,
    });

    const data = response.data;

    // Role verification: ensure user has appropriate permissions for the requested panel context
    const userRoles = Array.isArray(data.user?.roles) ? data.user.roles : [];

    if (context === "admin" && !userRoles.includes("administrator")) {
      return res.status(403).json({
        success: false,
        message: "Access denied: Administrator privileges required.",
      });
    }

    if (
      context === "employee" &&
      !userRoles.includes("employee") &&
      !userRoles.includes("administrator")
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied: Staff privileges required.",
      });
    }

    const cookieOptions = getCookieOptions(req, userRoles);

    if (data.success && data.session && data.cookie_name) {
      const fullCookieVal = `${data.cookie_name}=${data.session}`;
      res.cookie(
        cookieConfig.auth,
        fullCookieVal,
        cookieOptions
      );

      if (data.user?.id) {
        setSessionCache(fullCookieVal, {
          userId: data.user.id,
          name: data.user.name || "",
          roles: Array.isArray(data.user.roles) ? data.user.roles : [],
          email: data.user.email || "",
          isPhoneVerified: data.user.is_phone_verified === true,
          isSuspended: data.user.is_suspended === true,
          timestamp: Date.now(),
        });
      }
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
            ...(process.env.MUMBAI_INTERNAL_API_KEY ? { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY } : {}),
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
    const { otp } = req.body;
    const email = String(req.body.email || "").trim().toLowerCase();
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

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: "Email verification code is required to create an account.",
      });
    }

    const otpHash = hashOtp(otp);
    const effectivePassword = `${crypto.randomBytes(24).toString("hex")}!Aa1`;
    const cleanFullName = `${firstName} ${lastName}`;
    const context = resolveContext(req);
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;

    // Atomic OTP verification and account creation in WordPress (Finding #11 fix)
    let response;
    try {
      response = await wp.post(
        "/wp-json/mumbai-auth/v1/register",
        {
          name: cleanFullName,
          first_name: firstName,
          last_name: lastName,
          email,
          password: effectivePassword,
          otp_hash: otpHash,
        },
        {
          headers: {
            "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          },
        }
      );
    } catch (regErr) {
      const errStatus = regErr.response?.status || 400;
      const errMsg = regErr.response?.data?.message || "Registration failed. Please check your verification code.";
      return res.status(errStatus).json({
        success: false,
        message: errMsg,
      });
    }

    // A newly registered account should be visible immediately in the admin directory.
    serverCache.invalidatePrefix("admin:customers");

    const regData = response.data;
    let authUser = regData?.user;
    let session = regData?.session;
    let cookieName = regData?.cookie_name;
    let restNonce = regData?.rest_nonce;

    // Auto-login upon registration to issue authentication cookies seamlessly
    if (!session || !cookieName) {
      try {
        const loginResponse = await wp.post("/wp-json/mumbai-auth/v1/login", {
          email,
          password: effectivePassword,
        });
        const loginData = loginResponse.data;
        if (loginData?.success && loginData.session && loginData.cookie_name) {
          session = loginData.session;
          cookieName = loginData.cookie_name;
          restNonce = loginData.rest_nonce;
          authUser = loginData.user || authUser;
        }
      } catch (loginErr) {
        logError(req, loginErr, "Auto-login after registration fallback warning");
      }
    }

    const cookieOptions = getCookieOptions(
      req,
      Array.isArray(authUser?.roles) ? authUser.roles : ["customer"]
    );

    if (session && cookieName && typeof res.cookie === "function") {
      const fullCookieVal = `${cookieName}=${session}`;
      res.cookie(cookieConfig.auth, fullCookieVal, cookieOptions);

      if (authUser?.id) {
        setSessionCache(fullCookieVal, {
          userId: authUser.id,
          name: authUser.name || cleanFullName,
          roles: Array.isArray(authUser.roles) ? authUser.roles : ["customer"],
          email: authUser.email || email,
          isPhoneVerified: authUser.is_phone_verified === true,
          isSuspended: false,
          timestamp: Date.now(),
        });
      }
    }

    if (restNonce && typeof res.cookie === "function") {
      res.cookie(cookieConfig.nonce, restNonce, cookieOptions);
    }

    res.status(200).json({
      success: true,
      message: regData?.message || "Account created successfully.",
      user: authUser,
      context,
    });
  } catch (error) {
    logError(req, error, "Registration error");
    const { status, payload } = sanitizeAuthError(error, "Registration failed");
    return res.status(status).json(payload);
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
    const { status, payload } = sanitizeAuthError(error, "Unable to process password reset request.");
    return res.status(status).json(payload);
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

    if (response.data?.user_id) {
      invalidateUserSessionCache(response.data.user_id);
    }

    res.json(response.data);
  } catch (error) {
    logError(req, error, "Reset password error");
    const { status, payload } = sanitizeAuthError(error, "Unable to reset password.");
    return res.status(status).json(payload);
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
          ...(process.env.MUMBAI_INTERNAL_API_KEY ? { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY } : {}),
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
      name: response.data?.name || response.data?.display_name || "",
      username: response.data?.username || "",
      email: response.data?.email || "",
      phone: response.data?.phone || "",
    };

    // Skip heavy WooCommerce customer lookup for administrators and staff
    const isStaffOrAdmin =
      context === "admin" ||
      context === "employee" ||
      roles.includes("administrator") ||
      roles.includes("employee");

    if (!isStaffOrAdmin && context === "customer") {
      try {
        const customerRes = await wcApi.get(`customers/${userId}`);
        if (customerRes.data) {
          const c = customerRes.data;
          const fullName = formatCustomerDisplayName(c.first_name, c.last_name, "");
          const isSystemUsername =
            (c.username || "").toLowerCase() === "mumbaicollection" ||
            (c.username || "").toLowerCase() === "mumbai collection";
          userDetails.first_name = c.first_name || "";
          userDetails.last_name = c.last_name || "";
          userDetails.name =
            fullName || (!isSystemUsername ? c.username : "") || userDetails.name;
          userDetails.username =
            (!isSystemUsername ? c.username : "") || userDetails.username;
          userDetails.email = c.email || userDetails.email;
          userDetails.phone =
            response.data?.phone || c.billing?.phone || userDetails.phone;
        }
      } catch (wcErr) {
        // Fallback: If customer endpoint returns 404, keep default user details
      }
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
    const { credential, code } = req.body;
    
    if (Boolean(credential) === Boolean(code)) {
      return res.status(400).json({
        success: false,
        message: "Provide either a Google ID credential or an authorization code.",
      });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ success: false, message: "Google Auth is not configured on the server" });
    }

    let ticket;

    if (credential) {
      const client = new OAuth2Client(clientId);
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
    } else {
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const origin = req.headers.origin;
      if (!clientSecret) {
        return res.status(500).json({
          success: false,
          message: "Google authorization-code exchange is not configured on the server.",
        });
      }
      if (!origin || req.headers["x-requested-with"] !== "XMLHttpRequest") {
        return res.status(403).json({
          success: false,
          message: "Google sign-in request could not be verified. Please try again.",
        });
      }

      // Popup authorization-code flow: exchange the one-time code server-side,
      // then verify Google's signed ID token before using any identity claims.
      const client = new OAuth2Client(clientId, clientSecret, origin);
      const tokenResponse = await client.getToken({ code, redirect_uri: origin });
      if (!tokenResponse.tokens?.id_token) {
        return res.status(400).json({
          success: false,
          message: "Google did not return a verifiable identity token.",
        });
      }
      ticket = await client.verifyIdToken({
        idToken: tokenResponse.tokens.id_token,
        audience: clientId,
      });
    }

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

    const authenticated_user_id = req.user?.id || req.wpUserId || null;

    // Call the internal SSO endpoint in our WordPress plugin
    const response = await axios.post(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/sso`,
      { email, name, google_sub, authenticated_user_id },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
        httpsAgent,
        timeout: 10000,
      }
    );

    const data = response.data;

    // Defense in depth: WordPress must only return the account belonging to
    // the verified Google email. Never issue a session for a mismatched user.
    const returnedEmail = String(data?.user?.email || "").trim().toLowerCase();
    if (!data?.success || !returnedEmail || returnedEmail !== email.trim().toLowerCase()) {
      return res.status(502).json({
        success: false,
        message: "Google sign-in could not safely match your account. Please contact support.",
      });
    }

    // Role verification: ensure user has appropriate permissions for the requested panel context
    const userRoles = Array.isArray(data.user?.roles) ? data.user.roles : [];

    if (context === "admin" && !userRoles.includes("administrator")) {
      return res.status(403).json({
        success: false,
        message: "Access denied: Administrator privileges required.",
      });
    }

    if (
      context === "employee" &&
      !userRoles.includes("employee") &&
      !userRoles.includes("administrator")
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied: Staff privileges required.",
      });
    }

    const cookieOptions = getCookieOptions(req, userRoles);

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

    if (data.is_new_user) {
      serverCache.invalidatePrefix("admin:customers");
    }

    res.json({
      success: data.success,
      message: data.message,
      user: data.user,
      is_new_user: data.is_new_user === true,
      context,
    });
  } catch (error) {
    if (error.response?.status === 403 || error.response?.status === 409) {
      return res.status(error.response.status).json({
        success: false,
        message:
          error.response?.data?.message ||
          "This Google account cannot be safely linked to the requested store account. Please sign in another way or contact support.",
      });
    }

    logError(req, error, "Google login error");
    res.status(500).json({
      success: false,
      message: "Unable to authenticate with Google.",
    });
  }
};

export const hashOtp = (otp) => {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) {
    throw new Error("OTP_HMAC_SECRET is not configured");
  }
  return crypto.createHmac("sha256", secret).update(String(otp).trim()).digest("hex");
};

export const sendOtp = async (req, res) => {
  try {
    const rawTarget = req.body.phone || req.body.email;
    const { purpose } = req.body;
    if (!rawTarget || !["reset_password", "register"].includes(purpose)) {
      return res.status(400).json({ success: false, message: "Invalid phone, email or purpose." });
    }

    let cleanPhone = "";
    const rawInput = String(rawTarget || "").trim();
    const isEmailInput = rawInput.includes("@");
    if (purpose === "register") {
      if (!isEmailInput) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address.",
        });
      }
      cleanPhone = rawInput.toLowerCase();
    } else if (isEmailInput) {
      cleanPhone = rawInput.toLowerCase();
    } else {
      const normalized = normalizePhoneNumber(rawInput);
      cleanPhone = normalized ? normalized.local : rawInput;
    }

    if (process.env.NODE_ENV !== "production") {
      const inputMasked = `...${String(rawTarget).trim().slice(-4)}`;
      const cleanMasked = `...${cleanPhone.slice(-4)}`;
      console.log(
        `[OTP Flow] input: ${inputMasked} | normalized: ${cleanMasked} | purpose: ${purpose}`
      );
    }

    // Generate secure 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashOtp(otp);

    // Store OTP state in WordPress
    const storeResponse = await wp.post(
      "/wp-json/mumbai-auth/v1/otp/store",
      {
        phone: cleanPhone,
        purpose,
        otp_hash: otpHash,
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

    const targetEmail = storeResponse.data?.email || (purpose === "register" ? cleanPhone : "");
    const targetName = storeResponse.data?.name || req.body.first_name || req.body.name || "Valued Customer";

    // Uniform response for reset_password prevents account enumeration.
    // If in cooldown or user not found, cooldown/suppression is enforced silently without leaking account existence.
    if (purpose === "reset_password") {
      if (storeResponse.data?.rate_limited === true || storeResponse.data?.user_found === false || !targetEmail) {
        return res.status(200).json({
          success: true,
          message: storeResponse.data?.message || (isEmailInput ? "If an account is registered with this email, an OTP has been sent." : "If the number is registered, an OTP has been sent."),
        });
      }
    }

    if (!targetEmail) {
      return res.status(500).json({
        success: false,
        message: "No registered email address found for this account.",
      });
    }

    // Attempt Email dispatch via Brevo
    try {
      await sendOtpEmail({
        toEmail: targetEmail,
        toName: targetName,
        otp,
        purpose,
      });
    } catch (emailError) {
      logError(req, emailError, "Brevo Email send failure. Invalidating stored OTP");

      // Invalidate stored OTP in WordPress so no active OTP is left behind
      try {
        await wp.post(
          "/wp-json/mumbai-auth/v1/otp/invalidate",
          {
            phone: cleanPhone,
            purpose,
          },
          {
            headers: {
              "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
            },
          }
        );
      } catch (invalidateErr) {
        logError(req, invalidateErr, "Failed to invalidate OTP after email failure");
      }

      return res.status(500).json({
        success: false,
        message: "Unable to send verification code. Please try again.",
      });
    }

    // Purpose-specific responses
    if (purpose === "register") {
      return res.status(200).json({
        success: true,
        message: "Verification code sent to your email address.",
      });
    }

    if (purpose === "reset_password") {
      return res.status(200).json({
        success: true,
        message: storeResponse.data?.message || (isEmailInput ? "If an account is registered with this email, an OTP has been sent." : "If the number is registered, an OTP has been sent."),
      });
    }

    return res.status(400).json({ success: false, message: "Unsupported OTP purpose." });
  } catch (error) {
    if (error.message === "OTP_HMAC_SECRET is not configured") {
      logError(req, error, "Critical OTP Configuration Error: OTP_HMAC_SECRET is missing");
    } else {
      logError(req, error, "Send OTP error");
    }
    const status = error.response?.status || 500;
    if (status === 409) {
      return res.status(409).json({
        success: false,
        code: error.response?.data?.code || "email_exists",
        message: error.response?.data?.message || "An account with this email already exists. Please sign in.",
      });
    }
    if (status === 429) {
      const headerRetry = error.response?.headers?.["retry-after"];
      const bodyRetry = error.response?.data?.retryAfter || error.response?.data?.retry_after;
      const retryAfter = Number(bodyRetry || headerRetry) || 60;
      if (typeof res.set === "function") {
        res.set("Retry-After", String(retryAfter));
      }
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please try again later.",
        retryAfter,
      });
    }
    const { status: errStatus, payload } = sanitizeAuthError(error, "Failed to send OTP");
    return res.status(errStatus).json(payload);
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const rawTarget = req.body.phone || req.body.email;
    const { otp, purpose } = req.body;
    if (!rawTarget || !otp || !purpose || !["reset_password", "register"].includes(purpose)) {
      return res.status(400).json({ success: false, message: "Missing or invalid parameters." });
    }

    const rawPhone = String(rawTarget || "").trim();
    const isEmail = rawPhone.includes("@");
    let cleanPhone = "";
    if (isEmail) {
      cleanPhone = rawPhone.toLowerCase();
    } else {
      const normalized = normalizePhoneNumber(rawPhone);
      cleanPhone = normalized ? normalized.local : rawPhone;
    }

    const otpHash = hashOtp(otp);

    const verifyResponse = await wp.post(
      "/wp-json/mumbai-auth/v1/otp/verify",
      {
        phone: cleanPhone,
        purpose,
        otp_hash: otpHash,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    return res.status(200).json(verifyResponse.data);
  } catch (error) {
    if (error.message === "OTP_HMAC_SECRET is not configured") {
      logError(req, error, "Critical OTP Configuration Error: OTP_HMAC_SECRET is missing");
    } else {
      logError(req, error, "Verify OTP error");
    }
    const { status, payload } = sanitizeAuthError(error, "OTP verification failed", 400);
    return res.status(status).json(payload);
  }
};

export const resetPasswordOtp = async (req, res) => {
  try {
    const rawTarget = req.body.phone || req.body.email;
    const { reset_token, new_password } = req.body;
    if (!rawTarget || !reset_token || !new_password) {
      return res.status(400).json({ success: false, message: "Missing parameters." });
    }

    const rawPhone = String(rawTarget || "").trim();
    const isEmail = rawPhone.includes("@");
    let cleanPhone = "";
    if (isEmail) {
      cleanPhone = rawPhone.toLowerCase();
    } else {
      const normalized = normalizePhoneNumber(rawPhone);
      cleanPhone = normalized ? normalized.local : rawPhone;
    }

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

    if (resetResponse.data?.user_id) {
      invalidateUserSessionCache(resetResponse.data.user_id);
    }

    return res.status(200).json(resetResponse.data);
  } catch (error) {
    logError(req, error, "Reset password OTP error");
    const { status, payload } = sanitizeAuthError(error, "Password reset failed", 400);
    return res.status(status).json(payload);
  }
};
