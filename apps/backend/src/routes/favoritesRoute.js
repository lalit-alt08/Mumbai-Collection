import express from "express";
import {
  getFavorites,
  addFavorite,
  removeFavorite,
  checkFavoriteStatus,
} from "../controllers/favoritesController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All favorite actions are scoped strictly to the authenticated customer session
router.get("/", requireAuth("customer"), getFavorites);
router.post("/:productId", requireAuth("customer"), addFavorite);
router.delete("/:productId", requireAuth("customer"), removeFavorite);
router.get("/:productId/status", requireAuth("customer"), checkFavoriteStatus);

export default router;
