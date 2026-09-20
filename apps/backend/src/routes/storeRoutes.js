import express from "express";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { transformMediaUrls } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";
import { getSessionValidation, checkSessionPhoneVerified, checkSessionSuspended } from "../middlewares/authMiddleware.js";
import { checkoutLimiter } from "../middlewares/rateLimiter.js";
import { requireIdempotency } from "../middlewares/idempotencyMiddleware.js";
import { logError, logger } from "../utils/logger.js";
import storeHoursService from "../services/storeHoursService.js";

const router = express.Router();

const WP_BASE_URL = process.env.WORDPRESS_URL || "https://mumbai-collection.local";

// Safe last-known store-hours fallback cache with maximum 5-minute TTL
let lastKnownStoreStatus = null;
const STORE_HOURS_FALLBACK_MAX_AGE_MS = 5 * 60 * 1000;

export const _resetStoreRoutesHoursFallbackForTesting = () => {
  lastKnownStoreStatus = null;
};

/**
 * Universal Store API Gateway Proxy
 * Forwards requests to WooCommerce Store API v1 (/wp-json/wc/store/v1/)
 * and relays Store API Nonce, Cart-Token, and session cookies.
 */
async function proxyStoreApi(req, res) {
  const targetPath = req.path;
  const targetUrl = `${WP_BASE_URL}/wp-json/wc/store/v1${targetPath}`;

  // Server-side enforcement for checkout order creation
  if (req.method === "POST" && targetPath.replace(/\/+$/, "") === "/checkout") {
    const customerAuth =
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_wp_auth;

    if (!customerAuth) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Please log in to place an order.",
      });
    }

    // 1. Authoritative Store Hours Guard (Asia/Kolkata)
    try {
      const storeStatus = await storeHoursService.getStoreStatus();
      if (!storeStatus || typeof storeStatus.is_open !== "boolean") {
        throw new Error("Invalid store status payload");
      }

      // Record last known valid store status
      lastKnownStoreStatus = {
        status: storeStatus,
        timestamp: Date.now(),
      };

      if (!storeStatus.is_open) {
        return res.status(403).json({
          success: false,
          code: "STORE_CLOSED",
          message: storeStatus.message || "Our store is currently closed for new orders.",
          next_opening: storeStatus.next_opening,
          current_day: storeStatus.current_day,
          current_time_ist: storeStatus.current_time_ist,
          schedule_today: storeStatus.schedule_today,
          timezone: storeStatus.timezone || "Asia/Kolkata",
        });
      }
    } catch (statusErr) {
      logger.warn({ err: statusErr.message }, "[StoreGateway] Store hours evaluation warning, checking fallback cache");

      const hasValidFallback =
        lastKnownStoreStatus &&
        Date.now() - lastKnownStoreStatus.timestamp <= STORE_HOURS_FALLBACK_MAX_AGE_MS;

      if (hasValidFallback) {
        const fallback = lastKnownStoreStatus.status;
        if (!fallback || !fallback.is_open) {
          return res.status(403).json({
            success: false,
            code: "STORE_CLOSED",
            message: fallback?.message || "Our store is currently closed for new orders.",
            next_opening: fallback?.next_opening || null,
            current_day: fallback?.current_day,
            current_time_ist: fallback?.current_time_ist,
            schedule_today: fallback?.schedule_today,
            timezone: fallback?.timezone || "Asia/Kolkata",
          });
        }
        // Fallback state is valid within 5 minutes and store was open: allow checkout
      } else {
        // Fail closed: no valid cached state exists within 5 minutes
        return res.status(503).json({
          success: false,
          code: "STORE_HOURS_UNAVAILABLE",
          message: "Unable to verify store operating hours. Please try again in a few moments.",
        });
      }
    }

    // 2. Authoritative Unified Session Validation (Suspension & Phone Verification)
    const sessionData = await getSessionValidation(customerAuth);

    if (!sessionData || !sessionData.valid) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Please log in to place an order.",
      });
    }

    if (sessionData.isSuspended) {
      return res.status(403).json({
        success: false,
        code: "CUSTOMER_SUSPENDED",
        message: "Your account is currently suspended and you cannot place new orders.",
      });
    }

    if (!sessionData.isPhoneVerified) {
      return res.status(403).json({
        success: false,
        code: "PHONE_NOT_VERIFIED",
        message: "Please verify your mobile number with OTP before placing an order.",
      });
    }

    // 3. Authoritative Minimum Order Value Check (₹500 product items subtotal)
    try {
      const cartHeaders = { Cookie: customerAuth };
      if (req.headers["cart-token"]) {
        cartHeaders["Cart-Token"] = req.headers["cart-token"];
      }
      if (req.headers.nonce) {
        cartHeaders["Nonce"] = req.headers.nonce;
      }

      const cartRes = await axios.get(`${WP_BASE_URL}/wp-json/wc/store/v1/cart`, {
        headers: cartHeaders,
        httpsAgent,
        timeout: 10000,
      });

      const cart = cartRes.data;
      if (!cart?.items || cart.items.length === 0) {
        return res.status(400).json({
          success: false,
          code: "EMPTY_CART",
          message: "Your cart is empty.",
        });
      }

      const itemsSubtotal = cart.totals?.total_items
        ? Number(cart.totals.total_items) / 100
        : (Array.isArray(cart.items)
            ? cart.items.reduce(
                (sum, item) =>
                  sum +
                  (Number(item.totals?.line_subtotal) ||
                    Number(item.totals?.line_total) ||
                    0),
                0
              ) / 100
            : 0);

      const MIN_ORDER_VALUE_INR = 500;
      if (itemsSubtotal < MIN_ORDER_VALUE_INR) {
        const shortfall = Math.max(0, MIN_ORDER_VALUE_INR - itemsSubtotal);
        return res.status(400).json({
          success: false,
          code: "MIN_ORDER_VALUE",
          message: `Minimum product order value of ₹${MIN_ORDER_VALUE_INR} is required. Please add ₹${shortfall} more.`,
        });
      }
    } catch (cartErr) {
      logError(req, cartErr, "[StoreGateway] Authoritative cart validation failed before checkout");
      return res.status(502).json({
        success: false,
        code: "CART_FETCH_FAILED",
        message: "Unable to verify cart contents before checkout. Please try again.",
      });
    }
  }

  const forwardHeaders = {};
  if (req.headers.nonce) forwardHeaders["Nonce"] = req.headers.nonce;
  if (req.headers["cart-token"]) forwardHeaders["Cart-Token"] = req.headers["cart-token"];
  if (req.headers["content-type"]) forwardHeaders["Content-Type"] = req.headers["content-type"];

  // Map customer auth cookie to native WordPress auth cookie so WooCommerce Store API resolves the logged-in customer
  const customerAuth =
    req.cookies?.mumbai_customer_auth ||
    req.cookies?.mumbai_wp_auth ||
    req.cookies?.mumbai_admin_auth;

  if (customerAuth) {
    forwardHeaders["Cookie"] = customerAuth;
  } else if (req.headers.cookie) {
    forwardHeaders["Cookie"] = req.headers.cookie;
  }

  try {
    const isCheckoutRequest =
      req.method === "POST" && targetPath.replace(/\/+$/, "") === "/checkout";

    const response = await axios({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      headers: forwardHeaders,
      httpsAgent,
      validateStatus: () => true,
      timeout: isCheckoutRequest ? 25000 : 10000,
    });

    if (response.headers.nonce) {
      res.setHeader("Nonce", response.headers.nonce);
    }
    if (response.headers["cart-token"]) {
      res.setHeader("Cart-Token", response.headers["cart-token"]);
    }
    if (response.headers["set-cookie"]) {
      res.setHeader("Set-Cookie", response.headers["set-cookie"]);
    }

    // Real-time invalidation: Immediately clear operational caches upon successful order placement
    if (
      req.method === "POST" &&
      targetPath.replace(/\/+$/, "") === "/checkout" &&
      response.status >= 200 &&
      response.status < 300
    ) {
      serverCache.invalidatePrefix("employee:overview");
      serverCache.invalidatePrefix("admin:analytics");
      serverCache.invalidatePrefix("admin:customers");
      serverCache.delete("product_stock_counts");

      // Selectively invalidate detail caches for ordered products without wiping browse catalog
      const orderItems = response.data?.items || response.data?.line_items || [];
      if (Array.isArray(orderItems)) {
        for (const item of orderItems) {
          const productId = item.id || item.product_id;
          if (productId) {
            serverCache.delete(`catalog:product:${productId}`);
          }
        }
      }
    }

    return res.status(response.status).json(transformMediaUrls(response.data, req));
  } catch (error) {
    logError(req, error, "Store API proxy error");
    const status = error.response?.status || 502;
    return res.status(status).json({
      success: false,
      message: "Store service is temporarily unavailable. Please try again.",
      code: "store_gateway_error",
    });
  }
}

// Apply checkout rate limiting and idempotency specifically to POST /checkout
router.post(["/checkout", "/checkout/"], checkoutLimiter, requireIdempotency);

// Mount proxy middleware for all methods and paths under /api/store
router.use(proxyStoreApi);

export default router;
