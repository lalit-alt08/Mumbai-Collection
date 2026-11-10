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
import { searchIndexService } from "../services/searchIndexService.js";

const HOME_SHELF_COUNT = 6;
const HOME_PRODUCTS_PER_SHELF = 6;
const HOME_SHELF_BACKFILL = 4;
const HOME_CACHE_TTL_MS = 300_000;
const CATEGORY_CACHE_KEY = "catalog:categories:all";
const CATEGORY_LAST_KNOWN_KEY = "resilience:catalog_categories:last_known";
const CATEGORY_CACHE_TTL_MS = 300_000;
const CATEGORY_LAST_KNOWN_TTL_MS = 24 * 60 * 60 * 1000;
const CATEGORY_REFRESH_ERROR_BACKOFF_MS = 30_000;
let categoryRefreshRetryAfter = 0;

let fetchCategoriesOverride = null;
export const _setFetchCategoriesForTesting = (fn) => {
  fetchCategoriesOverride = fn;
};

export const refreshCategoryCache = async () => {
  const fence = await serverCache.createFence(CATEGORY_LAST_KNOWN_KEY);
  return serverCache.getOrFetch(
    CATEGORY_CACHE_KEY,
    async () => {
      const fetchFn = fetchCategoriesOverride || fetchCategories;
      const freshCategories = await fetchFn();
      // Generation fence: only populate last-known resilience cache if no invalidation occurred during fetch
      if (Array.isArray(freshCategories) && freshCategories.length > 0) {
        await serverCache.setFenced(
          CATEGORY_LAST_KNOWN_KEY,
          freshCategories,
          CATEGORY_LAST_KNOWN_TTL_MS,
          fence
        );
      }
      return freshCategories;
    },
    CATEGORY_CACHE_TTL_MS
  );
};

const getCategoriesWithStaleFallback = async () => {
  const freshCategories = serverCache.get(CATEGORY_CACHE_KEY);
  if (Array.isArray(freshCategories) && freshCategories.length > 0) {
    return freshCategories;
  }

  // Once a last-known tree exists, never make a storefront request wait for
  // WooCommerce. Refresh in the background; getOrFetch keeps that refresh
  // single-flight inside this process and Redis serves the shared hot value.
  const staleCategories = serverCache.get(CATEGORY_LAST_KNOWN_KEY);
  if (Array.isArray(staleCategories) && staleCategories.length > 0) {
    const now = Date.now();
    if (now >= categoryRefreshRetryAfter) {
      // Reserve the retry window before starting so sequential storefront
      // requests cannot create a retry storm after an upstream failure.
      categoryRefreshRetryAfter = now + CATEGORY_REFRESH_ERROR_BACKOFF_MS;
      void refreshCategoryCache()
        .then(() => {
          categoryRefreshRetryAfter = 0;
        })
        .catch((error) => {
          categoryRefreshRetryAfter = Date.now() + CATEGORY_REFRESH_ERROR_BACKOFF_MS;
          logger.warn(
            { status: error?.response?.status, code: error?.code },
            "WooCommerce category background refresh failed; serving last-known category taxonomy"
          );
        });
    }
    return staleCategories;
  }

  const fence = await serverCache.createFence(CATEGORY_LAST_KNOWN_KEY);
  try {
    const categories = await refreshCategoryCache();
    // Seed the fallback once when the fresh value came from an older Redis
    // entry created before the last-known cache was introduced, guarded by generation fence.
    if (
      Array.isArray(categories) &&
      categories.length > 0 &&
      serverCache.get(CATEGORY_LAST_KNOWN_KEY) === null
    ) {
      await serverCache.setFenced(
        CATEGORY_LAST_KNOWN_KEY,
        categories,
        CATEGORY_LAST_KNOWN_TTL_MS,
        fence
      );
    }
    return categories;
  } catch (error) {
    const staleCategories = await serverCache.getOrFetch(
      CATEGORY_LAST_KNOWN_KEY,
      async () => null,
      CATEGORY_LAST_KNOWN_TTL_MS
    );
    if (Array.isArray(staleCategories) && staleCategories.length > 0) {
      logger.warn(
        { status: error?.response?.status, code: error?.code },
        "WooCommerce category refresh failed; serving last-known category taxonomy"
      );
      return staleCategories;
    }
    throw error;
  }
};

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
    const cacheKey = `catalog:search:r${searchIndexService.revision}:${normalizedQuery}:${page}:${perPage}`;
    // Use shared-cache + single-flight path so all instances share Redis responses
    // and concurrent identical misses don't each spawn independent searches.
    // Throw inside the fetch callback to prevent caching reconciling empty pages.
    const result = await serverCache.getOrFetch(
      cacheKey,
      async () => {
        const r = await searchProducts(normalizedQuery, { page, per_page: perPage });
        // Reject caching: non-empty total with zero products means index is reconciling
        if (r && Array.isArray(r.products) && r.products.length === 0 && r.total > 0) {
          const reconcileErr = new Error("Search index reconciling — not caching empty result");
          reconcileErr.code = "SEARCH_PAGE_RECONCILING";
          reconcileErr.status = 503;
          throw reconcileErr;
        }
        return r;
      },
      120000 // 2 minutes TTL
    );

    res.json({
      success: true,
      ...result,
      products: transformMediaUrls(result.products, req),
    });
  } catch (error) {
    logError(req, error, "Search products error");

    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status === 503) {
      res.setHeader("Retry-After", "2");
    }

    res.status(status).json({
      success: false,
      code: error.code || "SEARCH_ERROR",
      message: error.message || "Failed to search products",
    });
  }
};

export const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.per_page || req.query.limit, 10) || 20;

    const sort = req.query.sort || "default";
    const priceRange = req.query.price_range || "all";
    const inStock = req.query.in_stock || "0";
    const cacheKey = `catalog:category:v3:${String(categoryId).toLowerCase()}:${page}:${perPage}:${sort}:${priceRange}:${inStock}`;
    const result = await serverCache.getOrFetch(
      cacheKey,
      () => fetchProductsByCategory(categoryId, { page, per_page: perPage, sort, price_range: priceRange, in_stock: inStock }),
      priceRange !== "all" || inStock === "1" ? 30000 : 300000
    );

    if (result && Array.isArray(result.products)) {
      let recommendations = [];
      if (page === 1 && result.total_confirmed && result.total === 0 && (priceRange !== "all" || inStock === "1")) {
        try {
          const fallback = await serverCache.getOrFetch(
            `catalog:category:suggestions:v2:${result.category_id}`,
            () => fetchProductsByCategory(result.category_id, { page: 1, per_page: 6, in_stock: "1", suggestions: true }),
            30000
          );
          recommendations = fallback.products;
        } catch (error) {
          logger.warn({ err: error.message }, "Category suggestions unavailable");
        }
      }
      return res.json({
        success: true,
        page: result.page,
        per_page: result.per_page,
        total: result.total,
        totalPages: result.totalPages,
        products: transformMediaUrls(result.products, req),
        recommendations: transformMediaUrls(recommendations, req),
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
    const categories = await getCategoriesWithStaleFallback();

    const allCategories = Array.isArray(categories) ? categories : [];
    const total = allCategories.length;

    // Check if client explicitly requested paginated results
    const isPaginated =
      Boolean(req.query.page) ||
      Boolean(req.query.per_page) ||
      Boolean(req.query.limit) ||
      req.query.format === "paginated" ||
      req.query.paginated === "true";

    if (isPaginated) {
      const page = Math.max(1, Number(req.query.page) || 1);
      const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || req.query.limit) || 20));
      const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;
      const startIndex = (page - 1) * perPage;
      const paginatedSlice = allCategories.slice(startIndex, startIndex + perPage);

      res.setHeader("X-Total-Count", String(total));
      res.setHeader("X-Total-Pages", String(totalPages));
      res.setHeader("X-Current-Page", String(page));
      res.setHeader("X-Per-Page", String(perPage));

      if (req.query.format === "paginated" || req.query.paginated === "true") {
        return res.json({
          success: true,
          page,
          per_page: perPage,
          total,
          totalPages,
          categories: transformMediaUrls(paginatedSlice, req),
        });
      }

      return res.json(transformMediaUrls(paginatedSlice, req));
    }

    // Default: return complete list for navbar menus and category drawers
    res.setHeader("X-Total-Count", String(total));
    res.setHeader("X-Total-Pages", "1");
    res.setHeader("X-Current-Page", "1");
    res.setHeader("X-Per-Page", String(total));
    return res.json(transformMediaUrls(allCategories, req));
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
    const requestedOffset = Number(req.query.offset);
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : (page - 1) * HOME_SHELF_COUNT;
    const currentPage = Math.floor(offset / HOME_SHELF_COUNT) + 1;
    const result = await serverCache.getOrFetch(
      // Cache with 6-shelf / 6-product boundaries
      `catalog:home_shelves:v5:offset:${offset}:c${HOME_SHELF_COUNT}:p${HOME_PRODUCTS_PER_SHELF}`,
      async () => {
        const categories = await getCategoriesWithStaleFallback();
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
          .map((category) => ({
            ...category,
            has_products: countsAvailable ? populatedDepartmentIds.has(Number(category.id)) : true,
          }))
          .sort((a, b) => {
            const orderA = Number(a.menu_order) > 0 ? Number(a.menu_order) : 9999;
            const orderB = Number(b.menu_order) > 0 ? Number(b.menu_order) : 9999;
            return orderA - orderB || Number(a.id) - Number(b.id);
          });

        // The full department list remains available on /categories. Keep the
        // homepage feed bounded so a large catalog cannot mount hundreds of
        // shelves and trigger stock checks for every product at once.
        // Inspect a small bounded overflow window so an empty or temporarily
        // unavailable shelf does not leave a visible hole on the homepage.
        // The limit keeps the cold-cache WooCommerce fan-out predictable.
        const homeDepartments = departments.slice(
          offset,
          offset + HOME_SHELF_COUNT + HOME_SHELF_BACKFILL
        );

        const shelves = new Array(homeDepartments.length);
        let nextIndex = 0;
        const worker = async () => {
          while (nextIndex < homeDepartments.length) {
            const index = nextIndex++;
            const department = homeDepartments[index];
            try {
              const shelf = await serverCache.getOrFetch(
                `catalog:home_shelf:p${HOME_PRODUCTS_PER_SHELF}:${department.id}`,
                () => fetchProductsByCategory(department.id, { page: 1, per_page: HOME_PRODUCTS_PER_SHELF }),
                HOME_CACHE_TTL_MS
              );
              shelves[index] = {
                ...department,
                products: Array.isArray(shelf?.products) ? shelf.products.slice(0, HOME_PRODUCTS_PER_SHELF) : [],
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
        const populatedShelves = shelves.filter((shelf) => shelf?.products?.length > 0);
        const visibleShelves = populatedShelves.slice(0, HOME_SHELF_COUNT);
        const lastVisibleShelfId = visibleShelves.at(-1)?.id;
        const lastConsumedIndex = lastVisibleShelfId
          ? shelves.findIndex((shelf) => Number(shelf?.id) === Number(lastVisibleShelfId))
          : homeDepartments.length - 1;
        const consumedDepartments = Math.max(0, lastConsumedIndex + 1);
        const nextOffset = offset + consumedDepartments;

        return {
          categories: offset === 0 ? departments.slice(0, 12) : [],
          shelves: visibleShelves,
          pagination: {
            page: currentPage,
            per_page: HOME_SHELF_COUNT,
            total_departments: departments.length,
            next_offset: nextOffset,
            has_more: nextOffset < departments.length,
          },
        };
      },
      300000
    );

    return res.json({
      success: true,
      categories: transformMediaUrls(result.categories || [], req),
      shelves: transformMediaUrls(result.shelves || [], req),
      pagination: result.pagination || {
        page: currentPage,
        per_page: HOME_SHELF_COUNT,
        total_departments: 0,
        next_offset: offset,
        has_more: false,
      },
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

export { getCategoriesWithStaleFallback as _getCategoriesWithStaleFallbackForTesting };
