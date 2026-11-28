/**
 * Payment Controller — Deferred WooCommerce Order Creation for Razorpay
 *
 * Coordinates checkout creation, payment verification, status polling, and cancellations.
 * Sub-concerns are partitioned into:
 * - paymentCheckoutUtils: cart fingerprinting, paise conversion, lock management, stock holds.
 * - paymentFinalizeService: atomic order finalization, duplicate suppression, and inventory commits.
 * - paymentWebhookHandler: durable webhook persistence, fast-ack, and background order resolution.
 * - paymentReconciliationHandler: admin order reconciliation with distributed lease protection.
 */

import crypto from "crypto";
import api from "../config/woocommerce.js";
import wp from "../services/wordpress.js";
import { serverCache } from "../utils/memoryCache.js";
import { logger, logError } from "../utils/logger.js";
import storeHoursService from "../services/storeHoursService.js";
import paymentIntentService, {
  updatePaymentIntentStatus,
  releaseCheckoutStock,
} from "../services/paymentIntentService.js";
import {
  createRazorpayOrder,
  getPublicKeyId,
  fetchRazorpayOrder,
  fetchRazorpayOrderPayments,
} from "../services/razorpayService.js";
import { validateDeliveryAddress } from "./addressController.js";
import { acquirePaymentLease } from "../services/paymentLease.js";
import {
  MIN_ORDER_VALUE_INR,
  formatPaiseAsRupees,
  checkoutScheduleFields,
  sendCartTokenMismatch,
  sendPaymentOrderNotFound,
  sendFinalizationResult,
  customerFrontendOrigin,
  reserveStockForCheckout,
  acquireCheckoutConcurrencyLock,
  releaseCheckoutConcurrencyLock,
  getActiveCartIntentId,
  setActiveCartIntentId,
  deleteActiveCartIntentId,
  getCustomerCart,
  getExistingRazorpayOrderId,
  totalToPaise,
  computeCartFingerprint,
  findOrderByRazorpayOrderId,
  assertInrCartMinorUnits,
} from "../utils/paymentCheckoutUtils.js";
import { finalizePaymentAndCreateOrder } from "../services/paymentFinalizeService.js";
import { handleWebhook } from "./paymentWebhookHandler.js";
import { reconcileOrder } from "./paymentReconciliationHandler.js";

// Re-export shared services and utilities for routes, submodules, and tests
export {
  finalizePaymentAndCreateOrder,
  handleWebhook,
  reconcileOrder,
  getExistingRazorpayOrderId,
  totalToPaise,
  computeCartFingerprint,
  findOrderByRazorpayOrderId,
};

// Safe last-known store-hours fallback cache with maximum 5-minute TTL
let lastKnownStoreStatus = null;

export const _resetPaymentStoreHoursFallbackForTesting = () => {
  lastKnownStoreStatus = null;
  storeHoursService._resetCheckoutStoreFallbackForTesting?.();
};

let _finalizePaymentOverrideForTesting = null;
export const _setFinalizeHandlerForTesting = (fn) => {
  _finalizePaymentOverrideForTesting = fn;
};

const finalizeSignedPayment = (req, rzpOrderId, rzpPaymentId, rzpSignature, expectedCustomerId, source) => {
  const finalizeFn = _finalizePaymentOverrideForTesting || finalizePaymentAndCreateOrder;
  return finalizeFn({ rzpOrderId, rzpPaymentId, rzpSignature, expectedCustomerId, source, req });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/create-order
// ─────────────────────────────────────────────────────────────────────────────

export const createOrder = async (req, res) => {
  try {
    const userId = req.wpUserId;

    // ── 1. Verify customer is not suspended ────────────────────────────────
    let isSuspended;
    try {
      const result = await wp.get(`/wp-json/mumbai-auth/v1/internal/customer-suspension/${userId}`, { timeout: 8000 });
      if (typeof result.data?.is_suspended !== "boolean") throw new Error("Invalid suspension status");
      isSuspended = result.data.is_suspended;
    } catch (error) {
      logError(req, error, "Unable to verify checkout eligibility");
      return res.status(503).json({ success: false, code: "SUSPENSION_STATUS_UNAVAILABLE", message: "Unable to verify checkout eligibility. Please try again." });
    }
    if (isSuspended) {
      return res.status(403).json({
        success: false,
        code: "CUSTOMER_SUSPENDED",
        message: "Your account is currently suspended and you cannot place new orders.",
      });
    }

    // ── 2. Store Hours Guard ───────────────────────────────────────────────
    const storeGuard = await storeHoursService.checkCheckoutStoreGuard(
      lastKnownStoreStatus,
      (val) => { lastKnownStoreStatus = val; }
    );
    if (!storeGuard.allowed) {
      return res.status(storeGuard.statusCode).json(storeGuard.payload);
    }

    // ── 3. Online Checkout Flow (DEFERRED WC ORDER CREATION) ────────────────
    const { billing_address, shipping_address } = req.body;
    if (!billing_address || !shipping_address) {
      return res.status(400).json({
        success: false,
        message: "Billing and shipping addresses are required.",
      });
    }

    const shippingValidation = validateDeliveryAddress(shipping_address);
    if (!shippingValidation.valid) {
      return res.status(400).json({
        success: false,
        code: "INVALID_DELIVERY_ADDRESS",
        message: shippingValidation.message,
      });
    }

    const billingValidation = validateDeliveryAddress(billing_address);
    if (!billingValidation.valid) {
      return res.status(400).json({
        success: false,
        code: "INVALID_BILLING_ADDRESS",
        message: billingValidation.message,
      });
    }

    // ── 5. Validate Cart-Token ownership & fetch live WooCommerce cart ──────
    const rawCartToken = req.headers["cart-token"] || req.body?.cart_token;
    let validatedCartToken = null;
    if (rawCartToken && typeof rawCartToken === "string") {
      try {
        const parts = rawCartToken.split(".");
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
          const payload = JSON.parse(payloadJson);
          const tokenUserId = payload.user_id !== undefined && payload.user_id !== null ? Number(payload.user_id) : NaN;
          if (isNaN(tokenUserId) || tokenUserId <= 0 || tokenUserId !== Number(userId)) {
            logger.warn(
              { tokenUserId: payload.user_id, authenticatedUserId: userId },
              "[Payment] Cart token ownership mismatch: token belongs to different user or guest"
            );
            return sendCartTokenMismatch(res, "Cart session does not belong to this account.");
          }
          validatedCartToken = rawCartToken;
        } else {
          return sendCartTokenMismatch(res);
        }
      } catch (tokenErr) {
        logger.warn({ err: tokenErr.message }, "[Payment] Failed to parse cart-token header");
        return sendCartTokenMismatch(res);
      }
    }

    let cart;
    try {
      cart = await getCustomerCart(
        req.wpAuthCookie,
        validatedCartToken,
        { billing_address, shipping_address },
        req.headers.nonce
      );
    } catch (cartErr) {
      logError(req, cartErr, "[Payment] Failed to fetch customer cart");
      const statusCode = cartErr.statusCode || 502;
      const code = cartErr.code || "CART_FETCH_FAILED";
      return res.status(statusCode).json({
        success: false,
        code,
        message: cartErr.message || "Unable to load your cart. Please try again.",
        retryable: true,
      });
    }

    if (!cart?.items || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Your cart is empty.",
      });
    }

    // ── 6. Minimum order value check (₹500 on product subtotal) ────────────
    const itemsSubtotal = cart.totals?.total_items
      ? Number(cart.totals.total_items) / 100
      : 0;

    if (itemsSubtotal < MIN_ORDER_VALUE_INR) {
      const shortfall = Math.max(0, MIN_ORDER_VALUE_INR - itemsSubtotal);
      return res.status(400).json({
        success: false,
        code: "MIN_ORDER_VALUE",
        message: `Minimum product order value of ₹${MIN_ORDER_VALUE_INR} is required. Please add ₹${shortfall} more.`,
      });
    }

    // ── 7. Build and validate line items from live cart ─────────────────────
    const lineItems = cart.items.map((item) => {
      const entry = {
        product_id: item.id,
        quantity: item.quantity,
      };
      if (item.variation && Array.isArray(item.variation) && item.variation.length > 0) {
        const variationId = item.variation_id || item.id;
        if (variationId !== item.id) {
          entry.variation_id = variationId;
        }
      }
      return entry;
    });

    const couponLines = Array.isArray(cart.coupons)
      ? cart.coupons.map((c) => ({ code: c.code }))
      : [];

    const shippingLines = [];
    if (Array.isArray(cart.shipping_rates)) {
      for (const pkg of cart.shipping_rates) {
        if (Array.isArray(pkg.shipping_rates)) {
          const selected = pkg.shipping_rates.find((r) => r.selected);
          if (selected) {
            shippingLines.push({
              method_id: selected.method_id,
              method_title: selected.name || selected.method_id,
              total: formatPaiseAsRupees(Number(selected.price)),
            });
          }
        }
      }
    }

    if (!assertInrCartMinorUnits(cart)) {
      return res.status(422).json({
        success: false,
        code: "CURRENCY_MISMATCH",
        message: "Only INR carts with standard paise precision can be checked out.",
      });
    }

    // Authoritative total price directly from WooCommerce cart
    const amountInPaise = Number(cart.totals?.total_price || 0);
    if (amountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid cart total calculated. Please review your cart and try again.",
      });
    }

    // The client amount is only a review guard. The amount charged remains
    // the total calculated by WooCommerce above.
    if (req.body.expected_total_paise !== undefined && req.body.expected_total_paise !== amountInPaise) {
      return res.status(409).json({
        success: false,
        code: "CHECKOUT_TOTAL_CHANGED",
        expected_total_paise: req.body.expected_total_paise,
        actual_total_paise: amountInPaise,
        cart,
        message: "Your cart total changed. Please review it before continuing.",
      });
    }

    const cartFingerprint = computeCartFingerprint(cart);

    // Acquire shared distributed mutex across servers (Redis / DB)
    let lockHandle;
    try {
      lockHandle = await acquireCheckoutConcurrencyLock(userId, cartFingerprint, 3000);
    } catch (lockErr) {
      if (lockErr?.code === "LOCK_STORAGE_UNAVAILABLE") {
        return res.status(503).json({
          success: false,
          code: "SERVICE_UNAVAILABLE",
          message: "Checkout locking is temporarily unavailable. Please try again shortly.",
        });
      }
      throw lockErr;
    }
    if (!lockHandle.acquired) {
      return res.status(409).json({
        success: false,
        code: "CHECKOUT_IN_PROGRESS",
        message: "A checkout request is already being processed for this cart. Please wait a moment.",
      });
    }

    try {
      // 7a. Reuse existing active unpaid payment intent across servers
      const existingRzpOrderId = await getActiveCartIntentId(userId, cartFingerprint);
      if (existingRzpOrderId) {
        const existingIntent = await paymentIntentService.getPaymentIntent(existingRzpOrderId, { fresh: true });
        if (existingIntent && !["created", "cancelled", "abandoned", "refunded"].includes(existingIntent.status)) {
          return res.status(409).json({
            success: false,
            code: "ORDER_PROCESSING",
            message: "A previous payment for this cart is still being resolved. Please check its status before paying again.",
          });
        }
        if (
          existingIntent &&
          existingIntent.status === "created" &&
          Number(existingIntent.customer_id) === Number(userId) &&
          existingIntent.cart_fingerprint === cartFingerprint &&
          existingIntent.amount_in_paise === amountInPaise &&
          existingIntent.stock_reservation_id &&
          Date.now() - (existingIntent.created_at || 0) < 15 * 60 * 1000
        ) {
          const reservationFailure = await reserveStockForCheckout(
            existingIntent.stock_reservation_id, lineItems, { reusingIntent: true }
          );
          if (reservationFailure) {
            const { status, ...payload } = reservationFailure;
            return res.status(status).json({ success: false, ...payload });
          }
          // Reuse the gateway intent, but refresh delivery scheduling and latest address details
          // from the authoritative store status and current checkout request.
          existingIntent.checkout_payload = {
            ...(existingIntent.checkout_payload || {}),
            billing: {
              ...billingValidation.normalized,
              email:
                billing_address.email ||
                req.wpUserEmail ||
                existingIntent.checkout_payload?.billing?.email ||
                "",
            },
            shipping: {
              ...shippingValidation.normalized,
            },
            customer_note:
              typeof req.body?.customer_note === "string"
                ? req.body.customer_note
                : existingIntent.checkout_payload?.customer_note || "",
            ...checkoutScheduleFields(storeGuard),
          };
          const refreshedIntent = await paymentIntentService.storePaymentIntent(existingRzpOrderId, existingIntent);
          if (!refreshedIntent && process.env.NODE_ENV === "production") {
            return res.status(503).json({
              success: false,
              code: "PAYMENT_SCHEDULE_UNAVAILABLE",
              message: "We could not refresh the delivery schedule. Please try again shortly.",
            });
          }
          logger.info(
            { customer_id: userId, razorpay_order_id: existingRzpOrderId, cart_fingerprint: cartFingerprint },
            "[Payment] Reusing existing active unpaid payment intent for identical user & cart"
          );
          return res.status(200).json({
            success: true,
            order_id: null,
            razorpay_order_id: existingRzpOrderId,
            amount: existingIntent.amount_in_paise,
            currency: existingIntent.currency || "INR",
            key_id: getPublicKeyId(),
            reused: true,
            ...checkoutScheduleFields(storeGuard),
          });
        }
      }

      // ── 7b. Check live stock for cart lines (Batched Pre-Payment Guard) ────────
      const cartItemIds = [...new Set((cart.items || []).map((item) => Number(item.id)).filter(Boolean))];
      let productsMap = new Map();
      if (cartItemIds.length > 0) {
        try {
          const batchRes = await api.get("products", {
            include: cartItemIds.join(","),
            per_page: Math.min(100, cartItemIds.length),
            _fields: "id,name,manage_stock,stock_quantity,stock_status,backorders_allowed",
          });
          const list = Array.isArray(batchRes?.data) ? batchRes.data : (batchRes?.data ? [batchRes.data] : []);
          for (const p of list) {
            if (p && p.id) productsMap.set(Number(p.id), p);
          }
        } catch (batchErr) {
          logger.warn({ err: batchErr.message }, "[Payment] Notice: Batched pre-checkout stock check upstream error");
        }
      }

      const stockShortages = [];
      const stockShortageDetails = [];
      for (const item of cart.items || []) {
        const prod = productsMap.get(Number(item.id));
        if (prod && typeof prod.manage_stock !== "undefined") {
          const isShort =
            (prod.manage_stock && typeof prod.stock_quantity === "number" && prod.stock_quantity < item.quantity && !prod.backorders_allowed) ||
            (prod.stock_status === "outofstock" && !prod.backorders_allowed);
          if (isShort) {
            const name = item.name || prod.name || `Product #${item.id}`;
            stockShortages.push(name);
            stockShortageDetails.push({
              id: item.id,
              key: item.key,
              name,
              requested: item.quantity,
              available:
                prod.manage_stock && typeof prod.stock_quantity === "number"
                  ? Math.max(0, prod.stock_quantity)
                  : 0,
            });
          }
        }
      }

      if (stockShortages.length > 0) {
        logger.warn(
          { customer_id: userId, stockShortages },
          "[Payment] Order creation blocked: Item(s) out of stock in cart"
        );
        return res.status(422).json({
          success: false,
          code: "ITEM_OUT_OF_STOCK",
          message: `The following item(s) are out of stock or have insufficient quantity: ${stockShortages.join(", ")}. Please update your cart.`,
          out_of_stock_items: stockShortages,
          out_of_stock_details: stockShortageDetails,
        });
      }

      // Reserve stock atomically in WordPress before allowing payment to start.
      const stockReservationId = crypto.randomUUID();
      const reservationFailure = await reserveStockForCheckout(stockReservationId, lineItems);
      if (reservationFailure) {
        const { status, ...payload } = reservationFailure;
        return res.status(status).json({ success: false, ...payload });
      }

      // ── 8. Create Razorpay Order ONLY (No WooCommerce order created yet) ───
      const receipt = `rcpt_${userId}_${Date.now()}`;
      let rzpOrder;
      try {
        rzpOrder = await createRazorpayOrder({
          amountInPaise,
          currency: "INR",
          receipt,
          notes: {
            customer_id: String(userId),
            cart_fingerprint: cartFingerprint,
          },
        });
      } catch (rzpErr) {
        await releaseCheckoutStock(stockReservationId);
        logError(req, rzpErr, "[Payment] Razorpay order creation failed");
        return res.status(502).json({
          success: false,
          message: "Unable to initialize payment gateway. Please try again.",
        });
      }

      // ── 9. Store Payment Intent for Post-Payment Finalization ───────────────
      const paymentIntent = {
        rzp_order_id: rzpOrder.id,
        customer_id: Number(userId),
        customer_email: req.wpUserEmail || billing_address.email || "",
        amount_in_paise: amountInPaise,
        currency: "INR",
        status: "created",
        stock_reservation_id: stockReservationId,
        cart_fingerprint: cartFingerprint,
        created_at: Date.now(),
        expires_at: Date.now() + 3600 * 1000,
        checkout_payload: {
          stock_reservation_id: stockReservationId,
          customer_id: Number(userId),
          billing: {
            ...billingValidation.normalized,
            email: billing_address.email || req.wpUserEmail || "",
          },
          shipping: {
            ...shippingValidation.normalized,
          },
          line_items: lineItems,
          coupon_lines: couponLines,
          shipping_lines: shippingLines,
          ...checkoutScheduleFields(storeGuard),
        },
      };

      const storedDurable = await paymentIntentService.storePaymentIntent(rzpOrder.id, paymentIntent);
      if (!storedDurable && process.env.NODE_ENV === "production") {
        await releaseCheckoutStock(stockReservationId);
        logError(req, new Error("Failed to persist payment intent to database"), "[Payment] Payment session persistence failure");
        return res.status(503).json({
          success: false,
          message: "Unable to initialize payment session. Please try again in a moment.",
        });
      }
      await setActiveCartIntentId(userId, cartFingerprint, rzpOrder.id, 15 * 60);

      logger.info(
        { customer_id: userId, razorpay_order_id: rzpOrder.id, amount: amountInPaise },
        "[Payment] Razorpay order created and payment intent stored — 0 WooCommerce orders created before payment"
      );

      return res.status(200).json({
        success: true,
        order_id: null, // Explicitly null: WooCommerce order will be created upon verified payment capture
        razorpay_order_id: rzpOrder.id,
        amount: amountInPaise,
        currency: "INR",
        key_id: getPublicKeyId(),
        ...checkoutScheduleFields(storeGuard),
      });
    } finally {
      await releaseCheckoutConcurrencyLock(lockHandle);
    }
  } catch (error) {
    logError(req, error, "[Payment] Unhandled error during createOrder");
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while initializing payment. Please try again.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/verify
// ─────────────────────────────────────────────────────────────────────────────

export const verifyPayment = async (req, res) => {
  try {
    const userId = req.wpUserId;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Missing required payment verification parameters.",
      });
    }

    const result = await finalizeSignedPayment(
      req, razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, "browser"
    );

    return sendFinalizationResult(res, result);
  } catch (error) {
    logError(req, error, "[Payment] Unhandled error during verifyPayment");
    return res.status(500).json({
      success: false,
      message: "Payment verification could not be completed. Please try again.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/callback (Server-Side Razorpay Form / App Redirect Callback)
// ─────────────────────────────────────────────────────────────────────────────

export const handlePaymentCallback = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    const frontendOrigin = customerFrontendOrigin();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      logger.warn(
        { razorpay_order_id, razorpay_payment_id },
        "[Payment Callback] Missing parameters in callback request"
      );
      return res.redirect(303, `${frontendOrigin}/cart?payment_error=missing_parameters`);
    }

    const result = await finalizeSignedPayment(
      req, razorpay_order_id, razorpay_payment_id, razorpay_signature, null, "callback"
    );

    if (result.success && result.order_id && !result._flagged && result.orderStatus !== "on-hold") {
      // 303 See Other redirect to success page without signature or payment ID in URL
      return res.redirect(303, `${frontendOrigin}/order-success?order=${result.order_id}`);
    }

    logger.warn({ result }, "[Payment Callback] Finalization unsuccessful in callback");
    return res.redirect(303, `${frontendOrigin}/cart?payment_error=verification_failed`);
  } catch (error) {
    logError(req, error, "[Payment Callback] Unexpected error during payment callback");
    const frontendOrigin = customerFrontendOrigin();
    return res.redirect(303, `${frontendOrigin}/cart?payment_error=server_error`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/check-status (App-Switch / Visibility / Reopen Recovery)
// ─────────────────────────────────────────────────────────────────────────────

export const checkPaymentStatus = async (req, res) => {
  try {
    const userId = Number(req.wpUserId || req.user?.id || 0);
    const { razorpay_order_id } = req.body;

    if (!razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: "Missing razorpay_order_id.",
      });
    }

    // 0. Authorization check on stored payment intent (if present)
    const intent = await paymentIntentService.getPaymentIntent(razorpay_order_id, { fresh: true });
    if (intent) {
      const intentCustomerId = Number(intent.customer_id || intent.user_id || 0);
      if (userId && intentCustomerId && intentCustomerId !== userId) {
        return sendPaymentOrderNotFound(res);
      }
    }

    // 1. Check refund/review intent states before treating any WooCommerce order as complete
    if (intent && ["reconciliation_escalated", "refund_escalated", "test_archived"].includes(intent.status)) {
      return res.json({
        success: false,
        terminal: true,
        support_required: true,
        ...(intent.status === "refund_escalated" ? { refund_status: "pending" } : {}),
        message: "This payment requires staff review. Please do not pay again; contact support with your checkout reference.",
      });
    }
    if (intent && intent.status === "refunded") {
      return res.json({
        success: false,
        paid: false,
        terminal: true,
        refunded: true,
        refund_status: "completed",
        order_id: intent.wc_order_id || null,
        error_reason: intent.error_reason || "ITEM_OUT_OF_STOCK",
        refund_id: intent.refund_id || null,
        message: intent.error_reason === "ITEM_OUT_OF_STOCK"
          ? "An item in your order went out of stock during payment. Your payment was automatically refunded."
          : "Payment was refunded.",
      });
    }

    if (intent && ["refund_pending", "refund_failed"].includes(intent.status)) {
      return res.json({
        success: false,
        paid: true,
        terminal: false,
        refunded: false,
        refund_status: "pending",
        error_reason: intent.error_reason || "ITEM_OUT_OF_STOCK",
        refund_id: intent.refund_id || null,
        message: "Refund pending — your refund is being processed and will reflect in 5-7 business days.",
      });
    }

    // 2. Check if WooCommerce order already exists (guard against refunded/cancelled/held states)
    const existing = await findOrderByRazorpayOrderId(razorpay_order_id);
    if (existing) {
      const existingCustomerId = Number(existing.customer_id || 0);
      if (userId && existingCustomerId && existingCustomerId !== userId) {
        return sendPaymentOrderNotFound(res);
      }
      const existingStatus = String(existing.status || "").toLowerCase();
      if (existingStatus === "refunded") {
        return res.json({
          success: false,
          paid: false,
          terminal: true,
          refunded: true,
          refund_status: "completed",
          order_id: existing.id,
          orderStatus: existingStatus,
          message: "Your payment was refunded.",
        });
      }
      if (["cancelled", "failed"].includes(existingStatus)) {
        return res.json({
          success: false,
          paid: false,
          terminal: true,
          cancelled: true,
          order_id: existing.id,
          orderStatus: existingStatus,
          message: "This order was cancelled or failed.",
        });
      }
      if (
        intent?.status === "amount_mismatch" ||
        (existingStatus === "on-hold" && intent?.status !== "paid")
      ) {
        return res.json({
          success: false,
          terminal: true,
          support_required: true,
          order_id: existing.id,
          orderStatus: existingStatus,
          message: "This order is on hold for store verification. Please contact support with your reference.",
        });
      }
      if (existingStatus !== "pending" && existingStatus !== "on-hold") {
        return res.json({
          success: true,
          order_id: existing.id,
          orderStatus: existing.status,
          status: existing.status,
          already_paid: true,
        });
      }
    }

    // 3. Fetch payments from Razorpay
    let paymentsRes;
    try {
      paymentsRes = await fetchRazorpayOrderPayments(razorpay_order_id);
    } catch (err) {
      if (intent?.status === "paid") {
        return res.status(200).json({
          success: false,
          paid: true,
          captured: true,
          confirming: true,
          terminal: false,
          message: "Payment received · Confirming your order",
        });
      }
      return res.status(502).json({
        success: false,
        message: "Failed to query payment status from gateway.",
      });
    }

    const items = paymentsRes?.items || [];
    const captured = items.find((p) => p.status === "captured");

    if (captured) {
      const finalizeFn = _finalizePaymentOverrideForTesting || finalizePaymentAndCreateOrder;
      const result = await finalizeFn({
        rzpOrderId: razorpay_order_id,
        rzpPaymentId: captured.id,
        expectedCustomerId: userId,
        source: "app_switch_recovery",
        req,
      });
      if (!result.success && [409, 502, 503].includes(result.status)) {
        return res.status(200).json({
          success: false,
          paid: true,
          captured: true,
          confirming: true,
          terminal: false,
          message: "Payment received · Confirming your order",
        });
      }
      return sendFinalizationResult(res, result);
    }

    const processing = items.some((payment) => payment.status === "authorized");
    if (!processing && intent && ["cancelled", "abandoned"].includes(intent.status)) {
      return res.json({
        success: false,
        terminal: true,
        cancelled: true,
        paid: false,
        message: "This checkout has no confirmed payment. You can start a new checkout.",
      });
    }
    const createdAt = typeof intent?.created_at === "number"
      ? intent.created_at
      : Date.parse(String(intent?.created_at || "").replace(" ", "T") + "Z");
    if (!processing && intent?.status === "created" && Date.now() - createdAt >= 15 * 60000) {
      return cancelPaymentOrder(req, res);
    }

    return res.json({
      success: false,
      paid: false,
      terminal: false,
      processing: Boolean(processing),
      can_cancel: !processing,
      message: processing
        ? "Payment is processing with your bank."
        : "Payment not completed or still processing.",
    });
  } catch (error) {
    logError(req, error, "[Payment] Error in checkPaymentStatus");
    return res.status(500).json({
      success: false,
      message: "Unable to check payment status.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/cancel (Customer Dismisses Checkout / Explicit Cancel)
// ─────────────────────────────────────────────────────────────────────────────

export const cancelPaymentOrder = async (req, res) => {
  let lease;
  try {
    const { razorpay_order_id } = req.body;
    if (!razorpay_order_id) {
      return res.status(400).json({ success: false, message: "razorpay_order_id is required." });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required to cancel checkout session.",
      });
    }

    lease = await acquirePaymentLease(razorpay_order_id, "cancel");
    if (!lease) {
      return res.status(409).json({
        success: false,
        message: "Payment processing is in progress. Please check its status.",
      });
    }

    const intent = await paymentIntentService.getPaymentIntent(razorpay_order_id, { fresh: true });
    if (!intent) {
      return res.status(404).json({
        success: false,
        message: "Checkout intent not found. Please check payment status.",
      });
    }

    // 1. Authorize: Intent must belong to the requesting authenticated customer
    if (intent.customer_id && Number(intent.customer_id) !== Number(userId)) {
      logger.warn(
        { rzpOrderId: razorpay_order_id, requestingUser: userId, intentCustomer: intent.customer_id },
        "[Payment Cancel] Unauthorized cancellation attempt: user does not own payment intent"
      );
      return res.status(403).json({
        success: false,
        message: "You are not authorized to cancel this checkout session.",
      });
    }

    // 2. State Guard: Cannot cancel a payment that is already completed or processing
    if (["reconciliation_escalated", "test_archived"].includes(intent.status)) {
      return res.status(409).json({
        success: false,
        code: "PAYMENT_REVIEW_REQUIRED",
        message: "This checkout requires staff review and cannot be cancelled automatically.",
      });
    }
    if (intent.status === "paid" || intent.status === "order_created") {
      logger.warn(
        { rzpOrderId: razorpay_order_id, status: intent.status },
        "[Payment Cancel] Rejection: attempt to cancel an already finalized or paid intent"
      );
      return res.status(409).json({
        success: false,
        code: "CHECKOUT_ALREADY_PAID",
        message: "Cannot cancel a checkout session that has already been paid or completed.",
      });
    }

    // 3. Upstream Gateway Guard: Confirm payment hasn't already been captured on Razorpay
    try {
      const rzpOrder = await fetchRazorpayOrder(razorpay_order_id);
      if (rzpOrder && (rzpOrder.status === "paid" || (rzpOrder.amount_paid && rzpOrder.amount_paid > 0))) {
        logger.warn(
          { rzpOrderId: razorpay_order_id, rzpStatus: rzpOrder.status, amount_paid: rzpOrder.amount_paid },
          "[Payment Cancel] Upstream Razorpay order already marked paid/captured. Refusing cancellation and stock release."
        );
        return res.status(409).json({
          success: false,
          code: "PAYMENT_ALREADY_CAPTURED",
          message: "Payment has already been processed by the gateway. This session cannot be cancelled.",
        });
      }
      const payments = await fetchRazorpayOrderPayments(razorpay_order_id);
      if ((payments.items || []).some((payment) => ["authorized", "captured"].includes(payment.status))) {
        return res.status(409).json({
          success: false,
          message: "A payment is processing. Please check status before paying again.",
        });
      }
    } catch (rzpErr) {
      logger.warn({ rzpOrderId: razorpay_order_id, err: rzpErr.message }, "[Payment Cancel] Gateway unavailable; retaining payment recovery");
      return res.status(503).json({
        success: false,
        message: "Payment status is uncertain. Please check again; do not pay again yet.",
      });
    }

    // 4. Safe Cancellation & Stock Release
    const isUnpaidAttempt = intent.status === "created" || ["cancelled", "abandoned"].includes(intent.status);
    if (!isUnpaidAttempt) {
      return res.status(409).json({
        success: false,
        message: "Payment state changed. Please check status.",
      });
    }

    if (intent.status === "created") {
      const cancelled = await updatePaymentIntentStatus({
        rzpOrderId: razorpay_order_id,
        fromStatus: "created",
        toStatus: "cancelled",
        errorReason: "Customer dismissed checkout; late captures remain recoverable.",
      });
      if (!cancelled) {
        return res.status(409).json({ success: false, message: "Payment state changed. Please check status." });
      }
    }

    const reservationId = intent.stock_reservation_id || intent.checkout_payload?.stock_reservation_id;
    let stockReleased = false;
    if (reservationId) {
      try {
        const releaseFn = paymentIntentService.releaseCheckoutStock || releaseCheckoutStock;
        stockReleased = await releaseFn(reservationId);
      } catch (relErr) {
        logger.warn({ reservationId, err: relErr?.message }, "[Payment Cancel] Error invoking releaseCheckoutStock");
        stockReleased = false;
      }
    } else {
      stockReleased = true;
    }

    if (intent.customer_id && intent.cart_fingerprint) {
      await deleteActiveCartIntentId(intent.customer_id, intent.cart_fingerprint);
    }

    return res.status(200).json({
      success: true,
      cancelled: true,
      terminal: true,
      stock_released: Boolean(stockReleased),
      message: stockReleased
        ? "Checkout session cancelled and reserved stock released."
        : "Checkout session cancelled. Reserved items could not be released immediately and will unlock automatically shortly.",
    });
  } catch (err) {
    if (err?.code === "LOCK_STORAGE_UNAVAILABLE") {
      return res.status(503).json({
        success: false,
        code: "SERVICE_UNAVAILABLE",
        message: "Payment verification storage is temporarily unavailable. Please try again shortly.",
      });
    }
    logError(req, err, "[Payment Cancel] Error cancelling payment intent");
    return res.status(500).json({ success: false, message: "Failed to cancel checkout session." });
  } finally {
    await lease?.release();
  }
};
