import express from "express";

import {
  getAllProducts,
  getProductById,
  getProductsByIds,
  getLiveProductStock,
  getRelatedProducts,
  searchAllProducts,
  getProductsByCategory,
  getAllCategories,
  getHomeShelves,
  getProductSocialPreview,
} from "../controllers/productController.js";

import {
  getProductReviews,
  createOrUpdateReview,
} from "../controllers/reviewController.js";

import { requireAuth, optionalAuth } from "../middlewares/authMiddleware.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";
import { reviewLimiter, catalogLimiter } from "../middlewares/rateLimiter.js";

const router = express.Router();

router.get("/:id/social-preview", catalogLimiter, validateRequest({ params: schemas.idParam }), getProductSocialPreview);
router.get("/", catalogLimiter, validateRequest({ query: schemas.pagination }), getAllProducts);
router.get("/home-shelves", catalogLimiter, validateRequest({ query: schemas.homeShelvesQuery }), getHomeShelves);
router.get("/by-ids", catalogLimiter, validateRequest({ query: schemas.productsByIds }), getProductsByIds);
router.get("/stock", catalogLimiter, validateRequest({ query: schemas.productStockIds }), getLiveProductStock);
router.get("/categories", catalogLimiter, validateRequest({ query: schemas.pagination }), getAllCategories);
router.get("/search", catalogLimiter, validateRequest({ query: schemas.productSearch }), searchAllProducts);
router.get("/related", catalogLimiter, validateRequest({ query: schemas.relatedProducts }), getRelatedProducts);
router.get("/category/:categoryId", catalogLimiter, validateRequest({ params: schemas.categoryIdParam, query: schemas.categoryProductsQuery }), getProductsByCategory);
router.get("/:id", catalogLimiter, validateRequest({ params: schemas.idParam, query: schemas.productDetailQuery }), getProductById);

// Product Reviews
router.get("/:productId/reviews", catalogLimiter, validateRequest({ params: schemas.productIdParam }), optionalAuth, getProductReviews);
router.post("/:productId/reviews", validateRequest({ params: schemas.productIdParam, body: schemas.review }), requireAuth("customer"), reviewLimiter, createOrUpdateReview);

export default router;
