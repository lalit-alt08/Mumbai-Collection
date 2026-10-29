import api from "../config/woocommerce.js";
import {
  getFavoriteProductIds,
  addFavorite as addFavService,
  removeFavorite as removeFavService,
  isFavorited as isFavService,
} from "../services/favoritesService.js";
import { logError, logger } from "../utils/logger.js";

/**
 * Lightweight endpoint returning strictly product IDs for fast nav/heart icon checking
 */
export const getFavoriteIds = async (req, res) => {
  try {
    const userId = req.user?.id || req.wpUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const productIds = await getFavoriteProductIds(userId);
    if (typeof res.setHeader === "function") {
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
    }
    return res.json({
      success: true,
      count: productIds.length,
      productIds,
    });
  } catch (error) {
    logError(req, error, "Get favorite IDs error");
    return res.status(500).json({
      success: false,
      message: "Failed to load favorite IDs.",
      productIds: [],
    });
  }
};

/**
 * Get all favorited products for authenticated customer (Full catalog hydration for /favorites page)
 */
export const getFavorites = async (req, res) => {
  try {
    const userId = req.user?.id || req.wpUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const productIds = await getFavoriteProductIds(userId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(48, Math.max(1, Number(req.query.per_page) || 24));
    const total = productIds.length;
    const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;
    const pageProductIds = productIds.slice((page - 1) * perPage, page * perPage);
    if (typeof res.setHeader === "function") {
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
    }

    if (!productIds || productIds.length === 0) {
      return res.json({
        success: true,
        count: 0,
        productIds: [],
        favorites: [],
        page,
        per_page: perPage,
        total,
        totalPages,
      });
    }

    // Fetch only the requested wishlist page in WooCommerce-sized batches.
    try {
      const batches = [];
      for (let index = 0; index < pageProductIds.length; index += 100) {
        batches.push(pageProductIds.slice(index, index + 100));
      }

      const products = [];
      for (let index = 0; index < batches.length; index += 2) {
        const results = await Promise.allSettled(
          batches.slice(index, index + 2).map((ids) =>
            api.get("products", {
              include: ids.join(","),
              orderby: "include",
              per_page: ids.length,
              _fields: "id,name,slug,price,regular_price,sale_price,images,stock_status",
            })
          )
        );
        for (const result of results) {
          if (result.status === "fulfilled" && Array.isArray(result.value.data)) {
            products.push(...result.value.data);
          } else if (result.status === "rejected") {
            logger.warn({ err: result.reason?.message }, "WooCommerce wishlist batch failed");
          }
        }
      }

      const productOrder = new Map(pageProductIds.map((id, index) => [Number(id), index]));
      products.sort((a, b) =>
        (productOrder.get(Number(a.id)) ?? Number.MAX_SAFE_INTEGER) -
        (productOrder.get(Number(b.id)) ?? Number.MAX_SAFE_INTEGER)
      );

      res.json({
        success: true,
        count: total,
        productIds,
        favorites: products,
        page,
        per_page: perPage,
        total,
        totalPages,
      });
    } catch (wcErr) {
      logger.warn({ err: wcErr.message }, "WooCommerce products fetch for favorites warning");
      // Fallback: return product IDs even if catalog is delayed
      res.json({
        success: true,
        count: productIds.length,
        productIds,
        favorites: [],
        page,
        per_page: perPage,
        total,
        totalPages,
      });
    }
  } catch (error) {
    logError(req, error, "Get favorites error");
    res.status(500).json({
      success: false,
      message: "Failed to load favorites.",
    });
  }
};

/**
 * Add product to customer's favorites
 */
export const addFavorite = async (req, res) => {
  try {
    const userId = req.user?.id || req.wpUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const productId = Number(req.params.productId);
    if (!productId || isNaN(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    const result = await addFavService(userId, productId);

    res.status(200).json({
      success: true,
      message: "Product added to favorites.",
      productId,
      isFavorited: true,
      productIds: result.productIds,
    });
  } catch (error) {
    logError(req, error, "Add favorite error");
    res.status(500).json({
      success: false,
      message: "Failed to add product to favorites.",
    });
  }
};

/**
 * Remove product from customer's favorites
 */
export const removeFavorite = async (req, res) => {
  try {
    const userId = req.user?.id || req.wpUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const productId = Number(req.params.productId);
    if (!productId || isNaN(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    const result = await removeFavService(userId, productId);

    res.status(200).json({
      success: true,
      message: "Product removed from favorites.",
      productId,
      isFavorited: false,
      productIds: result.productIds,
    });
  } catch (error) {
    logError(req, error, "Remove favorite error");
    res.status(500).json({
      success: false,
      message: "Failed to remove product from favorites.",
    });
  }
};

/**
 * Check favorite status for a single product
 */
export const checkFavoriteStatus = async (req, res) => {
  try {
    const userId = req.user?.id || req.wpUserId;
    if (!userId) {
      return res.json({
        success: true,
        isFavorited: false,
      });
    }

    const productId = Number(req.params.productId);
    const favorited = await isFavService(userId, productId);

    res.json({
      success: true,
      productId,
      isFavorited: favorited,
    });
  } catch (error) {
    res.json({
      success: true,
      isFavorited: false,
    });
  }
};
