import axios from "axios";
import https from "https";

export const requireAuth = async (req, res, next) => {
  try {
    const wpAuth = req.cookies?.mumbai_wp_auth;

    console.log("WORDPRESS_URL:", process.env.WORDPRESS_URL);
    console.log("AUTH COOKIE:", wpAuth);

    if (!wpAuth) {
      console.log("❌ NO AUTH COOKIE RECEIVED");

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

    console.log("WORDPRESS ME RESPONSE:", response.data);

    if (!response.data?.logged_in) {
      console.log("❌ WORDPRESS SAYS NOT LOGGED IN");

      return res.status(401).json({
        success: false,
        message: "Session expired.",
      });
    }

    req.wpAuthCookie = wpAuth;
    req.wpRestNonce = req.cookies?.mumbai_wp_nonce;
    req.wpUserId = response.data.current_user_id;

    console.log("REST NONCE:", req.wpRestNonce ? "RECEIVED" : "MISSING");
    console.log("WP USER ID:", req.wpUserId);
    console.log("✅ AUTHENTICATION SUCCESSFUL");

    next();
  } catch (error) {
    console.log(
      "❌ AUTH MIDDLEWARE ERROR:",
      error.response?.data || error.message,
    );

    console.log("ERROR CODE:", error.code);

    return res.status(error.response?.status || 401).json({
      success: false,
      message: "Authentication required.",
    });
  }
};
