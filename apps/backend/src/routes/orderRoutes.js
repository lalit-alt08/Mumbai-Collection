import express from "express";
import { getCustomerOrders, getOrderById } from "../controllers/orderController.js";
import { requireAuth, requireVerifiedPhone } from "../middlewares/authMiddleware.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

const router = express.Router();

// All customer order endpoints require an active session and verified mobile phone
router.get("/", validateRequest({ query: schemas.pagination }), requireAuth("customer"), requireVerifiedPhone, getCustomerOrders);
router.get("/:id", validateRequest({ params: schemas.idParam }), requireAuth("customer"), requireVerifiedPhone, getOrderById);

export default router;
