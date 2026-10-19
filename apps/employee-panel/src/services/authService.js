import axios from "axios";
import { readRetryDelayMs, shouldRetryRead } from "../utils/readRetry.js";

const API_BASE =
  import.meta.env?.VITE_API_URL || "http://localhost:5000/api";

const authApi = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "employee",
  },
  timeout: 12000,
});

authApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error?.config;
    if (!config || config._readRetry || !shouldRetryRead(error, config)) {
      return Promise.reject(error);
    }
    const delayMs = readRetryDelayMs(error);
    if (delayMs === null) return Promise.reject(error);
    config._readRetry = true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return authApi(config);
  }
);

export const loginEmployee = async (email, password) => {
  const response = await authApi.post("/auth/login", {
    email,
    password,
    context: "employee",
  });

  return response.data;
};

export const getCurrentUser = async () => {
  const response = await authApi.get("/auth/me", {
    params: { context: "employee" },
  });

  return response.data;
};

export const logoutEmployee = async () => {
  const response = await authApi.post("/auth/logout", {
    context: "employee",
  });

  return response.data;
};
