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
import { authLimiter } from "../middlewares/rateLimiter.js";
import { optionalAuth } from "../middlewares/authMiddleware.js";
import { sendOtp, verifyOtp, resetPasswordOtp } from "../controllers/authController.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

const router = express.Router();

router.post("/login", authLimiter, validateRequest({ body: schemas.login }), login);
router.post("/register", authLimiter, validateRequest({ body: schemas.register }), register);
router.post("/google-login", authLimiter, validateRequest({ body: schemas.googleLogin }), googleLogin);
router.post("/logout", logout);
router.post("/forgot-password", authLimiter, validateRequest({ body: schemas.forgotPassword }), forgotPassword);
router.post("/reset-password", authLimiter, validateRequest({ body: schemas.resetPassword }), resetPassword);

// SMS OTP Endpoints
router.post("/otp/send", authLimiter, validateRequest({ body: schemas.otpSend }), optionalAuth, sendOtp);
router.post("/otp/verify", authLimiter, validateRequest({ body: schemas.otpVerify }), optionalAuth, verifyOtp);
router.post("/otp/reset-password", authLimiter, validateRequest({ body: schemas.otpResetPassword }), resetPasswordOtp);

router.get("/me", me);

export default router;
