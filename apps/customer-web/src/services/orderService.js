import axios from "axios";
import API_URL from "../config/api.js";

const API = axios.create({
  baseURL: `${API_URL}/orders`,
  withCredentials: true,
});

export const getMyOrders = async (email) => {
  const response = await API.get("/", {
    params: email ? { email } : {},
  });
  return response.data;
};

export const getOrderById = async (id) => {
  const response = await API.get(`/${id}`);
  return response.data;
};
