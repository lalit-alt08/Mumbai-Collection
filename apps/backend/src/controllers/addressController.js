import axios from "axios";
import https from "https";

export const getAddresses = async (req, res) => {
  try {
    console.log(
      "INTERNAL KEY:",
      process.env.MUMBAI_INTERNAL_API_KEY ? "LOADED" : "MISSING",
    );

    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses`,
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,

          "X-Mumbai-User-ID": String(req.wpUserId),
        },

        httpsAgent:
          process.env.NODE_ENV === "development"
            ? new https.Agent({
                rejectUnauthorized: false,
              })
            : undefined,
      },
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Get addresses error:",
      error.response?.data || error.message,
    );

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to get addresses.",
      },
    );
  }
};
