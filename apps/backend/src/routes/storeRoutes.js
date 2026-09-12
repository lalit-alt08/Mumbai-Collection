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
      logger.warn({ err: statusErr.message }, "[StoreGateway] Store hours evaluation warning");
      // Fail open to last-known/default rather than crashing
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
