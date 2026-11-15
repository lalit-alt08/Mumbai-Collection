import crypto from "crypto";
import wp from "./wordpress.js";
import { sendOtpEmail, normalizePhoneNumber } from "./brevoService.js";
import { getInternalHeaders, revokeUserSessionsOnPasswordChange } from "../utils/authCookieUtils.js";
import { sanitizeAuthError } from "../utils/authErrorSanitizer.js";
import { logError } from "../utils/logger.js";

export const hashOtp = (otp) => {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) {
    throw new Error("OTP_HMAC_SECRET is not configured");
  }
  return crypto.createHmac("sha256", secret).update(String(otp).trim()).digest("hex");
};

export const normalizeOtpTarget = (rawTarget) => {
  const rawInput = String(rawTarget || "").trim();
  const isEmail = rawInput.includes("@");
  if (isEmail) {
    return { target: rawInput.toLowerCase(), isEmail: true };
  }
  const normalized = normalizePhoneNumber(rawInput);
  return { target: normalized ? normalized.local : rawInput, isEmail: false };
};

export const processSendOtp = async (req, res) => {
  try {
    const rawTarget = req.body.phone || req.body.email;
    const { purpose } = req.body;
    if (!rawTarget || !["reset_password", "register", "verify_phone"].includes(purpose)) {
      return res.status(400).json({ success: false, message: "Invalid phone, email or purpose." });
    }

    if (purpose === "verify_phone") {
      const authenticatedUserId = req.user?.id || req.wpUserId;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: "Authentication required to verify phone." });
      }
    }

    const { target: cleanPhone, isEmail: isEmailInput } = normalizeOtpTarget(rawTarget);
    if (purpose === "register" && !isEmailInput) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (process.env.NODE_ENV !== "production") {
      const inputMasked = `...${String(rawTarget).trim().slice(-4)}`;
      const cleanMasked = `...${cleanPhone.slice(-4)}`;
      console.log(
        `[OTP Flow] input: ${inputMasked} | normalized: ${cleanMasked} | purpose: ${purpose}`
      );
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashOtp(otp);

    // Store OTP state in WordPress
    const storeResponse = await wp.post(
      "/wp-json/mumbai-auth/v1/otp/store",
      {
        phone: cleanPhone,
        purpose,
        otp_hash: otpHash,
        user_id: req.user?.id || req.wpUserId,
      },
      {
        headers: getInternalHeaders(),
      }
    );

    if (!storeResponse.data?.success) {
      return res.status(400).json({
        success: false,
        message: storeResponse.data?.message || "Failed to request OTP.",
      });
    }

    const targetEmail = storeResponse.data?.email || req.user?.email || (purpose === "register" ? cleanPhone : "");
    const targetName = storeResponse.data?.name || req.user?.name || req.body.first_name || req.body.name || "Valued Customer";

    if (purpose === "reset_password") {
      if (storeResponse.data?.rate_limited === true || storeResponse.data?.user_found === false || !targetEmail) {
        return res.status(200).json({
          success: true,
          message: storeResponse.data?.message || (isEmailInput ? "If an account is registered with this email, an OTP has been sent." : "If the number is registered, an OTP has been sent."),
        });
      }
    }

    if (!targetEmail) {
      return res.status(500).json({
        success: false,
        message: "No registered email address found for this account.",
      });
    }

    try {
      await sendOtpEmail({
        toEmail: targetEmail,
        toName: targetName,
        otp,
        purpose,
      });
    } catch (emailError) {
      logError(req, emailError, "Brevo Email send failure. Invalidating stored OTP");

      try {
        await wp.post(
          "/wp-json/mumbai-auth/v1/otp/invalidate",
          {
            phone: cleanPhone,
            purpose,
          },
          {
            headers: getInternalHeaders(),
          }
        );
      } catch (invalidateErr) {
        logError(req, invalidateErr, "Failed to invalidate OTP after email failure");
      }

      return res.status(500).json({
        success: false,
        message: "Unable to send verification code. Please try again.",
      });
    }

    if (purpose === "register") {
      return res.status(200).json({
        success: true,
        message: "Verification code sent to your email address.",
      });
    }

    if (purpose === "verify_phone") {
      return res.status(200).json({
        success: true,
        message: "Verification code sent to your registered email address.",
      });
    }

    if (purpose === "reset_password") {
      return res.status(200).json({
        success: true,
        message: storeResponse.data?.message || (isEmailInput ? "If an account is registered with this email, an OTP has been sent." : "If the number is registered, an OTP has been sent."),
      });
    }

    return res.status(400).json({ success: false, message: "Unsupported OTP purpose." });
  } catch (error) {
    if (error.message === "OTP_HMAC_SECRET is not configured") {
      logError(req, error, "Critical OTP Configuration Error: OTP_HMAC_SECRET is missing");
    } else {
      logError(req, error, "Send OTP error");
    }
    const status = error.response?.status || 500;
    if (status === 409) {
      return res.status(409).json({
        success: false,
        code: error.response?.data?.code || "email_exists",
        message: error.response?.data?.message || "An account with this email already exists. Please sign in.",
      });
    }
    if (status === 429) {
      const headerRetry = error.response?.headers?.["retry-after"];
      const bodyRetry = error.response?.data?.retryAfter || error.response?.data?.retry_after;
      const retryAfter = Number(bodyRetry || headerRetry) || 60;
      if (typeof res.set === "function") {
        res.set("Retry-After", String(retryAfter));
      }
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please try again later.",
        retryAfter,
      });
    }
    const { status: errStatus, payload } = sanitizeAuthError(error, "Failed to send OTP");
    return res.status(errStatus).json(payload);
  }
};

export const processVerifyOtp = async (req, res) => {
  try {
    const rawTarget = req.body.phone || req.body.email;
    const { otp, purpose } = req.body;
    if (!rawTarget || !otp || !purpose || !["reset_password", "register", "verify_phone"].includes(purpose)) {
      return res.status(400).json({ success: false, message: "Missing or invalid parameters." });
    }

    if (purpose === "verify_phone") {
      const authenticatedUserId = req.user?.id || req.wpUserId;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: "Authentication required to verify phone." });
      }
    }

    const { target: cleanPhone } = normalizeOtpTarget(rawTarget);
    const otpHash = hashOtp(otp);

    const verifyPayload = {
      phone: cleanPhone,
      purpose,
      otp_hash: otpHash,
    };
    const authenticatedUserId = req.user?.id || req.wpUserId;
    if (authenticatedUserId !== undefined && authenticatedUserId !== null) {
      verifyPayload.user_id = authenticatedUserId;
    }

    const verifyResponse = await wp.post(
      "/wp-json/mumbai-auth/v1/otp/verify",
      verifyPayload,
      {
        headers: getInternalHeaders(),
      }
    );

    return res.status(200).json(verifyResponse.data);
  } catch (error) {
    if (error.message === "OTP_HMAC_SECRET is not configured") {
      logError(req, error, "Critical OTP Configuration Error: OTP_HMAC_SECRET is missing");
    } else {
      logError(req, error, "Verify OTP error");
    }
    const { status, payload } = sanitizeAuthError(error, "OTP verification failed", 400);
    return res.status(status).json(payload);
  }
};

export const processResetPasswordOtp = async (req, res) => {
  try {
    const rawTarget = req.body.phone || req.body.email;
    const { reset_token, new_password } = req.body;
    if (!rawTarget || !reset_token || !new_password) {
      return res.status(400).json({ success: false, message: "Missing parameters." });
    }

    const { target: cleanPhone } = normalizeOtpTarget(rawTarget);

    const resetResponse = await wp.post(
      "/wp-json/mumbai-auth/v1/otp/reset-password",
      {
        phone: cleanPhone,
        reset_token,
        new_password,
      },
      {
        headers: getInternalHeaders(),
      }
    );

    await revokeUserSessionsOnPasswordChange(
      resetResponse.data?.user_id,
      resetResponse.data?.session_version,
      "OTP reset"
    );

    return res.status(200).json(resetResponse.data);
  } catch (error) {
    logError(req, error, "Reset password OTP error");
    const { status, payload } = sanitizeAuthError(error, "Password reset failed", 400);
    return res.status(status).json(payload);
  }
};
