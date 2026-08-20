import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const authApi = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

export const loginAdmin = async (email, password) => {
  const response = await authApi.post("/auth/login", {
    email,
    password,
  });

  return response.data;
};

export const getCurrentUser = async () => {
  const response = await authApi.get("/auth/me");

  return response.data;
};

export const logoutAdmin = async () => {
  const response = await authApi.post("/auth/logout");

  return response.data;
};