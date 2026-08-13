import wp from "../services/wordpress.js";

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const response = await wp.post("/wp-json/mumbai-auth/v1/login", {
      email,
      password,
    });

    const data = response.data;

    if (data.success && data.session && data.cookie_name) {
      res.cookie("mumbai_wp_auth", `${data.cookie_name}=${data.session}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
        path: "/",
      });
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
    console.log(error.response?.data);
    console.log(error.message);

    res.status(error.response?.status || 401).json({
      success: false,
      message: error.response?.data || error.message,
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
    const response = await wp.get("/wp-json/mumbai-auth/v1/me", {
      headers: {
        Cookie: req.cookies.mumbai_wp_auth,
      },
    });

    res.json(response.data);
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Not authenticated.",
    });
  }
};
