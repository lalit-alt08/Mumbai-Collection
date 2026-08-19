import express from "express";
import {
  getDashboardOverview,
  getAdminOrders,
  updateOrderStatus,
  getAdminProducts,
  updateProduct,
  createProduct,
  getAdminCustomers,
} from "../controllers/adminController.js";

const router = express.Router();

// Executive Dashboard & Overview
router.get("/overview", getDashboardOverview);

// Orders Management
router.get("/orders", getAdminOrders);
router.put("/orders/:id/status", updateOrderStatus);

// Inventory & Products
router.get("/products", getAdminProducts);
router.put("/products/:id", updateProduct);
router.post("/products", createProduct);

// Customers Directory
router.get("/customers", getAdminCustomers);

export default router;
