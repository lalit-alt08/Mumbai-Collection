import express from "express";
import {
  getProductReviews,
  createOrUpdateReview,
  deleteReview,
} from "../controllers/reviewController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Reviews API
router.get("/product/:productId", getProductReviews);
router.post("/product/:productId", requireAuth("customer"), createOrUpdateReview);
router.delete("/:reviewId", requireAuth("customer"), deleteReview);

export default router;
