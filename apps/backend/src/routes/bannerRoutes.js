import express from "express";
import { getPublicBanners } from "../controllers/bannerController.js";

const router = express.Router();

// Public: GET /api/banners
router.get("/", getPublicBanners);

export default router;
