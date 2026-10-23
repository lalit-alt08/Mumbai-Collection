import axios from "axios";
import API_URL from "../config/api.js";
import { attachStaleConnectionRetry } from "../utils/resilientAxios.js";

const API = axios.create({
  baseURL: `${API_URL}/auth`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "customer",
  },
  timeout: 12000,
});

attachStaleConnectionRetry(API);

export const login = async (email, password) => {
  const { data } = await API.post("/login", {
    email,
    password,
    context: "customer",
  });

  return data;
};

export const register = async (userData) => {
  const { data } = await API.post("/register", userData);
  return data;
};

export const googleLogin = async (payload) => {
  const body =
    typeof payload === "string" ? { credential: payload } : payload;
  const { data } = await API.post("/google-login", {
    ...body,
    context: "customer",
  }, {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  return data;
};

export const getCurrentUser = async () => {
  const { data } = await API.get("/me", {
    params: { context: "customer" },
  });
  return data;
};

export const logout = async () => {
  const { data } = await API.post("/logout", {
    context: "customer",
  });
  return data;
};

export const forgotPassword = async (email) => {
  const { data } = await API.post("/forgot-password", {
    email,
  });

  return data;
};

export const resetPassword = async (token, password) => {
  const { data } = await API.post("/reset-password", {
    token,
    password,
  });

  return data;
};

export const deleteAccount = async () => {
  const { data } = await axios.delete(`${API_URL}/profile`, {
    withCredentials: true,
  });
  return data;
};

export const sendOtp = async (target, purpose = "verify_phone", extra = {}) => {
  const trimmed = typeof target === "string" ? target.trim() : target;
  const isEmail = typeof trimmed === "string" && trimmed.includes("@");
  const { data } = await API.post("/otp/send", {
    purpose,
    ...(isEmail ? { email: trimmed } : { phone: trimmed }),
    ...extra,
  });
  return data;
};

export const verifyOtp = async (target, otp, purpose = "verify_phone") => {
  const trimmed = typeof target === "string" ? target.trim() : target;
  const isEmail = typeof trimmed === "string" && trimmed.includes("@");
  const { data } = await API.post("/otp/verify", {
    purpose,
    otp: typeof otp === "string" ? otp.trim() : otp,
    ...(isEmail ? { email: trimmed } : { phone: trimmed }),
  });
  return data;
};

export const resetPasswordOtp = async (phone, reset_token, new_password) => {
  const trimmed = typeof phone === "string" ? phone.trim() : phone;
  const { data } = await API.post("/otp/reset-password", {
    phone: trimmed,
    email: typeof trimmed === "string" && trimmed.includes("@") ? trimmed : undefined,
    reset_token,
    new_password,
  });
  return data;
};

export const sendPasswordResetOtp = async (email) => {
  return sendOtp(email, "reset_password");
};

export const verifyPasswordResetOtp = async (email, otp) => {
  return verifyOtp(email, otp, "reset_password");
};

export const resetPasswordWithOtp = async (email, reset_token, new_password) => {
  return resetPasswordOtp(email, reset_token, new_password);
};

/**
 * Format user-friendly rate limit error message based on server Retry-After.
 * Never hardcodes static minutes and preserves exact retry period.
 */
export const parseOtpRateLimitError = (err) => {
  if (err?.response?.status === 429) {
    const headerRetry = err.response.headers?.["retry-after"];
    const bodyRetry = err.response.data?.retryAfter || err.response.data?.retry_after;
    const seconds = Number(bodyRetry || headerRetry);

    if (seconds && seconds > 0) {
      const minutes = Math.ceil(seconds / 60);
      return {
        isRateLimited: true,
        retryAfter: seconds,
        message: `Too many attempts. Please try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
      };
    }

    return {
      isRateLimited: true,
      retryAfter: 60,
      message: "Too many attempts. Please try again in 1 minute.",
    };
  }

  return {
    isRateLimited: false,
    retryAfter: 0,
    message:
      (typeof err?.response?.data?.message === "string" && err.response.data.message) ||
      "Unable to send verification code. Please try again.",
  };
};
