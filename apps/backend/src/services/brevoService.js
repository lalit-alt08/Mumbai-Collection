import axios from "axios";
import { logger } from "../utils/logger.js";

export const BREVO_TRANSACTIONAL_SMS_URL = "https://api.brevo.com/v3/transactionalSMS/send";

/**
 * Format the standard OTP verification message.
 */
export const formatOtpMessage = (otp) => {
  return `Mumbai Collection: Your verification code is ${otp}. It expires in 5 minutes.`;
};

/**
 * Normalize and validate Indian mobile phone numbers according to project conventions.
 * Accepts: "+919820123456", "919820123456", "09820123456", or "9820123456"
 * Returns: { local: "9820123456", e164: "+919820123456" } or null if invalid.
 */
export const normalizePhoneNumber = (phone) => {
  if (!phone || typeof phone !== "string") return null;

  const digits = phone.trim().replace(/\D/g, "");
  let local = digits;

  if (local.length === 13 && (local.startsWith("919") || local.startsWith("910"))) {
    local = local.slice(3);
  } else if (local.length === 12 && local.startsWith("91")) {
    local = local.slice(2);
  } else if (local.length === 11 && local.startsWith("0")) {
    local = local.slice(1);
  }

  // Must be exactly 10 digits starting with 6, 7, 8, or 9
  if (!/^[6-9]\d{9}$/.test(local)) {
    return null;
  }

  return {
    local,
    e164: `+91${local}`,
  };
};

/**
 * Checks whether mock SMS mode is enabled.
 * NOTE: Mock SMS is strictly forbidden in production.
 */
export const isMockSmsEnabled = () => {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return process.env.MOCK_SMS === "true";
};

/**
 * Retrieve the configured Brevo API Key safely.
 */
export const getBrevoApiKey = () => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("BREVO_API_KEY is missing or invalid");
  }
  return apiKey.trim();
};

/**
 * Retrieve the configured Brevo SMS Sender ID safely.
 */
export const getBrevoSender = () => {
  const sender =
    process.env.BREVO_SMS_SENDER !== undefined
      ? process.env.BREVO_SMS_SENDER
      : "mumbaicoll";

  if (!sender || typeof sender !== "string" || !sender.trim()) {
    throw new Error("Brevo SMS sender configuration is missing");
  }
  return sender.trim();
};

/**
 * Dispatches an OTP verification SMS via Brevo Transactional SMS or simulated mock.
 * 
 * @param {Object} params
 * @param {string} params.phone - Destination mobile phone number
 * @param {string} params.otp - 6-digit verification code
 * @param {string} [params.customMessage] - Optional custom message override
 * @returns {Promise<{success: boolean, messageId?: string, mock?: boolean}>}
 */
export const sendOtpSms = async ({ phone, otp, customMessage }) => {
  if (!otp || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    throw new Error("Invalid OTP code provided for SMS dispatch");
  }

  const normalized = normalizePhoneNumber(phone);
  if (!normalized) {
    throw new Error("Invalid destination phone number");
  }

  const content = customMessage || formatOtpMessage(otp);

  // 1. Development Mock Mode
  if (isMockSmsEnabled()) {
    // Log OTP only to the backend development terminal
    console.log(
      `\n[MOCK SMS] Destination: ${normalized.e164} (${normalized.local})\n[MOCK SMS] Message: ${content}\n[MOCK SMS] OTP: ${otp}\n`
    );

    return {
      success: true,
      mock: true,
      messageId: `mock_${Date.now()}_${otp}`,
    };
  }

  // 2. Production / Live Brevo API
  const apiKey = getBrevoApiKey();
  const sender = getBrevoSender();

  const inputMasked = `...${String(phone).trim().slice(-4)}`;
  const normalizedMasked = `...${normalized.local.slice(-4)}`;
  const brevoRecipientMasked = `...${normalized.e164.slice(-4)}`;

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[Brevo SMS Dispatch] input: ${inputMasked} | normalized: ${normalizedMasked} | brevo recipient: ${brevoRecipientMasked} | sender: ${sender}`
    );
  }

  try {
    const response = await axios.post(
      BREVO_TRANSACTIONAL_SMS_URL,
      {
        sender,
        recipient: normalized.e164,
        content,
        type: "transactional",
      },
      {
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 10000,
      }
    );

    const messageId = response.data?.messageId || `brevo_${Date.now()}`;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[Brevo SMS Success] Status: ${response.status} | Message ID: ${messageId} | brevo recipient: ${brevoRecipientMasked} | sender: ${sender}`
      );
    }

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    // Sanitize and shield internal credentials from error messages/logs
    const status = error.response?.status || 500;
    const sanitizedReason =
      error.response?.data?.message ||
      error.message ||
      "Brevo SMS request failed";

    logger.error(
      { err: sanitizedReason, recipientMasked: `...${normalized.local.slice(-4)}` },
      "[Brevo SMS Error] Failed to send SMS"
    );

    const safeError = new Error(sanitizedReason);
    safeError.status = status;
    safeError.isBrevoError = true;
    throw safeError;
  }
};
