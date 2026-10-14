import express from "express";
import {
  login,
  logout,
  register,
  forgotPassword,
  resetPassword,
  me,
  googleLogin,
} from "../controllers/authController.js";
import { authLimiter, ipAuthLimiter } from "../middlewares/rateLimiter.js";
import { optionalAuth } from "../middlewares/authMiddleware.js";
import { sendOtp, verifyOtp, resetPasswordOtp } from "../controllers/authController.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

const router = express.Router();

router.post("/login", ipAuthLimiter, authLimiter, validateRequest({ body: schemas.login }), login);
router.post("/register", ipAuthLimiter, authLimiter, validateRequest({ body: schemas.register }), register);
router.post("/google-login", ipAuthLimiter, authLimiter, validateRequest({ body: schemas.googleLogin }), optionalAuth, googleLogin);
router.post("/logout", logout);
router.post("/forgot-password", ipAuthLimiter, authLimiter, validateRequest({ body: schemas.forgotPassword }), forgotPassword);
router.post("/reset-password", ipAuthLimiter, authLimiter, validateRequest({ body: schemas.resetPassword }), resetPassword);

router.get("/me", me);

// Transactional Email OTP Endpoints
router.post("/otp/send", ipAuthLimiter, authLimiter, validateRequest({ body: schemas.otpSend }), optionalAuth, sendOtp);
router.post("/otp/verify", ipAuthLimiter, authLimiter, validateRequest({ body: schemas.otpVerify }), optionalAuth, verifyOtp);
router.post("/otp/reset-password", ipAuthLimiter, authLimiter, validateRequest({ body: schemas.otpResetPassword }), resetPasswordOtp);
export default router;
