import express from "express";

import {
  getProfile,
  saveProfile,
  checkProfileComplete,
} from "../controllers/profileController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", requireAuth("customer"), getProfile);
router.put("/", requireAuth("customer"), saveProfile);
router.get("/complete", requireAuth("customer"), checkProfileComplete);

export default router;
