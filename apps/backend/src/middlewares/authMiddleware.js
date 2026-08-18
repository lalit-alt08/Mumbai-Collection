import axios from "axios";
import https from "https";

export const requireAuth = async (req, res, next) => {
  try {
    const wpAuth = req.cookies?.mumbai_wp_auth;

    if (!wpAuth) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
      {
        headers: {
          Cookie: wpAuth,
        },
        httpsAgent:
          process.env.NODE_ENV === "development"
            ? new https.Agent({
                rejectUnauthorized: false,
              })
            : undefined,
      },
    );

    if (!response.data?.logged_in) {
      return res.status(401).json({
        success: false,
        message: "Session expired.",
      });
    }

    req.wpAuthCookie = wpAuth;
    req.wpRestNonce = req.cookies?.mumbai_wp_nonce;
    req.wpUserId = response.data.current_user_id;

    next();
  } catch (error) {
    console.error(
      "❌ Auth Middleware Error:",
      error.response?.status || error.message,
    );

    return res.status(error.response?.status || 401).json({
      success: false,
      message: "Authentication required.",
    });
  }
};
