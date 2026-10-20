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
import api from "../config/woocommerce.js";

const router = express.Router();

const WP_BASE_URL = process.env.WORDPRESS_URL || "https://mumbai-collection.local";

// Safe last-known store-hours fallback cache with maximum 5-minute TTL
let lastKnownStoreStatus = null;
const STORE_HOURS_FALLBACK_MAX_AGE_MS = 5 * 60 * 1000;

export const _resetStoreRoutesHoursFallbackForTesting = () => {
  lastKnownStoreStatus = null;
};

// Strict allow-list of WooCommerce Store API v1 endpoints
const ALLOWED_STORE_PATTERNS = [
  /^\/cart(\/.*)?$/,
  /^\/checkout(\/.*)?$/,
  /^\/batch$/,
  /^\/products(\/.*)?$/,
];

/**
 * Universal Store API Gateway Proxy
 * Forwards requests to WooCommerce Store API v1 (/wp-json/wc/store/v1/)
 * and relays Store API Nonce, Cart-Token, and session cookies.
 */
async function proxyStoreApi(req, res) {
  const targetPath = req.path || "";

  // Guard against path traversal attacks (e.g. .. or backslashes)
  if (
    targetPath.includes("..") ||
    targetPath.includes("\\") ||
    targetPath.includes("%2e") ||
    targetPath.includes("%2E")
  ) {
    return res.status(403).json({
      success: false,
      code: "INVALID_PATH",
      message: "Path traversal is strictly prohibited.",
    });
  }

  // Strict allow-list enforcement: only authorized WooCommerce Store API endpoints may be proxied
  const isAllowed = ALLOWED_STORE_PATTERNS.some((pattern) => pattern.test(targetPath));
  if (!isAllowed) {
    return res.status(403).json({
      success: false,
      code: "ENDPOINT_NOT_ALLOWED",
      message: "Requested store endpoint is not permitted.",
    });
  }

  const targetUrl = `${WP_BASE_URL}/wp-json/wc/store/v1${targetPath}`;

  // Server-side enforcement for checkout order creation
  if (req.method === "POST" && targetPath.replace(/\/+$/, "") === "/checkout") {
    const customerAuth =
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_admin_auth ||
      req.cookies?.mumbai_employee_auth ||
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

      // Fail closed if store status configuration is stale (> 5 minutes without fresh WP read)
      if (storeStatus.is_stale) {
        throw new Error("Store status configuration is stale (> 5 minutes)");
      }

      // Record last known valid store status ONLY on live/fresh reads, never on stale fallbacks
      if (!storeStatus.is_fallback) {
        lastKnownStoreStatus = {
          status: storeStatus,
          timestamp: Date.now(),
        };
      }

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
        message: "Please verify your mobile number before placing an order.",
      });
    }
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
    req.cookies?.mumbai_admin_auth ||
    req.cookies?.mumbai_employee_auth ||
    req.cookies?.mumbai_wp_auth;

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
      serverCache.invalidatePrefix("catalog:products:");

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

    // Live stock enrichment: WooCommerce Store API only reads cached session data on GET /cart.
    // Attach authoritative live stock status to prevent stale out-of-stock items passing silently in cart.
    if (
      response.status === 200 &&
      response.data &&
      Array.isArray(response.data.items) &&
      response.data.items.length > 0 &&
      targetPath.includes("/cart")
    ) {
      await Promise.allSettled(
        response.data.items.map(async (item) => {
          try {
            const productId = item.id;
            let prod = serverCache.get(`catalog:product:${productId}`);
            if (!prod) {
              const prodRes = await api.get(`products/${productId}`);
              prod = prodRes?.data;
              if (prod) {
                serverCache.set(`catalog:product:${productId}`, prod, 15000);
              }
            }

            if (prod && typeof prod.manage_stock !== "undefined") {
              const backordersAllowed = Boolean(prod.backorders_allowed);
              const managesStock = prod.manage_stock === true && typeof prod.stock_quantity === "number";
              const isDepleted = !backordersAllowed && (
                prod.stock_status === "outofstock" ||
                (managesStock && prod.stock_quantity <= 0)
              );
              const isQuantityShort = !backordersAllowed && managesStock && prod.stock_quantity > 0 && prod.stock_quantity < item.quantity;
              const isShort = isDepleted || isQuantityShort;

              item.is_in_stock = !isDepleted;
              item.stock_status = isDepleted ? "outofstock" : "instock";
              item.isOutOfStock = isDepleted;
              item.isQuantityShort = isQuantityShort;
              if (isShort) {
                if (!item.quantity_limits) item.quantity_limits = {};
                item.quantity_limits.maximum =
                  managesStock
                    ? Math.max(0, prod.stock_quantity)
                    : isDepleted ? 0 : 99;
              }
            }
          } catch (enrichErr) {
            // fail-safe, retain original item
          }
        })
      );
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

/**
 * Resolve and enforce authenticated customer identity before checkout rate limiting and idempotency.
 * Fails closed with 401 if unauthenticated, ensuring requireIdempotency runs only with a verified req.wpUserId.
 */
const resolveCheckoutCustomer = async (req, res, next) => {
  const customerAuth =
    req.cookies?.mumbai_customer_auth ||
    req.cookies?.mumbai_admin_auth ||
    req.cookies?.mumbai_employee_auth ||
    req.cookies?.mumbai_wp_auth;

  if (!customerAuth) {
    return res.status(401).json({
      success: false,
      code: "AUTH_REQUIRED",
      message: "Please log in to place an order.",
    });
  }

  try {
    const sessionData = await getSessionValidation(customerAuth);
    if (!sessionData?.valid || !sessionData.userId) {
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
        message: "Please verify your mobile number before placing an order.",
      });
    }

    req.wpUserId = sessionData.userId;
    req.user = {
      id: sessionData.userId,
      roles: sessionData.roles || [],
      email: sessionData.email || "",
      is_phone_verified: sessionData.isPhoneVerified === true,
      is_suspended: false,
    };
    req.isPhoneVerified = sessionData.isPhoneVerified === true;
    req.isSuspended = false;
    next();
  } catch (err) {
    logError(req, err, "Checkout customer authentication error");
    return res.status(401).json({
      success: false,
      code: "AUTH_REQUIRED",
      message: "Please log in to place an order.",
    });
  }
};

// Apply checkout customer resolution, idempotency, and rate limiting specifically to POST /checkout
router.post(
  ["/checkout", "/checkout/"],
  resolveCheckoutCustomer,
  requireIdempotency,
  checkoutLimiter
);

let sitemapCatalogProviderForTesting = null;
export const _setSitemapCatalogProviderForTesting = (fn) => {
  sitemapCatalogProviderForTesting = fn;
};

const escapeXml = (str) => {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

// Dynamic Sitemap Generator (published products + categories + static policy pages)
export const generateSitemapXml = async (req, res) => {
  try {
    const cachedXml = serverCache.get("seo:sitemap_xml");
    if (cachedXml && !sitemapCatalogProviderForTesting) {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=21600, s-maxage=21600");
      return res.send(cachedXml);
    }

    const BASE_SITE_URL = (
      process.env.CUSTOMER_ORIGIN ||
      process.env.CLIENT_ORIGIN ||
      process.env.FRONTEND_URL ||
      "https://mumbaicollection.in"
    ).replace(/\/+$/, "");

    // 1. Static Core Pages
    const staticUrls = [
      { loc: `${BASE_SITE_URL}/`, priority: "1.0", changefreq: "daily" },
      { loc: `${BASE_SITE_URL}/categories`, priority: "0.8", changefreq: "weekly" },
      { loc: `${BASE_SITE_URL}/contact`, priority: "0.6", changefreq: "monthly" },
      { loc: `${BASE_SITE_URL}/privacy-policy`, priority: "0.5", changefreq: "monthly" },
      { loc: `${BASE_SITE_URL}/terms`, priority: "0.5", changefreq: "monthly" },
      { loc: `${BASE_SITE_URL}/return-policy`, priority: "0.5", changefreq: "monthly" },
      { loc: `${BASE_SITE_URL}/shipping-policy`, priority: "0.5", changefreq: "monthly" },
    ];

    let rawProducts = [];
    let rawCategories = [];

    if (sitemapCatalogProviderForTesting) {
      const data = await sitemapCatalogProviderForTesting();
      rawProducts = data.products || [];
      rawCategories = data.categories || [];
    } else {
      try {
        const prodRes = await api.get("products", {
          status: "publish",
          per_page: 100,
        });
        if (Array.isArray(prodRes?.data)) {
          rawProducts = prodRes.data;
        }
      } catch (_) {}

      try {
        const catRes = await api.get("products/categories", {
          per_page: 100,
          hide_empty: true,
        });
        if (Array.isArray(catRes?.data)) {
          rawCategories = catRes.data;
        }
      } catch (_) {}
    }

    // Exclude drafts, private, pending, and out-of-catalog/hidden visibility products
    const validProducts = rawProducts.filter(
      (prod) =>
        prod &&
        prod.id &&
        prod.status === "publish" &&
        prod.catalog_visibility !== "hidden"
    );

    const validCategories = rawCategories.filter(
      (cat) => cat && (cat.slug || cat.id)
    );

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const page of staticUrls) {
      xml += `  <url>\n    <loc>${escapeXml(page.loc)}</loc>\n    <changefreq>${escapeXml(page.changefreq)}</changefreq>\n    <priority>${escapeXml(page.priority)}</priority>\n  </url>\n`;
    }

    for (const cat of validCategories) {
      const catSlug = cat.slug || cat.id;
      xml += `  <url>\n    <loc>${escapeXml(`${BASE_SITE_URL}/category/${catSlug}`)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
    }

    for (const prod of validProducts) {
      const lastMod = prod.date_modified_gmt || prod.date_modified || prod.date_created;
      let lastModTag = "";
      if (lastMod) {
        try {
          const dateStr = new Date(lastMod).toISOString().split("T")[0];
          lastModTag = `\n    <lastmod>${escapeXml(dateStr)}</lastmod>`;
        } catch (_) {}
      }
      xml += `  <url>\n    <loc>${escapeXml(`${BASE_SITE_URL}/product/${prod.id}`)}</loc>${lastModTag}\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    }

    xml += `</urlset>`;

    if (!sitemapCatalogProviderForTesting) {
      serverCache.set("seo:sitemap_xml", xml, 6 * 60 * 60 * 1000); // 6 hours
    }

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=21600, s-maxage=21600");
    return res.send(xml);
  } catch (error) {
    logger.warn({ err: error.message }, "[SEO] Failed generating dynamic sitemap, returning static fallback");
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://mumbaicollection.in/</loc><priority>1.0</priority></url>\n</urlset>`);
  }
};

router.get("/sitemap.xml", generateSitemapXml);

// Mount proxy middleware for all methods and paths under /api/store
router.use(proxyStoreApi);

export default router;
