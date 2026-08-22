import express from "express";
import multer from "multer";

import {
  getDashboardOverview,
  getAdminProducts,
  updateProduct,
  deleteProduct,
  createProduct,
  uploadProductImage,
  getAdminCustomers,
  getAdminAnalytics,
} from "../controllers/adminController.js";

import { requireAuth } from "../middlewares/authMiddleware.js";
import { requireRole } from "../middlewares/roleMiddleware.js";

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

// Inventory & Products
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
  createProduct
);

router.post(
  "/upload",
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

// Dedicated Deep Analytics & Reporting
router.get(
  "/analytics",
  requireAuth("admin"),
  requireRole(["administrator"]),
  getAdminAnalytics
);

export default router;