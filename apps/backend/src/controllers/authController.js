import axios from "axios";
import wp from "../services/wordpress.js";
import { httpsAgent } from "../config/httpAgent.js";
import { invalidateSessionCache } from "../middlewares/authMiddleware.js";

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const response = await wp.post("/wp-json/mumbai-auth/v1/login", {
      email,
      password,
    });

    const data = response.data;

    if (data.success && data.session && data.cookie_name) {
      res.cookie(
        "mumbai_wp_auth",
        `${data.cookie_name}=${data.session}`,
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 24 * 60 * 60 * 1000,
          path: "/",
        }
      );
    }

    if (data.rest_nonce) {
      res.cookie("mumbai_wp_nonce", data.rest_nonce, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
        path: "/",
      });
    }

    res.json({
      success: data.success,
      message: data.message,
      user: data.user,
    });
  } catch (error) {
    const status = error.response?.status || 500;

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
    const wpAuth = req.cookies?.mumbai_wp_auth;

    if (wpAuth) {
      invalidateSessionCache(wpAuth);

      // Invalidate session on WordPress server-side
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

    res.clearCookie("mumbai_wp_auth", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    res.clearCookie("mumbai_wp_nonce", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    res.json({
      success: true,
      message: "Logged out successfully.",
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
    const wpAuth = req.cookies?.mumbai_wp_auth;

    if (!wpAuth) {
      return res.status(401).json({
        logged_in: false,
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

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 401).json(
      error.response?.data || {
        logged_in: false,
        message: "Session verification failed.",
      },
    );
  }
};
