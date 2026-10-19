import express from "express";

import {
  getAllProducts,
  getProductById,
  getProductsByIds,
  getRelatedProducts,
  searchAllProducts,
  getProductsByCategory,
  getAllCategories,
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
router.get("/", validateRequest({ query: schemas.pagination }), getAllProducts);
router.get("/by-ids", validateRequest({ query: schemas.productsByIds }), getProductsByIds);
router.get("/categories", validateRequest({ query: schemas.pagination }), getAllCategories);
router.get("/search", validateRequest({ query: schemas.pagination }), searchAllProducts);
router.get("/related", validateRequest({ query: schemas.pagination }), getRelatedProducts);
router.get("/category/:categoryId", validateRequest({ params: schemas.categoryIdParam, query: schemas.pagination }), getProductsByCategory);
router.get("/:id", validateRequest({ params: schemas.idParam }), getProductById);

// Product Reviews
router.get("/:productId/reviews", validateRequest({ params: schemas.productIdParam }), optionalAuth, getProductReviews);
router.post("/:productId/reviews", validateRequest({ params: schemas.productIdParam, body: schemas.review }), requireAuth("customer"), reviewLimiter, createOrUpdateReview);

export default router;
