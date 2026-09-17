import axios from "axios";
import { logger } from "../utils/logger.js";

export const BREVO_TRANSACTIONAL_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

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
 * Checks whether mock email mode is enabled.
 * NOTE: Mock email is strictly forbidden in production.
 */
export const isMockEmailEnabled = () => {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return process.env.MOCK_EMAIL === "true";
};

/**
 * Retrieve the configured Brevo Email Sender safely.
 */
export const getBrevoEmailSender = () => {
  const name =
    process.env.BREVO_EMAIL_SENDER_NAME !== undefined && process.env.BREVO_EMAIL_SENDER_NAME.trim() !== ""
      ? process.env.BREVO_EMAIL_SENDER_NAME.trim()
      : "Mumbai Collection";

  const email = process.env.BREVO_EMAIL_SENDER_EMAIL?.trim();

  if (!email || !email.includes("@")) {
    throw new Error("BREVO_EMAIL_SENDER_EMAIL is missing or invalid");
  }

  return { name, email };
};

/**
 * Build a clean, responsive Mumbai Collection branded transactional email HTML template.
 */
export const buildOtpEmailHtml = ({ toName, otp, purpose }) => {
  const isVerifyPhone = purpose === "verify_phone";
  const title = isVerifyPhone
    ? "Verify Your Mobile Number"
    : "Reset Your Password";
  const lead = isVerifyPhone
    ? "Please use the 6-digit verification code below to verify your mobile number on your Mumbai Collection account."
    : "We received a request to reset your Mumbai Collection account password. Please use the 6-digit verification code below to proceed.";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8F9FD; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1E1E1E;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F8F9FD; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #FFFFFF; border-radius: 20px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04); border: 1px solid #E5E7EB; overflow: hidden;" cellspacing="0" cellpadding="0" border="0">
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px; background: linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%); text-align: center;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.5px;">
                Mumbai Collection
              </h1>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #DDD6FE; font-weight: 500;">
                Toys &amp; Stationery • Vasai
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px 32px 24px 32px;">
              <h2 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 700; color: #111827;">
                ${title}
              </h2>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #4B5563;">
                Hello${toName ? ` ${toName}` : ""},
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #4B5563;">
                ${lead}
              </p>
              <!-- OTP Box -->
              <div style="background-color: #F5F3FF; border: 2px dashed #7C3AED; border-radius: 14px; padding: 20px; text-align: center; margin: 0 0 24px 0;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #6D28D9; display: inline-block;">
                  ${otp}
                </span>
              </div>
              <!-- Security Notes -->
              <div style="background-color: #FFFBEB; border: 1px solid #FDE68A; border-radius: 12px; padding: 14px 16px; margin: 0 0 24px 0;">
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #92400E;">
                  <strong>Important:</strong> This verification code is valid for <strong>5 minutes</strong>. Do not share this OTP with anyone. Mumbai Collection staff will never ask for your verification code.
                </p>
              </div>
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #6B7280;">
                If you did not make this request, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #F9FAFB; border-top: 1px solid #F3F4F6; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #9CA3AF; line-height: 1.4;">
                This is an automated transactional security email from Mumbai Collection.<br>
                Please do not reply directly to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Dispatches an OTP verification email via Brevo Transactional Email (SMTP API).
 * 
 * @param {Object} params
 * @param {string} params.toEmail - Destination email address
 * @param {string} [params.toName] - Destination recipient name
 * @param {string} params.otp - 6-digit verification code
 * @param {string} [params.purpose] - Purpose: "verify_phone" | "reset_password"
 * @returns {Promise<{success: boolean, messageId?: string, mock?: boolean}>}
 */
export const sendOtpEmail = async ({ toEmail, toName, otp, purpose = "verify_phone" }) => {
  if (!otp || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    throw new Error("Invalid OTP code provided for email dispatch");
  }

  if (!toEmail || typeof toEmail !== "string" || !toEmail.includes("@")) {
    throw new Error("Invalid destination email address");
  }

  const cleanEmail = toEmail.trim().toLowerCase();
  const cleanName = (toName || "").trim();

  const isVerifyPhone = purpose === "verify_phone";
  const subject = isVerifyPhone
    ? `Your Mumbai Collection verification code: ${otp}`
    : `Your Mumbai Collection password reset code: ${otp}`;

  const textContent = `Mumbai Collection\n\nYour verification code is: ${otp}\n\nThis code is valid for 5 minutes. Do not share this code with anyone.\nIf you did not request this, please ignore this email.`;
  const htmlContent = buildOtpEmailHtml({ toName: cleanName, otp, purpose });

  // 1. Development Mock Mode
  if (isMockEmailEnabled()) {
    console.log(
      `\n[MOCK EMAIL] Destination: ${cleanEmail}\n[MOCK EMAIL] Subject: ${subject}\n[MOCK EMAIL] OTP: ${otp}\n`
    );

    return {
      success: true,
      mock: true,
      messageId: `mock_email_${Date.now()}_${otp}`,
    };
  }

  // 2. Production / Live Brevo API
  const apiKey = getBrevoApiKey();
  const sender = getBrevoEmailSender();

  const emailMasked = cleanEmail.length > 4
    ? `${cleanEmail.slice(0, 2)}***@${cleanEmail.split("@")[1] || ""}`
    : "***";

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[Brevo Email Dispatch] destination: ${emailMasked} | purpose: ${purpose} | sender: ${sender.email}`
    );
  }

  try {
    const response = await axios.post(
      BREVO_TRANSACTIONAL_EMAIL_URL,
      {
        sender: {
          name: sender.name,
          email: sender.email,
        },
        to: [
          {
            email: cleanEmail,
            name: cleanName || "Valued Customer",
          },
        ],
        subject,
        htmlContent,
        textContent,
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

    const messageId = response.data?.messageId || `brevo_email_${Date.now()}`;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[Brevo Email Success] Status: ${response.status} | Message ID: ${messageId} | destination: ${emailMasked}`
      );
    }

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    const status = error.response?.status || 500;
    const sanitizedReason =
      error.response?.data?.message ||
      error.message ||
      "Brevo Email request failed";

    logger.error(
      { err: sanitizedReason, destinationMasked: emailMasked },
      "[Brevo Email Error] Failed to send email"
    );

    const safeError = new Error(sanitizedReason);
    safeError.status = status;
    safeError.isBrevoError = true;
    throw safeError;
  }
};
