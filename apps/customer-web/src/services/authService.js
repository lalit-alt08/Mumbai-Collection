import axios from "axios";
import API_URL from "../config/api.js";

const API = axios.create({
  baseURL: `${API_URL}/auth`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "customer",
  },
  timeout: 12000,
});

// Automatically retry once if the local development socket reset (GET requests only - never retry mutations)
API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const isGetMethod =
      config?.method && config.method.toLowerCase() === "get";

    if (!config || config._retry || error.response || !isGetMethod) {
      return Promise.reject(error);
    }

    if (
      error.message?.includes("Network Error") ||
      error.code === "ERR_NETWORK" ||
      error.code === "ECONNRESET"
    ) {
      config._retry = true;
      return API(config);
    }

    return Promise.reject(error);
  }
);

export const login = async (email, password) => {
  const { data } = await API.post("/login", {
    email,
    password,
    context: "customer",
  });

  return data;
};

export const googleLogin = async (credential) => {
  const { data } = await API.post("/google-login", {
    credential,
    context: "customer",
  });

  return data;
};

export const register = async (userData) => {
  const { data } = await API.post("/register", userData);
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

export const sendOtp = async (phone, purpose = "verify_phone") => {
  const { data } = await API.post("/otp/send", { phone, purpose });
  return data;
};

export const verifyOtp = async (phone, otp, purpose = "verify_phone") => {
  const { data } = await API.post("/otp/verify", { phone, otp, purpose });
  return data;
};

export const resetPasswordOtp = async (phone, reset_token, new_password) => {
  const { data } = await API.post("/otp/reset-password", {
    phone,
    reset_token,
    new_password,
  });
  return data;
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