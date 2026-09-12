import express from "express";
import { getPublicStoreHours } from "../controllers/storeHoursController.js";

const router = express.Router();

// Public: GET /api/store-hours
router.get("/", getPublicStoreHours);

export default router;
