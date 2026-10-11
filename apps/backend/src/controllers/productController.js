import {
  fetchProducts,
  fetchProductById,
  fetchRelatedProducts,
  searchProducts,
  fetchProductsByCategory,
  fetchCategories,
} from "../services/productService.js";
import { logError } from "../utils/logger.js";
import { transformMediaUrls } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";

export const getAllProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.per_page || req.query.limit, 10) || 50;

    const cacheKey = `catalog:products:p${page}:l${perPage}`;
    const result = await serverCache.getOrFetch(
      cacheKey,
      () => fetchProducts(page, perPage),
      60000
    );

    const prods = Array.isArray(result)
      ? result
      : Array.isArray(result?.products)
      ? result.products
      : [];
    const total = typeof result?.total === "number" ? result.total : prods.length;
    const totalPages =
      typeof result?.totalPages === "number"
        ? result.totalPages
        : (prods.length > 0 ? 1 : 0);

    // Set standard pagination response headers for proxies, CDNs and clients
    res.setHeader("X-Total-Count", String(total));
    res.setHeader("X-Total-Pages", String(totalPages));
    res.setHeader("X-Current-Page", String(page));
    res.setHeader("X-Per-Page", String(perPage));

    // If caller explicitly requests paginated JSON envelope
    if (req.query.format === "paginated" || req.query.paginated === "true") {
      return res.json({
        success: true,
        page,
        per_page: perPage,
        total,
        totalPages,
        products: transformMediaUrls(prods, req),
      });
    }

    // Default backward-compatible behavior: return array of products
    return res.json(transformMediaUrls(prods, req));
  } catch (error) {
    logError(req, error, "Get all products error");

    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      products: [],
    });
  }
};

export const getProductById = async (req, res) => {
  try {
    const productId = req.params.id;
    const cacheKey = `catalog:product:${productId}`;
    const product = await serverCache.getOrFetch(cacheKey, () => fetchProductById(productId), 120000);

    res.json(transformMediaUrls(product, req));
  } catch (error) {
    logError(req, error, "Get product by ID error");

    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
};

export const getRelatedProducts = async (req, res) => {
  try {
    const { categoryId, currentProductId } = req.query;
    const cacheKey = `catalog:related:${categoryId || ""}:${currentProductId || ""}`;
    const products = await serverCache.getOrFetch(
      cacheKey,
      () => fetchRelatedProducts(categoryId, currentProductId),
      120000
    );

    res.json(transformMediaUrls(products, req));
  } catch (error) {
    logError(req, error, "Get related products error");

    res.status(500).json({
      success: false,
      message: "Failed to fetch related products",
    });
  }
};

export const searchAllProducts = async (req, res) => {
  try {
    const { q } = req.query;
    const cacheKey = `catalog:search:${(q || "").trim().toLowerCase()}`;
    const products = await serverCache.getOrFetch(
      cacheKey,
      () => searchProducts(q),
      30000
    );

    res.json(transformMediaUrls(products, req));
  } catch (error) {
    logError(req, error, "Search products error");

    res.status(500).json({
      success: false,
      message: "Failed to search products",
    });
  }
};

export const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.per_page || req.query.limit, 10) || 20;

    const cacheKey = `catalog:category:${categoryId}:${page}:${perPage}`;
    const result = await serverCache.getOrFetch(
      cacheKey,
      () => fetchProductsByCategory(categoryId, { page, per_page: perPage }),
      120000
    );

    if (result && Array.isArray(result.products)) {
      return res.json({
        success: true,
        page: result.page,
        per_page: result.per_page,
        total: result.total,
        totalPages: result.totalPages,
        products: transformMediaUrls(result.products, req),
      });
    }

    if (Array.isArray(result)) {
      return res.json({
        success: true,
        page: 1,
        per_page: result.length,
        total: result.length,
        totalPages: 1,
        products: transformMediaUrls(result, req),
      });
    }

    res.json(transformMediaUrls(result, req));
  } catch (error) {
    logError(req, error, "Get category products error");

    res.status(500).json({
      success: false,
      message: "Failed to fetch category products",
      products: [],
      total: 0,
      totalPages: 0,
    });
  }
};

export const getAllCategories = async (req, res) => {
  try {
    const cacheKey = "catalog:categories:all";
    const categories = await serverCache.getOrFetch(
      cacheKey,
      () => fetchCategories(),
      120000
    );

    res.json(transformMediaUrls(categories, req));
  } catch (error) {
    logError(req, error, "Get all categories error");
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      categories: [],
    });
  }
};

const SOCIAL_CRAWLERS_REGEX = /(WhatsApp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|TelegramBot|Slackbot|Instagram|Pinterest|Discordbot)/i;

const escapeHtml = (str) => {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

/**
 * Lightweight dynamic HTML endpoint for social crawlers (WhatsApp, Facebook, Twitter, Instagram)
 * Returns standard Open Graph meta tags and auto-redirects browsers to the React app.
 */
export const getProductSocialPreview = async (req, res) => {
  try {
    const rawId = String(req.params.id || "").trim();
    const productId = parseInt(rawId, 10);

    // Numeric ID validation only
    if (!productId || !Number.isInteger(productId) || productId <= 0 || String(productId) !== rawId) {
      return res.status(400).send("Invalid product ID: numeric ID required.");
    }

    const frontendOrigin = (
      process.env.CUSTOMER_ORIGIN ||
      process.env.CLIENT_ORIGIN ||
      process.env.FRONTEND_URL ||
      "https://mumbaicollection.in"
    ).replace(/\/$/, "");

    const userAgent = req.headers["user-agent"] || "";
    const isSocialCrawler = SOCIAL_CRAWLERS_REGEX.test(userAgent);

    // If Googlebot or normal human browser, redirect to the SPA on own origin
    if (!isSocialCrawler) {
      return res.redirect(302, `${frontendOrigin}/product/${productId}`);
    }

    const cacheKey = `social_preview:${productId}`;
    const product = await serverCache.getOrFetch(
      cacheKey,
      () => fetchProductById(productId),
      300000
    );

    if (!product || !product.id) {
      return res.status(404).send("Product not found");
    }

    const rawTitle = String(product.name || "Product").trim();
    const rawPrice = product.price ? `₹${product.price}` : "";
    const rawDesc = String(product.short_description || product.description || "Shop quality toys, stationery, and gifts at Mumbai Collection.")
      .replace(/<[^>]*>/g, "")
      .replace(/[\n\r]+/g, " ")
      .trim()
      .slice(0, 160);
    const rawImageUrl = product.images?.[0]?.src || `${frontendOrigin}/og-image.jpg`;
    const canonicalProductUrl = `${frontendOrigin}/product/${product.id}`;
    const relativeUrl = `/product/${product.id}`;

    // HTML-escape every field for strict XSS prevention
    const safeTitle = escapeHtml(rawTitle);
    const safePrice = escapeHtml(rawPrice);
    const safeDesc = escapeHtml(rawDesc);
    const safeImageUrl = escapeHtml(rawImageUrl);
    const safeUrl = escapeHtml(canonicalProductUrl);
    const safeRelativeUrl = escapeHtml(relativeUrl);
    const safeTitleWithPrice = safePrice ? `${safeTitle} — ${safePrice}` : safeTitle;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${safeTitle} | Mumbai Collection</title>
  <meta property="og:site_name" content="Mumbai Collection">
  <meta property="og:type" content="product">
  <meta property="og:url" content="${safeUrl}">
  <meta property="og:title" content="${safeTitleWithPrice}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:image" content="${safeImageUrl}">
  <meta property="og:image:alt" content="${safeTitle}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitleWithPrice}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="${safeImageUrl}">
  <meta http-equiv="refresh" content="0;url=${safeRelativeUrl}">
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${safeDesc}</p>
  <a href="${safeRelativeUrl}">View in Store</a>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    return res.send(html);
  } catch (error) {
    logError(req, error, "Social preview error");
    return res.status(404).send("Product not found");
  }
};
