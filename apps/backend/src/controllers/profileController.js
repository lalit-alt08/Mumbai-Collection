import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

export const getProfile = async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(req.wpUserId),
        },
        httpsAgent,
        timeout: 8000,
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Get profile error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to get profile.",
      }
    );
  }
};

export const saveProfile = async (req, res) => {
  try {
    const { full_name, age, phone } = req.body;

    const response = await axios.put(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
      {
        full_name,
        age,
        phone,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(req.wpUserId),
        },
        httpsAgent,
        timeout: 8000,
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Save profile error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to save profile.",
      }
    );
  }
};

export const checkProfileComplete = async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile/complete`,
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(req.wpUserId),
        },
        httpsAgent,
        timeout: 8000,
      },
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Check profile complete error:",
      error.response?.data || error.message,
    );

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to check profile completion.",
      },
    );
  }
};