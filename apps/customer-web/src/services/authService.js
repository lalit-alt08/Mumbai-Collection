import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:5000/api/auth",
  withCredentials: true,
});

export const login = async (email, password) => {
  const { data } = await API.post("/login", {
    email,
    password,
  });

  return data;
};

export const register = async (userData) => {
  const { data } = await API.post("/register", userData);
  return data;
};

export const getCurrentUser = async () => {
  const { data } = await API.get("/me");
  return data;
};

export const logout = async () => {
  const { data } = await API.post("/logout");
  return data;
};

export const forgotPassword = async (email) => {
  const { data } = await API.post("/forgot-password", {
    email,
  });

  return data;
};