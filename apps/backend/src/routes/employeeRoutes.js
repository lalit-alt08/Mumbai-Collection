import express from "express";
import multer from "multer";

import {
  getEmployeeOrders,
  updateOrderStatus,
  getEmployeeOverview,
} from "../controllers/employeeController.js";

import {
  getAdminProducts,
  updateProduct,
  createProduct,
  uploadProductImage,
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

const ALLOWED_EMPLOYEE_ROLES = ["employee", "shop_manager", "administrator"];

// Employee Dashboard / Operations Overview Counts
router.get(
  "/overview",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  getEmployeeOverview
);

// Orders & Dispatch Management
router.get(
  "/orders",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  getEmployeeOrders
);

router.patch(
  "/orders/:id/status",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  updateOrderStatus
);

// Products & Inventory Management (No deletion allowed for employees)
router.get(
  "/products",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  getAdminProducts
);

router.post(
  "/products",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  createProduct
);

router.put(
  "/products/:id",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  updateProduct
);

router.patch(
  "/products/:id",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  updateProduct
);

router.post(
  "/upload",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  handleImageUpload,
  uploadProductImage
);

export default router;
