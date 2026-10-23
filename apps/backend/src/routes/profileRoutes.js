import express from "express";

import {
  getProfile,
  saveProfile,
  checkProfileComplete,
  deleteAccount,
  checkPhoneAvailability,
} from "../controllers/profileController.js";
import { requireAuth, optionalAuth } from "../middlewares/authMiddleware.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

const router = express.Router();

router.get("/check-phone", optionalAuth, checkPhoneAvailability);
router.get("/", requireAuth("customer"), getProfile);
router.put("/", validateRequest({ body: schemas.profile }), requireAuth("customer"), saveProfile);
router.get("/complete", requireAuth("customer"), checkProfileComplete);
router.delete("/", requireAuth("customer"), deleteAccount);

export default router;
