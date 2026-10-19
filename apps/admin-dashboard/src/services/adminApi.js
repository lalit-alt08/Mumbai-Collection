import axios from "axios";
import { readRetryDelayMs, shouldRetryRead } from "../utils/readRetry.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: `${API_BASE}/admin`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "admin",
  },
  timeout: 12000,
});

// Automatically retry safe reads once; writes are not replayed after ambiguous failures.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    // Handle session expiration
    if (error.response?.status === 401 && !window.location.pathname.includes("/login")) {
      window.location.href = "/login";
      return Promise.reject(error);
    }

    if (!config || config._retry) {
      return Promise.reject(error);
    }

    if (shouldRetryRead(error, config)) {
      const delayMs = readRetryDelayMs(error);
      if (delayMs === null) return Promise.reject(error);
      config._retry = true;
      await new Promise((r) => setTimeout(r, delayMs));
      return api(config);
    }

    return Promise.reject(error);
  }
);

export const getOverview = async (params = {}) => {
  const res = await api.get("/overview", { params });
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

export const deleteProduct = async (id) => {
  const res = await api.delete(`/products/${id}`);
  return res.data;
};

export const createProduct = async (data) => {
  const res = await api.post("/products", data);
  return res.data;
};

export const uploadProductImage = async (file) => {
  const formData = new FormData();
  formData.append("image", file);

  const res = await api.post("/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return res.data;
};

export const getCustomers = async (params = {}) => {
  const res = await api.get("/customers", { params });
  return res.data;
};

export const getCustomerOrders = async (customerId, params = {}) => {
  const res = await api.get(`/customers/${customerId}/orders`, { params });
  return res.data;
};

export const getAnalytics = async (params = {}) => {
  const res = await api.get("/analytics", { params });
  return res.data;
};

export const getAnalyticsReport = async (params = {}) => {
  const res = await api.get("/analytics/report", { params });
  return res.data;
};

// Employee Access & Staff Directory Management
export const getEmployees = async (params = {}) => {
  const res = await api.get("/employees", { params });
  return res.data;
};

export const requestEmployeeAccess = async (data) => {
  const res = await api.post("/employees/access", data);
  return res.data;
};

export const approveEmployee = async (id, data) => {
  const res = await api.patch(`/employees/${id}/approve`, data);
  return res.data;
};

export const rejectEmployee = async (id, data) => {
  const res = await api.patch(`/employees/${id}/reject`, data);
  return res.data;
};

export const updateEmployeeStatus = async (id, data) => {
  const res = await api.patch(`/employees/${id}/status`, data);
  return res.data;
};

export const revokeEmployeeSessions = async (id) => {
  const res = await api.post(`/employees/${id}/revoke-sessions`);
  return res.data;
};

// Store Operating Hours Configuration
export const getStoreHours = async () => {
  const res = await api.get("/store-hours");
  return res.data;
};

export const updateStoreHours = async (data) => {
  const res = await api.put("/store-hours", data);
  return res.data;
};

export const togglePeakHours = async (is_peak_hours, extra = {}) => {
  const res = await api.put("/store-hours/peak-toggle", {
    is_peak_hours,
    ...extra,
  });
  return res.data;
};

// Customer Suspension Management
export const lookupCustomerSuspension = async (email) => {
  const res = await api.get("/customer-suspension/lookup", {
    params: { email },
  });
  return res.data;
};

export const suspendCustomer = async (data) => {
  const res = await api.post("/customer-suspension/suspend", data);
  return res.data;
};

export const unsuspendCustomer = async (data) => {
  const res = await api.post("/customer-suspension/unsuspend", data);
  return res.data;
};

// Payment Reconciliation (Razorpay - WooCommerce Sync)
export const reconcilePayment = async (orderId) => {
  const base = API_BASE.replace(/\/admin\/?$/, "");
  const res = await axios.post(
    `${base}/payments/reconcile/${orderId}`,
    {},
    {
      withCredentials: true,
      headers: {
        "X-Mumbai-Panel": "admin",
      },
      timeout: 15000,
    }
  );
  return res.data;
};

