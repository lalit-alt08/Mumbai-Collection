import express from "express";
import multer from "multer";

import {
  getDashboardOverview,
  getAdminAnalytics,
} from "../controllers/adminAnalyticsController.js";

import {
  getAdminProducts,
  updateProduct,
  deleteProduct,
  createProduct,
  uploadProductImage,
} from "../controllers/adminProductController.js";

import { getAdminCustomers } from "../controllers/adminCustomerController.js";

import {
  getAdminOrders,
  updateAdminOrderStatus,
} from "../controllers/adminOrderController.js";

import { requireAuth } from "../middlewares/authMiddleware.js";
import { requireRole } from "../middlewares/roleMiddleware.js";
import { requireIdempotency } from "../middlewares/idempotencyMiddleware.js";
import { validateImageBuffer } from "../utils/imageValidator.js";
import { uploadLimiter } from "../middlewares/rateLimiter.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      const err = new Error("Only image files (JPEG, PNG, WebP, GIF) are allowed.");
      err.code = "INVALID_FILE_TYPE";
      return cb(err, false);
    }

    cb(null, true);
  },
});

const handleImageUpload = (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File size exceeds the 10MB limit.",
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || "Invalid image upload.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided.",
      });
    }

    const validation = validateImageBuffer(req.file);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    next();
  });
};

const router = express.Router();

// Executive Dashboard & Overview
router.get(
  "/overview",
  requireAuth("admin"),
  requireRole(["administrator"]),
  getDashboardOverview
);

// Products & Inventory Management
router.get(
  "/products",
  requireAuth("admin"),
  requireRole(["administrator"]),
  getAdminProducts
);

router.put(
  "/products/:id",
  requireAuth("admin"),
  requireRole(["administrator"]),
  updateProduct
);

router.patch(
  "/products/:id",
  requireAuth("admin"),
  requireRole(["administrator"]),
  updateProduct
);

router.delete(
  "/products/:id",
  requireAuth("admin"),
  requireRole(["administrator"]),
  deleteProduct
);

router.post(
  "/products",
  requireAuth("admin"),
  requireRole(["administrator"]),
  requireIdempotency,
  createProduct
);

router.post(
  "/upload",
  uploadLimiter,
  requireAuth("admin"),
  requireRole(["administrator"]),
  handleImageUpload,
  uploadProductImage
);

// Customers Directory
router.get(
  "/customers",
  requireAuth("admin"),
  requireRole(["administrator"]),
  getAdminCustomers
);

// Order Management (H4: previously orphaned — now mounted)
router.get(
  "/orders",
  requireAuth("admin"),
  requireRole(["administrator"]),
  getAdminOrders
);

router.put(
  "/orders/:id/status",
  requireAuth("admin"),
  requireRole(["administrator"]),
  updateAdminOrderStatus
);

// Dedicated Deep Analytics & Reporting
router.get(
  "/analytics",
  requireAuth("admin"),
  requireRole(["administrator"]),
  getAdminAnalytics
);

export default router;

