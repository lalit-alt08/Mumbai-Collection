import express from "express";
import { getAddresses } from "../controllers/addressController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", requireAuth, getAddresses);

export default router;