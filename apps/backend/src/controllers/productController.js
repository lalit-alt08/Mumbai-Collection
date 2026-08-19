import {
  fetchProducts,
  fetchProductById,
  fetchRelatedProducts,
   searchProducts,
   fetchProductsByCategory,
} from "../services/productService.js";

export const getAllProducts = async (req, res) => {
  try {
    const products = await fetchProducts();

    if (Array.isArray(products)) {
      return res.json(products);
    }

    // If WooCommerce/service returns { products: [...] }
    if (Array.isArray(products?.products)) {
      return res.json(products.products);
    }

    console.error("Unexpected products response:", products);

    return res.status(500).json({
      success: false,
      message: "Invalid products response.",
      products: [],
    });
  } catch (error) {
    console.error(
      "Get all products error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
};
export const getProductById = async (req, res) => {
  try {
    const product = await fetchProductById(req.params.id);

    res.json(product);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
};

export const getRelatedProducts = async (req, res) => {
  try {
    const { categoryId, currentProductId } = req.query;

    const products = await fetchRelatedProducts(categoryId, currentProductId);

    res.json(products);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch related products",
    });
  }
};

export const searchAllProducts = async (req, res) => {
  try {
    const { q } = req.query;

    const products = await searchProducts(q);

    res.json(products);
  } catch (error) {
    console.error(error.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to search products",
    });
  }
};

export const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const products = await fetchProductsByCategory(categoryId);

    res.json(products);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch category products",
    });
  }
};
