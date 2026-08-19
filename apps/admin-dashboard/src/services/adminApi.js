import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: `${API_BASE}/admin`,
  withCredentials: true,
});

// Automatically retry once if the local development socket reset
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!config || config._retry || error.response) {
      return Promise.reject(error);
    }

    if (
      error.message?.includes("Network Error") ||
      error.code === "ERR_NETWORK" ||
      error.code === "ECONNRESET"
    ) {
      config._retry = true;
      return api(config);
    }

    return Promise.reject(error);
  }
);

export const getOverview = async () => {
  const res = await api.get("/overview");
  return res.data;
};

export const getOrders = async (params = {}) => {
  const res = await api.get("/orders", { params });
  return res.data;
};

export const updateOrderStatus = async (id, status) => {
  const res = await api.put(`/orders/${id}/status`, { status });
  return res.data;
};

export const getProducts = async (params = {}) => {
  const res = await api.get("/products", { params });
  return res.data;
};

export const updateProduct = async (id, data) => {
  const res = await api.put(`/products/${id}`, data);
  return res.data;
};

export const createProduct = async (data) => {
  const res = await api.post("/products", data);
  return res.data;
};

export const getCustomers = async () => {
  const res = await api.get("/customers");
  return res.data;
};
