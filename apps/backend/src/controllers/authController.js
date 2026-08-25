import axios from "axios";
import wp from "../services/wordpress.js";
import wcApi from "../config/woocommerce.js";
import { httpsAgent } from "../config/httpAgent.js";
import { COOKIE_NAMES, invalidateSessionCache } from "../middlewares/authMiddleware.js";

const resolveContext = (req) => {
  const panel = req.body?.context || req.query?.context || req.headers["x-mumbai-panel"];
  if (panel === "admin") return "admin";
  if (panel === "employee") return "employee";
  if (panel === "customer") return "customer";

  const origin = req.headers.origin;
  if (origin && (origin === process.env.ADMIN_ORIGIN || origin.includes(":5174"))) {
    return "admin";
  }
  if (origin && (origin === process.env.EMPLOYEE_ORIGIN || origin.includes(":5175"))) {
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
    maxAge: 24 * 60 * 60 * 1000,
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

    console.log("========== WP AUTH REQUEST DEBUG ==========");
    console.log(`Path: /wp-json/mumbai-auth/v1/login`);
    console.log(`Context: ${context}`);
    console.log(`Email: ${email || "missing"}`);
    console.log(`Origin: ${req.headers.origin || "none"}`);
    console.log(`User-Agent: ${req.headers["user-agent"] || "none"}`);
    console.log(`Body Contains Email: ${Boolean(email) ? "YES" : "NO"}`);
    console.log(`Body Contains Password: ${Boolean(password) ? "YES" : "NO"}`);
    console.log("===========================================");

    const response = await wp.post("/wp-json/mumbai-auth/v1/login", {
      email,
      password,
    });

    const data = response.data;
    console.log("========== WP AUTH RESPONSE DEBUG ==========");
    console.log(`HTTP Status: ${response.status}`);
    console.log(`Response Code: ${data.code || (data.success ? "success" : "none")}`);
    console.log(`Safe Message: ${data.message || "none"}`);
    console.log("============================================");

    console.log("========== COOKIE SETTING DEBUG ==========");
    console.log(`WordPress Login Succeeded: ${data.success ? "YES" : "NO"}`);
    console.log(`Auth Cookie Name: ${cookieConfig.auth}`);
    console.log(`Nonce Cookie Name: ${cookieConfig.nonce}`);
    console.log(`Cookie Options - secure: ${cookieOptions.secure}`);
    console.log(`Cookie Options - sameSite: ${cookieOptions.sameSite}`);
    console.log(`Cookie Options - httpOnly: ${cookieOptions.httpOnly}`);
    console.log(`Cookie Options - path: ${cookieOptions.path}`);
    console.log(`res.headersSent before res.cookie: ${res.headersSent}`);

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

    const setCookieHeaders = res.getHeader("Set-Cookie");
    const safeSetCookie = Array.isArray(setCookieHeaders)
      ? setCookieHeaders.map((c) => c.split("=")[0] + "=[REDACTED_VALUE]; " + c.split(";").slice(1).join(";"))
      : setCookieHeaders ? setCookieHeaders.split("=")[0] + "=[REDACTED_VALUE]; " + setCookieHeaders.split(";").slice(1).join(";") : "NONE";

    console.log(`res.headersSent after res.cookie: ${res.headersSent}`);
    console.log(`Generated Set-Cookie Headers: ${JSON.stringify(safeSetCookie)}`);
    console.log("==========================================");

    res.json({
      success: data.success,
      message: data.message,
      user: data.user,
      context,
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const wpCode = error.response?.data?.code || "none";
    const wpMessage = error.response?.data?.message || error.message || "Unable to login.";

    console.log(`[LOGIN DEBUG] Upstream WordPress HTTP status: ${status} (code: ${wpCode})`);

    if (status === 401) {
      console.log(`[LOGIN DEBUG] Rejecting login (HTTP 401): WordPress authentication failed (${wpMessage})`);
    } else if (status === 429) {
      console.log(`[LOGIN DEBUG] Rejecting login (HTTP 429): Account locked due to rate limiting (${wpMessage})`);
    } else {
      console.log(`[LOGIN DEBUG] Login controller error (HTTP ${status}): ${wpMessage}`);
    }

    // 401 and 429 are expected authentication responses.
    if (status !== 401 && status !== 429) {
      console.error("Login error:", error.response?.data || error.message);
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
    console.error("Logout error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to logout.",
    });
  }
};

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const response = await wp.post("/wp-json/mumbai-auth/v1/register", {
      name,
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
    console.error(
      "Forgot password error:",
      error.response?.data || error.message,
    );

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
    console.error(
      "Reset password error:",
      error.response?.data || error.message,
    );

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
        const fullName = `${c.first_name || ""} ${c.last_name || ""}`.trim();
        userDetails.name = fullName || c.username || "";
        userDetails.username = c.username || "";
        userDetails.email = c.email || "";
      }
    } catch (wcErr) {
      // Fallback: If customer endpoint returns 404 (e.g. administrator/shop_manager), keep default user details
    }

    res.json({
      success: true,
      logged_in: true,
      current_user_id: userId,
      roles,
      user: userDetails,
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
