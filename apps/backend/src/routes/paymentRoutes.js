/**
 * Payment Routes — Stage 1: Backend Payment Foundation
 *
 * POST /api/payments/create-order  → Creates WooCommerce + Razorpay order
 * POST /api/payments/verify        → Verifies Razorpay payment signature
 *
 * Middleware chain:
 * 1. checkoutLimiter — rate limiting (reuses existing checkout rate limiter)
 * 2. requireAuth("customer") — session authentication
 * 3. requireVerifiedPhone — phone verification enforcement
 * 4. requireIdempotency — duplicate request prevention
 */

import express from "express";
import { requireAuth, requireVerifiedPhone } from "../middlewares/authMiddleware.js";
import { checkoutLimiter } from "../middlewares/rateLimiter.js";
import { requireIdempotency } from "../middlewares/idempotencyMiddleware.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";
import {
  createOrder,
  verifyPayment,
  handleWebhook,
  reconcileOrder,
} from "../controllers/paymentController.js";

const router = express.Router();

// POST /api/payments/create-order
router.post(
  "/create-order",
  validateRequest({ body: schemas.paymentCreateOrder }),
  checkoutLimiter,
  requireAuth("customer"),
  requireVerifiedPhone,
  requireIdempotency,
  createOrder
);

// POST /api/payments/verify
router.post(
  "/verify",
  validateRequest({ body: schemas.paymentVerify }),
  checkoutLimiter,
  requireAuth("customer"),
  requireVerifiedPhone,
  verifyPayment
);

// POST /api/payments/webhook
// Unauthenticated machine-to-machine webhook from Razorpay (signature verified in controller, exempt from CSRF)
router.post(
  "/webhook",
  handleWebhook
);

// POST /api/payments/reconcile/:id
// Admin reconciliation endpoint
router.post(
  "/reconcile/:id",
  requireAuth("admin"),
  reconcileOrder
);

export default router;
