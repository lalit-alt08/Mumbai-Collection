import express from "express";
import multer from "multer";

import {
  getEmployeeOrders,
  updateOrderStatus,
  getEmployeeOverview,
  uploadEmployeeMedia,
  deleteEmployeeMedia,
} from "../controllers/employeeController.js";

import {
  getAdminProducts,
  updateProduct,
  createProduct,
  deleteProduct,
} from "../controllers/adminProductController.js";

import {
  getAdminCategories,
  createCategory,
  updateCategory,
  reorderCategories,
} from "../controllers/adminCategoryController.js";

import {
  getEmployeeBanners,
  updateEmployeeBanners,
} from "../controllers/bannerController.js";

import { requireAuth } from "../middlewares/authMiddleware.js";
import { requireRole } from "../middlewares/roleMiddleware.js";
import { requireIdempotency } from "../middlewares/idempotencyMiddleware.js";
import {
  EMPLOYEE_MAX_IMAGE_SIZE_BYTES,
  validateImageBuffer,
} from "../utils/imageValidator.js";
import { uploadLimiter } from "../middlewares/rateLimiter.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: EMPLOYEE_MAX_IMAGE_SIZE_BYTES,
  },
  fileFilter: (req, file, cb) => {
    // Do not trust the client-provided MIME type. The authoritative
    // content/dimension validator runs after Multer has buffered the file.
    cb(null, true);
  },
});

const handleImageUpload = (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File size exceeds the 5MB limit.",
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

    const validation = validateImageBuffer(req.file, {
      maxFileSizeBytes: EMPLOYEE_MAX_IMAGE_SIZE_BYTES,
    });
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

const ALLOWED_EMPLOYEE_ROLES = ["employee", "administrator"];

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
  validateRequest({ query: schemas.pagination }),
  getEmployeeOrders
);

router.patch(
  "/orders/:id/status",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  validateRequest({ params: schemas.idParam, body: schemas.orderStatus }),
  updateOrderStatus
);

// Products & Inventory Management (No deletion allowed for employees)
router.get(
  "/products",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  validateRequest({ query: schemas.pagination }),
  getAdminProducts
);

router.get(
  "/categories",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  getAdminCategories
);

router.post(
  "/categories",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  requireIdempotency,
  validateRequest({ body: schemas.categoryCreate }),
  createCategory
);

router.put(
  "/categories/reorder",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  requireIdempotency,
  validateRequest({ body: schemas.categoryReorder }),
  reorderCategories
);

router.put(
  "/categories/:id",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  requireIdempotency,
  validateRequest({ params: schemas.idParam, body: schemas.categoryUpdate }),
  updateCategory
);

router.post(
  "/products",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  requireIdempotency,
  validateRequest({ body: schemas.productCreate }),
  createProduct
);

router.put(
  "/products/:id",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  validateRequest({ params: schemas.idParam, body: schemas.productUpdate }),
  updateProduct
);

router.patch(
  "/products/:id",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  validateRequest({ params: schemas.idParam, body: schemas.productUpdate }),
  updateProduct
);

router.delete(
  "/products/:id",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  validateRequest({ params: schemas.idParam }),
  deleteProduct
);

router.post(
  "/upload",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  uploadLimiter,
  handleImageUpload,
  uploadEmployeeMedia
);

router.delete(
  "/media/:id",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  deleteEmployeeMedia
);

// Homepage Banners Management (Max 3)
router.get(
  "/banners",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  getEmployeeBanners
);

router.put(
  "/banners",
  requireAuth("employee"),
  requireRole(ALLOWED_EMPLOYEE_ROLES),
  requireIdempotency,
  updateEmployeeBanners
);

export default router;
