/**
 * Admin Controller (Compatibility Re-Export Barrel)
 * Re-exports domain-specific controllers for backward compatibility.
 */

// Product & Inventory Management
export {
  validateProductInput,
  getAdminProducts,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  createProduct,
} from "./adminProductController.js";

// Category Management & Merchandising
export {
  getAdminCategories,
  createCategory,
  updateCategory,
  reorderCategories,
} from "./adminCategoryController.js";

// Customer Directory & LTV
export {
  getAdminCustomers,
} from "./adminCustomerController.js";

// Analytics & Dashboard Overview
export {
  getDashboardOverview,
  getAdminAnalytics,
} from "./adminAnalyticsController.js";

// Order Management
export {
  getAdminOrders,
  updateAdminOrderStatus,
} from "./adminOrderController.js";
