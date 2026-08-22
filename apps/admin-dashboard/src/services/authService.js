import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const authApi = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "admin",
  },
});

export const loginAdmin = async (email, password) => {
  const response = await authApi.post("/auth/login", {
    email,
    password,
    context: "admin",
  });

  return response.data;
};

export const getCurrentUser = async () => {
  const response = await authApi.get("/auth/me", {
    params: { context: "admin" },
  });

  return response.data;
};

export const logoutAdmin = async () => {
  const response = await authApi.post("/auth/logout", {
    context: "admin",
  });

  return response.data;
};