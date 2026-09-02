import {
  fetchProducts,
  fetchProductById,
  fetchRelatedProducts,
  searchProducts,
  fetchProductsByCategory,
  fetchCategories,
} from "../services/productService.js";
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
    console.error("Get all products error:", error.response?.data || error.message);

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
    console.error("Get product by ID error:", error.response?.data || error.message);

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
    console.error("Get related products error:", error.response?.data || error.message);

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
    console.error("Search products error:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: "Failed to search products",
    });
  }
};

export const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const cacheKey = `catalog:category:${categoryId}`;
    const products = await serverCache.getOrFetch(
      cacheKey,
      () => fetchProductsByCategory(categoryId),
      120000
    );

    res.json(transformMediaUrls(products, req));
  } catch (error) {
    console.error("Get category products error:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: "Failed to fetch category products",
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
    console.error("Get all categories error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      categories: [],
    });
  }
};
