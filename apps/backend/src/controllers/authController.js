import axios from "axios";
import wp from "../services/wordpress.js";
import wcApi from "../config/woocommerce.js";
import { httpsAgent } from "../config/httpAgent.js";
import {
  COOKIE_NAMES,
  getSessionValidation,
  invalidateSessionCache,
  rolesMatchAuthContext,
  removeDurableRevocation,
} from "../middlewares/authMiddleware.js";
import { parseFirstAndLastName } from "../utils/nameFormatter.js";
import { logger, logError } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import { sanitizeAuthError } from "../utils/authErrorSanitizer.js";
import {
  resolveContext,
  getContextAccessMessage,
  getInternalHeaders,
  revokeIssuedWordPressSession,
  getCookieOptions,
  getClearCookieOptions,
  clearPanelCookies,
  revokeUpstreamWordPressSession,
  revokeUserSessionsOnPasswordChange,
  attachSessionCookiesAndCache,
  buildUserProfile,
} from "../utils/authCookieUtils.js";
import { verifyGoogleAuthPayload } from "../services/googleAuthService.js";
import {
  hashOtp,
  processSendOtp,
  processVerifyOtp,
  processResetPasswordOtp,
} from "../services/authOtpService.js";

// Re-export utilities for external consumers and tests
export { sanitizeAuthError } from "../utils/authErrorSanitizer.js";
export { hashOtp } from "../services/authOtpService.js";

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
    const userRoles = Array.isArray(data.user?.roles) ? data.user.roles : [];

    if (!rolesMatchAuthContext(context, userRoles)) {
      await revokeIssuedWordPressSession(data);
      return res.status(403).json({
        success: false,
        message: getContextAccessMessage(context),
      });
    }

    const { computedExpiresAt, sessionVersion } = attachSessionCookiesAndCache(res, req, {
      data,
      user: data.user,
      context,
      cookieConfig,
    });

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
      serverRevocationSuccess = await revokeUpstreamWordPressSession(wpAuth);

      if (serverRevocationSuccess) {
        removeDurableRevocation(wpAuth);
        await invalidateSessionCache(wpAuth, { permanent: false });
      } else {
        let sharedRevocationConfirmed = false;
        try {
          sharedRevocationConfirmed = await invalidateSessionCache(wpAuth, { permanent: true });
        } catch (dErr) {
          logger.error({ err: dErr?.message }, "[Auth] Failed recording durable revocation during unconfirmed logout");
        }

        logger.warn({ sharedRevocationConfirmed }, "[Auth] Logout could not confirm WordPress server session destruction");
        const isForce = req.body?.force === true || req.query?.force === "true";
        if (isForce) {
          clearPanelCookies(res, cookieConfig, clearOptions);
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

    clearPanelCookies(res, cookieConfig, clearOptions);
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
          headers: getInternalHeaders(),
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

    serverCache.invalidatePrefix("admin:customers");

    const regData = response.data;
    let authUser = regData?.user;
    let session = regData?.session;
    let cookieName = regData?.cookie_name;
    let restNonce = regData?.rest_nonce;

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

    const sessionEstablished = Boolean(session && cookieName);

    if (sessionEstablished) {
      attachSessionCookiesAndCache(res, req, {
        data: {
          success: true,
          session,
          cookie_name: cookieName,
          rest_nonce: restNonce,
          expires_at: response.data?.expires_at,
          session_version: response.data?.session_version,
        },
        user: authUser || {
          id: regData?.user_id,
          name: cleanFullName,
          first_name: firstName,
          last_name: lastName,
          email,
          roles: ["customer"],
        },
        context,
        cookieConfig,
        isRegistration: true,
      });
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

    await revokeUserSessionsOnPasswordChange(
      response.data?.user_id,
      response.data?.session_version,
      "reset password"
    );

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

    const isStaffOrAdmin =
      context === "admin" ||
      context === "employee" ||
      roles.includes("administrator") ||
      roles.includes("employee");

    let wcCustomer = null;
    if (!isStaffOrAdmin && context === "customer") {
      try {
        const customerRes = await wcApi.get(`customers/${userId}`);
        if (customerRes.data) wcCustomer = customerRes.data;
      } catch (wcErr) {
        // Fallback: If customer endpoint returns 404, keep default user details
      }
    }

    const userDetails = buildUserProfile(session, roles, wcCustomer);

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
    const authResult = await verifyGoogleAuthPayload(req);
    if (!authResult.success) {
      return res.status(authResult.status).json(authResult.payload);
    }

    const { email, name, google_sub } = authResult.data;
    const { intent } = req.body;
    const context = resolveContext(req);
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;
    const authenticated_user_id = req.user?.id || req.wpUserId || null;

    if (intent === "link" && !authenticated_user_id) {
      return res.status(401).json({
        success: false,
        message: "You must be signed in to link a Google account. Please refresh and try again.",
      });
    }

    const response = await axios.post(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/sso`,
      { email, name, google_sub, authenticated_user_id },
      {
        headers: getInternalHeaders(),
        httpsAgent,
        timeout: 10000,
      }
    );

    const data = response.data;
    const returnedEmail = String(data?.user?.email || "").trim().toLowerCase();
    if (!data?.success || !returnedEmail || returnedEmail !== email.trim().toLowerCase()) {
      return res.status(502).json({
        success: false,
        message: "Google sign-in could not safely match your account. Please contact support.",
      });
    }

    const userRoles = Array.isArray(data.user?.roles) ? data.user.roles : [];

    if (!rolesMatchAuthContext(context, userRoles)) {
      await revokeIssuedWordPressSession(data);
      return res.status(403).json({
        success: false,
        message: getContextAccessMessage(context),
      });
    }

    if (intent === "link" && Number(data?.user?.id) !== Number(authenticated_user_id)) {
      await revokeIssuedWordPressSession(data);
      return res.status(409).json({
        success: false,
        message: "This Google account belongs to a different store account and cannot be linked.",
      });
    }

    if (data.success && data.session && data.cookie_name) {
      attachSessionCookiesAndCache(res, req, {
        data,
        user: data.user,
        context,
        cookieConfig,
      });
    } else if (data.rest_nonce && typeof res?.cookie === "function") {
      const cookieOptions = getCookieOptions(req, userRoles);
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

export const sendOtp = processSendOtp;
export const verifyOtp = processVerifyOtp;
export const resetPasswordOtp = processResetPasswordOtp;
