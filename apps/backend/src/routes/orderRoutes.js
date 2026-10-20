import express from "express";
import { getCustomerOrders, getOrderById } from "../controllers/orderController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

const router = express.Router();

// Customer order history and order tracking endpoints require an active session
router.get("/", validateRequest({ query: schemas.pagination }), requireAuth("customer"), getCustomerOrders);
router.get("/:id", validateRequest({ params: schemas.idParam }), requireAuth("customer"), getOrderById);

export default router;
