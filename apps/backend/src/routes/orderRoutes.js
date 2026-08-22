import express from "express";
import { getCustomerOrders, getOrderById } from "../controllers/orderController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All customer order endpoints require an active session
router.get("/", requireAuth("customer"), getCustomerOrders);
router.get("/:id", requireAuth("customer"), getOrderById);

export default router;
