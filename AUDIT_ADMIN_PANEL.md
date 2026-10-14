# Comprehensive Security & Architectural Audit: Administrator Panel
**Target System**: `apps/admin-dashboard` (React 19 SPA) & Backend Administrative Gateway  
**Auditor**: Principal Engineer & Application-Security Reviewer  
**Date**: October 12, 2026  
**Status**: READ-ONLY AUDIT COMPLETE — FIX NOTHING UNTIL EXPLICITLY INSTRUCTED  

---

## Executive Summary & Threat Profile

The Administrator Panel (`apps/admin-dashboard`) represents the crown jewels of the Mumbai Collection e-commerce system. Unlike the counter staff panel, which focuses primarily on rapid packing and dispatch, the Admin Panel holds total existential authority over the store:
- **Financial Intelligence**: Complete historical and live store revenue, sales trends, average order value (AOV), top customer spending, and payment reconciliation.
- **Identity & Access Governance**: Approving new employees, deactivating staff accounts, immediately killing employee sessions, and managing the staff allowlist.
- **Customer Account Enforcement**: Temporarily or permanently suspending customer accounts.
- **Store Operations**: Overriding physical store operating hours (forcing immediate closure or re-opening) and toggling dynamic peak-hour delivery ETAs for quick commerce.
- **Catalog Authority**: Creating, adjusting, and permanently deleting products and WordPress media.

### Primary Threat Personas Considered:
1. **Malicious or Compromised Administrator**: A disgruntled store manager or hijacked administrator credentials.
2. **Horizontal / Vertical Privilege Escalator**: A curious counter employee or customer attempting to cross into admin routes.
3. **Phished or Session-Hijacked Admin Device**: An administrator accessing the dashboard from a shared or unhardened laptop/PC.
4. **Third-Party Network Attacker / MitM**: An external adversary discovering administrative endpoints or exploiting hosting misconfigurations.

---

## Key Audit Summary Table

| Finding ID | Severity | Area | Problem Summary | Remediation Effort |
| :--- | :--- | :--- | :--- | :---: |
| **[CRITICAL-01]** | **CRITICAL** | Hosting / Network | Ephemeral Cloudflare tunnel in `apps/admin-dashboard/vercel.json` | **S** |
| **[CRITICAL-02]** | **CRITICAL** | Auth & Session | Admin session cookie valid for 30 days without re-auth or idle timeout | **S** |
| **[HIGH-01]** | **HIGH** | Governance / Audit | Missing input validation & zero audit logging on Store Operating Hours mutations | **S** |
| **[HIGH-02]** | **HIGH** | Privacy & PII | Customer directory exposes unmasked PII on bulk list queries without `no-store` | **M** |
| **[HIGH-03]** | **HIGH** | Account Control | Customer suspension fails to destroy active WordPress sessions server-side | **S** |
| **[HIGH-04]** | **HIGH** | Financial Integrity | Payment reconciliation mutation (`reconcileOrder`) lacks audit trail | **S** |
| **[MEDIUM-01]** | **MEDIUM** | Architecture | Category management routes completely missing from `adminRoutes.js` | **S** |
| **[MEDIUM-02]** | **MEDIUM** | Usability / Ops | Admin Dashboard has no UI Order Management screen despite backend mount | **M** |
| **[MEDIUM-03]** | **MEDIUM** | Inventory | Blind stock updates overwrite live customer checkout sales (lost update race) | **M** |
| **[MEDIUM-04]** | **MEDIUM** | Audit Visibility | No Audit Log viewer in Admin Dashboard (logs trapped on backend disk) | **M** |
| **[LOW-01]** | **LOW** | Privacy / Caching | Missing `Cache-Control: no-store` on Executive Overview & Sales Analytics | **S** |
| **[LOW-02]** | **LOW** | Auth Semantics | Public registration endpoint accepts `context: "admin"` and issues admin cookie name | **S** |

---

## PART 0 - MAP: Screens, APIs, Roles, and Data Flow

### 0.1 Screen to API Endpoint Mapping
| Screen / View | Frontend Component (`file:line`) | Backend Endpoint | Method | Request Payload / Parameters | Role Required |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin Login** | [`Login.jsx:47`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Login.jsx#L47) | `/api/auth/login` | `POST` | `{ email, password, context: "admin" }` | Public |
| **Session Verification** | [`AdminAuthContext.jsx:16`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/context/AdminAuthContext.jsx#L16) | `/api/auth/me?context=admin` | `GET` | Cookie: `mumbai_admin_auth` | `administrator` |
| **Logout** | [`AdminLayout.jsx:39`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/layouts/AdminLayout.jsx#L39) | `/api/auth/logout` | `POST` | `{ context: "admin" }` | `administrator` |
| **Executive Overview** | [`Overview.jsx:32`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Overview.jsx#L32) | `/api/admin/overview` | `GET` | Optional: `?refresh=true` | `administrator` |
| **Payment Reconciliation** | [`Overview.jsx:47`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Overview.jsx#L47) | `/api/payments/reconcile/:id` | `POST` | Path param: `id` (Order ID) | `administrator` |
| **Products Inventory** | [`Products.jsx:86`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Products.jsx#L86) | `/api/admin/products` | `GET` | `page, per_page, search, stock_status` | `administrator` |
| **Quick Adjust Product** | [`Products.jsx:21`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Products.jsx#L21) | `/api/admin/products/:id` | `PUT` | `{ regular_price, sale_price, stock_quantity, stock_status }` | `administrator` |
| **Permanent Product Delete**| [`Products.jsx:20`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Products.jsx#L20) | `/api/admin/products/:id` | `DELETE` | Path param: `id` | `administrator` |
| **Customer Directory** | [`Customers.jsx:24`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Customers.jsx#L24) | `/api/admin/customers` | `GET` | `page, per_page, search, location` | `administrator` |
| **Customer Suspension Lookup**|[`CustomerSuspension.jsx:65`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/CustomerSuspension.jsx#L65)| `/api/admin/customer-suspension/lookup` | `GET` | `?email=...` | `administrator` |
| **Suspend Customer** | [`CustomerSuspension.jsx:100`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/CustomerSuspension.jsx#L100)| `/api/admin/customer-suspension/suspend` | `POST` | `{ email, duration, reason }` | `administrator` |
| **Unsuspend Customer** | [`CustomerSuspension.jsx:155`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/CustomerSuspension.jsx#L155)| `/api/admin/customer-suspension/unsuspend` | `POST` | `{ email }` | `administrator` |
| **Staff Directory** | [`Employees.jsx:66`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Employees.jsx#L66) | `/api/admin/employees` | `GET` | `search, status` | `administrator` |
| **Request / Allowlist Staff**| [`Employees.jsx:102`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Employees.jsx#L102)| `/api/admin/employees/access` | `POST` | `{ email, role: "employee", notes }` | `administrator` |
| **Approve Staff** | [`Employees.jsx:127`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Employees.jsx#L127)| `/api/admin/employees/:id/approve` | `PATCH` | `{ role: "employee" }` | `administrator` |
| **Reject Staff Request** | [`Employees.jsx:130`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Employees.jsx#L130)| `/api/admin/employees/:id/reject` | `PATCH` | `{ reason }` | `administrator` |
| **Deactivate / Reactivate Staff**|[`Employees.jsx:133`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Employees.jsx#L133)| `/api/admin/employees/:id/status` | `PATCH` | `{ status: "deactivated" \| "active" }` | `administrator` |
| **Kill Staff Sessions** | [`Employees.jsx:139`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Employees.jsx#L139)| `/api/admin/employees/:id/revoke-sessions`| `POST` | Path param: `id` | `administrator` |
| **Sales Analytics & Reports** | [`Analytics.jsx:28`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/Analytics.jsx#L28) | `/api/admin/analytics` | `GET` | Optional: `?refresh=true` | `administrator` |
| **Store Hours Configuration** | [`StoreHours.jsx:18`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/StoreHours.jsx#L18) | `/api/admin/store-hours` | `GET` | None | `administrator` |
| **Update Store Schedule** | [`StoreHours.jsx:19`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/StoreHours.jsx#L19) | `/api/admin/store-hours` | `PUT` | `{ schedule, manual_override, ... }` | `administrator` |
| **Toggle Peak Hours ETA** | [`StoreHours.jsx:20`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/src/pages/StoreHours.jsx#L20) | `/api/admin/store-hours/peak-toggle` | `PUT` | `{ is_peak_hours, ... }` | `administrator` |
| **Admin Orders List (Unmapped UI)**| N/A (Backend only) | `/api/admin/orders` | `GET` | `page, per_page, search, status` | `administrator` |
| **Admin Order Status Override**| N/A (Backend only) | `/api/admin/orders/:id/status` | `PUT/PATCH` | `{ status }` | `administrator` |

---

### 0.2 Role & Permission Matrix (As Implemented)

| Route / Capability | Anonymous | Customer Cookie | Employee Cookie | Administrator Cookie | Enforced By |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `POST /api/auth/login` | **Allow (200)** | **Allow (200)** | **Allow (200)** | **Allow (200)** | Public |
| `GET /api/auth/me?context=admin` | **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `authMiddleware.js` (`mumbai_admin_auth` required) |
| `GET /api/admin/overview` | **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `requireAuth("admin")` + `requireRole(["administrator"])` |
| `GET /api/admin/products` | **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `requireAuth("admin")` + `requireRole(["administrator"])` |
| `PUT /api/admin/products/:id` | **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `requireAuth("admin")` + `requireRole(["administrator"])` |
| `DELETE /api/admin/products/:id` | **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `requireAuth("admin")` + `requireRole(["administrator"])` |
| `GET /api/admin/customers` | **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `requireAuth("admin")` + `requireRole(["administrator"])` |
| `POST /api/admin/customer-suspension/*`| **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `requireAuth("admin")` + `requireRole(["administrator"])` |
| `POST /api/admin/employees/*` | **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `requireAuth("admin")` + `requireRole(["administrator"])` |
| `PUT /api/admin/store-hours*` | **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `requireAuth("admin")` + `requireRole(["administrator"])` |
| `POST /api/payments/reconcile/:id` | **Deny (401)** | **Deny (401)** | **Deny (401)** | **Allow (200)** | `requireAuth("admin")` + `requireRole(["administrator"])` |
| WordPress `/wp-json/mumbai-auth/v1/admin/*`| **Deny (401)** | **Deny (401)** | **Deny (401)** | **Deny (401)** | `mumbai_internal_server_permission` (Key required) |

*Key Takeaway*: The multi-cookie isolation architecture strictly prevents Customer and Employee cookies from touching Admin routes. `requireAuth("admin")` inspects ONLY `req.cookies["mumbai_admin_auth"]`. If an employee makes a request using their staff cookie, the server rejects it immediately with HTTP 401 without even consulting the database.

---

### 0.3 Side Effects of Administrator Actions

1. **Product Deletion (`DELETE /api/admin/products/:id`)**:
   - Permanently deletes product from WooCommerce catalog with `{ force: true }`.
   - Purges associated product reviews, ratings, and sales links in WooCommerce.
   - Triggers `deleteMediaIfUnreferenced` to delete unattached product images from the WordPress media library.
   - Clears in-memory caches: `admin_products:*`, `product_stock_counts`, `catalog:*`.
   - Writes `PRODUCT_DELETE` entry to `logs/audit.log`.

2. **Employee Approval (`PATCH /api/admin/employees/:id/approve`)**:
   - Calls WordPress REST endpoint `mumbai-auth/v1/admin/employees/approve`.
   - Modifies user role to `employee`.
   - Calls `WP_Session_Tokens::get_instance($user_id)->destroy_all()`.
   - Clears in-memory session cache via `invalidateUserSessionCache(targetUserId)`.
   - Writes `employee.approved` entry to `logs/audit.log`.

3. **Employee Deactivation (`PATCH /api/admin/employees/:id/status`)**:
   - Demotes user role from `employee` to `customer`.
   - Immediately kills all active WordPress sessions (`destroy_all()`).
   - Clears Node.js in-memory session cache.
   - Writes `employee.deactivated` entry to `logs/audit.log`.

4. **Customer Suspension (`POST /api/admin/customer-suspension/suspend`)**:
   - Sets user metadata `_mumbai_customer_suspended = 'yes'` and stores expiration timestamp.
   - Clears Node.js 60-second in-memory session cache.
   - **Does NOT** destroy active WordPress session tokens (Customer remains logged in, but blocked from checkout and reviews).
   - Writes `customer.suspended` entry to `logs/audit.log`.

5. **Store Hours Override (`PUT /api/admin/store-hours`)**:
   - Persists operating schedule or manual override (`open`, `closed`, `auto`) to WordPress options.
   - Re-evaluates instant shop status in Asia/Kolkata timezone.
   - Public customer storefront immediately respects new status on next fetch (disabling or enabling cart checkout).
   - **Does NOT** write an audit entry to `logs/audit.log` (**Defect**).

6. **Payment Reconciliation (`POST /api/payments/reconcile/:id`)**:
   - Queries Razorpay API to inspect payment status for the order's Razorpay order ID.
   - Verifies that captured amount in paise exactly matches WooCommerce total in paise.
   - If captured, transitions WooCommerce order status from `pending`/`on-hold` to `processing`.
   - Clears in-memory overview and customer caches.
   - **Does NOT** write an audit entry to `logs/audit.log` (**Defect**).

---

## PART 1 - ADMIN AUTH & SESSION SECURITY

### 1.1 Login & Rate Limiting
- **Brute-Force & Spray Protection**:
  - Protected by dual-layer rate limiting:
    1. `ipAuthLimiter` ([`rateLimiter.js:115-128`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/middlewares/rateLimiter.js#L115-L128)): Max 60 attempts per 15 minutes per IP.
    2. `authLimiter` ([`rateLimiter.js:96-112`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/middlewares/rateLimiter.js#L96-L112)): Max 20 attempts per identifier+IP per 15 minutes.
  - Mitigates brute-force attacks and password spraying attempts against administrator accounts.

### 1.2 Cookie Security & Separation
- **Cookie Name**: `mumbai_admin_auth` (and `mumbai_admin_nonce`).
- **Flags**: `HttpOnly: true`, `Path: /`, `SameSite: none` (or `lax` in HTTP development), `Secure: true` in production/HTTPS.
- **Isolation Verification**: Complete separation. Customer cookie (`mumbai_customer_auth`) and staff cookie (`mumbai_employee_auth`) cannot authenticate administrative requests.
- **Vulnerability [CRITICAL-02]**: The cookie is configured with `maxAge: 30 * 24 * 60 * 60 * 1000` (30 full days).
  - An administrative session remaining active for a month on a browser creates extreme risk of physical device compromise or credential retention.
  - There is no idle inactivity timer or requirement for password re-entry prior to high-consequence operations (such as permanently deleting catalog products or revoking employees).

### 1.3 Logout & Session Termination
- **Logout Execution ([`authController.js:144-167`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/authController.js#L144-L167))**:
  - Immediately purges session from Node.js in-memory `sessionCache`.
  - Dispatches upstream call to `/wp-json/mumbai-auth/v1/logout` to destroy the WordPress session token server-side.
  - Clears `mumbai_admin_auth` and `mumbai_admin_nonce` cookies in the browser.
  - Tested: Token cannot be re-used after logout.

### 1.4 Web Storage & PII Inspection
- `apps/admin-dashboard` was audited across all `.jsx` and `.js` source files:
  - **Zero usages of `localStorage`**.
  - **Zero usages of `sessionStorage`**.
  - State is managed strictly in React memory (`AdminAuthContext`) and validated against HttpOnly cookies. No customer PII or administrator credentials persist in client-side web storage.

---

## PART 2 - AUTHORIZATION, PRIVILEGE ESCALATION & MASS ASSIGNMENT

### 2.1 Route Protection & Role Verification
- All endpoints mounted in `adminRoutes.js` are wrapped in the dual middleware chain:
  ```javascript
  requireAuth("admin"),
  requireRole(["administrator"])
  ```
- **Self-Modification & Privilege Demotion Guards**:
  - In [`adminEmployeeController.js:110-115`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminEmployeeController.js#L110-L115): Administrators cannot approve, reject, or deactivate their own user account.
  - In [`mumbai-auth.php:3417-3420`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L3417-L3420): WordPress rejects any attempt to modify roles for accounts that hold the `administrator` role.
  - In [`mumbai-auth.php:4149-4155`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L4149-L4155): Customer suspension strictly rejects targets holding `administrator` or `employee` roles.

### 2.2 Mass Assignment & Payload Filtering
- **Product Updates ([`adminProductController.js:259-273`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminProductController.js#L259-L273))**:
  - Rather than spreading `req.body` directly into WooCommerce (`api.put(..., req.body)`), the controller constructs an explicit allowlist dictionary:
    ```javascript
    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name.trim();
    if (regular_price !== undefined) updatePayload.regular_price = String(regular_price);
    if (sale_price !== undefined) updatePayload.sale_price = sale_price ? String(sale_price) : "";
    if (stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== "") {
      updatePayload.manage_stock = true;
      updatePayload.stock_quantity = stockNum;
      updatePayload.stock_status = stockNum <= 0 ? "outofstock" : "instock";
    }
    ```
  - Arbitrary fields (e.g. `meta_data`, `customer_id`, `id`, `reviews_allowed`) passed in `req.body` are discarded.

### 2.3 Internal Key Authentication (`mumbai-auth.php`)
- All server-to-server calls from Node.js to WordPress (`wp.get`, `wp.post`) include:
  ```
  X-Mumbai-Internal-Key: process.env.MUMBAI_INTERNAL_API_KEY
  ```
- WordPress validates the key using `hash_equals` ([`mumbai-auth.php:1354`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L1354)), preventing timing side-channel attacks.
- Endpoint capability check `mumbai_internal_server_permission` ensures external browser requests directly reaching WordPress cannot execute admin actions without this server secret.

---

## PART 3 - CUSTOMER/USER-CONTROLLED DATA REACHING ADMIN SCREENS

### 3.1 Stored XSS & DOM Sink Audit
- Customer names, addresses, suspension reasons, product descriptions, and staff notes are displayed across multiple admin screens:
  - **Sinks Scanned**: `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `window.open`, `eval()`.
  - **Result**: **0 unsafe sinks identified**. All customer inputs rendered in `Overview.jsx`, `Customers.jsx`, `Employees.jsx`, and `CustomerSuspension.jsx` are bound via standard React 19 JSX `{variable}` expressions, which are automatically HTML-escaped by the React engine.

### 3.2 CSV / Excel Formula Injection
- Audit checked whether the Admin Panel features export buttons (e.g. Export Customers to CSV / Export Revenue to Excel).
- **Result**: **No export functionality currently exists**. Formula injection (`=cmd|' /C ...'!A0`) is not an active attack surface.

### 3.3 Media Upload Pipeline Security
- Handled in [`adminRoutes.js:55-110`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/adminRoutes.js#L55-L110):
  - **File Size Cap**: Hard 10MB limit enforced by Multer.
  - **MIME Allowlist**: JPEG, PNG, WebP, GIF.
  - **Magic Byte Verification**: Passed to [`validateImageBuffer`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/utils/imageValidator.js) inspecting the first bytes on the memory buffer.
  - **Rate Limiting**: `uploadLimiter` attached to `/api/admin/upload`.
  - **Filename Sanitization**: Uploaded buffers are renamed with randomized UUIDs and processed via WordPress media service, eliminating directory traversal (`../`) and polyglot PHP execution risks.

---

## PART 4 - FINANCIAL & REVENUE METRICS ACCURACY

### 4.1 Revenue Integrity & Voided Orders Policy
- In [`adminAnalyticsController.js:16-28`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminAnalyticsController.js#L16-L28):
  ```javascript
  const INVALID_ORDER_STATUSES = new Set(["pending", "cancelled", "failed", "refunded", "trash"]);
  ```
  - Orders in `pending`, `cancelled`, `failed`, `refunded`, or `trash` are strictly excluded from Total Revenue, Today Sales, Month Sales, and Average Order Value calculations.
  - Respects the quick-commerce custom metadata `_delivery_status` so orders delivered by riders are credited accurately.

### 4.2 Timezone Accounting
- Evaluated against `Asia/Kolkata` (IST):
  - [`adminAnalyticsController.js:72-95`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminAnalyticsController.js#L72-L95) uses `Intl.DateTimeFormat` with `timeZone: "Asia/Kolkata"` to anchor "Today Sales" and "Month Sales" to Indian Standard Time midnight rather than UTC midnight.
  - Eliminates the classic midnight boundary shift where orders placed between 12:00 AM and 5:30 AM IST would otherwise register on the previous day.

### 4.3 Payment Reconciliation Security
- Tested in [`paymentController.js:1309-1416`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/paymentController.js#L1309-L1416):
  - An admin can reconcile failed/stalled online orders via `POST /api/payments/reconcile/:id`.
  - The controller queries Razorpay for the captured payment and asserts:
    ```javascript
    if (capturedPayment.amount !== expectedAmountPaise) {
      return res.status(409).json({ anomaly: "AMOUNT_MISMATCH", ... });
    }
    ```
  - Prevents an admin or attacker from manually reconciling an order that had an incorrect or discounted capture amount.
  - **Vulnerability [HIGH-04]**: When reconciliation updates the order to `processing`, `logAuditEvent` is not called.

---

## PART 5 - PRODUCTS, INVENTORY & CATEGORY MANAGEMENT

### 5.1 Concurrency & Lost Update Race Condition
- **Vulnerability [MEDIUM-03]**:
  - In [`adminProductController.js:264-273`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminProductController.js#L264-L273), updating product stock writes the absolute integer:
    ```javascript
    updatePayload.stock_quantity = stockNum;
    ```
  - If a customer places an order while the admin is editing the product details, the customer's sale decrements stock in WooCommerce, but the admin's submit overwrites WooCommerce with the older cached stock number.

### 5.2 Category Routes Disparity
- **Vulnerability [MEDIUM-01]**:
  - `adminCategoryController.js` contains complete category CRUD and drag-and-drop reordering logic.
  - However, this controller is mounted **only** in `employeeRoutes.js` at `/api/employee/categories`!
  - `adminRoutes.js` has **zero** category endpoints mounted. The executive Admin Dashboard has no Categories screen.

---

## PART 6 - PII & DATA PROTECTION

### 6.1 Customer Directory Over-Exposure
- **Vulnerability [HIGH-02]**:
  - Endpoint `GET /api/admin/customers` returns full customer records for 20 customers per page:
    - Customer primary phone number
    - Secondary phone number
    - Full physical residential address
    - Total lifetime rupees spent
    - Email address
  - Unlike the single customer inspection modal, the bulk list does not mask phone numbers or addresses.
  - Omission of `Cache-Control: no-store` allows intermediate caching or browser disk persistence of customer databases.

### 6.2 Customer Suspension Session Invalidation
- **Vulnerability [HIGH-03]**:
  - In [`mumbai-auth.php:4182`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php#L4182):
    ```php
    // Store suspension metadata (sessions are NOT destroyed)
    ```
  - When an admin suspends a customer, their WordPress session tokens remain active.
  - While checkout is blocked by `req.isSuspended`, the customer is not logged out and can continue accessing addresses and profile data.

---

## PART 7 - INSIDER THREAT & AUDIT TRAIL

### 7.1 Mutating Actions Audit Coverage

| Mutating Action | Controller / Line | Audit Event Logged? | Action Code in Log |
| :--- | :--- | :---: | :--- |
| **Product Create** | [`adminProductController.js:505`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminProductController.js#L505) | **YES** | `PRODUCT_CREATE` |
| **Product Quick Adjust** | [`adminProductController.js:280`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminProductController.js#L280) | **YES** | `PRODUCT_UPDATE` |
| **Product Permanent Delete**| [`adminProductController.js:339`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminProductController.js#L339) | **YES** | `PRODUCT_DELETE` |
| **Staff Access Request** | [`adminEmployeeController.js:76`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminEmployeeController.js#L76) | **YES** | `employee.access_requested` |
| **Staff Approval** | [`adminEmployeeController.js:141`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminEmployeeController.js#L141) | **YES** | `employee.approved` |
| **Staff Rejection** | [`adminEmployeeController.js:198`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminEmployeeController.js#L198) | **YES** | `employee.rejected` |
| **Staff Status Change** | [`adminEmployeeController.js:262`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminEmployeeController.js#L262) | **YES** | `employee.deactivated` / `reactivated` |
| **Staff Sessions Revocation**| [`adminEmployeeController.js:316`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminEmployeeController.js#L316) | **YES** | `employee.sessions_revoked` |
| **Customer Suspension** | [`adminCustomerSuspensionController.js:87`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCustomerSuspensionController.js#L87) | **YES** | `customer.suspended` |
| **Customer Unsuspension** | [`adminCustomerSuspensionController.js:148`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCustomerSuspensionController.js#L148) | **YES** | `customer.unsuspended` |
| **Store Hours Modification**| [`adminStoreHoursController.js:37`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminStoreHoursController.js#L37) | **NO [HIGH-01]** | None |
| **Peak Hours Toggle** | [`adminStoreHoursController.js:71`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminStoreHoursController.js#L71) | **NO [HIGH-01]** | None |
| **Payment Reconciliation** | [`paymentController.js:1373`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/paymentController.js#L1373) | **NO [HIGH-04]** | None |
| **Admin Order Status Override**| [`adminOrderController.js:149`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminOrderController.js#L149) | **YES** | `ADMIN_ORDER_STATUS_UPDATE` |

### 7.2 Audit Log Visibility
- **Vulnerability [MEDIUM-04]**: All entries write directly to `logs/audit.log` via Winston/Pino. There is no API route or UI interface within the Admin Dashboard for the store owner to view recent audit entries, track employee activations, or monitor status changes without direct server terminal access.

---

## PART 8 - HOSTING, ENVIRONMENT & CLOUD INTEGRATION

### 8.1 Vercel & Reverse Proxy Configuration
- In [`apps/admin-dashboard/vercel.json:14`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/admin-dashboard/vercel.json#L14):
  - Rewrites proxy `/api/:path*` to `https://vacations-arising-bus-governor.trycloudflare.com/api/:path*`.
  - While necessary for local cross-device tunnel testing before purchasing Hostinger, this ephemeral tunnel must be updated to the production backend host upon deployment.

### 8.2 Security Headers
- Security headers added:
  - `X-Frame-Options: DENY` (Clickjacking mitigation)
  - `X-Content-Type-Options: nosniff` (MIME sniffing mitigation)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Robots-Tag: noindex, nofollow` (Prevents search engine crawling of private admin URL)

---

## SECTION D: TOP FIXES IN PRIORITY ORDER

### Priority 1: High-Risk Security & Governance (Immediate Hardening)
1. **Fix 1 [HIGH-01]**: Add input validation schemas (`storeHours`, `peakHoursToggle`) to `requestValidation.js` and add `logAuditEvent` calls to `updateAdminStoreHours` and `toggleAdminPeakHours`.
2. **Fix 2 [HIGH-03]**: In `mumbai-auth.php:4182`, immediately destroy WordPress sessions (`WP_Session_Tokens::get_instance($user->ID)->destroy_all()`) upon customer account suspension.
3. **Fix 3 [HIGH-04]**: Add `logAuditEvent` (`PAYMENT_RECONCILED`) to `paymentController.js:reconcileOrder` recording actor ID, order ID, and Razorpay payment ID.
4. **Fix 4 [HIGH-02]**: Add `Cache-Control: no-store, no-cache, must-revalidate, private` to `getAdminCustomers`, `getDashboardOverview`, and `getAdminAnalytics`.

### Priority 2: Operational Consistency & Architecture
5. **Fix 5 [MEDIUM-01]**: Mount `adminCategoryController.js` routes (`/categories`, `/categories/:id`, `/categories/reorder`) in `adminRoutes.js` under `requireRole(["administrator"])`.
6. **Fix 6 [LOW-02]**: Restrict `POST /api/auth/register` to always issue `context = "customer"` cookies, rejecting public registration requests attempting to request `context: "admin"`.
7. **Fix 7 [MEDIUM-04]**: Implement a secure read-only audit log inspection endpoint (`GET /api/admin/audit-logs`) to let store owners inspect administrative and staff actions directly.

---

## SECTION E: NOT TESTED LIST & OWNER ACTION ITEMS

The following operations require live administrative production credentials or physical hardware:
1. **Hostinger Production Deployment**:
   - Update `vercel.json` rewrites or Vite `.env` (`VITE_API_URL`) to point to the authoritative Hostinger domain rather than `trycloudflare.com`.
2. **Brevo Production SMTP / SMS Verification**:
   - Verify that staff notification emails and OTPs are not caught in spam filters.
3. **Razorpay Live Dashboard Webhook Secret**:
   - Confirm that the Razorpay webhook secret in production matches `RAZORPAY_WEBHOOK_SECRET` in `.env`.
