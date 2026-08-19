import express from "express";
import {
  login,
  logout,
  register,
  forgotPassword,
  resetPassword,
  me,
} from "../controllers/authController.js";
import { authLimiter } from "../middlewares/rateLimiter.js";

const router = express.Router();

router.post("/login", authLimiter, login);
router.post("/register", authLimiter, register);
router.post("/logout", logout);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.get("/me", me);

export default router;