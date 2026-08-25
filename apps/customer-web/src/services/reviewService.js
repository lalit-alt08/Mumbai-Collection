import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: `${API_BASE}/reviews`,
  withCredentials: true,
  headers: {
    "X-Mumbai-Panel": "customer",
  },
});

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
