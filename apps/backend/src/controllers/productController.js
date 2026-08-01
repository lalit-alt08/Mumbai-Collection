import { fetchProducts } from "../services/productService.js";

export const getAllProducts = async (req, res) => {
  try {
    const products = await fetchProducts();

    res.json(products);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
};