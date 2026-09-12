import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: `${API_BASE}/admin`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "admin",
  },
  timeout: 12000,
});

// Automatically retry once if the local development socket reset (GET requests only - never retry mutations)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const isGetMethod =
      config?.method && config.method.toLowerCase() === "get";

    // Handle session expiration
    if (error.response?.status === 401 && !window.location.pathname.includes("/login")) {
      window.location.href = "/login";
      return Promise.reject(error);
    }

    if (!config || config._retry || error.response || !isGetMethod) {
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

export const getAnalytics = async (params = {}) => {
  const res = await api.get("/analytics", { params });
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
