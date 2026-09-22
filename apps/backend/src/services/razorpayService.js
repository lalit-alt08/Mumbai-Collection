/**
 * Razorpay Payment Gateway Service
 *
 * Provides reusable helpers for:
 * - Razorpay client initialization
 * - Creating Razorpay payment orders
 * - Verifying Razorpay payment signatures (HMAC SHA256)
 * - Fetching payment details from Razorpay
 *
 * SECURITY:
 * - Razorpay key_secret is used ONLY server-side for HMAC verification.
 * - Never log API keys, secrets, signatures, card data, or UPI credentials.
 * - Only order IDs and payment IDs appear in safe operational logs.
 */

import Razorpay from "razorpay";
import crypto from "crypto";
import { logger } from "../utils/logger.js";

// ─────────────────────────────────────────────────────────
// Razorpay Client Initialization
// ─────────────────────────────────────────────────────────

let razorpayInstance = null;

/**
 * Returns a lazily-initialized Razorpay SDK instance.
 * Throws if credentials are not configured.
 */
export const getRazorpayInstance = () => {
  if (razorpayInstance) return razorpayInstance;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }

  razorpayInstance = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  logger.info("Razorpay client initialized");
  return razorpayInstance;
};

export const _setRazorpayInstanceForTesting = (instance) => {
  razorpayInstance = instance;
};

// ─────────────────────────────────────────────────────────
// Create Razorpay Order
// ─────────────────────────────────────────────────────────

/**
 * Creates a Razorpay payment order.
 *
 * @param {Object} params
 * @param {number} params.amountInPaise - Order amount in paise (integer, e.g. 50000 = ₹500)
 * @param {string} [params.currency="INR"] - Currency code
 * @param {string} params.receipt - Receipt identifier (e.g. "wc_order_123")
 * @param {Object} [params.notes={}] - Razorpay notes (max 15 key-value pairs)
 * @returns {Promise<Object>} Razorpay order object
 */
export const createRazorpayOrder = async ({ amountInPaise, currency = "INR", receipt, notes = {} }) => {
  const razorpay = getRazorpayInstance();

  const order = await razorpay.orders.create({
    amount: amountInPaise,
    currency,
    receipt: String(receipt).slice(0, 40), // Razorpay receipt max 40 chars
    notes,
  });

  logger.info(
    { razorpay_order_id: order.id, amount: amountInPaise, currency },
    "[Razorpay] Order created"
  );

  return order;
};

// ─────────────────────────────────────────────────────────
// Verify Razorpay Payment Signature
// ─────────────────────────────────────────────────────────

/**
 * Verifies the Razorpay payment signature using HMAC SHA256.
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * @param {Object} params
 * @param {string} params.razorpay_order_id - Razorpay order ID
 * @param {string} params.razorpay_payment_id - Razorpay payment ID
 * @param {string} params.razorpay_signature - Signature from Razorpay checkout
 * @returns {boolean} true if signature is valid
 */
export const verifyPaymentSignature = ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new Error("Razorpay key secret is not configured.");
  }

  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(body)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(razorpay_signature, "hex")
    );
  } catch {
    // Buffer length mismatch or invalid hex → signature invalid
    return false;
  }
};

// ─────────────────────────────────────────────────────────
// Fetch Razorpay Payment Details
// ─────────────────────────────────────────────────────────

/**
 * Fetches payment details directly from Razorpay.
 *
 * @param {string} paymentId - Razorpay payment ID (e.g. "pay_XXXXXXXXXXXXXX")
 * @returns {Promise<Object>} Razorpay payment object
 */
export const fetchRazorpayPayment = async (paymentId) => {
  const razorpay = getRazorpayInstance();
  return razorpay.payments.fetch(paymentId);
};

/**
 * Fetches order details directly from Razorpay.
 *
 * @param {string} orderId - Razorpay order ID (e.g. "order_XXXXXXXXXXXXXX")
 * @returns {Promise<Object>} Razorpay order object
 */
export const fetchRazorpayOrder = async (orderId) => {
  const razorpay = getRazorpayInstance();
  return razorpay.orders.fetch(orderId);
};

/**
 * Returns the public Razorpay Key ID (safe for frontend).
 * @returns {string}
 */
export const getPublicKeyId = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) {
    throw new Error("RAZORPAY_KEY_ID is not configured.");
  }
  return keyId;
};

// ─────────────────────────────────────────────────────────
// Verify Razorpay Webhook Signature
// ─────────────────────────────────────────────────────────

/**
 * Verifies the Razorpay webhook signature using HMAC SHA256.
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * @param {Buffer|string} rawBody - Exact raw request body
 * @param {string} signature - Signature from X-Razorpay-Signature header
 * @returns {boolean} true if signature is valid
 */
export const verifyWebhookSignature = (rawBody, signature) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("Razorpay webhook secret is not configured.");
  }

  if (!rawBody || !signature || typeof signature !== "string") {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    // Buffer length mismatch or invalid hex → signature invalid
    return false;
  }
};

/**
 * Fetches all payments associated with a Razorpay order.
 *
 * @param {string} orderId - Razorpay order ID
 * @returns {Promise<Object>} Collection of payments { count, items: [] }
 */
export const fetchRazorpayOrderPayments = async (orderId) => {
  const razorpay = getRazorpayInstance();
  return razorpay.orders.fetchPayments(orderId);
};

