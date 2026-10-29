import {
  fetchProducts,
  fetchProductById,
  fetchProductsByIds,
  fetchProductStockByIds,
  fetchRelatedProducts,
  searchProducts,
  fetchProductsByCategory,
  fetchCategories,
} from "../services/productService.js";
import { logError, logger } from "../utils/logger.js";
import { transformMediaUrls } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";

const MAX_HOME_SHELVES = 8;

export const getAllProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.per_page || req.query.limit, 10) || 50;

    const cacheKey = `catalog:products:p${page}:l${perPage}`;
    const result = await serverCache.getOrFetch(
      cacheKey,
      () => fetchProducts(page, perPage),
      300000 // 5-minute catalog TTL reduces redundant post-hydration load
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
    // Product details stay behind the shared cache. Fresh inventory checks use
    // the bounded /stock endpoint instead of allowing public cache bypasses.
    const product = await serverCache.getOrFetch(
      cacheKey,
      () => fetchProductById(productId),
      300000
    );

    res.json(transformMediaUrls(product, req));
  } catch (error) {
    logError(req, error, "Get product by ID error");

    const statusCode = error.status || error.statusCode || error.response?.status || 500;
    if (statusCode === 404) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
};

export const getProductsByIds = async (req, res) => {
  try {
    const ids = [...new Set(String(req.query.ids || "").split(",").map(Number))];
    const detailMode = ["selection", "cross-sells"].includes(req.query.details)
      ? req.query.details
      : "catalog";
    if (ids.length === 0 || ids.length > 12 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return res.status(400).json({ success: false, message: "Provide between 1 and 12 valid product IDs." });
    }

    const cacheKey = `catalog:products:ids:${detailMode}:${ids.join(",")}`;
    const products = await serverCache.getOrFetch(
      cacheKey,
      () => fetchProductsByIds(ids, detailMode),
      30000
    );
    const selectedProducts = (Array.isArray(products) ? products : []);
    const availableProducts = selectedProducts.filter((product) => {
      if (product.stock_status === "outofstock") return false;
      if (product.manage_stock === true) {
        const quantity = Number(product.stock_quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) return false;
      }
      return true;
    });

    return res.json(transformMediaUrls(availableProducts, req));
  } catch (error) {
    logError(req, error, "Get selected products error");
    return res.status(500).json({ success: false, message: "Failed to fetch selected products." });
  }
};

export const getLiveProductStock = async (req, res) => {
  try {
    const ids = [...new Set(String(req.query.ids || "").split(",").map(Number))].sort((a, b) => a - b);
    const cacheKey = `catalog:stock:${ids.join(",")}`;
    const stock = await serverCache.getOrFetch(cacheKey, () => fetchProductStockByIds(ids), 5000);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json((Array.isArray(stock) ? stock : []).map((product) => ({
      id: product.id,
      manage_stock: product.manage_stock,
      stock_quantity: product.stock_quantity,
      stock_status: product.stock_status,
      backorders_allowed: product.backorders_allowed,
    })));
  } catch (error) {
    logError(req, error, "Get live product stock error");
    return res.status(502).json({ success: false, message: "Unable to refresh product availability." });
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
    const prods = Array.isArray(products) ? products : [];
    const inStockOnly = prods.filter((p) => {
      if (!p) return false;
      if (p.stock_status === "outofstock") return false;
      if (p.manage_stock === true) {
        const qty = Number(p.stock_quantity);
        if (!Number.isFinite(qty) || qty <= 0) return false;
      }
      return true;
    });

    res.json(transformMediaUrls(inStockOnly, req));
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
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 20));
    const normalizedQuery = String(q || "").trim().toLowerCase();
    const cacheKey = `catalog:search:${normalizedQuery}:${page}:${perPage}`;
    const result = await serverCache.getOrFetch(
      cacheKey,
      () => searchProducts(normalizedQuery, { page, per_page: perPage }),
      120000 // 2 minutes TTL
    );

    res.json({
      success: true,
      ...result,
      products: transformMediaUrls(result.products, req),
    });
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
      300000 // 5 minutes TTL
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

    const statusCode = error.status === 404 ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: statusCode === 404 ? "Category not found" : "Failed to fetch category products",
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

/**
 * Return a compact, independently paged first shelf for each top-level
 * department. Each shelf is cached so the home page does not scan the global
 * catalog or make one WooCommerce request per visitor.
 */
export const getHomeShelves = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const offset = (page - 1) * MAX_HOME_SHELVES;
    const result = await serverCache.getOrFetch(
      // Version and page the cache key so an older Redis payload cannot keep
      // serving unbounded shelves, and later pages are fetched independently.
      `catalog:home_shelves:v3:page:${page}`,
      async () => {
        const categories = await serverCache.getOrFetch(
          "catalog:categories:all",
          () => fetchCategories(),
          120000
        );
        const categoryList = Array.isArray(categories) ? categories : [];
        const categoryById = new Map(
          categoryList.filter((category) => category?.id).map((category) => [Number(category.id), category])
        );
        const populatedDepartmentIds = new Set();
        for (const category of categoryList) {
          if (!category?.id || Number(category.count) <= 0) continue;
          let current = category;
          const visited = new Set();
          while (current?.id && !visited.has(Number(current.id))) {
            visited.add(Number(current.id));
            const parentId = Number(current.parent) || 0;
            if (parentId <= 0) {
              populatedDepartmentIds.add(Number(current.id));
              break;
            }
            current = categoryById.get(parentId);
          }
        }
        const countsAvailable = categoryList.some((category) => category?.count !== undefined && category?.count !== null);
        const departments = (Array.isArray(categories) ? categories : [])
          .filter((category) =>
            Number(category?.parent) <= 0 &&
            category.slug?.toLowerCase() !== "uncategorized" &&
            category.name?.toLowerCase() !== "uncategorized" &&
            (!countsAvailable || populatedDepartmentIds.has(Number(category.id)))
          )
          .sort((a, b) => {
            const orderA = Number(a.menu_order) > 0 ? Number(a.menu_order) : 9999;
            const orderB = Number(b.menu_order) > 0 ? Number(b.menu_order) : 9999;
            return orderA - orderB || Number(a.id) - Number(b.id);
          });

        // The full department list remains available on /categories. Keep the
        // homepage feed bounded so a large catalog cannot mount hundreds of
        // shelves and trigger stock checks for every product at once.
        const homeDepartments = departments.slice(offset, offset + MAX_HOME_SHELVES);

        const shelves = new Array(homeDepartments.length);
        let nextIndex = 0;
        const worker = async () => {
          while (nextIndex < homeDepartments.length) {
            const index = nextIndex++;
            const department = homeDepartments[index];
            try {
              const shelf = await serverCache.getOrFetch(
                `catalog:home_shelf:${department.id}`,
                () => fetchProductsByCategory(department.id, { page: 1, per_page: 10 }),
                300000
              );
              shelves[index] = {
                ...department,
                products: Array.isArray(shelf?.products) ? shelf.products.slice(0, 10) : [],
              };
            } catch (error) {
              logger.warn(
                { categoryId: department.id, err: error.message },
                "Failed to load a homepage product shelf"
              );
              shelves[index] = { ...department, products: [] };
            }
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(4, homeDepartments.length) }, () => worker())
        );
        return {
          categories: page === 1 && Array.isArray(categories) ? categories : [],
          shelves: shelves.filter((shelf) => shelf?.products?.length > 0),
          pagination: {
            page,
            per_page: MAX_HOME_SHELVES,
            total_departments: departments.length,
            has_more: offset + homeDepartments.length < departments.length,
          },
        };
      },
      300000
    );

    return res.json({
      success: true,
      categories: transformMediaUrls(result.categories || [], req),
      shelves: transformMediaUrls(result.shelves || [], req),
      pagination: result.pagination || { page, per_page: MAX_HOME_SHELVES, total_departments: 0, has_more: false },
    });
  } catch (error) {
    logError(req, error, "Get homepage shelves error");
    return res.status(502).json({
      success: false,
      message: "Failed to load homepage product shelves.",
      categories: [],
      shelves: [],
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

    if (
      !product ||
      !product.id ||
      (product.status && product.status !== "publish") ||
      product.catalog_visibility === "hidden"
    ) {
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
