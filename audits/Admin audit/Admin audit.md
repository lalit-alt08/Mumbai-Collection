# Mumbai Collection — Admin Panel Architecture & Audit Documentation

This directory contains comprehensive, end-to-end technical audit documents for all 7 features of the **Mumbai Collection Admin Panel** as configured in [`AdminLayout.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/layouts/AdminLayout.jsx):

```
Admin HQ Navigation:
1. Overview                -> 01_Overview.md (Completed)
2. Inventory & Stock       -> 02_Inventory_and_Stock.md (Completed)
3. Customers               -> 03_Customers.md (Completed)
4. Customer Suspension     -> 04_Customer_Suspension.md (Completed)
5. Employee Access         -> 05_Employee_Access.md (Completed)
6. Sales Analytics         -> 06_Sales_Analytics.md (Completed)
7. Store Hours             -> 07_Store_Hours.md (Completed)
```

---

## Complete Audit Index

- **[01. Executive Overview Dashboard](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Admin%20audit/01_Overview.md)**:
  - **Frontend**: [`Overview.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Overview.jsx), [`adminApi.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/services/adminApi.js)
  - **BFF (Node.js)**: [`adminAnalyticsController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminAnalyticsController.js), [`adminRoutes.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/adminRoutes.js), [`paymentController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/paymentController.js)
  - **WordPress / PHP**: [`mumbai-auth.php`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L5804-L6050)
  - **Key Capabilities**: Real-time sales calculations, IST timezone normalization (+330 mins), 7-day revenue scaling, low-stock warnings, authoritative HPOS SQL queries, operational delivery sub-status resolution, and one-click Razorpay payment reconciliation.

- **[02. Inventory & Stock Management](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Admin%20audit/02_Inventory_and_Stock.md)**:
  - **Frontend**: [`Products.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Products.jsx), [`productAdjuster.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/utils/productAdjuster.js), [`readRetry.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/utils/readRetry.js)
  - **BFF (Node.js)**: [`adminProductController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminProductController.js), [`searchIndexService.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/services/searchIndexService.js), [`imageValidator.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/utils/imageValidator.js)
  - **WordPress / PHP**: [`mumbai-auth.php`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L5764-L5802)
  - **Key Capabilities**: 400ms search debouncing with request race-condition suppression, server-side pagination with stock status filters, Quick Adjust modal with optimistic updates, MySQL row-level locking (`FOR UPDATE`), optimistic concurrency checks (`expected_stock_quantity`), active checkout reservation protection (`wc_get_held_stock_quantity()`), multi-tier cache invalidation, and search index rebuild synchronization.

- **[03. Customer Directory & LTV Analytics](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Admin%20audit/03_Customers.md)**:
  - **Frontend**: [`Customers.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Customers.jsx), [`adminApi.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/services/adminApi.js)
  - **BFF (Node.js)**: [`adminCustomerController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCustomerController.js), [`nameFormatter.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/utils/nameFormatter.js)
  - **WordPress / PHP**: [`mumbai-auth.php`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L5419-L5580)
  - **Key Capabilities**: Dedicated customer metrics pre-aggregation table (`mumbai_customer_metrics`), MySQL Full-Text search with Indian phone normalization (stripping `91`/`0`), exclusion of staff/administrator accounts, 5-second micro-caching with manual refresh invalidation, and two-tier resilient customer order history (Internal SQL with WooCommerce REST fallback).

- **[04. Customer Suspension & Account Enforcement](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Admin%20audit/04_Customer_Suspension.md)**:
  - **Frontend**: [`CustomerSuspension.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/CustomerSuspension.jsx), [`adminApi.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/services/adminApi.js)
  - **BFF (Node.js)**: [`adminCustomerSuspensionController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCustomerSuspensionController.js), [`authMiddleware.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/middlewares/authMiddleware.js)
  - **WordPress / PHP**: [`mumbai-auth.php`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L6832-L7000)
  - **Key Capabilities**: Role immunity defense (preventing suspension of admins/employees), timed suspensions (3 months, 6 months) and permanent suspensions, zero-cron timestamp evaluation (`time() >= expires_at`), real-time BFF JWT session revocation via `invalidateUserSessionCache()`, and dual enforcement gates on authentication and checkout order submission.

- **[05. Employee Access & Staff Governance](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Admin%20audit/05_Employee_Access.md)**:
  - **Frontend**: [`Employees.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Employees.jsx), [`adminApi.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/services/adminApi.js)
  - **BFF (Node.js)**: [`adminEmployeeController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminEmployeeController.js), [`authMiddleware.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/middlewares/authMiddleware.js), [`pushNotificationService.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/services/pushNotificationService.js)
  - **WordPress / PHP**: [`mumbai-auth.php`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L600-L618)
  - **Key Capabilities**: Role whitelisting (only `employee` role can be requested/assigned), self-action lockout prevention (admins cannot deactivate or reject themselves), instant JWT revocation via `invalidateUserSessionCache()`, live WebPush endpoint purging (`removeSubscriptionsForEmployee()`) to silence live order sound/alert chimes, and `_mumbai_session_version` timestamp validation.

- **[06. Sales Analytics & Deep Reporting](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Admin%20audit/06_Sales_Analytics.md)**:
  - **Frontend**: [`Analytics.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Analytics.jsx), [`DateRangePicker.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/components/common/DateRangePicker.jsx), [`adminApi.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/services/adminApi.js)
  - **BFF (Node.js)**: [`adminAnalyticsController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminAnalyticsController.js), [`adminRoutes.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/adminRoutes.js)
  - **WordPress / PHP**: [`mumbai-auth.php`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L6200-L6320)
  - **Key Capabilities**: Calendar integrity parsing in IST (+05:30), 24h exclusive boundary expansion, dynamic single-product isolation subquery joining order line items, strict clean-revenue filtering (`processing`, `completed`), MySQL IST trend aggregation (`INTERVAL 330 MINUTE`), top 100 revenue-generating products ranking, and CSV export capabilities.

- **[07. Store Hours & Operating Control](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Admin%20audit/07_Store_Hours.md)**:
  - **Frontend**: [`StoreHours.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/StoreHours.jsx), [`adminApi.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/services/adminApi.js)
  - **BFF (Node.js)**: [`storeHoursService.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/services/storeHoursService.js), [`adminStoreHoursController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminStoreHoursController.js), [`adminRoutes.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/adminRoutes.js)
  - **WordPress / PHP**: [`mumbai-auth.php`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L500-L519, L4943-L4969)
  - **Key Capabilities**: Live 1-second IST clock ticking against configured open schedules, Peak Hours switch dynamically flipping customer ETA between `60–90 mins` and `2–3 hours`, overnight shift spillover handling across midnight, 24-hour shift support, manual override precedence (`open`/`closed`), 5-minute fallback grace window during WordPress outages, and the authoritative fail-closed checkout guard (`checkCheckoutStoreGuard`) intercepting order placement and Razorpay payment authorization.
