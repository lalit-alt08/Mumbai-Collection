import axios from "axios";
import API_URL from "../config/api.js";
import { attachStaleConnectionRetry } from "../utils/resilientAxios.js";

const api = axios.create({
  baseURL: `${API_URL}/reviews`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "customer",
  },
  timeout: 12000,
});

attachStaleConnectionRetry(api);

/**
 * Fetch reviews and summary for a product
 */
export const getProductReviews = async (productId) => {
  const res = await api.get(`/product/${productId}`);
  return res.data;
};

/**
 * Submit or update a product review
 */
export const submitProductReview = async (productId, { rating, review }) => {
  const res = await api.post(`/product/${productId}`, { rating, review });
  return res.data;
};

/**
 * Delete a product review
 */
export const deleteProductReview = async (reviewId) => {
  const res = await api.delete(`/${reviewId}`);
  return res.data;
};

export default {
  getProductReviews,
  submitProductReview,
  deleteProductReview,
};
