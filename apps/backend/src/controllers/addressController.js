import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

const ALLOWED_DELIVERY_REGIONS = [
  "vasai west",
  "vasai east",
  "nallasopara west",
  "nallasopara east",
];

const normalizeRegion = (input) => {
  if (!input || typeof input !== "string") return null;
  const lower = input.trim().toLowerCase();
  if (lower === "vasai west" || lower === "vasai (west)" || lower === "vasai-west") return "Vasai West";
  if (lower === "vasai east" || lower === "vasai (east)" || lower === "vasai-east") return "Vasai East";
  if (lower === "nallasopara west" || lower === "nalasopara west" || lower === "nallasopara (west)") return "Nallasopara West";
  if (lower === "nallasopara east" || lower === "nalasopara east" || lower === "nallasopara (east)") return "Nallasopara East";

  const match = ALLOWED_DELIVERY_REGIONS.find((r) => r === lower);
  if (match) {
    return match
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return null;
};

/**
 * Fetch all saved addresses for the authenticated customer
 */
export const getAddresses = async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses`,
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

/**
 * Save a new address with strict 1 Home / 1 Office limit and local geo-fencing
 */
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

    const normalizedType = String(type || "").trim().toLowerCase();
    if (!["home", "office"].includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid address type. Address type must be either 'home' or 'office'.",
      });
    }

    const normalizedRegion = normalizeRegion(city);
    if (!normalizedRegion) {
      return res.status(400).json({
        success: false,
        message: "Delivery is only available in Vasai West, Vasai East, Nallasopara West, and Nallasopara East (Maharashtra). Please select a valid delivery region.",
      });
    }

    const cleanFullName = String(full_name || "").trim();
    if (!cleanFullName || cleanFullName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Full name is required (at least 2 characters).",
      });
    }

    const cleanPhone = String(phone || "").trim().replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit phone number.",
      });
    }

    const cleanAddress1 = String(address_line1 || "").trim();
    if (!cleanAddress1 || cleanAddress1.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Flat / Building / Street address is required.",
      });
    }

    // Fetch existing addresses to enforce strict 1 Home / 1 Office limit
    const existingRes = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses`,
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(req.wpUserId),
        },
        httpsAgent,
        timeout: 8000,
      }
    );

    const existingAddresses = existingRes.data?.addresses || [];
    const alreadyExists = existingAddresses.some(
      (a) => a.type?.toLowerCase() === normalizedType
    );

    if (alreadyExists) {
      return res.status(400).json({
        success: false,
        message: `You already have a saved ${normalizedType === "home" ? "Home" : "Office"} address. Each customer can have at most one Home and one Office address.`,
      });
    }

    const response = await axios.post(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses`,
      {
        type: normalizedType,
        full_name: cleanFullName,
        phone: cleanPhone,
        address_line1: cleanAddress1,
        address_line2: String(address_line2 || "").trim(),
        city: normalizedRegion,
        state: "MH",
        pincode: pincode ? String(pincode).trim() : "",
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

/**
 * Update an existing address with duplicate-type collision protection and geo-fencing
 */
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

    const normalizedType = String(type || "").trim().toLowerCase();
    if (!["home", "office"].includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid address type. Address type must be either 'home' or 'office'.",
      });
    }

    const normalizedRegion = normalizeRegion(city);
    if (!normalizedRegion) {
      return res.status(400).json({
        success: false,
        message: "Delivery is only available in Vasai West, Vasai East, Nallasopara West, and Nallasopara East (Maharashtra). Please select a valid delivery region.",
      });
    }

    const cleanFullName = String(full_name || "").trim();
    if (!cleanFullName || cleanFullName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Full name is required (at least 2 characters).",
      });
    }

    const cleanPhone = String(phone || "").trim().replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit phone number.",
      });
    }

    const cleanAddress1 = String(address_line1 || "").trim();
    if (!cleanAddress1 || cleanAddress1.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Flat / Building / Street address is required.",
      });
    }

    // Fetch existing addresses to prevent switching to an already-occupied address type
    const existingRes = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses`,
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(req.wpUserId),
        },
        httpsAgent,
        timeout: 8000,
      }
    );

    const existingAddresses = existingRes.data?.addresses || [];
    const duplicateOccupied = existingAddresses.some(
      (a) => String(a.id) !== String(id) && a.type?.toLowerCase() === normalizedType
    );

    if (duplicateOccupied) {
      return res.status(400).json({
        success: false,
        message: `Another ${normalizedType === "home" ? "Home" : "Office"} address already exists. Each customer can have at most one Home and one Office address.`,
      });
    }

    const response = await axios.put(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses/${encodeURIComponent(id)}`,
      {
        type: normalizedType,
        full_name: cleanFullName,
        phone: cleanPhone,
        address_line1: cleanAddress1,
        address_line2: String(address_line2 || "").trim(),
        city: normalizedRegion,
        state: "MH",
        pincode: pincode ? String(pincode).trim() : "",
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

/**
 * Delete a saved address
 */
export const deleteAddress = async (req, res) => {
  try {
    const { id } = req.params;

    const response = await axios.delete(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/addresses/${encodeURIComponent(id)}`,
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