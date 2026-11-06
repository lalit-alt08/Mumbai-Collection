# Employee Panel Audit: Feature 05 — Categories & Merchandising

> **Feature Scope**: Top-Level Department Taxonomy, Storefront Drag & Drop Reordering, and Visual Merchandising  
> **Target Audience**: Technical Architects, Backend Developers, and System Auditors  
> **Authoritative Baseline**: WordPress Taxonomy (`product_cat`), WooCommerce HPOS, and Redis Batch Invalidation  
> **Date**: November 2026

---

## 1. High-Level Architecture & System Role

The **Categories** feature (`/categories/add`) manages top-level departments across Mumbai Collection. It enables floor staff and merchandising leads to define primary storefront departments, upload category banner iconography, and control the exact visual display sequence shown on the customer storefront via interactive drag-and-drop and touch controls.

```mermaid
flowchart TD
    subgraph Frontend["Employee Console (React + Vite PWA)"]
        UI["AddCategory.jsx (940 Lines)"]
        DnD["Drag & Drop + Mobile Touch Controls"]
        Form["AddCategoryForm.jsx & UpdateCategoryModal.jsx"]
        ClientAPI["employeeApi.js: getCategories(), reorderCategories(), updateCategory()"]

        UI --> DnD
        UI --> Form
        UI --> ClientAPI
    end

    subgraph BFF["Node.js Backend (Express BFF)"]
        Auth["requireAuth('employee') & requireRole(['employee', 'administrator'])"]
        Idemp["requireIdempotency Middleware"]
        CatRoutes["employeeRoutes.js: /categories, /categories/reorder, /categories/:id"]
        CatCtrl["adminCategoryController.js: getAdminCategories(), reorderCategories()"]
        BatchCache["serverCache (invalidateAllCategoryCaches)"]

        ClientAPI -->|GET /api/employee/categories| Auth --> CatRoutes --> CatCtrl
        ClientAPI -->|POST /api/employee/categories/reorder| Auth --> Idemp --> CatRoutes --> CatCtrl
        ClientAPI -->|PUT /api/employee/categories/:id| Auth --> Idemp --> CatRoutes --> CatCtrl
        CatCtrl --> BatchCache
    end

    subgraph WordPress["WordPress / WooCommerce Backend (PHP)"]
        WCRestCat["WooCommerce REST API v3 (/wp-json/wc/v3/products/categories)"]
        TaxonomyDB["wp_terms, wp_term_taxonomy, wp_termmeta (product_cat)"]
        MenuOrder["menu_order Term Meta Field"]

        CatCtrl -->|PUT menu_order batch| WCRestCat --> TaxonomyDB
        WCRestCat --> MenuOrder
    end
```

---

## 2. Frontend Layer (React + Tailwind CSS)

### 2.1 File Map & Responsibilities
- **Primary Page Component**: [`apps/employee-panel/src/pages/AddCategory.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx) *(940 lines)*
- **Add Form Component**: [`apps/employee-panel/src/components/category/AddCategoryForm.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/components/category/AddCategoryForm.jsx)
- **Reorder List Item**: [`apps/employee-panel/src/components/category/CategoryOrderItem.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/components/category/CategoryOrderItem.jsx)
- **Update Modal**: [`apps/employee-panel/src/components/category/UpdateCategoryModal.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/components/category/UpdateCategoryModal.jsx)
- **System Category Banner**: [`apps/employee-panel/src/components/category/SystemCategoryCard.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/components/category/SystemCategoryCard.jsx)
- **API Client**: [`apps/employee-panel/src/services/employeeApi.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/services/employeeApi.js)

---

### 2.2 Deep Logic & Implementation Details

#### A. Separation of Storefront Departments vs Subcategories
In [`AddCategory.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L104-L121):
- WooCommerce lumps root categories and subcategories into a single flat taxonomy (`product_cat`).
- The frontend separates them into distinct functional scopes using memoized filters:
  - **Storefront Categories (Lines 106–109)**: Top-level departments only (`!category.parent || Number(category.parent) === 0`) and excludes the system `uncategorized` term.
  - **Subcategories (Lines 111–114)**: Child categories (`Number(category.parent) > 0`).
  - **System Categories (Lines 118–120)**: Term `uncategorized`.
- Reordering operations operate strictly on root departments so subcategories are never accidentally elevated to root navigation bars.

#### B. HTML5 Drag-and-Drop & Mobile Touch Reordering
In [`AddCategory.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L167-L245):
- **Desktop HTML5 DnD (Lines 167–221)**:
  - `handleDragStart`: Records `draggedIndexRef.current` and sets drag effect to `move`.
  - `handleDragOver`: Prevents default browser drop behavior and highlights the target insertion line via `dragOverIndex`.
  - `handleDrop`: Splices the dragged item out of its original position and inserts it at the target slot.
- **Mobile Touch Fallback (Lines 223–245)**:
  - Because HTML5 drag events are unsupported or clunky on mobile capacitive touchscreens, each item renders dedicated `↑` and `↓` touch buttons (`handleMoveCategory`).
  - Shifts elements up or down by 1 index safely within storefront boundary limits.

#### C. Debounced Persistence & Conflict Retry Queue
In [`AddCategory.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L248-L290):
- Reordering an array can generate dozens of state updates in seconds if a user drags an item across the list.
- **Queued In-Flight State (`queuedOrderRef.current`)**: Buffers the latest full list order.
- **Debounce Timer (300ms)**: Only triggers `reorderCategories({ category_ids: [...] })` after the user has paused dragging, preventing database thrashing.
- **Optimistic State with 409 Conflict Retry**: If a concurrent staff member modified categories, the queue automatically re-fetches the live catalog and retries.

#### D. System "Uncategorized" Protection
In [`AddCategory.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L97-L102) and [`SystemCategoryCard.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/components/category/SystemCategoryCard.jsx):
- Detects the default WooCommerce `uncategorized` slug.
- Disables rename, delete, and reorder controls for this category.
- Displays a permanent lock badge explaining that WooCommerce requires this fallback bucket for uncategorized inventory.

---

## 3. Node.js BFF (Backend For Frontend) Layer

### 3.1 File Map & Responsibilities
- **Routes Definition**: [`apps/backend/src/routes/employeeRoutes.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/employeeRoutes.js#L186-L216)
- **Controller Implementation**: [`apps/backend/src/controllers/adminCategoryController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCategoryController.js#L586-L650)
- **Cache Eviction Batcher**: [`apps/backend/src/controllers/adminCategoryController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCategoryController.js#L51-L85)

---

### 3.2 Deep Logic & Implementation Details

#### A. RBAC & Idempotency Pipeline
In [`apps/backend/src/routes/employeeRoutes.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/employeeRoutes.js#L186-L216):
- All category mutations (`POST /categories`, `POST /categories/reorder`, `PUT /categories/:id`) enforce:
  1. `requireAuth("employee")`
  2. `requireRole(["employee", "administrator"])`
  3. `requireIdempotency`: Caches mutation tokens to eliminate duplicate insertions.
  4. Joi Schema Validation: `schemas.categoryCreate`, `schemas.categoryReorder`, `schemas.categoryUpdate`.

#### B. Batch Category Reordering (`reorderCategories`)
In [`adminCategoryController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCategoryController.js#L586-L650):
- Takes an array of numeric `category_ids` in the intended display order.
- Validates that IDs are distinct, positive integers without duplicates.
- Executes WooCommerce category updates, setting each category's `menu_order` property equal to its index (`0, 1, 2, ...`).
- **Atomic Cache Flush (`invalidateAllCategoryCaches`)**:
  Purges all related cache prefixes across both customer storefront and employee panels:
  - `admin:categories`
  - `categories:all`
  - `categories:tree`
  - `customer:categories:*`
  - `customer:home:*`

---

## 4. WordPress & WooCommerce Backend Layer (PHP)

### 4.1 File Map & Responsibilities
- **WooCommerce Taxonomy Controller**: Core `WC_REST_Product_Categories_Controller`
- **Database Tables**:
  - `wp_terms`: Term IDs, names, and sanitized slugs.
  - `wp_term_taxonomy`: Taxonomy classification (`taxonomy = 'product_cat'`) and `parent` ID hierarchy.
  - `wp_termmeta`: Merchandising display order (`meta_key = 'order'` or `menu_order`).

---

### 4.2 Deep Logic & Implementation Details

#### A. Storefront Menu Ordering
WooCommerce category display queries order terms by `menu_order ASC, name ASC`. When `reorderCategories` updates the `menu_order` field:
- The customer homepage department carousel reflects the exact custom order configured by staff.
- Newly created categories default to `menu_order = 0`, placing them at the beginning of the list until explicitly repositioned by floor staff.

---

## 5. End-to-End Category Reordering Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Merchandiser / Clerk
    participant UI as AddCategory.jsx (React)
    participant BFF as adminCategoryController.js (Express)
    participant Cache as serverCache (Redis / In-Memory)
    participant WP as WooCommerce REST API (PHP)
    participant DB as MySQL (wp_term_taxonomy / wp_termmeta)

    Staff->>UI: Drags "Watches" above "Electronics"
    UI->>UI: Optimistically updates UI list order
    UI->>UI: Debounces network call by 300ms
    UI->>BFF: POST /api/employee/categories/reorder { category_ids: [42, 18, 99, ...] }
    
    BFF->>BFF: Validate non-empty, unique numeric array
    loop For each category ID
        BFF->>WP: PUT /wp-json/wc/v3/products/categories/:id { menu_order: index }
        WP->>DB: UPDATE wp_termmeta SET meta_value = index WHERE term_id = :id
    end
    
    BFF->>Cache: invalidateAllCategoryCaches()
    Cache-->>BFF: Caches purged (admin:categories, customer:home:*)
    BFF-->>UI: 200 OK { success: true }
    UI->>UI: Set isSavingOrder = false
    UI-->>Staff: Displays success toast: "Category order updated"
```

---

## 6. Deep Logic Code Index

| Component | File Path | Line Range | Functional Responsibility |
| :--- | :--- | :--- | :--- |
| **Storefront Filter** | [`AddCategory.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L104-L121) | `L104-L121` | Separates root departments (`parent === 0`) from subcategories and uncategorized |
| **Drag & Drop Engine** | [`AddCategory.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L167-L221) | `L167-L221` | HTML5 drag-and-drop event handlers (`dragStart`, `dragOver`, `drop`) |
| **Mobile Touch Mover** | [`AddCategory.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L223-L245) | `L223-L245` | Touch-safe `↑` and `↓` buttons shifting items 1 position in storefront list |
| **Debounced Order Queue** | [`AddCategory.jsx`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/employee-panel/src/pages/AddCategory.jsx#L248-L290) | `L248-L290` | 300ms debounce buffer preventing database thrashing during rapid reorders |
| **BFF Router** | [`employeeRoutes.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/routes/employeeRoutes.js#L186-L216) | `L186-L216` | Route protection, idempotency enforcement, and validation schemas |
| **Reorder Controller** | [`adminCategoryController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCategoryController.js#L586-L650) | `L586-L650` | Batch assignment of `menu_order` across WooCommerce category IDs |
| **Cache Invalidation** | [`adminCategoryController.js`](file:///c:/Users/asus/Desktop/Mumbai%20Collection/apps/backend/src/controllers/adminCategoryController.js#L51-L85) | `L51-L85` | Multi-prefix cache eviction across customer and staff consoles |
