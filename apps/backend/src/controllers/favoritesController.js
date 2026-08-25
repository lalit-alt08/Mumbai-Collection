import api from "../config/woocommerce.js";
import {
  getFavoriteProductIds,
  addFavorite as addFavService,
  removeFavorite as removeFavService,
  isFavorited as isFavService,
} from "../services/favoritesService.js";

/**
 * Get all favorited products for authenticated customer
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

    if (!productIds || productIds.length === 0) {
      return res.json({
        success: true,
        count: 0,
        productIds: [],
        favorites: [],
      });
    }

    // Fetch full real-time product details from WooCommerce
    try {
      const response = await api.get("products", {
        include: productIds,
        per_page: Math.min(100, productIds.length),
      });

      const products = Array.isArray(response.data) ? response.data : [];

      res.json({
        success: true,
        count: products.length,
        productIds,
        favorites: products,
      });
    } catch (wcErr) {
      console.warn("WooCommerce products fetch for favorites warning:", wcErr.message);
      // Fallback: return product IDs even if catalog is delayed
      res.json({
        success: true,
        count: productIds.length,
        productIds,
        favorites: [],
      });
    }
  } catch (error) {
    console.error("Get favorites error:", error.response?.data || error.message);
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
    console.error("Add favorite error:", error.response?.data || error.message);
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
    console.error("Remove favorite error:", error.response?.data || error.message);
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
