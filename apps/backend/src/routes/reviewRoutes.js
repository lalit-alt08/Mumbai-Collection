import express from "express";
import {
  getProductReviews,
  createOrUpdateReview,
  deleteReview,
} from "../controllers/reviewController.js";
import { requireAuth, optionalAuth } from "../middlewares/authMiddleware.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

const router = express.Router();

// Reviews API
router.get("/product/:productId", validateRequest({ params: schemas.productIdParam }), optionalAuth, getProductReviews);
router.post("/product/:productId", validateRequest({ params: schemas.productIdParam, body: schemas.review }), requireAuth("customer"), createOrUpdateReview);
router.delete("/:reviewId", validateRequest({ params: schemas.reviewIdParam }), requireAuth("customer"), deleteReview);

export default router;
