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

export const saveAddress = async (req, res) => {
  try {
    const {
      type,
      full_name,
      phone,
      address_line1,
      address_line2,
      city,
      state,
      pincode,
    } = req.body;

    const response = await axios.post(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses`,
      {
        type,
        full_name,
        phone,
        address_line1,
        address_line2,
        city,
        state,
        pincode,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key":
            process.env.MUMBAI_INTERNAL_API_KEY,

          "X-Mumbai-User-ID": String(req.wpUserId),
        },

        httpsAgent:
          process.env.NODE_ENV === "development"
            ? new https.Agent({
                rejectUnauthorized: false,
              })
            : undefined,
      }
    );

    res.status(201).json(response.data);
  } catch (error) {
    console.error(
      "Save address error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to save address.",
      }
    );
  }
};

export const updateAddress = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      type,
      full_name,
      phone,
      address_line1,
      address_line2,
      city,
      state,
      pincode,
    } = req.body;

    const response = await axios.put(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses/${id}`,
      {
        type,
        full_name,
        phone,
        address_line1,
        address_line2,
        city,
        state,
        pincode,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key":
            process.env.MUMBAI_INTERNAL_API_KEY,

          "X-Mumbai-User-ID": String(req.wpUserId),
        },

        httpsAgent:
          process.env.NODE_ENV === "development"
            ? new https.Agent({
                rejectUnauthorized: false,
              })
            : undefined,
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Update address error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to update address.",
      }
    );
  }
};

export const deleteAddress = async (req, res) => {
  try {
    const { id } = req.params;

    const response = await axios.delete(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses/${id}`,
      {
        headers: {
          "X-Mumbai-Internal-Key":
            process.env.MUMBAI_INTERNAL_API_KEY,

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
      "Delete address error:",
      error.response?.data || error.message,
    );

    res.status(error.response?.status || 500).json(
      error.response?.data || {
        success: false,
        message: "Unable to delete address.",
      },
    );
  }
};