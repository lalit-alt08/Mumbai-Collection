import express from "express";

import {
  getProfile,
  saveProfile,
  checkProfileComplete,
} from "../controllers/profileController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", requireAuth, getProfile);
router.put("/", requireAuth, saveProfile);
router.get("/complete", requireAuth, checkProfileComplete);

export default router;
