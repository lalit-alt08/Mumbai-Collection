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
import { createRateLimiter, getClientIp } from "../middlewares/rateLimiter.js";

const router = express.Router();

const phoneAvailabilityLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many phone availability checks. Please try again later.",
  keyGenerator: (req) => `profile:check-phone:${getClientIp(req)}`,
});

const requireAccountDeletionPassword = (req, res, next) => {
  if (typeof req.body?.password !== "string" || req.body.password.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Your current password is required to delete your account.",
    });
  }
  return next();
};

router.get("/check-phone", phoneAvailabilityLimiter, optionalAuth, checkPhoneAvailability);
router.get("/", requireAuth("customer"), getProfile);
router.put("/", validateRequest({ body: schemas.profile }), requireAuth("customer"), saveProfile);
router.get("/complete", requireAuth("customer"), checkProfileComplete);
router.delete("/", requireAuth("customer"), requireAccountDeletionPassword, deleteAccount);

export default router;
