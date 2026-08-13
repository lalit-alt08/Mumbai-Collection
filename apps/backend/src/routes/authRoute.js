import express from "express";
import { login , register , forgotPassword , resetPassword ,  me} from "../controllers/authController.js";

const router = express.Router();

router.post("/login", login);
router.post("/register", register);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", me);

export default router;