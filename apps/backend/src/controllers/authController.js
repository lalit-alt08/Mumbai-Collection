import crypto from "crypto";
import axios from "axios";
import wp from "../services/wordpress.js";
import wcApi from "../config/woocommerce.js";
import { httpsAgent } from "../config/httpAgent.js";
import {
  COOKIE_NAMES,
  getSessionValidation,
  invalidateSessionCache,
  invalidateUserSessionCache,
  rolesMatchAuthContext,
  setSessionCache,
  parseWordPressAuthCookie,
  removeDurableRevocation,
} from "../middlewares/authMiddleware.js";
import { OAuth2Client } from "google-auth-library";
import { sendOtpEmail, normalizePhoneNumber } from "../services/brevoService.js";
import { formatCustomerDisplayName, parseFirstAndLastName } from "../utils/nameFormatter.js";
import { logger, logError } from "../utils/logger.js";
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

const getContextAccessMessage = (context) => {
  if (context === "admin") return "Access denied: Administrator privileges required.";
  if (context === "employee") return "Access denied: Staff privileges required.";
  return "Access denied: Please use a customer account for the storefront.";
};

const revokeIssuedWordPressSession = async (data) => {
  if (!data?.session || !data?.cookie_name) return;

  try {
    await axios.post(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/logout`,
      {},
      {
        headers: {
          Cookie: `${data.cookie_name}=${data.session}`,
          ...(process.env.MUMBAI_INTERNAL_API_KEY
            ? { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY }
            : {}),
        },
        httpsAgent,
        timeout: 5000,
      }
    );
  } catch (error) {
    logger.warn(
      { err: error?.message },
      "[Auth] Could not revoke a WordPress session rejected by panel role policy"
    );
  }
};

const isAllowedGoogleOrigin = (origin) => {
  if (!origin) return false;

  const normalizeOrigin = (value) => {
    try {
      return new URL(value).origin.toLowerCase();
    } catch (_) {
      return "";
    }
  };

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  // Dedicated staff origins must never be accepted as customer Google login endpoints
  const staffOrigins = new Set(
    [
      ...String(process.env.ADMIN_ORIGIN || "").split(","),
      ...String(process.env.EMPLOYEE_ORIGIN || "").split(","),
    ]
      .map((value) => normalizeOrigin(value.trim()))
      .filter(Boolean)
  );

  // Explicitly configured customer-facing origins under store control
  const customerOrigins = new Set(
    [
      ...String(process.env.CUSTOMER_ORIGIN || "").split(","),
      ...String(process.env.FRONTEND_URL || "").split(","),
      ...String(process.env.CLIENT_ORIGIN || "").split(","),
      ...String(process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .filter((val) => !val.includes("admin") && !val.includes("employee")),
    ]
      .map((value) => normalizeOrigin(value.trim()))
      .filter(Boolean)
  );

  // In non-production development, allow local customer frontend dev servers on port 5173
  if (process.env.NODE_ENV !== "production") {
    customerOrigins.add("http://localhost:5173");
    customerOrigins.add("http://127.0.0.1:5173");
  }

  // Ensure staff origins are excluded even if accidentally included in ALLOWED_ORIGINS
  for (const staffOrigin of staffOrigins) {
    customerOrigins.delete(staffOrigin);
  }

  return customerOrigins.has(normalized);
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

    if (!rolesMatchAuthContext(context, userRoles)) {
      await revokeIssuedWordPressSession(data);
      return res.status(403).json({
        success: false,
        message: getContextAccessMessage(context),
      });
    }

    const cookieOptions = getCookieOptions(req, userRoles);

    let computedExpiresAt = null;
    const sessionVersion = (data.session_version !== undefined && data.session_version !== null && Number.isFinite(Number(data.session_version)))
      ? Number(data.session_version)
      : null;

    if (data.success && data.session && data.cookie_name) {
      const fullCookieVal = `${data.cookie_name}=${data.session}`;
      res.cookie(
        cookieConfig.auth,
        fullCookieVal,
        cookieOptions
      );

      const parsedFullCookie = parseWordPressAuthCookie(fullCookieVal);
      computedExpiresAt = data.expires_at && Number.isFinite(Number(data.expires_at)) && Number(data.expires_at) > 0
        ? Number(data.expires_at) * 1000
        : (parsedFullCookie?.expiresAt && Number.isFinite(Number(parsedFullCookie.expiresAt)) && Number(parsedFullCookie.expiresAt) > 0
            ? Number(parsedFullCookie.expiresAt)
            : null);

      if (data.user?.id) {
        setSessionCache(fullCookieVal, {
          userId: data.user.id,
          name: data.user.name || "",
          roles: Array.isArray(data.user.roles) ? data.user.roles : [],
          email: data.user.email || "",
          username: data.user.username || "",
          firstName: data.user.first_name || "",
          lastName: data.user.last_name || "",
          phone: data.user.phone || "",
          verifiedPhone: data.user.verified_phone || "",
          isGoogleUser: data.user.is_google_user === true,
          hasUsablePassword: data.user.has_usable_password === true,
          isPhoneVerified: data.user.is_phone_verified === true,
          isSuspended: data.user.is_suspended === true,
          expiresAt: computedExpiresAt,
          timestamp: Date.now(),
          userVersion: sessionVersion,
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
      session_version: sessionVersion,
      expires_at: computedExpiresAt ? Math.floor(computedExpiresAt / 1000) : (data.expires_at ? Number(data.expires_at) : null),
      server_now: data.server_now ? Number(data.server_now) : Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    const status = error.response?.status || 500;

    // 401 and 429 are expected authentication responses.
    if (status !== 401 && status !== 429) {
      logError(req, error, "Login error");
    }

    const { payload } = sanitizeAuthError(error, "Unable to login.", status);
    res.status(status).json(payload);
  }
};

export const logout = async (req, res) => {
  try {
    const context = resolveContext(req);
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;
    const wpAuth = req.cookies?.[cookieConfig.auth] || (context === "customer" ? req.cookies?.mumbai_wp_auth : undefined);
    const clearOptions = getClearCookieOptions(req);

    let serverRevocationSuccess = false;
    if (wpAuth) {
      // Invalidate session on WordPress server-side specifically for this session token (with retry)
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const wpLogoutRes = await axios.post(
            `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/logout`,
            {},
            {
              headers: {
                Cookie: wpAuth,
                ...(process.env.MUMBAI_INTERNAL_API_KEY ? { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY } : {}),
              },
              httpsAgent,
              timeout: 3000,
            }
          );
          if (wpLogoutRes.data?.success) {
            serverRevocationSuccess = true;
            break;
          }
        } catch (err) {
          logger.warn({ attempt, err: err?.message }, "[Auth] Upstream WordPress session revocation attempt failed during logout");
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 150));
          }
        }
      }

      // If confirmed by WordPress, remove any pending durable block and invalidate cache
      if (serverRevocationSuccess) {
        removeDurableRevocation(wpAuth);
        await invalidateSessionCache(wpAuth, { permanent: false });
      } else {
        // WordPress did not confirm destruction: record shared durable block with atomic writes
        let sharedRevocationConfirmed = false;
        try {
          sharedRevocationConfirmed = await invalidateSessionCache(wpAuth, { permanent: true });
        } catch (dErr) {
          logger.error({ err: dErr?.message }, "[Auth] Failed recording durable revocation during unconfirmed logout");
        }

        logger.warn({ sharedRevocationConfirmed }, "[Auth] Logout could not confirm WordPress server session destruction");
        const isForce = req.body?.force === true || req.query?.force === "true";
        if (isForce) {
          res.clearCookie(cookieConfig.auth, clearOptions);
          res.clearCookie(cookieConfig.nonce, clearOptions);
          return res.status(200).json({
            success: true,
            server_revocation_confirmed: false,
            shared_revocation_persisted: sharedRevocationConfirmed,
            cookie_cleared: true,
            message: "Local logout completed. Server session revocation could not be confirmed.",
            context,
          });
        }

        return res.status(500).json({
          success: false,
          server_revocation_confirmed: false,
          shared_revocation_persisted: sharedRevocationConfirmed,
          cookie_cleared: false,
          code: "LOGOUT_REVOCATION_FAILED",
          message: "Logout could not confirm server session revocation in WordPress. Credentials preserved for retry. Pass force=true to clear anyway.",
          context,
        });
      }
    }

    // Clear only this panel's cookies, leaving other panels untouched
    res.clearCookie(cookieConfig.auth, clearOptions);
    res.clearCookie(cookieConfig.nonce, clearOptions);

    res.json({
      success: true,
      server_revocation_confirmed: serverRevocationSuccess,
      cookie_cleared: true,
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
    const { otp, registration_token, password } = req.body;
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

    if (!otp && !registration_token) {
      return res.status(400).json({
        success: false,
        message: "Email verification code is required to create an account.",
      });
    }

    const otpHash = otp ? hashOtp(otp) : undefined;
    const effectivePassword = password;
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
          registration_token,
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

    const sessionEstablished = Boolean(session && cookieName);

    if (sessionEstablished && typeof res.cookie === "function") {
      const fullCookieVal = `${cookieName}=${session}`;
      res.cookie(cookieConfig.auth, fullCookieVal, cookieOptions);

      if (authUser?.id) {
        const regExpiresAt = (response.data?.expires_at
          ? Number(response.data.expires_at)
          : Math.floor(Date.now() / 1000) + 30 * 86400) * 1000;

        const regVersion = (response.data?.session_version !== undefined && response.data.session_version !== null && Number.isFinite(Number(response.data.session_version)))
          ? Number(response.data.session_version)
          : null;

        setSessionCache(fullCookieVal, {
          userId: authUser.id,
          name: authUser.name || cleanFullName,
          roles: Array.isArray(authUser.roles) ? authUser.roles : ["customer"],
          email: authUser.email || email,
          username: authUser.username || "",
          firstName: authUser.first_name || firstName,
          lastName: authUser.last_name || lastName,
          phone: authUser.phone || "",
          verifiedPhone: authUser.verified_phone || "",
          isGoogleUser: authUser.is_google_user === true,
          hasUsablePassword: authUser.has_usable_password !== false,
          isPhoneVerified: authUser.is_phone_verified === true,
          isSuspended: authUser.is_suspended === true,
          expiresAt: regExpiresAt,
          timestamp: Date.now(),
          userVersion: regVersion,
        });
      }
    }

    if (restNonce && typeof res.cookie === "function") {
      res.cookie(cookieConfig.nonce, restNonce, cookieOptions);
    }

    res.status(200).json({
      success: true,
      message: sessionEstablished
        ? (regData?.message || "Account created successfully.")
        : "Account created successfully. Please sign in to continue.",
      user: authUser,
      context,
      session_established: sessionEstablished,
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
      const revoked = await invalidateUserSessionCache(
        response.data.user_id,
        response.data.session_version
      );
      if (!revoked) {
        logger.warn(
          { userId: response.data.user_id },
          "[Auth] User revocation marker could not be persisted to Redis after reset password"
        );
      }
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

    const session = await getSessionValidation(wpAuth);
    if (!session.valid) {
      if (["AUTH_UNAVAILABLE", "AUTH_TIMEOUT"].includes(session.error)) {
        return res.status(503).json({
          success: false,
          unavailable: true,
          logged_in: false,
          user: null,
          message: "Authentication service temporarily unavailable.",
        });
      }

      return res.status(401).json({
        success: false,
        logged_in: false,
        user: null,
        message: "Session expired or invalid.",
      });
    }

    const userId = session.userId;
    const roles = Array.isArray(session.roles) ? session.roles : [];
    if (!rolesMatchAuthContext(context, roles)) {
      return res.status(403).json({
        success: false,
        logged_in: false,
        user: null,
        message: getContextAccessMessage(context),
      });
    }

    let userDetails = {
      id: userId,
      roles,
      name: session.name || "",
      username: session.username || "",
      email: session.email || "",
      phone: session.phone || "",
      first_name: session.firstName || "",
      last_name: session.lastName || "",
      is_google_user: session.isGoogleUser === true,
      has_usable_password: session.hasUsablePassword === true,
    };

    // Skip the heavy WooCommerce customer lookup when the cached WordPress
    // session already contains display data, and always skip it for staff.
    const hasNameData = Boolean(userDetails.first_name || userDetails.name);
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
          userDetails.first_name = c.first_name || userDetails.first_name || "";
          userDetails.last_name = c.last_name || userDetails.last_name || "";
          userDetails.name =
            fullName || (!isSystemUsername ? c.username : "") || userDetails.name;
          userDetails.username =
            (!isSystemUsername ? c.username : "") || userDetails.username;
          userDetails.email = c.email || userDetails.email;
          userDetails.phone =
            session.phone || c.billing?.phone || userDetails.phone;
        }
      } catch (wcErr) {
        // Fallback: If customer endpoint returns 404, keep default user details
      }
    }

    if (!userDetails.phone && session.phone) {
      userDetails.phone = session.phone;
    }
    userDetails.is_phone_verified = session.isPhoneVerified === true;
    userDetails.verified_phone = session.verifiedPhone || "";

    res.json({
      success: true,
      logged_in: true,
      current_user_id: userId,
      roles,
      user: userDetails,
      session_version: session.userVersion !== undefined ? session.userVersion : null,
      is_phone_verified: session.isPhoneVerified === true,
      verified_phone: session.verifiedPhone || "",
      expires_at: session.expiresAt ? Math.floor(session.expiresAt / 1000) : null,
      server_now: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    const isUpstreamOutage =
      !error.response ||
      error.response.status >= 500 ||
      error.code === "ECONNREFUSED" ||
      error.code === "ETIMEDOUT";

    if (isUpstreamOutage) {
      return res.status(503).json({
        success: false,
        unavailable: true,
        logged_in: false,
        user: null,
        message: "Authentication service temporarily unavailable.",
      });
    }

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
    const { credential, code, intent } = req.body;
    
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
      if (!isAllowedGoogleOrigin(origin) || req.headers["x-requested-with"] !== "XMLHttpRequest") {
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

    if (intent === "link") {
      if (!authenticated_user_id) {
        return res.status(401).json({
          success: false,
          message: "You must be signed in to link a Google account. Please refresh and try again.",
        });
      }
    }

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

    if (!rolesMatchAuthContext(context, userRoles)) {
      await revokeIssuedWordPressSession(data);
      return res.status(403).json({
        success: false,
        message: getContextAccessMessage(context),
      });
    }

    // Explicit linking verification: Ensure returned user ID matches the authenticated customer
    if (intent === "link") {
      if (Number(data?.user?.id) !== Number(authenticated_user_id)) {
        await revokeIssuedWordPressSession(data);
        return res.status(409).json({
          success: false,
          message: "This Google account belongs to a different store account and cannot be linked.",
        });
      }
    }

    const cookieOptions = getCookieOptions(req, userRoles);

    if (data.success && data.session && data.cookie_name) {
      const fullCookieVal = `${data.cookie_name}=${data.session}`;
      res.cookie(
        cookieConfig.auth,
        fullCookieVal,
        cookieOptions
      );

      const parsedFullCookie = parseWordPressAuthCookie(fullCookieVal);
      const computedExpiresAt = data.expires_at && Number.isFinite(Number(data.expires_at)) && Number(data.expires_at) > 0
        ? Number(data.expires_at) * 1000
        : (parsedFullCookie?.expiresAt && Number.isFinite(Number(parsedFullCookie.expiresAt)) && Number(parsedFullCookie.expiresAt) > 0
            ? Number(parsedFullCookie.expiresAt)
            : null);

      if (data.user?.id) {
        const ssoVersion = (data.session_version !== undefined && data.session_version !== null && Number.isFinite(Number(data.session_version)))
          ? Number(data.session_version)
          : null;

        setSessionCache(fullCookieVal, {
          userId: data.user.id,
          name: data.user.name || "",
          roles: userRoles,
          email: data.user.email || "",
          username: data.user.username || "",
          firstName: data.user.first_name || "",
          lastName: data.user.last_name || "",
          phone: data.user.phone || "",
          verifiedPhone: data.user.verified_phone || "",
          isGoogleUser: data.user.is_google_user === true,
          hasUsablePassword: data.user.has_usable_password === true,
          isPhoneVerified: data.user.is_phone_verified === true,
          isSuspended: data.user.is_suspended === true,
          expiresAt: computedExpiresAt,
          timestamp: Date.now(),
          userVersion: ssoVersion,
        });
      }
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
      const revoked = await invalidateUserSessionCache(
        resetResponse.data.user_id,
        resetResponse.data.session_version
      );
      if (!revoked) {
        logger.warn(
          { userId: resetResponse.data.user_id },
          "[Auth] User revocation marker could not be persisted to Redis after OTP reset"
        );
      }
    }

    return res.status(200).json(resetResponse.data);
  } catch (error) {
    logError(req, error, "Reset password OTP error");
    const { status, payload } = sanitizeAuthError(error, "Password reset failed", 400);
    return res.status(status).json(payload);
  }
};
