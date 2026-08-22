import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: `${API_BASE}/employee`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "employee",
  },
});

// Automatic retry for transient connection drops
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (
      error.message &&
      (error.message.includes("Network Error") ||
        error.code === "ECONNRESET" ||
        error.code === "ERR_NETWORK") &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;
      try {
        return await api(originalRequest);
      } catch (retryError) {
        return Promise.reject(retryError);
      }
    }

    if (error.response?.status === 401) {
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// Overview / Operational Dashboard
export const getOverview = async () => {
  const res = await api.get("/overview");
  return res.data;
};

// Orders Management
export const getOrders = async (params = {}) => {
  const res = await api.get("/orders", { params });
  return res.data;
};

export const updateOrderStatus = async (id, status) => {
  const res = await api.patch(`/orders/${id}/status`, { status });
  return res.data;
};

// Explicit Employee-owned function aliases
export const getEmployeeOrders = getOrders;
export const updateEmployeeOrderStatus = updateOrderStatus;

// Inventory & Products Management
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

export default api;
