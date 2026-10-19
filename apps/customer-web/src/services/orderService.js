import axios from "axios";
import API_URL from "../config/api.js";
import { attachStaleConnectionRetry } from "../utils/resilientAxios.js";

const API = axios.create({
  baseURL: `${API_URL}/orders`,
  withCredentials: true,
  timeout: 12000,
});

attachStaleConnectionRetry(API);

export const getMyOrders = async ({ page = 1, per_page = 10, email } = {}) => {
  const params = { page, per_page };
  if (email) params.email = email;

  const response = await API.get("", { params });
  return response.data;
};

export const getOrderById = async (id) => {
  const response = await API.get(`/${id}`);
  return response.data;
};
