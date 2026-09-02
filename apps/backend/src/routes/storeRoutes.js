import express from "express";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { transformMediaUrls } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";

const router = express.Router();

const WP_BASE_URL = process.env.WORDPRESS_URL || "https://mumbai-collection.local";

/**
 * Universal Store API Gateway Proxy
 * Forwards requests to WooCommerce Store API v1 (/wp-json/wc/store/v1/;)
 * and relays Store API Nonce, Cart-Token, and session cookies.
 */
async function proxyStoreApi(req, res) {
  const targetPath = req.path;
  const targetUrl = `${WP_BASE_URL}/wp-json/wc/store/v1${targetPath}`;

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
    const response = await axios({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      headers: forwardHeaders,
      httpsAgent,
      validateStatus: () => true,
      timeout: 10000,
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
      serverCache.invalidatePrefix("catalog:products");
    }

    return res.status(response.status).json(transformMediaUrls(response.data, req));
  } catch (error) {
    console.error("Store API proxy error:", error.response?.data || error.message);
    const status = error.response?.status || 502;
    return res.status(status).json({
      success: false,
      message: "Store service is temporarily unavailable. Please try again.",
      code: "store_gateway_error",
    });
  }
}

// Mount proxy middleware for all methods and paths under /api/store
router.use(proxyStoreApi);

export default router;
