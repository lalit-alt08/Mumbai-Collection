import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { logger } from "./logger.js";
import {
  setSessionCache,
  invalidateSessionCache,
  invalidateUserSessionCache,
  parseWordPressAuthCookie,
} from "../middlewares/authMiddleware.js";
import { formatCustomerDisplayName } from "./nameFormatter.js";

export const resolveContext = (req) => {
  const panel = req.body?.context || req.query?.context || req.headers["x-mumbai-panel"];
  if (panel === "admin") return "admin";
  if (panel === "employee") return "employee";
  if (panel === "customer") return "customer";

  const origin = req.headers?.origin;
  const isDev = process.env.NODE_ENV === "development";

  if (origin && (origin === process.env.ADMIN_ORIGIN || (isDev && origin.includes(":5174")))) {
    return "admin";
  }
  if (origin && (origin === process.env.EMPLOYEE_ORIGIN || (isDev && origin.includes(":5175")))) {
    return "employee";
  }

  return "customer";
};

export const getContextAccessMessage = (context) => {
  if (context === "admin") return "Access denied: Administrator privileges required.";
  if (context === "employee") return "Access denied: Staff privileges required.";
  return "Access denied: Please use a customer account for the storefront.";
};

export const getInternalHeaders = () => (
  process.env.MUMBAI_INTERNAL_API_KEY
    ? { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY }
    : {}
);

export const revokeIssuedWordPressSession = async (data) => {
  if (!data?.session || !data?.cookie_name) return;

  try {
    await axios.post(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/logout`,
      {},
      {
        headers: {
          Cookie: `${data.cookie_name}=${data.session}`,
          ...getInternalHeaders(),
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

export const getCookieOptions = (req, role = "customer") => {
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
    sameSite: "lax",
    maxAge: isStaffSession
      ? 12 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000,
    path: "/",
  };
};

export const getClearCookieOptions = (req) => {
  const isHttps =
    req.secure ||
    req.headers["x-forwarded-proto"] === "https" ||
    process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
  };
};

export const clearPanelCookies = (res, cookieConfig, clearOptions) => {
  if (typeof res?.clearCookie === "function") {
    res.clearCookie(cookieConfig.auth, clearOptions);
    res.clearCookie(cookieConfig.nonce, clearOptions);
  }
};

export const revokeUpstreamWordPressSession = async (wpAuth) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const wpLogoutRes = await axios.post(
        `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/logout`,
        {},
        {
          headers: {
            Cookie: wpAuth,
            ...getInternalHeaders(),
          },
          httpsAgent,
          timeout: 3000,
        }
      );
      if (wpLogoutRes.data?.success) return true;
    } catch (err) {
      logger.warn({ attempt, err: err?.message }, "[Auth] Upstream WordPress session revocation attempt failed during logout");
      if (attempt < 3) await new Promise((r) => setTimeout(r, 150));
    }
  }
  return false;
};

export const revokeUserSessionsOnPasswordChange = async (userId, sessionVersion, context = "password update") => {
  if (!userId) return;
  const revoked = await invalidateUserSessionCache(userId, sessionVersion);
  if (!revoked) {
    logger.warn({ userId }, `[Auth] User revocation marker could not be persisted to Redis after ${context}`);
  }
};

export const attachSessionCookiesAndCache = (res, req, { data, user = data?.user, context, cookieConfig, isRegistration = false }) => {
  const userRoles = Array.isArray(user?.roles) ? user.roles : ["customer"];
  const cookieOptions = getCookieOptions(req, userRoles);

  const sessionVersion = (data?.session_version !== undefined && data?.session_version !== null && Number.isFinite(Number(data.session_version)))
    ? Number(data.session_version)
    : null;

  let computedExpiresAt = null;

  if (data?.session && data?.cookie_name && typeof res?.cookie === "function") {
    const fullCookieVal = `${data.cookie_name}=${data.session}`;
    res.cookie(cookieConfig.auth, fullCookieVal, cookieOptions);

    const parsedFullCookie = parseWordPressAuthCookie(fullCookieVal);
    computedExpiresAt = data.expires_at && Number.isFinite(Number(data.expires_at)) && Number(data.expires_at) > 0
      ? Number(data.expires_at) * 1000
      : (parsedFullCookie?.expiresAt && Number.isFinite(Number(parsedFullCookie.expiresAt)) && Number(parsedFullCookie.expiresAt) > 0
          ? Number(parsedFullCookie.expiresAt)
          : (isRegistration ? (Math.floor(Date.now() / 1000) + 30 * 86400) * 1000 : null));

    const hasUsablePassword = isRegistration
      ? user?.has_usable_password !== false
      : user?.has_usable_password === true;

    if (user?.id) {
      setSessionCache(fullCookieVal, {
        userId: user.id,
        name: user.name || "",
        roles: userRoles,
        email: user.email || "",
        username: user.username || "",
        firstName: user.first_name || "",
        lastName: user.last_name || "",
        phone: user.phone || "",
        verifiedPhone: user.verified_phone || "",
        isGoogleUser: user.is_google_user === true,
        hasUsablePassword,
        isPhoneVerified: user.is_phone_verified === true,
        isSuspended: user.is_suspended === true,
        expiresAt: computedExpiresAt,
        timestamp: Date.now(),
        userVersion: sessionVersion,
      });
    }
  }

  if (data?.rest_nonce && typeof res?.cookie === "function") {
    res.cookie(cookieConfig.nonce, data.rest_nonce, cookieOptions);
  }

  return { sessionVersion, computedExpiresAt };
};

export const buildUserProfile = (session, roles, wcCustomer = null) => {
  const profile = {
    id: session.userId,
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

  if (wcCustomer) {
    const fullName = formatCustomerDisplayName(wcCustomer.first_name, wcCustomer.last_name, "");
    const isSystemUsername =
      (wcCustomer.username || "").toLowerCase() === "mumbaicollection" ||
      (wcCustomer.username || "").toLowerCase() === "mumbai collection";
    profile.first_name = wcCustomer.first_name || profile.first_name || "";
    profile.last_name = wcCustomer.last_name || profile.last_name || "";
    profile.name = fullName || (!isSystemUsername ? wcCustomer.username : "") || profile.name;
    profile.username = (!isSystemUsername ? wcCustomer.username : "") || profile.username;
    profile.email = wcCustomer.email || profile.email;
    profile.phone = session.phone || wcCustomer.billing?.phone || profile.phone;
  }

  if (!profile.phone && session.phone) {
    profile.phone = session.phone;
  }
  profile.is_phone_verified = session.isPhoneVerified === true;
  profile.verified_phone = session.verifiedPhone || "";

  return profile;
};
