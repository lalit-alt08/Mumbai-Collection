import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: `${API_BASE}/favorites`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "customer",
  },
});

/**
 * Fetch all favorites for logged-in customer
 */
export const getFavorites = async () => {
  const res = await api.get("/");
  return res.data;
};

/**
 * Add a product to favorites
 */
export const addFavorite = async (productId) => {
  const res = await api.post(`/${productId}`);
  return res.data;
};

/**
 * Remove a product from favorites
 */
export const removeFavorite = async (productId) => {
  const res = await api.delete(`/${productId}`);
  return res.data;
};

/**
 * Check favorite status of a product
 */
export const checkFavoriteStatus = async (productId) => {
  const res = await api.get(`/${productId}/status`);
  return res.data;
};

export default {
  getFavorites,
  addFavorite,
  removeFavorite,
  checkFavoriteStatus,
};
