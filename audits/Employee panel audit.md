# Mumbai Collection: Employee Panel Technical Audit

> **Scope**: End-to-End Architectural, Frontend, Backend, and Database Audits of all Employee Panel Features  
> **Repository Baseline**: Monorepo (`apps/employee-panel`, `apps/backend`, `mumbai-auth.php`)  
> **Target Audience**: Core Engineering Team, Solutions Architects, and Security Auditors  
> **Date**: November 2026

---

## Audit Index & Feature Modules

| Module # | Feature Name | Primary Route | Audit File | Status |
| :---: | :--- | :--- | :--- | :---: |
| **01** | **Operational Dashboard** | `/` | [`Employee panel audit/01_Dashboard.md`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Employee%20panel%20audit/01_Dashboard.md) | **Completed** |
| **02** | **Orders & Dispatch Pipeline** | `/orders` | [`Employee panel audit/02_Orders_and_Dispatch.md`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Employee%20panel%20audit/02_Orders_and_Dispatch.md) | **Completed** |
| **03** | **Product Inventory & Stock** | `/products` | [`Employee panel audit/03_Products_and_Stock.md`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Employee%20panel%20audit/03_Products_and_Stock.md) | **Completed** |
| **04** | **Add New Product** | `/products/add` | [`Employee panel audit/04_Add_Product.md`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Employee%20panel%20audit/04_Add_Product.md) | **Completed** |
| **05** | **Categories & Merchandising** | `/categories/add` | [`Employee panel audit/05_Categories.md`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Employee%20panel%20audit/05_Categories.md) | **Completed** |
| **06** | **Subcategories & Mapping** | `/subcategories` | [`Employee panel audit/06_Subcategories.md`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Employee%20panel%20audit/06_Subcategories.md) | **Completed** |
| **07** | **Homepage Banners** | `/banners` | [`Employee panel audit/07_Homepage_Banners.md`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Employee%20panel%20audit/07_Homepage_Banners.md) | **Completed** |
| **08** | **Counter Mode & WakeLock** | Global | [`Employee panel audit/08_Counter_Mode_and_WakeLock.md`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Employee%20panel%20audit/08_Counter_Mode_and_WakeLock.md) | **Completed** |

---

## Feature 01: Operational Dashboard Summary

The **Employee Dashboard** is the counter and warehouse fulfillment engine. Key architectural mechanisms audited in detail:
- **Frontend**: [`apps/employee-panel/src/pages/Dashboard.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/Dashboard.jsx)
  - Inflight promise deduplication via `AbortController`.
  - Background visibility-aware polling (30s) that stops when tab is hidden and restarts on focus.
  - Delta-based synthesized 2-tone audio chime (880 Hz -> 1174 Hz) via Web Audio API.
  - Screen Wake Lock (`useWakeLock.js`) to keep warehouse tablet displays alive.
  - 1-click status advancement buttons (`PACK NOW`, `DISPATCH`, `MARK DELIVERED`).
  - Unpaid online order shield withholding dispatch actions on pending Razorpay transactions.
- **Node.js BFF**: [`apps/backend/src/controllers/employeeController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/employeeController.js)
  - `getEmployeeOverview` using 90-second in-memory caching (`serverCache`).
  - Parallel asynchronous queries across HPOS orders, low stock items, and IST-bounded daily counts.
  - Strict fulfillment task force priority sorting (`processing` > `packed` > `out-for-delivery`).
- **WordPress HPOS Backend**: [`mumbai-auth.php`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/mumbai-auth.php)
  - Direct MySQL aggregation query joining `wp_wc_orders` and `wp_wc_orders_meta` on `_delivery_status`.
  - Application-level distributed lock using MySQL `GET_LOCK(SHA2('staff-order:<id>', 256), 3)` to prevent concurrent packing collisions.
  - Optimistic concurrency verification using `expected_modified` vs `modified_gmt`.

*Full deep-dive report with Mermaid sequence diagrams, architecture topologies, and line-by-line code index available in [**`Employee panel audit/01_Dashboard.md`**](file:///c:/Users/asus/Desktop/Mumbai%20Collection/Employee%20panel%20audit/01_Dashboard.md).*
