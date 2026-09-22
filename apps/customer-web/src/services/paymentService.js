/**
 * Payment Service — Customer Web
 *
 * Handles API communication with the backend payment endpoints:
 * - POST /api/payments/create-order
 * - POST /api/payments/verify
 *
 * Adheres to existing Axios withCredentials conventions.
 * Never stores or transmits secrets.
 */

import axios from "axios";
import API_URL from "../config/api.js";

const API = axios.create({
  baseURL: `${API_URL}/payments`,
  withCredentials: true,
  timeout: 30000,
});

/**
 * Creates or reuses a payment order on the backend.
 *
 * @param {Object} payload
 * @param {number} [payload.order_id] - Optional order ID when retrying payment for an existing pending order
 * @param {Object} [payload.billing_address]
 * @param {Object} [payload.shipping_address]
 * @param {Object} [config] - Additional Axios config (e.g. headers: { "X-Idempotency-Key": ... })
 * @returns {Promise<Object>} Backend response: { success, order_id, razorpay_order_id, amount, currency, key_id }
 */
export const createPaymentOrder = async (payload, config = {}) => {
  const response = await API.post("/create-order", payload, config);
  return response.data;
};

/**
 * Verifies the Razorpay payment signature on the backend.
 *
 * @param {Object} payload
 * @param {number|string} payload.order_id - WooCommerce order ID
 * @param {string} payload.razorpay_order_id
 * @param {string} payload.razorpay_payment_id
 * @param {string} payload.razorpay_signature
 * @returns {Promise<Object>} Backend response: { success, order_id, status, message }
 */
export const verifyPayment = async (payload) => {
  const response = await API.post("/verify", payload);
  return response.data;
};

/**
 * Checks payment state on backend by Razorpay order ID (for recovery after browser close / app switch).
 *
 * @param {string} razorpayOrderId
 * @returns {Promise<Object>}
 */
export const checkPaymentStatus = async (razorpayOrderId) => {
  const response = await API.post("/check-status", { razorpay_order_id: razorpayOrderId });
  return response.data;
};

export default {
  createPaymentOrder,
  verifyPayment,
  checkPaymentStatus,
};

