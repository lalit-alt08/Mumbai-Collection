import axios from "axios";
import API_URL from "../config/api.js";

const API = axios.create({
  baseURL: `${API_URL}/auth`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "customer",
  },
});

// Automatically retry once if the local development socket reset
API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!config || config._retry || error.response) {
      return Promise.reject(error);
    }

    if (error.message?.includes("Network Error") || error.code === "ERR_NETWORK") {
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