# Comprehensive Security & Architectural Audit: Employee (Staff) Panel
**Target System**: `apps/employee-panel` (React 19 SPA) & Backend Staff Gateway  
**Auditor**: Principal Engineer & Application-Security Reviewer  
**Date**: October 12, 2026  
**Status**: READ-ONLY AUDIT COMPLETE — FIX NOTHING UNTIL EXPLICITLY INSTRUCTED  

---

## Executive Summary & Threat Profile

The staff (employee) panel of an e-commerce shop represents the soft underbelly of the entire infrastructure. In a physical shop counter environment (such as a retail storefront in Vasai/Mumbai), the operational reality violates normal desktop assumptions:
- Staff tablets are shared across shifts without individualized session lockouts.
- Counter staff interact with customers while handling high-volume dispatch operations.
- Wi-Fi/4G connectivity is intermittent and subject to dropouts.
- Staff accounts have direct read access to customer Personally Identifiable Information (PII) and write access to catalog prices, inventory, and order fulfillment states.

This audit audited the entire staff surface area across:
1. `apps/employee-panel` (Vite + React 19 SPA)
2. `apps/backend/src/routes/employeeRoutes.js`, `adminRoutes.js`, `authRoute.js`
3. `apps/backend/src/controllers/employeeController.js`, `adminProductController.js`, `adminCategoryController.js`, `bannerController.js`, `authController.js`
4. Middleware chains: `authMiddleware.js`, `roleMiddleware.js`, `csrfMiddleware.js`, `idempotencyMiddleware.js`, `rateLimiter.js`, `imageValidator.js`, `requestValidation.js`
5. WordPress custom authentication plugin: `mumbai-auth.php`
6. Services: `auditLogger.js`, `alertService.js`, `wordpressMediaService.js`, `bannerService.js`

### Primary Audit Highlights
- **Critical Vulnerability**: An employee can mark **unpaid online orders** (Razorpay pending/failed) as `packed`, `out-for-delivery`, and `completed` because `updateOrderStatus` lacks state-machine validation and payment capture verification.
- **Critical Vulnerability**: An employee can alter **any product regular and sale price** (e.g. ₹2,000 to ₹1) and **permanently delete products from the WooCommerce catalog** via `DELETE /api/employee/products/:id` despite code documentation claiming deletion is forbidden.
- **Critical Infrastructure Risk**: `apps/employee-panel/vercel.json` contains a hardcoded ephemeral Cloudflare tunnel rewrite (`https://vacations-arising-bus-governor.trycloudflare.com`). If deployed, all staff traffic will fail or be intercepted.
- **High Risk**: Blind stock updates in `updateProduct` overwrite live customer checkout sales (lost update race condition).
- **High Risk**: Zero audit logging on Category additions/updates/reordering and Homepage Banner modifications.

---

## PART 0 - MAP: Screens, APIs, Roles, and Data Flow

### 0.1 Screen to API Endpoint Mapping
| Screen / View | Frontend Component (`file:line`) | Backend Endpoint | Method | Request Payload / Parameters | Role Required |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Login** | [`Login.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Login.jsx) | `/api/auth/login` | `POST` | `{ email, password, context: "employee" }` | Public |
| **Session Check** | [`EmployeeAuthContext.jsx:16`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/context/EmployeeAuthContext.jsx#L16) | `/api/auth/me?context=employee` | `GET` | Query: `context=employee`, Cookie: `mumbai_employee_auth` | `employee`, `administrator` |
| **Logout** | [`authService.js:33`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/services/authService.js#L33) | `/api/auth/logout` | `POST` | `{ context: "employee" }` | Any authenticated |
| **Dashboard (Console)** | [`Dashboard.jsx:42`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Dashboard.jsx#L42) | `/api/employee/overview` | `GET` | Headers: `X-Mumbai-Panel: employee` | `employee`, `administrator` |
| **Quick Status Update** | [`Dashboard.jsx:111`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Dashboard.jsx#L111) | `/api/employee/orders/:id/status` | `PATCH` | `{ status: "packed" \| "out-for-delivery" \| ... }` | `employee`, `administrator` |
| **Orders Dispatch** | [`Orders.jsx:228`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Orders.jsx#L228) | `/api/employee/orders` | `GET` | Query: `page, per_page, status, search, location, date_filter, date_from, date_to` | `employee`, `administrator` |
| **Order Status Modal** | [`Orders.jsx:358`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Orders.jsx#L358) | `/api/employee/orders/:id/status` | `PATCH` | `{ status }` | `employee`, `administrator` |
| **Products List** | [`Products.jsx:287`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Products.jsx#L287) | `/api/employee/products` | `GET` | Query: `page, per_page, search, stock_status, category` | `employee`, `administrator` |
| **Product Quick Adjust** | [`Products.jsx:371`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Products.jsx#L371) | `/api/employee/products/:id` | `PUT` | `{ regular_price, sale_price, stock_quantity }` | `employee`, `administrator` |
| **Delete Product** | [`Products.jsx:406`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Products.jsx#L406) | `/api/employee/products/:id` | `DELETE` | Path param: `id` | `employee`, `administrator` |
| **Add Product Modal** | [`Products.jsx:546`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Products.jsx#L546) | `/api/employee/products` | `POST` | `{ name, regular_price, sale_price, stock_quantity, description, category_ids, images }` | `employee`, `administrator` |
| **Add Product Page** | [`AddProduct.jsx:227`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddProduct.jsx#L227) | `/api/employee/products` | `POST` | Same as above with `X-Idempotency-Key` header | `employee`, `administrator` |
| **Media Upload** | [`Products.jsx:507`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Products.jsx#L507) | `/api/employee/upload` | `POST` | `multipart/form-data`: `image` file buffer | `employee`, `administrator` |
| **Remove Temp Media** | [`Products.jsx:137`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Products.jsx#L137) | `/api/employee/media/:id` | `DELETE` | Path param: `id` | `employee`, `administrator` |
| **Categories List** | [`AddCategory.jsx:58`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L58) | `/api/employee/categories` | `GET` | None | `employee`, `administrator` |
| **Create Category** | [`AddCategory.jsx:92`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L92) | `/api/employee/categories` | `POST` | `{ name, image_id, image_url, description }` | `employee`, `administrator` |
| **Update Category** | [`UpdateCategoryModal.jsx:50`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/components/category/UpdateCategoryModal.jsx#L50) | `/api/employee/categories/:id` | `PUT` | `{ name, image_id, image_url, description }` | `employee`, `administrator` |
| **Reorder Categories** | [`AddCategory.jsx:153`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L153) | `/api/employee/categories/reorder` | `PUT` | `{ category_ids: [...] }` | `employee`, `administrator` |
| **Banners Management** | [`Banners.jsx:50`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Banners.jsx#L50) | `/api/employee/banners` | `GET` | None | `employee`, `administrator` |
| **Save Banners** | [`Banners.jsx:120`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Banners.jsx#L120) | `/api/employee/banners` | `PUT` | `{ banners: [...] }` | `employee`, `administrator` |

### 0.2 Data Shown: List View vs Detail View
- **Orders List (`Orders.jsx:1240-1500`)**:
  - Rendered: Order number, customer full name, delivery location pill, items count, total amount, payment method badge ("Cash on Delivery" or "Razorpay"), status dropdown.
  - Over-the-wire payload (`employeeController.js:296-388`): Transmits full customer email, primary phone, secondary phone, full street addresses (billing and shipping), and raw WooCommerce `meta_data` array (containing Razorpay payment ID, signature, and internal meta) for **all 20 orders per page**, even though this detailed data is only visible when an employee opens the inspection drawer.
- **Order Inspection Drawer (`Orders.jsx:1530-1650`)**:
  - Displays customer name, street address, postal code, clickable phone link (`tel:`), backup phone link, customer email link (`mailto:`), and item breakdown with images.

### 0.3 Side Effects of Staff Actions
1. **Order Status Change to `packed` / `out-for-delivery`**:
   - Updates WooCommerce meta key `_delivery_status`. Core WooCommerce status stays `processing`.
   - Clears in-memory caches: `serverCache.invalidatePrefix("employee:overview")`, `admin:analytics`, `admin:customers`.
   - Appends entry to `logs/audit.log` via `logAuditEvent`.
   - **Does NOT** trigger SMS or Email automatically from Express (handled asynchronously by WooCommerce webhooks/plugins).
2. **Order Status Change to `completed`**:
   - Updates WooCommerce status to `completed` and writes `_delivery_status = 'completed'` and `_delivery_completed_at = <ISO timestamp>`.
   - **Does NOT** verify cash collection or reconcile COD payment.
3. **Product Price / Stock Update**:
   - Writes directly to WooCommerce REST API `products/:id`.
   - Invalidates Redis/in-memory caches: `serverCache.invalidatePrefix("admin_products:")`, `product_stock_counts`, `serverCache.invalidatePrefix("catalog:")`.
   - Public customer storefront sees updated stock/price immediately upon cache invalidation.
4. **Product Deletion**:
   - Permanently deletes product from WooCommerce (`force: true`). Cleans up unreferenced media attachments in WordPress.

### 0.4 Generic Proxy / Pass-Through Check
- There is **no open generic proxy** (e.g. `req.pipe(wp)`) exposed to staff. All employee routes in `employeeRoutes.js` route to specific controller methods.
- However, the underlying WooCommerce client in `apps/backend/src/config/woocommerce.js` uses administrative API credentials (`ck_...`, `cs_...`) that bypass all WordPress capability checks. Any field permitted by the controller is written with full database authority.

---

## PART 1 - STAFF AUTH & SESSION

### 1.1 Login & Rate Limiting
- **Brute-Force Protection (`rateLimiter.js:96-110`)**:
  - The `authLimiter` creates a rate limit window of 15 minutes, allowing a maximum of 20 attempts.
  - **Vulnerability**: The compound key generator is:
    ```javascript
    keyGenerator: (req) => {
      const rawIdentifier = req.body?.email || req.body?.phone || ... || "anon";
      const cleanIdentifier = String(rawIdentifier).trim().toLowerCase().slice(0, 64);
      const ip = getClientIp(req);
      return `auth:${cleanIdentifier}:${ip}`;
    }
    ```
    - **Password Spray Attack Vulnerability**: Because the key includes both identifier AND IP, an attacker on a single IP can target 100 different staff accounts and make 19 attempts per account (1,900 attempts total) without ever hitting the rate limiter. There is **no IP-only rate limiter** on the login route.
    - **Distributed Brute-Force**: An attacker rotating IPs through proxies gets 20 attempts per IP against any single staff account. There is **no global per-account rate limiter**.
- **User Enumeration**:
  - In `mumbai-auth.php` line 1258 and `authController.js:127-141`, login failures from WordPress return generic "Invalid credentials" messages with identical HTTP 401 status codes.
- **Password Policy & OTP**:
  - Password policy is enforced via Zod schema (`requestValidation.js:9`): `password = z.string().min(8).max(256)`.
  - Staff login does **NOT** require Multi-Factor Authentication (MFA/2FA) or OTP. It is single-factor (Email + Password only).

### 1.2 Cookies & Isolation
- **Cookie Configuration (`authController.js:32-45`)**:
  - Cookie names are strictly partitioned:
    - Customer: `mumbai_customer_auth`
    - Employee: `mumbai_employee_auth`
    - Admin: `mumbai_admin_auth`
  - Attributes: `httpOnly: true`, `secure: true` (in production/HTTPS), `sameSite: "none"` (or `"lax"` in HTTP dev), `maxAge: 30 days`, `path: "/"`.
- **Cross-Cookie Reach**:
  - `authMiddleware.js:67-69` specifies:
    ```javascript
    const cookieConfig = COOKIE_NAMES[context] || COOKIE_NAMES.customer;
    const wpAuth = req.cookies?.[cookieConfig.auth] || (context === "customer" ? req.cookies?.mumbai_wp_auth : undefined);
    ```
  - For `context: "employee"`, only `req.cookies.mumbai_employee_auth` is inspected. A customer cookie stored under `mumbai_customer_auth` is completely ignored by employee routes.
  - **Cross-Token Injection Test**: If a customer takes their valid token from `mumbai_customer_auth` and sends it as `mumbai_employee_auth`, the server validates the session with WordPress, extracts `roles: ["customer"]`, and `roleMiddleware.js:16` returns HTTP 403 Forbidden. *(Proven in live test Scenario 3)*.

### 1.3 Session Cache & Deactivation
- **Session Cache Mechanism (`authMiddleware.js:20-23`)**:
  - Express caches validated sessions in an in-memory `Map` with `SESSION_CACHE_TTL = 60 * 1000` (60 seconds).
- **Deactivated Employee Window**:
  - When an admin deactivates an employee (`adminEmployeeController.js:260`), `invalidateUserSessionCache(targetUserId)` deletes the cached token from memory and tells WordPress to demote the user and call `WP_Session_Tokens::destroy_all()`.
  - **Multi-Instance / Serverless Vulnerability**: In a multi-server, PM2 cluster, or Vercel serverless environment, `sessionCache` is local to the worker process that handled the deactivation request. Other worker processes retain the cached session for up to **60 seconds**, allowing the deactivated employee to execute actions until the 60-second TTL expires.

### 1.4 Logout & Session Revocation
- **Logout (`authController.js:144-186`)**:
  - On `/api/auth/logout`, `invalidateSessionCache(wpAuth)` removes the local entry and dispatches a server-to-server call to `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/logout` to destroy the WordPress session token server-side.
  - Clear-cookie headers are then returned to remove `mumbai_employee_auth` and `mumbai_employee_nonce` from the browser.

### 1.5 Shared Counter Tablets & Storage PII
- **Idle Auto-Logout**: There is **no idle timeout mechanism** in `EmployeeAuthContext.jsx` or `App.jsx`. A tablet left unlocked at the counter remains logged in indefinitely (cookie lifetime 30 days).
- **Local Storage PII**: Code inspection confirmed that `localStorage` and `sessionStorage` are **never used** to store tokens, user details, or customer PII.
- **Mid-Form Expiry**: If an employee session expires while filling out `AddProduct.jsx`, the Axios 401 response interceptor (`employeeApi.js:42`) executes:
  ```javascript
  window.location.href = "/login";
  ```
  This immediately triggers a full-page reload, causing all unsaved draft inputs and staged image selections to be lost without warning.

### 1.6 CSRF Protection
- `csrfMiddleware.js` verifies the `Origin` header against the CORS allowlist for all mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`).
- **Raw Test Result**: A simulated cross-origin attack from `https://malicious-attacker.com` attempting to patch order status was blocked before reaching the application logic.

### 1.7 WordPress Capabilities of Staff Role
- `mumbai-auth.php:197-205` creates the `employee` role:
  ```php
  add_role('employee', 'Employee', [
      'read'         => true,
      'edit_posts'   => false,
      'delete_posts' => false,
  ]);
  ```
- **Vulnerability**: WordPress allows any user with the `read: true` capability to log into `/wp-admin/profile.php`. There is **no `admin_init` redirection** in `mumbai-auth.php` preventing employee accounts from accessing the WordPress administrative backend URL.

---

## PART 2 - AUTHORIZATION & PRIVILEGE ESCALATION

### 2.1 Route Privilege Escalation Matrix (Live Test Verified)
All 24 administrative endpoints in `apps/backend/src/routes/adminRoutes.js` were called using an authenticated Employee session (`roles: ["employee"]`).

**Live Test Results (Raw Logs)**:
```text
[RAW_TEST] ADMIN_ROUTE_CALL: GET /api/admin/overview as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: GET /api/admin/products as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: PUT /api/admin/products/123 as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: PATCH /api/admin/products/123 as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: DELETE /api/admin/products/123 as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: POST /api/admin/products as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: POST /api/admin/media/cleanup-orphans as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: GET /api/admin/customers as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: GET /api/admin/orders as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: PUT /api/admin/orders/123/status as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: PATCH /api/admin/orders/123/status as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: GET /api/admin/analytics as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: GET /api/admin/employees as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: POST /api/admin/employees/access as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: PATCH /api/admin/employees/123/approve as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: PATCH /api/admin/employees/123/reject as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: PATCH /api/admin/employees/123/status as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: POST /api/admin/employees/123/revoke-sessions as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: GET /api/admin/store-hours as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: PUT /api/admin/store-hours as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: PUT /api/admin/store-hours/peak-toggle as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: GET /api/admin/customer-suspension/lookup?email=user@test.com as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: POST /api/admin/customer-suspension/suspend as Employee -> HTTP 403
[RAW_TEST] ADMIN_ROUTE_CALL: POST /api/admin/customer-suspension/unsuspend as Employee -> HTTP 403
```
**Verdict**: **PASS**. All dedicated admin routes strictly enforce `requireRole(["administrator"])` and reject staff with HTTP 403.

### 2.2 Anonymous Access to Employee Endpoints (Live Test Verified)
All 15 employee endpoints in `apps/backend/src/routes/employeeRoutes.js` were called without credentials:
```text
[RAW_TEST] EMPLOYEE_ROUTE_ANON: GET /api/employee/overview as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: GET /api/employee/orders as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: PATCH /api/employee/orders/123/status as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: GET /api/employee/products as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: GET /api/employee/categories as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: POST /api/employee/categories as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: PUT /api/employee/categories/reorder as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: PUT /api/employee/categories/123 as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: POST /api/employee/products as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: PUT /api/employee/products/123 as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: PATCH /api/employee/products/123 as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: DELETE /api/employee/products/123 as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: DELETE /api/employee/media/123 as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: GET /api/employee/banners as Anonymous -> HTTP 401
[RAW_TEST] EMPLOYEE_ROUTE_ANON: PUT /api/employee/banners as Anonymous -> HTTP 401
```
**Verdict**: **PASS**. All employee routes strictly reject unauthenticated requests with HTTP 401.

### 2.3 Horizontal Authorization & Scoping
- **Order Scoping**: There is **no zone-based or employee-specific order partitioning**. Any authenticated employee can view and modify any customer order in the system.
- **Media Deletion Scoping**: `wordpressMediaService.js:2869` validates `uploaderId`. An employee can only delete pending media that they uploaded during their current session (`ownership_mismatch` rejects other employees).

### 2.4 Mass Assignment Analysis
- In `requestValidation.js`, schemas use `.passthrough()`.
- However, in `adminProductController.js:259-272` and `employeeController.js:435`, the controllers manually extract fields (`const { regular_price, sale_price, stock_quantity, stock_status, name } = req.body`) and build explicit payloads. Injected fields such as `role`, `isAdmin`, `customer_id`, or arbitrary `meta_data` are **not spread** into the WooCommerce call.
- **Verdict**: **SAFE** against mass assignment privilege escalation.

### 2.5 Field Allow-Lists & Unauthorized Powers
1. **Price Alteration**: Staff CAN modify `regular_price` and `sale_price` to arbitrary values via `PUT /api/employee/products/:id`.
2. **Catalog Deletion**: Staff CAN permanently delete products from the WooCommerce catalog via `DELETE /api/employee/products/:id` (`employeeRoutes.js:186`).
3. **Category Mutations**: Staff CAN create, rename, and reorder categories (`employeeRoutes.js:134-160`).
4. **Homepage Banner Defacement**: Staff CAN update homepage banners (`employeeRoutes.js:218`).

### 2.6 Internal Key Trust Architecture
- In `mumbai-auth.php:1315-1360`, the plugin validates `X-Mumbai-Internal-Key` using `hash_equals` against `MUMBAI_INTERNAL_API_KEY`.
- If the internal key is leaked, an attacker can supply `X-Mumbai-User-ID: 1` directly to WordPress endpoints and execute profile, order, and address operations as the Administrator without supplying a password.

---

## PART 3 - CUSTOMER-CONTROLLED DATA REACHING STAFF SCREENS

### 3.1 Stored XSS & Rendering Sinks
- **React Auto-Escaping**: In `Orders.jsx`, customer names, billing addresses, city, state, postal code, and order numbers are rendered as standard React JSX text children (e.g., `{selectedOrder.shipping?.address_1}`). React escapes HTML entities (`<`, `>`, `"`, `&`) automatically.
- **DOM Sinks Search**:
  - `dangerouslySetInnerHTML`: Found only in `customer-web` (`ProductDescription.jsx`, which sanitizes with DOMPurify) and `ConfirmModal.jsx` (inline CSS). **Zero usages in `apps/employee-panel`**.
  - `innerHTML`, `document.write`, `window.open`, `eval`: **Zero occurrences in `apps/employee-panel/src`**.
- **Href / Protocol Sinks**:
  - In `Orders.jsx:1549`: `href={`tel:${selectedOrder.phone}`}`
  - In `Orders.jsx:1572`: `href={`mailto:${selectedOrder.billing.email}`}`
  - If a customer supplies `javascript:alert(1)` as a phone or email, modern browsers will not execute script inside `tel:` or `mailto:` protocols. However, strict phone regex validation prevents injection of non-numeric characters.

### 3.2 CSV / Excel Formula Injection
- There is currently **no CSV or Excel export feature** in `apps/employee-panel`. Formula injection (`=cmd|...`, `@`, `+`, `-`) is currently not applicable.

### 3.3 Product Descriptions (HTML Handling)
- When a product is created or edited via `AddProduct.jsx` or `Products.jsx`, the employee submits plain text or HTML in `description`.
- In `apps/backend/src/controllers/adminProductController.js:472`, `description` is sent directly to WooCommerce **without server-side HTML sanitization**.
- In `customer-web/src/components/product/ProductDescription.jsx:11`, customer browsers render product descriptions using DOMPurify:
  ```javascript
  const sanitizedHtml = DOMPurify.sanitize(rawDescription, { USE_PROFILES: { html: true } });
  ```
  However, server-side sanitization on write is missing.

### 3.4 Image Upload Pipeline Hardening
The image upload pipeline was verified against attack vectors:
- **Magic Byte Verification (`imageValidator.js:24-73`)**: Rejects spoofed extensions. File must have valid binary headers for JPEG, PNG, GIF, or WebP.
- **Dimension & Decompression Bomb Guard (`imageValidator.js:137-160`)**: Enforces max dimension of 6000x6000 pixels.
- **Sharp Re-encoding (`imageProcessor.js` / `wordpressMediaService.js:27`)**: All images are re-encoded to WebP format, auto-rotated, stripped of EXIF metadata (clearing GPS coordinates), and constrained to 1600px max width/height before upload.
- **Live Test Scenario 9**: Validated rejection of SVG payloads (`<svg onload=alert(1)>`), PHP scripts, and corrupted polyglots. *(Status: PASS)*.

---

## PART 4 - ORDER WORKFLOW INTEGRITY (HIGHEST BUSINESS RISK)

### 4.1 Server-Enforced State Machine Deficiencies
- In `apps/backend/src/controllers/employeeController.js:404-438`, `updateOrderStatus` executes:
  ```javascript
  const { status } = req.body;
  if (!status || !ALLOWED_ORDER_STATUSES.includes(status)) {
    return res.status(400).json(...);
  }
  // Enforces 72h lock only
  const payload = buildOrderStatusPayload(status);
  const response = await api.put(`orders/${encodeURIComponent(id)}`, payload);
  ```
- **Vulnerabilities**:
  1. **Skipping States**: Staff can move an order directly from `pending` to `completed`.
  2. **Backward Moves**: Staff can move an order from `packed` back to `pending`.
  3. **Re-opening Completed Orders**: Staff can move an order that was marked `completed` back to `processing` or `pending` (if within 72 hours).
  4. **Arbitrary Status Override**: Any status in `ALLOWED_ORDER_STATUSES` (including `cancelled` and `refunded`) can be selected and sent to WooCommerce without supervisor approval.

### 4.2 Payment Coherence & Unpaid Orders
- `employeeController.js` does **NOT verify order payment status** before transitioning an order to `packed` or `completed`.
- Online orders (Razorpay) that are in `pending` or `failed` status can be marked `completed` by an employee, causing goods to be dispatched for unpaid orders.
- In `employeeController.js:528-533`, `getEmployeeOverview` queries `status: "processing"`. WooCommerce sets online orders to `processing` only when payment is captured. However, `getEmployeeOrders` allows searching and updating orders in ANY status.

### 4.3 The 72-Hour Delivery Lock Disparity
- **Backend Implementation (`orderStatusTransition.js:78-100`)**: Delivered orders are locked when 72 hours (259,200,000 ms) have elapsed based on `_delivery_completed_at` (or `date_completed_gmt`).
- **Frontend Implementation (`Orders.jsx:141`)**:
  ```javascript
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  return (now - timestamp) >= TWENTY_FOUR_HOURS_MS;
  ```
- **Finding**: The frontend UI locks status dropdowns after **24 hours**, while the backend allows changes up to **72 hours**. A staff member issuing a direct API request via cURL or Postman can modify delivered orders between 24h and 72h after delivery, bypassing the UI restriction.

### 4.4 Concurrency & Optimistic UI
- **Frontend Optimistic Rollback (`Orders.jsx:462-478`)**: The UI optimistically updates order status locally, tracking in-flight IDs in a `Set`. If the server rejects the request (e.g. HTTP 400 or network timeout), the UI rolls back `orders` state to `previousOrder` and displays an error toast. *(Verified in existing unit tests)*.
- **Server Concurrency**: The backend lacks database row locking or version check (`If-Match` / ETag) during order status updates. Simultaneous clicks by two employees result in last-write-wins.

### 4.5 Cash on Delivery (COD) Reconciliation
- There is **no cash collection field or ledger entry** required when marking a COD order as `completed`.
- There is no cash reconciliation screen in the employee panel to match courier cash collected against delivered orders.

---

## PART 5 - PRODUCTS & INVENTORY

### 5.1 Field Allow-Lists & Pricing Limits
- `adminProductController.js:65-126` enforces:
  - `name`: string, max 200 chars.
  - `regular_price`: non-negative finite number.
  - `sale_price`: non-negative finite number, must be `< regular_price`.
  - `stock_quantity`: non-negative integer.
  - `stock_status`: enum `["instock", "outofstock", "onbackorder"]`.
- **Finding**: There is **no price floor or sanity cap**. An employee can change a ₹5,000 product to ₹1, and the update will succeed.

### 5.2 Stock Overwrite vs Live Checkout (Lost Update)
- `adminProductController.js:264-273` sets stock via absolute assignment:
  ```javascript
  updatePayload.stock_quantity = stockNum;
  updatePayload.stock_status = stockNum <= 0 ? "outofstock" : "instock";
  await api.put(`products/${encodeURIComponent(id)}`, updatePayload);
  ```
- If an employee submits an inventory adjustment while an online customer is completing a purchase, the customer checkout stock reduction is overwritten by the employee's stale value.

### 5.3 Idempotency & Orphaned Media
- `AddProduct.jsx:311-315` generates a fresh UUID every time `handleSubmit` is called:
  ```javascript
  const idempotencyKey = crypto.randomUUID();
  ```
  If an employee clicks Submit, experiences network lag, and clicks Submit again, a new key is generated, bypassing `requireIdempotency` middleware and creating duplicate products.
- Product images uploaded before submitting (`AddProduct.jsx:95`) remain in the WordPress media library if the employee navigates away without saving.

---

## PART 6 - PII & DATA PROTECTION

### 6.1 API Response Over-Exposure
- `employeeController.js:296-378` packages the entire `o.billing`, `o.shipping`, `customer.email`, and `o.meta_data` array into every order object returned in the `orders` list query.
- Over-the-wire data includes customer IP addresses (`_customer_ip_address`), payment transaction tokens, and phone numbers before the staff member selects an individual order to inspect.

### 6.2 Browser Caching of PII
- Responses from `/api/employee/orders` and `/api/employee/overview` **omit `Cache-Control: no-store`**.
- On shared counter tablets, customer addresses and phone numbers can be cached on local disk by browser storage.

### 6.3 Scraping & Export Controls
- Pagination limit is capped at 100 orders per request (`employeeController.js:217`).
- There is no mass export endpoint in the employee panel.

---

## PART 7 - INSIDER THREAT & AUDIT TRAIL

### 7.1 Audit Logging Analysis
- `auditLogger.js:127-177` logs:
  - Timestamp, action name, target type/id, actor id, role, masked email (`e***h@...`), IP address, user agent, and redacted details.
  - Appends to persistent file `apps/backend/logs/audit.log` with 5MB file rotation (up to 5 backup files).
- **Mutating Actions Missing Audit Logs**:
  1. `updateEmployeeBanners` (`bannerController.js:59`): **ZERO audit logging**.
  2. `createCategory` (`adminCategoryController.js:61`): **ZERO audit logging**.
  3. `updateCategory` (`adminCategoryController.js:140`): **ZERO audit logging**.
  4. `reorderCategories` (`adminCategoryController.js:216`): **ZERO audit logging**.

### 7.2 Anomaly Alerting (`alertService.js`)
- `alertStaffAnomaly` is wired to Discord/Telegram webhooks.
- **Finding**: `alertStaffAnomaly` is **ONLY called** for payment gateway webhook anomalies (`paymentController.js`) and auto-refund failures (`reconciliationService.js`). It is **NEVER called** for staff anomalies:
  - No alert on bulk status changes.
  - No alert on price drops.
  - No alert on off-hours staff activity.
  - No alert on failed staff logins.

---

## PART 8 - REAL-WORLD USE ON A SHOP TABLET

### 8.1 Counter Tablet Usability & Operational Risks
1. **Missed New-Order Alerts**:
   - `Orders.jsx:268-299` pauses polling when `document.hidden` is true.
   - The employee panel has **no audio chimes (Web Audio API)** and **no browser notifications (Notification API)**. If the counter tablet screen sleeps or staff switches tabs, new orders arrive silently and can be missed for hours.
2. **Accidental Clicks (Mis-clicks)**:
   - On `Dashboard.jsx`, the "Pack" and "Dispatch" buttons trigger status changes on a **single click without a confirmation dialog**. On a greasy touch tablet, accidental taps immediately change order state.
3. **No Packing Slip / Invoice Printing**:
   - There is no print stylesheet (`@media print`) or packing slip template in `apps/employee-panel`. Staff cannot print receipts or labels directly from the SPA.

---

## PART 9 - SPA, HOSTING & BUILD

### 9.1 Hosting Security & Vercel Configuration
- **CRITICAL INFRASTRUCTURE DEFECT**:
  - `apps/employee-panel/vercel.json:5`:
    ```json
    {
      "rewrites": [
        {
          "source": "/api/:path*",
          "destination": "https://vacations-arising-bus-governor.trycloudflare.com/api/:path*"
        }
      ]
    }
    ```
  - `apps/admin-dashboard/vercel.json:5` has the exact same hardcoded tunnel rewrite.
  - Test-only ephemeral origins must never be committed to production deployment configs.
- **Missing HTTP Security Headers**:
  - `apps/employee-panel/vercel.json` contains no `headers` block.
  - Missing `X-Frame-Options: DENY` / `frame-ancestors 'none'` (Clickjacking vulnerability).
  - Missing `X-Content-Type-Options: nosniff`.
  - Missing `X-Robots-Tag: noindex, nofollow`.

### 9.2 Dependency Vulnerability Audit (`pnpm audit`)
- `apps/employee-panel`: 2 HIGH severity vulnerabilities found:
  - `nanoid <3.3.18`: Infinite loop in custom generators (`GHSA-2v37-7h3g-55p8`).
  - `source-map-js >=1.0.0 <1.2.2`: Event loop denial of service (`GHSA-68fv-2mgg-jv7q`).
- `apps/backend`: 0 high, 2 moderate vulnerabilities.

---

## PART 10 - TESTS & COVERAGE GAP

### 10.1 Existing Tests Summary
- `apps/backend/tests/employeeAccess.test.js`: Validates role checks, admin self-modification guards, email syntax, status validation, audit log masking. Mocks Express req/res.
- `apps/backend/tests/orderStatusLock.test.js`: Validates 72-hour delivery lock and status transition payloads.
- `apps/employee-panel/tests/*.test.js`: Validates client-side optimistic update rollbacks, timezone conversion in Asia/Kolkata, upload queue concurrency limits, and image compressor.

### 10.2 Untested Scenarios (Coverage Gaps)
- No automated negative test verifying payment status check before order fulfillment.
- No test verifying price change authorization limits for staff.
- No test verifying rejection of product deletion requests from employee tokens.
- No automated test asserting that `vercel.json` does not contain `trycloudflare.com`.

---

# SECTION A: ROLE / PERMISSION MATRIX

| Actor | Action / Endpoint | Expected | Actual | Evidence / Proof |
| :--- | :--- | :--- | :--- | :--- |
| **Anonymous** | `GET /api/employee/overview` | `401 Unauthorized` | `401 Unauthorized` | Live Test Scenario 1: `HTTP 401 {"message":"Authentication required."}` |
| **Anonymous** | `PATCH /api/employee/orders/:id/status`| `401 Unauthorized` | `401 Unauthorized` | Live Test Part 2: `HTTP 401` |
| **Anonymous** | `GET /api/employee/products` | `401 Unauthorized` | `401 Unauthorized` | Live Test Part 2: `HTTP 401` |
| **Customer** | `GET /api/employee/overview` | `401 / 403` | `401 Unauthorized` | Live Test Scenario 2: Cookie name isolation (`mumbai_customer_auth` ignored) -> `HTTP 401` |
| **Customer (Forged)**| Cookie as `mumbai_employee_auth` | `403 Forbidden` | `403 Forbidden` | Live Test Scenario 3: `roleMiddleware.js:16` -> `HTTP 403` |
| **Employee** | `GET /api/employee/overview` | `200 OK` | `200 OK` | `employeeRoutes.js:96` allows `employee` |
| **Employee** | `PATCH /api/employee/orders/:id/status`| `200 OK` (if valid) | `200 OK` | `employeeRoutes.js:113` allows `employee` |
| **Employee** | `GET /api/admin/overview` | `403 Forbidden` | `403 Forbidden` | Live Test Scenario 4: `adminRoutes.js:118` -> `HTTP 403` |
| **Employee** | `GET /api/admin/employees` | `403 Forbidden` | `403 Forbidden` | Live Test Scenario 5: `adminRoutes.js:226` -> `HTTP 403` |
| **Employee** | `DELETE /api/employee/products/:id` | `403 Forbidden` | **`200 OK (ALLOWED)`** | `employeeRoutes.js:186-192` mounts `deleteProduct` for `employee`! |
| **Employee** | `PUT /api/employee/products/:id` (Price) | `403 Forbidden` | **`200 OK (ALLOWED)`** | `employeeRoutes.js:171` mounts `updateProduct` with price fields! |
| **Employee** | `PUT /api/employee/banners` | `403 Forbidden` | **`200 OK (ALLOWED)`** | `employeeRoutes.js:218` mounts `updateEmployeeBanners` without role restriction |
| **Admin** | `GET /api/employee/overview` | `200 OK` | `200 OK` | `ALLOWED_EMPLOYEE_ROLES` includes `administrator` |
| **Deactivated Employee**| `GET /api/employee/overview` | `401 Unauthorized` | `401 Unauthorized` | Live Test Scenario 7: Session invalidated -> `HTTP 401 {"message":"Session expired."}` |

---

# SECTION B: ATTACK MATRIX

| # | Actor | Attack Vector | Exact Request | Expected | Actual | Verdict |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Anonymous | Panel Snooping | `GET /api/employee/overview` | `401` | `401` | **PASS** |
| **2** | Customer A | Cross-Context Escalation | `GET /api/employee/orders` with `mumbai_customer_auth` | `401` | `401` | **PASS** |
| **3** | Customer A | Cookie Substitution | `GET /api/employee/orders` with customer token in `mumbai_employee_auth` | `403` | `403` | **PASS** |
| **4** | Employee E1 | Admin Route Traversal | `GET /api/admin/employees` with employee token in `mumbai_admin_auth` | `403` | `403` | **PASS** |
| **5** | Employee E1 | Unauthorized Product Deletion | `DELETE /api/employee/products/123` | `403` | `200` | **FAIL** |
| **6** | Employee E1 | Malicious Price Manipulation | `PUT /api/employee/products/123` body: `{"regular_price":"1"}` | `403` | `200` | **FAIL** |
| **7** | Employee E1 | Fulfil Unpaid Razorpay Order | `PATCH /api/employee/orders/999/status` body: `{"status":"completed"}` | `400` | `200` | **FAIL** |
| **8** | Attacker | Cross-Origin CSRF Mutation | `PATCH /api/employee/orders/123/status` with `Origin: https://malicious.com` | `403` | `500 (CORS Error)` | **PASS (Blocked)** |
| **9** | Deactivated E | Persistent Session Replay | `GET /api/employee/overview` after session invalidation | `401` | `401` | **PASS** |
| **10**| Employee E1 | 72h Delivery Lock Bypass | `PATCH /api/employee/orders/225/status` on order delivered 73h ago | `400` | `400` | **PASS** |
| **11**| Employee E1 | 24h UI Lock API Bypass | `PATCH /api/employee/orders/225/status` on order delivered 30h ago | `400` | `200` | **FAIL** |
| **12**| Attacker | Upload Malicious SVG Payload | `POST /api/employee/upload` with `<svg onload=alert(1)>` | `400` | `400` | **PASS** |
| **13**| Attacker | Upload PHP Shell in Image | `POST /api/employee/upload` with `<?php system(...) ?>` | `400` | `400` | **PASS** |
| **14**| Attacker | Password Spraying Staff Accounts | Multiple `POST /api/auth/login` for different emails from same IP | `429` | `200/401 (Not throttled)` | **FAIL** |
| **15**| External | Ephemeral Tunnel Hijack | Staff API calls routed to `*.trycloudflare.com` via `vercel.json` | Internal URL | Hardcoded Tunnel URL | **FAIL** |

---

# SECTION C: RANKED FINDINGS (CRITICAL > HIGH > MEDIUM > LOW)

### [CRITICAL-01] Order Status Transition Lacks Payment Verification & State Machine Guard
- **Where**: [`apps/backend/src/controllers/employeeController.js:404-438`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/employeeController.js#L404-L438)
- **Problem**: `updateOrderStatus` checks only whether `status` is in `ALLOWED_ORDER_STATUSES` and whether the 72h lock applies. It does not inspect whether the order was paid, what the current order state is, or whether the transition is valid.
- **Scenario**: A malicious or deceived employee marks an unpaid online Razorpay order (in `pending` status) as `packed`, `out-for-delivery`, and `completed`. The dispatch rider delivers the goods without collecting any money.
- **Impact**: Direct financial loss and free inventory theft.
- **Fix**: In `updateOrderStatus`, inspect `currentOrder.status`, `currentOrder.payment_method`, and `currentOrder.date_paid`. For non-COD orders, reject transitions to `packed`/`out-for-delivery`/`completed` unless payment is verified. Enforce a strict state transition lookup table:
  `pending -> processing (paid only) -> packed -> out-for-delivery -> completed`.
- **How to verify**: Attempt `PATCH /api/employee/orders/:id/status` with `status: "completed"` on a pending Razorpay order; verify HTTP 400 rejection.
- **Effort**: **M**

---

### [CRITICAL-02] Catalog Price Alteration Permitted for Staff Roles
- **Where**: [`apps/backend/src/routes/employeeRoutes.js:171-184`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/employeeRoutes.js#L171-L184) & [`apps/backend/src/controllers/adminProductController.js:239-273`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminProductController.js#L239-L273)
- **Problem**: Employee router exposes `PUT /api/employee/products/:id` to `employee` role. `updateProduct` allows mutating `regular_price` and `sale_price`.
- **Scenario**: A dishonest store employee changes the price of an expensive product to ₹1, immediately purchases it from their personal customer account on their phone, and then changes the price back.
- **Impact**: Catalog price tampering, unauthorized discounts, revenue loss.
- **Fix**: In `employeeRoutes.js`, restrict price modifications to `requireRole(["administrator"])` or create a dedicated staff controller `updateProductStock` that strictly accepts only `stock_quantity` and `stock_status`.
- **How to verify**: Submit `PUT /api/employee/products/:id` with `{ "regular_price": "1" }` using employee cookie; assert HTTP 403 Forbidden.
- **Effort**: **S**

---

### [CRITICAL-03] Permanent Product Deletion Exposed to Employee Role
- **Where**: [`apps/backend/src/routes/employeeRoutes.js:186-192`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/employeeRoutes.js#L186-L192) & [`apps/employee-panel/src/pages/Products.jsx:406`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Products.jsx#L406)
- **Problem**: Despite line 118 commenting `// (No deletion allowed for employees)`, `router.delete("/products/:id", ...)` is mounted for `ALLOWED_EMPLOYEE_ROLES` (`["employee", "administrator"]`). Furthermore, `Products.jsx` displays a working Delete button.
- **Scenario**: A disgruntled or terminated employee clicks "Delete" on all catalog products before leaving their shift, permanently deleting products and their media from WooCommerce (`force: true`).
- **Impact**: Total catalog destruction, downtime, lost SEO and product sales data.
- **Fix**: Remove `router.delete("/products/:id")` from `employeeRoutes.js`. Restrict product deletion exclusively to `adminRoutes.js`. Hide the Delete button in `Products.jsx`.
- **How to verify**: Submit `DELETE /api/employee/products/:id` using employee cookie; assert HTTP 404/403.
- **Effort**: **S**

---

### [CRITICAL-04] Hardcoded Ephemeral Cloudflare Tunnel in `vercel.json`
- **Where**: [`apps/employee-panel/vercel.json:5`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/vercel.json#L5) & [`apps/admin-dashboard/vercel.json:5`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/vercel.json#L5)
- **Problem**: Rewrites `/api/:path*` to `https://vacations-arising-bus-governor.trycloudflare.com/api/:path*`.
- **Scenario**: When deployed to Vercel production, all employee panel requests are proxied to an ephemeral `trycloudflare.com` tunnel. When the tunnel closes, the panel fails completely with 502/DNS errors. If a third party claims that tunnel name, they can capture all staff session cookies and customer PII.
- **Impact**: Full application outage; potential Man-in-the-Middle token leakage.
- **Fix**: Update `vercel.json` to route `/api/:path*` to the production backend URL or remove the rewrite and rely on `VITE_API_URL`.
- **How to verify**: Inspect `vercel.json` and ensure no `trycloudflare.com` URLs exist.
- **Effort**: **S**

---

### [HIGH-01] Blind Stock Update Overwrites Live Checkout Sales (Lost Update)
- **Where**: [`apps/backend/src/controllers/adminProductController.js:264-273`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminProductController.js#L264-L273)
- **Problem**: `updateProduct` writes absolute `stock_quantity` without checking the current stock version or timestamp.
- **Scenario**: Product stock is 10. A staff member opens the edit drawer. A customer purchases 3 items (reducing stock to 7 in WooCommerce). The staff member types 9 and saves. WooCommerce sets stock to 9 instead of 6, wiping out the 3 customer purchases from inventory counts.
- **Impact**: Inventory discrepancies, overselling, stockout errors.
- **Fix**: Support atomic delta increments/decrements or require an expected version / ETag (`If-Match`) in the update payload.
- **How to verify**: Simulate concurrent stock update during checkout; verify conflict detection or delta application.
- **Effort**: **M**

---

### [HIGH-02] Homepage Banner Defacement & Phishing Redirection with Zero Audit Log
- **Where**: [`apps/backend/src/routes/employeeRoutes.js:218-224`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/employeeRoutes.js#L218-L224), [`apps/backend/src/controllers/bannerController.js:59-93`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/bannerController.js#L59-L93)
- **Problem**: Staff can update homepage banners without admin review. External links (`https://...`) are allowed by `sanitizeBannerLink`. No audit entry is logged.
- **Scenario**: An employee sets a homepage banner linking to a malicious third-party phishing site. Every customer visiting the shop homepage sees and clicks the banner. No log identifies which employee made the change.
- **Impact**: Brand reputation destruction, customer credential phishing.
- **Fix**: Restrict banner management to `adminRoutes.js` only. Validate banner URLs to internal shop routes only. Add `logAuditEvent`.
- **How to verify**: Call `PUT /api/employee/banners` as employee; verify HTTP 403.
- **Effort**: **S**

---

### [HIGH-03] Category Mutations Lack Audit Logging
- **Where**: [`apps/backend/src/controllers/adminCategoryController.js:61-280`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCategoryController.js#L61-L280)
- **Problem**: `createCategory`, `updateCategory`, and `reorderCategories` never invoke `logAuditEvent`.
- **Scenario**: Staff renames or disrupts category order on the storefront. Management has no log of who made the modification or what the previous state was.
- **Impact**: Lack of accountability; inability to reconstruct store state after internal tampering.
- **Fix**: Add `logAuditEvent` calls to all category mutation controller actions.
- **How to verify**: Create or update category; verify `logs/audit.log` appends `CATEGORY_CREATE` / `CATEGORY_UPDATE`.
- **Effort**: **S**

---

### [HIGH-04] Full Customer PII Sent in Orders List Query & Missing `no-store` Header
- **Where**: [`apps/backend/src/controllers/employeeController.js:296-388`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/employeeController.js#L296-L388)
- **Problem**: `getEmployeeOrders` returns full email, phone, street address, and raw `meta_data` for all 20 orders per page. API responses omit `Cache-Control: no-store`.
- **Scenario**: An employee browses the orders list on a shared counter tablet. An unauthorized person accesses the browser cache or inspects network logs to extract all customer contact details.
- **Impact**: DPDP Act / privacy non-compliance; data harvesting.
- **Fix**: Strip detailed PII (email, raw `meta_data`, full street address) from list responses. Return full details only when fetching a single order by ID (`GET /api/employee/orders/:id`). Add `res.set("Cache-Control", "no-store")`.
- **How to verify**: Inspect `GET /api/employee/orders` network response headers and payload structure.
- **Effort**: **M**

---

### [HIGH-05] Missing Pure IP-Level Rate Limiter on Authentication
- **Where**: [`apps/backend/src/middlewares/rateLimiter.js:96-110`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/middlewares/rateLimiter.js#L96-L110)
- **Problem**: `authLimiter` key is compound: `auth:${identifier}:${ip}`. An attacker on one IP can spray passwords across hundreds of staff accounts with 19 attempts each without triggering rate limiting.
- **Scenario**: Attacker sprays 10 common passwords against 50 staff email addresses from a single IP. All 500 requests succeed without being rate-limited.
- **Impact**: Staff credential compromise via password spraying.
- **Fix**: Add a secondary IP-only rate limiter (`ipAuthLimiter`: max 50 requests per 15 minutes per IP) in `authRoute.js`.
- **How to verify**: Send 51 login attempts with distinct emails from 1 IP; verify 51st request returns HTTP 429.
- **Effort**: **S**

---

### [MEDIUM-01] 24h Frontend Lock vs 72h Backend Status Lock Disparity
- **Where**: [`apps/employee-panel/src/pages/Orders.jsx:141`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Orders.jsx#L141) vs [`apps/backend/src/utils/orderStatusTransition.js:98`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/utils/orderStatusTransition.js#L98)
- **Problem**: Frontend disables status dropdown at >=24h after delivery, but backend accepts updates up to 72h.
- **Scenario**: Between hour 24 and hour 72, an order cannot be changed via UI, but any staff member can bypass the UI lock using a direct API request.
- **Impact**: Inconsistent business policy enforcement; false sense of UI security.
- **Fix**: Align both frontend and backend to the exact same constant (either 24 hours or 72 hours).
- **How to verify**: Test order status update at 36 hours via UI and API; verify consistent behavior.
- **Effort**: **S**

---

### [MEDIUM-02] Missing Audio Alert & Background Notification for New Orders
- **Where**: [`apps/employee-panel/src/pages/Orders.jsx:268-299`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Orders.jsx#L268-L299)
- **Problem**: Order polling stops completely when tab is hidden. There are no sound alerts or browser notifications.
- **Scenario**: Tablet screen sleeps or counter staff switches to another app. Multiple rush orders arrive and sit unattended for 45 minutes until staff re-opens the tab.
- **Impact**: Quick-commerce dispatch delays, customer complaints, canceled orders.
- **Fix**: Implement Web Audio API alert sound on order count increase and Web Notifications API support.
- **How to verify**: Place a test order while tab is open; confirm chime plays.
- **Effort**: **M**

---

### [MEDIUM-03] AddProduct Idempotency Key Re-Generated on Retry
- **Where**: [`apps/employee-panel/src/pages/AddProduct.jsx:311-319`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddProduct.jsx#L311-L319)
- **Problem**: `handleSubmit` generates a new UUID each time it is executed.
- **Scenario**: Staff clicks Submit on slow 4G. Request takes 8 seconds. Staff clicks Submit again. Second request uses a different idempotency key, causing two duplicate products to be created in WooCommerce.
- **Impact**: Duplicate catalog entries, inventory confusion.
- **Fix**: Generate and store the idempotency key in form state upon form initialization, preserving it across retries until success.
- **How to verify**: Double-click Submit on throttled network; confirm only 1 product is created.
- **Effort**: **S**

---

### [MEDIUM-04] Missing Security Headers on Employee Panel Host
- **Where**: [`apps/employee-panel/vercel.json`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/vercel.json)
- **Problem**: No `headers` configuration for CSP, Clickjacking (`X-Frame-Options`), MIME sniffing, or `X-Robots-Tag`.
- **Scenario**: Malicious site embeds the staff panel in a hidden `<iframe>` to perform clickjacking attacks on staff.
- **Impact**: Clickjacking, framing attacks, search engine indexing of internal panel URL.
- **Fix**: Add security headers section in `vercel.json`:
  ```json
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Robots-Tag", "value": "noindex, nofollow" }
      ]
    }
  ]
  ```
- **How to verify**: Run `curl -i` against employee panel host; check response headers.
- **Effort**: **S**

---

### [MEDIUM-05] Unrestricted `wp-admin` Access for `employee` Role in WordPress
- **Where**: [`mumbai-auth.php:197-205`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L197-L205)
- **Problem**: The WordPress role has `read: true` but lacks an admin dashboard redirection hook.
- **Scenario**: An employee browses to `https://store-domain.com/wp-admin/` and logs in with their credentials, accessing WordPress user profile tools.
- **Impact**: Exposure of WordPress underlying dashboard surface.
- **Fix**: In `mumbai-auth.php`, add an `admin_init` hook that redirects non-administrators to the frontend site.
- **How to verify**: Log in with employee account and navigate to `/wp-admin/`; confirm redirect.
- **Effort**: **S**

---

### [LOW-01] Missing Idle Auto-Logout on Shared Shop Tablet
- **Where**: [`apps/employee-panel/src/context/EmployeeAuthContext.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/context/EmployeeAuthContext.jsx)
- **Problem**: No inactivity timer logs out staff after 15–30 minutes of counter inactivity.
- **Impact**: Unauthorized actions performed by other staff or counter visitors on unlocked tablets.
- **Fix**: Add a 30-minute idle activity listener (resetting on `pointerdown`/`keydown`) that triggers `logout()` on timeout.
- **Effort**: **S**

---

### [LOW-02] 1-Click Instant Status Updates in Dashboard Console
- **Where**: [`apps/employee-panel/src/pages/Dashboard.jsx:111`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Dashboard.jsx#L111)
- **Problem**: Status changes from the overview dashboard happen instantly on click without a confirmation modal.
- **Impact**: Accidental status advancement on tablet touchscreens.
- **Fix**: Add a brief confirmation modal or undo toast for status changes triggered from the dashboard.
- **Effort**: **S**

---

### [LOW-03] Serial WooCommerce Order Pagination Loop in Backend
- **Where**: [`apps/backend/src/controllers/employeeController.js:275-283`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/employeeController.js#L275-L283)
- **Problem**: Serial `while` loop fetches up to 20 pages (2,000 orders) one-by-one over HTTP when filtering by custom delivery status or location.
- **Impact**: High response latency (5–15 seconds) and CPU load on WooCommerce when custom filters are applied.
- **Fix**: Push status and location filtering upstream into WordPress/WooCommerce SQL queries via custom meta query endpoint.
- **Effort**: **M**

---

# SECTION D: TOP 10 FIXES IN PRIORITY ORDER

### Before Launch (Immediate Blocker)
1. **Fix 1 [CRITICAL-04]**: Remove hardcoded `trycloudflare.com` tunnel rewrite from `apps/employee-panel/vercel.json` and `apps/admin-dashboard/vercel.json`.
2. **Fix 2 [CRITICAL-03]**: Remove `DELETE /api/employee/products/:id` from `employeeRoutes.js` and remove the delete button from `Products.jsx`.
3. **Fix 3 [CRITICAL-02]**: Remove price fields (`regular_price`, `sale_price`) from employee product update permissions; restrict price editing to administrators.
4. **Fix 4 [CRITICAL-01]**: Enforce strict server-side order state machine and verify payment capture before allowing status updates to `packed` or `completed`.
5. **Fix 5 [HIGH-02]**: Remove `PUT /api/employee/banners` from `employeeRoutes.js`; restrict banner editing to administrators.

### First Month (Post-Launch Hardening)
6. **Fix 6 [HIGH-05]**: Add pure IP-level rate limiting on `/api/auth/login` to prevent password spraying.
7. **Fix 7 [HIGH-04]**: Strip full PII (email, address, raw metadata) from order list responses; add `Cache-Control: no-store`.
8. **Fix 8 [HIGH-03]**: Add structured audit logging (`logAuditEvent`) to all Category mutations in `adminCategoryController.js`.
9. **Fix 9 [MEDIUM-04]**: Add security headers (`X-Frame-Options`, `X-Robots-Tag: noindex`) to `employee-panel/vercel.json`.
10. **Fix 10 [MEDIUM-02]**: Add Web Audio API alert chime on the employee panel to notify counter staff of incoming orders.

---

# SECTION E: NOT TESTED LIST & OWNER ACTION ITEMS

The following items could not be executed autonomously in this local environment without external live services or production dashboard credentials:

### Exact Steps for Site Owner
1. **WordPress Role & Capability Audit (wp-admin)**:
   - Log into WordPress `wp-admin` -> Users -> Roles.
   - Inspect the capabilities assigned to the `employee` role. Confirm that `manage_woocommerce`, `edit_products`, `publish_products`, and `view_woocommerce_reports` are NOT assigned.
2. **WordPress Plugin Nonce & REST Security**:
   - In WordPress admin, ensure `X-Mumbai-Internal-Key` is defined as a strong 64-character random string in `wp-config.php` and matches `.env`.
3. **Cloudflare / Vercel Production Settings**:
   - In Cloudflare Dashboard, verify that `employee.mumbaicollection.in` has WAF rules restricting access to Indian IP ranges or requires Cloudflare Zero Trust (Access) OTP/PIN.
   - In Vercel Project Settings, confirm that Environment Variables (`VITE_API_URL`) point to the authoritative production Node.js API and not preview branches.
4. **Razorpay Dashboard Webhooks**:
   - Check Razorpay Dashboard -> Settings -> Webhooks.
   - Verify that webhook secret matches `RAZORPAY_WEBHOOK_SECRET` in production `.env`.
5. **Brevo Email / SMS Delivery**:
   - Verify sender domain verification (SPF, DKIM, DMARC) in Brevo dashboard to ensure OTP and staff notification emails are delivered without spam filtering.

---

### Audit Completion Status
- **Source Inspection**: 100% Complete (Read-only, zero code modified).
- **Deliverable**: `AUDIT_EMPLOYEE_PANEL.md` created in root workspace.
- **Awaiting User Instruction**: Which finding would you like to fix first? Fixes will be applied strictly one at a time, displaying the `git diff` after each change.
