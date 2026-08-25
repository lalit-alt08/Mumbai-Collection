import express from "express";

import {
  getAllProducts,
  getProductById,
  getRelatedProducts,
  searchAllProducts,
  getProductsByCategory,
  getAllCategories,
} from "../controllers/productController.js";

import {
  getProductReviews,
  createOrUpdateReview,
} from "../controllers/reviewController.js";

import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getAllProducts);
router.get("/categories", getAllCategories);
router.get("/search", searchAllProducts);
router.get("/related", getRelatedProducts);
router.get("/category/:categoryId", getProductsByCategory);
router.get("/:id", getProductById);

// Product Reviews
router.get("/:productId/reviews", getProductReviews);
router.post("/:productId/reviews", requireAuth("customer"), createOrUpdateReview);

export default router;