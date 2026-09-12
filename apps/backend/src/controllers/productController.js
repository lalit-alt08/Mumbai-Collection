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
    const cacheKey = `catalog:products:all:${JSON.stringify(req.query || {})}`;
    const products = await serverCache.getOrFetch(cacheKey, () => fetchProducts(), 60000);

    if (Array.isArray(products)) {
      return res.json(transformMediaUrls(products, req));
    }

    // If WooCommerce/service returns { products: [...] }
    if (Array.isArray(products?.products)) {
      return res.json(transformMediaUrls(products.products, req));
    }

    return res.status(500).json({
      success: false,
      message: "Invalid products response.",
      products: [],
    });
  } catch (error) {
    logError(req, error, "Get all products error");

    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
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
    const cacheKey = `catalog:categories:all:${JSON.stringify(req.query || {})}`;
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
