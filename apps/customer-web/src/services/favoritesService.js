import axios from "axios";
import API_URL from "../config/api.js";
import { attachStaleConnectionRetry } from "../utils/resilientAxios.js";

const api = axios.create({
  baseURL: `${API_URL}/favorites`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "customer",
  },
  timeout: 12000,
});

attachStaleConnectionRetry(api);

/**
 * Fetch strictly favorite product IDs for fast badge/heart checking (zero product hydration)
 */
export const getFavoriteIds = async () => {
  const res = await api.get("/ids");
  return res.data;
};

/**
 * Fetch all favorites with full product details for logged-in customer (for /favorites page)
 */
export const getFavorites = async () => {
  const res = await api.get("");
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
  getFavoriteIds,
  getFavorites,
  addFavorite,
  removeFavorite,
  checkFavoriteStatus,
};
