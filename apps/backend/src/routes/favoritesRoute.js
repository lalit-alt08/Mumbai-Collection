import express from "express";
import {
  getFavorites,
  addFavorite,
  removeFavorite,
  checkFavoriteStatus,
} from "../controllers/favoritesController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

const router = express.Router();

// All favorite actions are scoped strictly to the authenticated customer session
router.get("/", requireAuth("customer"), getFavorites);
router.post("/:productId", validateRequest({ params: schemas.productIdParam }), requireAuth("customer"), addFavorite);
router.delete("/:productId", validateRequest({ params: schemas.productIdParam }), requireAuth("customer"), removeFavorite);
router.get("/:productId/status", validateRequest({ params: schemas.productIdParam }), requireAuth("customer"), checkFavoriteStatus);

export default router;
