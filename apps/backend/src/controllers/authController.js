import wp from "../services/wordpress.js";

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/login",
      {
        email,
        password,
      }
    );

    res.json(response.data);
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

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/register",
      {
        name,
        email,
        password,
      }
    );

    res.status(200).json(response.data);
  } catch (error) {

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Registration failed",
      }
    );
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/forgot-password",
      {
        email,
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Forgot password error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to process password reset request.",
      }
    );
  }
};