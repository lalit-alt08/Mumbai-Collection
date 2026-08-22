import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const authApi = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "employee",
  },
});

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
