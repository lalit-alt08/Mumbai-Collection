import axios from "axios";

const API_BASE = import.meta.env?.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: `${API_BASE}/employee`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "employee",
  },
  timeout: 12000,
});

// Automatic retry for transient connection drops (GET requests only - never retry mutations)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isGetMethod =
      originalRequest?.method &&
      originalRequest.method.toLowerCase() === "get";

    if (
      isGetMethod &&
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
      if (typeof window !== "undefined" && window.location?.pathname !== "/login") {
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
  const cleanParams = {};

  if (params.page !== undefined && params.page !== null) {
    cleanParams.page = Number(params.page) || 1;
  }
  if (params.per_page !== undefined && params.per_page !== null) {
    cleanParams.per_page = Number(params.per_page) || 20;
  }
  if (typeof params.search === "string" && params.search.trim() !== "") {
    cleanParams.search = params.search.trim();
  }
  if (
    typeof params.stock_status === "string" &&
    params.stock_status.trim() !== "" &&
    params.stock_status !== "all"
  ) {
    cleanParams.stock_status = params.stock_status.trim();
  }
  if (
    typeof params.category === "string" &&
    params.category.trim() !== "" &&
    params.category !== "all"
  ) {
    cleanParams.category = params.category.trim();
  }

  // Forward any additional custom parameters for backwards compatibility
  const knownKeys = new Set(["page", "per_page", "search", "stock_status", "category"]);
  for (const [key, val] of Object.entries(params)) {
    if (!knownKeys.has(key) && val !== undefined && val !== null && val !== "") {
      cleanParams[key] = val;
    }
  }

  const res = await api.get("/products", { params: cleanParams });
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

export const createProduct = async (data, headers = {}) => {
  const config = {};
  if (headers && Object.keys(headers).length > 0) {
    config.headers = headers;
  }
  const res = await api.post("/products", data, config);
  return res.data;
};

export const uploadProductImage = async (file, options = {}) => {
  const formData = new FormData();
  formData.append("image", file);

  const config = {};
  if (options.onUploadProgress) {
    config.onUploadProgress = options.onUploadProgress;
  }
  if (options.signal) {
    config.signal = options.signal;
  }

  const res = await api.post("/upload", formData, config);
  return res.data;
};

export const deleteMedia = async (mediaId) => {
  const res = await api.delete(`/media/${mediaId}`);
  return res.data;
};

export const getCategories = async () => {
  const res = await api.get("/categories");
  return res.data;
};

export const createCategory = async (data, headers = {}) => {
  const config = {};
  if (headers && Object.keys(headers).length > 0) {
    config.headers = headers;
  }
  const res = await api.post("/categories", data, config);
  return res.data;
};

export const updateCategory = async (id, data, headers = {}) => {
  const config = {};
  if (headers && Object.keys(headers).length > 0) {
    config.headers = headers;
  }
  const res = await api.put(`/categories/${id}`, data, config);
  return res.data;
};

export const reorderCategories = async (categoryIds, headers = {}) => {
  const config = {};
  if (headers && Object.keys(headers).length > 0) {
    config.headers = headers;
  }
  const res = await api.put("/categories/reorder", { category_ids: categoryIds }, config);
  return res.data;
};

export const getBanners = async () => {
  const res = await api.get("/banners");
  return res.data;
};

export const updateBanners = async (banners, headers = {}) => {
  const config = {};
  if (headers && Object.keys(headers).length > 0) {
    config.headers = headers;
  }
  const res = await api.put("/banners", { banners }, config);
  return res.data;
};

export default api;
