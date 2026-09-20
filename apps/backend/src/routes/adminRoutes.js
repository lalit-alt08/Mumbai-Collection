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
  triggerOrphanCleanup,
} from "../controllers/adminProductController.js";

import {
  getAdminCustomers,
} from "../controllers/adminCustomerController.js";

import {
  getAdminOrders,
  updateAdminOrderStatus,
} from "../controllers/adminOrderController.js";

import {
  getAdminEmployees,
  requestEmployeeAccess,
  approveEmployee,
  rejectEmployee,
  updateEmployeeStatus,
  revokeEmployeeSessions,
} from "../controllers/adminEmployeeController.js";

import {
  getAdminStoreHours,
  updateAdminStoreHours,
} from "../controllers/adminStoreHoursController.js";

import {
  lookupCustomerSuspension,
  suspendCustomer,
  unsuspendCustomer,
} from "../controllers/adminCustomerSuspensionController.js";

import { requireAuth } from "../middlewares/authMiddleware.js";
import { requireRole } from "../middlewares/roleMiddleware.js";
import { requireIdempotency } from "../middlewares/idempotencyMiddleware.js";
import { validateImageBuffer } from "../utils/imageValidator.js";
import { uploadLimiter } from "../middlewares/rateLimiter.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

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
  validateRequest({ query: schemas.pagination }),
  getAdminProducts
);

router.put(
  "/products/:id",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ params: schemas.idParam, body: schemas.productUpdate }),
  updateProduct
);

router.patch(
  "/products/:id",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ params: schemas.idParam, body: schemas.productUpdate }),
  updateProduct
);

router.delete(
  "/products/:id",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ params: schemas.idParam }),
  deleteProduct
);

router.post(
  "/products",
  requireAuth("admin"),
  requireRole(["administrator"]),
  requireIdempotency,
  validateRequest({ body: schemas.productCreate }),
  createProduct
);

router.post(
  "/upload",
  requireAuth("admin"),
  requireRole(["administrator"]),
  uploadLimiter,
  handleImageUpload,
  uploadProductImage
);

router.post(
  "/media/cleanup-orphans",
  requireAuth("admin"),
  requireRole(["administrator"]),
  triggerOrphanCleanup
);

// Customers Directory
router.get(
  "/customers",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ query: schemas.pagination }),
  getAdminCustomers
);

// Order Management (H4: previously orphaned — now mounted)
router.get(
  "/orders",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ query: schemas.pagination }),
  getAdminOrders
);

router.put(
  "/orders/:id/status",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ params: schemas.idParam, body: schemas.orderStatus }),
  updateAdminOrderStatus
);

router.patch(
  "/orders/:id/status",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ params: schemas.idParam, body: schemas.orderStatus }),
  updateAdminOrderStatus
);

// Dedicated Deep Analytics & Reporting
router.get(
  "/analytics",
  requireAuth("admin"),
  requireRole(["administrator"]),
  getAdminAnalytics
);

// Employee Access & Staff Directory Management
router.get(
  "/employees",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ query: schemas.pagination }),
  getAdminEmployees
);

router.post(
  "/employees/access",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ body: schemas.employeeAccess }),
  requestEmployeeAccess
);

router.patch(
  "/employees/:id/approve",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ params: schemas.idParam, body: schemas.employeeRole }),
  approveEmployee
);

router.patch(
  "/employees/:id/reject",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ params: schemas.idParam, body: schemas.employeeReject }),
  rejectEmployee
);

router.patch(
  "/employees/:id/status",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ params: schemas.idParam, body: schemas.employeeStatus }),
  updateEmployeeStatus
);

router.post(
  "/employees/:id/revoke-sessions",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ params: schemas.idParam }),
  revokeEmployeeSessions
);

// Store Operating Hours Configuration
router.get(
  "/store-hours",
  requireAuth("admin"),
  requireRole(["administrator"]),
  getAdminStoreHours
);

router.put(
  "/store-hours",
  requireAuth("admin"),
  requireRole(["administrator"]),
  requireIdempotency,
  updateAdminStoreHours
);

// Customer Suspension Management
router.get(
  "/customer-suspension/lookup",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ query: schemas.suspensionLookup }),
  lookupCustomerSuspension
);

router.post(
  "/customer-suspension/suspend",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ body: schemas.suspension }),
  suspendCustomer
);

router.post(
  "/customer-suspension/unsuspend",
  requireAuth("admin"),
  requireRole(["administrator"]),
  validateRequest({ body: schemas.unsuspension }),
  unsuspendCustomer
);

export default router;

