# PRE-LAUNCH DUE-DILIGENCE AUDIT REPORT: MUMBAI COLLECTION
**Role:** Principal Engineer, Application-Security Lead, SRE & Conversion/UX Auditor  
**Date:** 2026-10-08  
**Target:** Mumbai Collection E-Commerce Platform (`apps/backend`, `apps/customer-web`, `apps/employee-panel`, `apps/admin-dashboard`, `mumbai-auth.php`)  
**Commit/Branch:** `feature/durable-payments-and-verification`  

---

## SECTION A: EXECUTIVE SUMMARY

### 1. Overall Pre-Launch Verdict
**VERDICT: READY WITH FIXES (Conditional Approval)**  
The codebase exhibits unusually strong defenses in several core areas—including atomic deferred-order creation with Razorpay, image magic-byte and decompression bomb validation via Sharp, CSRF origin verification, and structured Pino logging with automatic PII/credential redaction. However, several high-priority architectural and security items must be resolved prior to public launch, specifically:
1. IP-spoofing header bypass in rate limiting (`CF-Connecting-IP` without upstream proxy validation).
2. Critical/High CVEs in dependencies (`proxy-addr` CVE IP spoofing, Axios vulnerabilities).
3. Synchronous, blocking execution of order finalization inside the Razorpay webhook receiver risking 5s gateway timeout loops.
4. Auto-approval of unmoderated, non-buyer product reviews allowing star-rating manipulation.
5. Missing mobile zoom accessibility (WCAG 1.4.4 violation) and placeholder social graph (OG/Twitter) metadata.
6. Untracked status for `.env` files currently committed to git history in web apps.

---

### 2. Domain Health Scores (/10)

| Domain | Area | Score (/10) | Status | Primary Constraint / Concern |
|---|---|:---:|:---:|---|
| **01** | Authentication & Sessions | **8 / 10** | PASS WITH FIXES | In-memory session cache desync across multi-instance nodes; IP rate-limit spoofing. |
| **02** | Authorization | **8 / 10** | PASS WITH FIXES | Employees can transition orders to `cancelled`/`refunded` without restriction. |
| **03** | Input Handling & Web Vulns | **8 / 10** | PASS WITH FIXES | Incomplete regex sanitization for product reviews; outdated DOMPurify version. |
| **04** | Transport, Secrets & Deps | **6 / 10** | ACTION REQUIRED | Critical CVE in `proxy-addr`, 10 High CVEs in Axios; committed `.env` files in git. |
| **05** | Payments & Checkout Integrity | **8 / 10** | PASS WITH FIXES | Webhook handler blocks synchronously on WooCommerce API; phone number dummy fallback (`9999999999`). |
| **06** | Business Logic & Abuse | **7 / 10** | PASS WITH FIXES | Unmoderated review spam affects product star ratings; missing strict order state transition graph. |
| **07** | Data Layer | **7 / 10** | PASS | High MySQL `wp_options` lock contention during flash sales; application-level relational integrity. |
| **08** | Backend Reliability & SRE | **7 / 10** | PASS WITH FIXES | In-memory cache/rate-limit state lost on restarts; background cron timers inactive in serverless environments. |
| **09** | Frontend Performance | **8 / 10** | PASS | Catalog endpoint (`/api/products`) hardcoded to 50 items and ignores pagination query parameters. |
| **10** | Mobile & Cross-Browser | **8 / 10** | PASS WITH FIXES | Viewport disables zoom (`user-scalable=no`); excellent mobile UPI app-switch recovery. |
| **11** | Observability & Logging | **9 / 10** | PASS | Pino structured logging with request ID tracing and automated field redaction. |
| **12** | Accessibility (A11Y) | **7 / 10** | PASS WITH FIXES | Disabling pinch-to-zoom violates WCAG 2.1 SC 1.4.4; some icon buttons require aria-labels. |
| **13** | SEO & Social Sharing | **5 / 10** | ACTION REQUIRED | Pure CSR SPA with no dynamic SSR/prerender; placeholder `yourdomain.com` Open Graph tags. |
| **14** | Legal, Privacy & Compliance | **8 / 10** | PASS | Mandatory policies present; account deletion flow implemented; GST tax breakdown needed on invoices. |
| **15** | Third-Party Integrations | **8 / 10** | PASS | Fail-closed Brevo email and Razorpay integrations; circuit breaking on upstream WordPress. |
| **16** | Operations, Deploy & CI/CD | **6 / 10** | ACTION REQUIRED | CI lacks `pnpm audit`, code linters, and PHP syntax validation for 4600-line `mumbai-auth.php`. |
| **17** | Search & Catalog Scale | **8 / 10** | PASS | Cached search queries with debounce, but catalog listing needs pagination fix. |
| **18** | Admin & Back-Office Ops | **9 / 10** | PASS | Robust role separation (`administrator` vs `employee`), audit logging with actor tracking. |
| **19** | Conversion Rate & UX | **9 / 10** | PASS | OTP barrier removed per UX requirement; smooth responsive checkout; clear minimum order feedback. |

**Platform Aggregate Quality Score: 7.6 / 10**

---

### 3. Top 10 Priority Risks (Ordered by Business Impact)

1. **R-01 [Financial / Availability] Synchronous Webhook Processing Blocks on WooCommerce (Domain 05 / 08)**  
   *Impact:* Razorpay requires webhook responses within 5 seconds. `paymentController.js:1104` calls `finalizePaymentAndCreateOrder` synchronously inside the webhook receiver. If WooCommerce takes > 5s, Razorpay marks the webhook failed and triggers rapid retries, leading to lock contention and temporary service degradation.
2. **R-02 [Security] IP-Based Rate Limiting Spoofable via Forged `CF-Connecting-IP` (Domain 01 / 04)**  
   *Impact:* `rateLimiter.js:10` trusts `req.headers["cf-connecting-ip"]` without validating whether the connection originated from Cloudflare IP ranges. An attacker can send arbitrary IP headers to bypass login, checkout, and catalog rate limits.
3. **R-03 [Security] Critical Vulnerability in `proxy-addr` & High CVEs in `axios` (Domain 04)**  
   *Impact:* `pnpm audit` identifies 1 Critical CVE in `proxy-addr` (IP spoofing via IPv4-mapped IPv6) and 10 High CVEs in `axios` (<1.20.0, SSRF/Header Injection).
4. **R-04 [Reputation / Fraud] Unmoderated Product Reviews with Immediate Public Impact (Domain 06 / 03)**  
   *Impact:* `reviewController.js:342` forces `status: "approved"` for any authenticated customer, and allows non-purchasers to rate products. A malicious user can submit fake 1-star or 5-star reviews across the entire catalog with zero admin moderation.
5. **R-05 [SRE / Distributed State] In-Memory Cache and Rate Limiter Single Points of Failure (Domain 08)**  
   *Impact:* Session authentication cache (`authMiddleware.js`), rate limiting maps (`rateLimiter.js`), and catalog caches (`memoryCache.js`) live exclusively in Node.js process memory. Multi-instance horizontal scaling or container restarts cause cache invalidation misses and reset rate counters.
6. **R-06 [Operations / Compliance] Committed `.env` Files in Git History (Domain 04)**  
   *Impact:* `apps/customer-web/.env` and `apps/employee-panel/.env` are tracked in git repository index (`git ls-files`). Exposes development URLs, Client IDs, and internal structure in source control.
7. **R-07 [Business / Catalog] Unpaginated Products Endpoint Breaks Browse Experience Beyond 50 SKUs (Domain 09 / 17)**  
   *Impact:* `productController.js:16` calls `fetchProducts()` with a fixed limit of 50 and ignores `req.query.page`. When catalog expands beyond 50 products, customers cannot view remaining inventory.
8. **R-08 [Conversion / Social] Placeholder Open Graph Metadata & Zero Dynamic SEO for Products (Domain 13)**  
   *Impact:* `customer-web/index.html:16` contains dummy `https://yourdomain.com/` tags. Sharing links on WhatsApp or social media displays generic broken previews, hurting click-through rates.
9. **R-09 [Accessibility / Mobile UX] Viewport Disables Pinch-To-Zoom (Domain 10 / 12)**  
   *Impact:* `index.html:6` includes `user-scalable=no, maximum-scale=1.0`. Fails WCAG 2.1 SC 1.4.4; visually impaired users cannot zoom in on product text or images.
10. **R-10 [Operations / Reliability] Missing PHP Syntax Check in CI for `mumbai-auth.php` (Domain 16)**  
    *Impact:* `mumbai-auth.php` contains 4,638 lines of PHP code handling authentication, transients, and locks. CI (`ci.yml`) runs zero PHP linting or syntax tests. A single typo will trigger a fatal PHP White Screen of Death (WSOD) on WordPress upon deployment.

---

## SECTION B: DETAILED FINDINGS

```
================================================================================
CRITICAL SEVERITY FINDINGS
================================================================================
```

### [SEC-01] Critical IP Spoofing in Dependency (`proxy-addr`) via Express
- **Domain:** 04 - Transport, Headers, Secrets & Dependencies
- **Severity:** Critical
- **Confidence:** Confirmed (Verified via `pnpm audit`)
- **Where:** `apps/backend/package.json` (`express` -> `proxy-addr@2.0.7`)
- **Evidence / Command Output:**
  ```text
  pnpm audit --audit-level critical
  Package: proxy-addr
  Vulnerable versions: >=1.1.0 <2.0.8
  Patched versions: >=2.0.8
  Paths: .>express>proxy-addr
  Advisory: https://github.com/advisories/GHSA-jqcg-44mw-7w3h
  Severity: 1 critical
  ```
- **Problem:** Subnet parsing vulnerability in `proxy-addr` allows spoofing client IP addresses using IPv4-mapped IPv6 trust subnets.
- **Scenario:** An attacker connects through an IPv4-mapped IPv6 header payload, bypassing `req.ip` subnet checks and spoofing administrative or trusted addresses.
- **Impact:** Compromises IP-based authentication guards, audit logs, and rate limiting.
- **Fix:** Add a pnpm `pnpm.overrides` entry in root or backend `package.json` to force `proxy-addr: ">=2.0.8"`, then run `pnpm install`.
- **Verify:** Run `pnpm audit --audit-level critical` inside `apps/backend`; expect 0 critical vulnerabilities.
- **Effort:** Small (15 minutes).

---

```
================================================================================
HIGH SEVERITY FINDINGS
================================================================================
```

### [SEC-02] IP-Based Rate Limiting Bypass via Unvalidated `CF-Connecting-IP`
- **Domain:** 01 - Authentication & Sessions / 04 - Transport & Headers
- **Severity:** High
- **Confidence:** Confirmed (Verified in source code)
- **Where:** `apps/backend/src/middlewares/rateLimiter.js:9-15`
- **Evidence / Code:**
  ```javascript
  // apps/backend/src/middlewares/rateLimiter.js:9-15
  export const getClientIp = (req) => {
    const cfIp = req?.headers?.["cf-connecting-ip"];
    if (typeof cfIp === "string" && cfIp.trim()) {
      return cfIp.trim();
    }
    return req?.ip || req?.socket?.remoteAddress || "unknown";
  };
  ```
- **Problem:** The backend trusts the `CF-Connecting-IP` header blindly from ANY client without verifying that the request originated from an authentic Cloudflare reverse-proxy IP address or that Cloudflare is active.
- **Scenario:** An attacker wanting to brute-force customer passwords or flood the checkout endpoint sends a different forged header on every request:
  `CF-Connecting-IP: 103.21.244.X`. The in-memory limiter creates a new bucket for each forged IP, completely neutralizing `authLimiter`, `checkoutLimiter`, and `catalogLimiter`.
- **Impact:** Brute-force attacks, SMS/email spam abuse, and credential stuffing bypass rate limits entirely.
- **Fix:** If not directly behind a verified Cloudflare proxy (or if the application is accessed directly / behind Vercel), rely strictly on Express `req.ip` (configured with verified proxy trust) or validate the connection socket remote address before trusting proxy headers.
- **Verify:** Send request with `curl -H "CF-Connecting-IP: 8.8.8.8"` directly to backend; confirm rate limiter binds to actual socket/Express IP, not the forged header.
- **Effort:** Small (30 minutes).

---

### [PAY-01] Synchronous Order Finalization Inside Razorpay Webhook Receiver
- **Domain:** 05 - Payments & Checkout Integrity / 08 - Reliability
- **Severity:** High
- **Confidence:** Confirmed (Verified in source code)
- **Where:** `apps/backend/src/controllers/paymentController.js:1104-1119`
- **Evidence / Code:**
  ```javascript
  // apps/backend/src/controllers/paymentController.js:1104
  const result = await finalizePaymentAndCreateOrder({
    rzpOrderId,
    rzpPaymentId,
    source: "webhook",
    req,
  });
  if (result.success) {
    await updateWebhookEventStatus({ eventId, status: "processed" });
    return res.status(200).json({ ... });
  }
  ```
- **Problem:** Razorpay webhooks enforce a strict 5-second timeout window. `finalizePaymentAndCreateOrder` performs sequential network calls to WordPress (acquire distributed lock, verify customer cart/stock, call WooCommerce `POST /orders`, clear WooCommerce cart, notify alert channels).
- **Scenario:** During peak load or network latency spikes, WordPress takes 6 seconds to complete order creation. Razorpay closes the connection due to timeout and marks the delivery failed. Razorpay immediately re-transmits the webhook. The retried webhook encounters an active lock (`status: 409`), leading to retry thrashing.
- **Impact:** Webhook timeout failures, repeated webhook deliveries, and risk of customer confusion during payment reconciliation.
- **Fix:** In `handleWebhook`, record the incoming verified webhook event durably in the database, return HTTP `200 OK` to Razorpay immediately (`res.status(200).json({ received: true })`), and dispatch `finalizePaymentAndCreateOrder` asynchronously (or via queue / setImmediate with error handling).
- **Verify:** Simulate an upstream WooCommerce response latency of 6000ms; verify Razorpay webhook returns `200 OK` in < 500ms while order creation completes in background.
- **Effort:** Medium (2-3 hours).

---

### [DEP-01] Multiple High-Severity CVEs in Axios Dependency
- **Domain:** 04 - Transport, Headers, Secrets & Dependencies
- **Severity:** High
- **Confidence:** Confirmed (Verified via `pnpm audit`)
- **Where:** `apps/backend/package.json` (`axios@^1.19.0`) & `apps/customer-web/package.json` (`axios@^1.19.0`)
- **Evidence / Command Output:**
  ```text
  pnpm audit in apps/backend
  Package: axios (>=1.0.0 <1.20.0)
  Patched versions: >=1.20.0
  Advisories: GHSA-9fr6-4gfg-395g (SSRF bypass), GHSA-j8rh-479h-cp32 (Header Injection), GHSA-4hqw-qxg8-jxx2
  Found: 10 high vulnerabilities
  ```
- **Problem:** Installed Axios versions (< 1.20.0) contain header injection and SSRF proxy exclusion bypass flaws.
- **Impact:** Upstream requests made to WordPress or external APIs could theoretically be manipulated if untrusted input reaches header configurations.
- **Fix:** Update Axios to `^1.20.0` or latest stable (`pnpm update axios`) across all apps.
- **Verify:** Run `pnpm audit --audit-level high` in all workspaces; verify 0 high vulnerabilities.
- **Effort:** Small (20 minutes).

---

### [BIZ-01] Product Reviews Auto-Approved Without Purchase Verification or Moderation
- **Domain:** 06 - Business Logic & Abuse / 03 - Input Handling
- **Severity:** High
- **Confidence:** Confirmed (Verified in source code)
- **Where:** `apps/backend/src/controllers/reviewController.js:335-345`
- **Evidence / Code:**
  ```javascript
  // apps/backend/src/controllers/reviewController.js:342
  const createRes = await api.post("products/reviews", {
    product_id: productId,
    reviewer: reviewerName,
    reviewer_email: reviewerEmail,
    rating: ratingNum,
    review: cleanReview,
    verified: isVerified,
    status: "approved", // <--- Forces instant public publication!
  });
  ```
- **Problem:** Any logged-in customer can submit a review for ANY product. While `isVerified` indicates whether the user bought the item, the review is auto-approved (`status: "approved"`). Non-verified ratings are factored directly into `averageRating` and `totalReviews` (`reviewController.js:204-205`).
- **Scenario:** A competitor or disgruntled user creates a free account, scripts calls to `POST /api/products/:id/reviews` with 1-star ratings across 50 products, instantly dropping store average ratings to 1.0 star before launch.
- **Impact:** Store reputation damage, skewed product ratings, and vulnerability to review bombing.
- **Fix:** Either:
  1. Restrict review submissions to customers who purchased the product (`if (!isVerified) return res.status(403)...`), OR
  2. Set unverified reviews to `status: "hold"` for manual admin moderation, and calculate public aggregate ratings solely from verified buyers.
- **Verify:** Attempt to submit a review from an account with zero orders; verify review requires admin approval or cannot affect public rating unverified.
- **Effort:** Small (1 hour).

---

```
================================================================================
MEDIUM SEVERITY FINDINGS
================================================================================
```

### [CAT-01] Product Catalog Endpoint Disregards Pagination Parameters
- **Domain:** 09 - Frontend Performance / 17 - Search & Catalog Scale
- **Severity:** Medium
- **Confidence:** Confirmed (Verified in source code)
- **Where:** `apps/backend/src/controllers/productController.js:14-25`
- **Evidence / Code:**
  ```javascript
  // apps/backend/src/controllers/productController.js:15-16
  const cacheKey = "catalog:products:all";
  const products = await serverCache.getOrFetch(cacheKey, () => fetchProducts(), 60000);
  // fetchProducts in productService.js defaults to per_page = 50 and accepts no page param
  ```
- **Problem:** The main catalog route `/api/products` accepts validation for `schemas.pagination` in `productRoutes.js:22`, but `getAllProducts` ignores `req.query.page` and `req.query.per_page`. It fetches and caches only the first 50 items.
- **Scenario:** Once Mumbai Collection stocks more than 50 products, products #51 onwards can never be discovered or paginated by customers on the storefront.
- **Impact:** Inability to scale catalog beyond 50 products without items becoming invisible.
- **Fix:** Update `getAllProducts` to accept `page` and `per_page` query parameters, build a paginated cache key (`catalog:products:p${page}:l${limit}`), and return total count and total pages headers.
- **Verify:** Query `/api/products?page=2&per_page=10`; confirm different slice of items is returned with total headers.
- **Effort:** Small (1 hour).

---

### [OPS-01] Committed `.env` Files Tracked in Git Repository
- **Domain:** 04 - Transport, Headers, Secrets & Dependencies
- **Severity:** Medium
- **Confidence:** Confirmed (Verified via `git ls-files`)
- **Where:** `apps/customer-web/.env` and `apps/employee-panel/.env`
- **Evidence / Command Output:**
  ```text
  git ls-files | Select-String "\.env"
  apps/customer-web/.env
  apps/employee-panel/.env
  ```
- **Problem:** Even though root `.gitignore` excludes `.env`, these files were committed previously and remain tracked by git.
- **Impact:** Risk of accidental secret commits if API keys or production URLs are updated in local development files.
- **Fix:** Untrack files using `git rm --cached apps/customer-web/.env apps/employee-panel/.env` and verify `.gitignore` covers them.
- **Verify:** Run `git ls-files | Select-String "\.env$"`; confirm zero `.env` files are tracked.
- **Effort:** Small (5 minutes).

---

### [A11Y-01] Viewport Meta Tag Disables User Pinch-to-Zoom (WCAG 1.4.4 Violation)
- **Domain:** 10 - Mobile & Cross-Browser / 12 - Accessibility (A11Y)
- **Severity:** Medium
- **Confidence:** Confirmed (Verified in source code)
- **Where:** `apps/customer-web/index.html:6`
- **Evidence / Code:**
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  ```
- **Problem:** `maximum-scale=1.0, user-scalable=no` prevents mobile users from zooming into product images, specifications, or fine print.
- **Impact:** Fails WCAG 2.1 Success Criterion 1.4.4 (Resize Text). Disqualifies store on standard accessibility audits and frustrates low-vision shoppers on smartphones.
- **Fix:** Change meta viewport to standard responsive tag:
  `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`
- **Verify:** Open customer web on mobile browser or Chrome DevTools mobile emulation; confirm pinch-to-zoom functions normally.
- **Effort:** Small (5 minutes).

---

### [SEO-01] Placeholder Open Graph & Social Graph Metadata
- **Domain:** 13 - SEO & Social Sharing
- **Severity:** Medium
- **Confidence:** Confirmed (Verified in source code)
- **Where:** `apps/customer-web/index.html:14-33`
- **Evidence / Code:**
  ```html
  <meta property="og:url" content="https://yourdomain.com/" />
  <meta property="og:image" content="https://yourdomain.com/favicon.svg" />
  <meta name="twitter:url" content="https://yourdomain.com/" />
  ```
- **Problem:** Production metadata contains generic `yourdomain.com` placeholder URLs.
- **Impact:** When links are shared via WhatsApp, Facebook, or Twitter, unfurled cards show broken images or `yourdomain.com`, hurting trust and viral sharing.
- **Fix:** Update Open Graph URLs to point to official domain `https://mumbaicollection.in` and provide a high-resolution 1200x630 branded banner image.
- **Verify:** Test URL with Facebook Sharing Debugger or WhatsApp chat preview.
- **Effort:** Small (15 minutes).

---

### [CI-01] Missing Automated PHP Syntax Validation in CI Workflow
- **Domain:** 16 - Operations, Deployment & CI/CD
- **Severity:** Medium
- **Confidence:** Confirmed (Verified in `.github/workflows/ci.yml`)
- **Where:** `.github/workflows/ci.yml`
- **Problem:** The repository relies heavily on root `mumbai-auth.php` (4,638 lines) for custom transients, authentication, locks, and media handling. CI only runs `node --test` for JS workspaces and contains no PHP syntax check (`php -l`).
- **Scenario:** A developer edits `mumbai-auth.php`, introducing a missing semicolon or syntax error. CI passes 100% green. Upon deploying the plugin to WordPress production, the entire WordPress REST API crashes with a fatal 500 error.
- **Impact:** High risk of production downtime on plugin updates.
- **Fix:** Add a step to `.github/workflows/ci.yml`:
  ```yaml
  - name: Validate PHP Plugin Syntax
    run: php -l mumbai-auth.php
  ```
- **Verify:** Run `php -l mumbai-auth.php` in terminal; confirm syntax passes.
- **Effort:** Small (10 minutes).

---

### [AUTH-01] Employee Panel Lacks Restrictive Order State Transition Graph
- **Domain:** 02 - Authorization / 06 - Business Logic
- **Severity:** Medium
- **Confidence:** Confirmed (Verified in source code)
- **Where:** `apps/backend/src/controllers/employeeController.js:393-398`
- **Problem:** `ALLOWED_ORDER_STATUSES` contains `pending`, `processing`, `packed`, `out-for-delivery`, `completed`, `cancelled`, `refunded`, `failed`. An employee can transition an order to ANY status in this list without adhering to a legal state machine (e.g., jumping from `completed` back to `processing`, or marking an order `refunded`).
- **Impact:** Accidental or unauthorized status transitions by staff causing inventory or delivery tracking anomalies.
- **Fix:** Restrict employee status transitions to the forward dispatch lifecycle (`processing` -> `packed` -> `out-for-delivery` -> `completed`). Require administrator role for `refunded` and `cancelled`.
- **Verify:** Send request from employee account attempting to set status to `refunded`; expect 403 Forbidden.
- **Effort:** Small (1 hour).

---

```
================================================================================
LOW SEVERITY FINDINGS & HYGIENE
================================================================================
```

### [CHK-01] Hardcoded Dummy Phone Number Fallback in Checkout
- **Domain:** 05 - Payments & Checkout Integrity
- **Severity:** Low
- **Confidence:** Confirmed (Verified in source code)
- **Where:** `apps/customer-web/src/components/checkout/BillingForm.jsx:266`
- **Evidence:** `(selectedAddress.phone || "").replace(/\D/g, "") || "9999999999";`
- **Problem:** If a customer's address lacks a phone number, checkout quietly injects `"9999999999"` instead of prompting the user.
- **Impact:** Courier delivery failures if delivery staff cannot call the recipient.
- **Fix:** Validate that `selectedAddress.phone` has 10 digits before submitting; show error if missing.
- **Effort:** Small (15 minutes).

### [DEP-02] DOMPurify Low-Severity Advisory in Storefront
- **Domain:** 04 - Transport, Headers, Secrets & Dependencies
- **Severity:** Low
- **Confidence:** Confirmed (Verified via `pnpm audit`)
- **Where:** `apps/customer-web/package.json` (`dompurify@^3.4.14`)
- **Problem:** DOMPurify `<3.4.16` contains minor node-removing afterSanitize hook bypasses.
- **Fix:** Update `dompurify` to `^3.4.16` in `apps/customer-web/package.json`.
- **Effort:** Small (5 minutes).

---

## SECTION C: PRIORITIZED REMEDIATION ROADMAP

### Phase 1: Must Fix Before Launch (Blockers)
1. **[SEC-01]** Override `proxy-addr` dependency to `>=2.0.8` to eliminate Critical CVE.
2. **[SEC-02]** Secure `getClientIp` in `rateLimiter.js` against forged `CF-Connecting-IP` headers.
3. **[PAY-01]** Decouple order finalization from Razorpay webhook handler to guarantee < 5s response.
4. **[BIZ-01]** Restrict product reviews to verified purchasers or hold unverified reviews for moderation.
5. **[OPS-01]** Untrack `.env` files from git repository (`git rm --cached`).
6. **[A11Y-01]** Re-enable mobile pinch-to-zoom in `customer-web/index.html`.
7. **[SEO-01]** Replace placeholder `yourdomain.com` tags with actual domain and open-graph asset.

### Phase 2: First Week Post-Launch (P1 Hardening)
1. **[DEP-01]** Upgrade Axios to `>=1.20.0` across all workspaces.
2. **[CAT-01]** Implement pagination (`page`, `per_page`) on `GET /api/products`.
3. **[CI-01]** Add PHP syntax verification (`php -l`) and `pnpm audit` to GitHub Actions workflow.
4. **[AUTH-01]** Restrict employee order state transitions to forward dispatch states only.
5. **[CHK-01]** Remove dummy `"9999999999"` fallback; enforce real phone entry on checkout.

### Phase 3: First Month (P2 Operational Scaling)
1. Migrate in-memory rate limiting and session cache from Node.js process memory to Redis/Upstash for multi-instance readiness.
2. Ensure automated daily backups with restore testing for WordPress MySQL database.
3. Implement itemized GST tax invoices (CGST/SGST/IGST breakdown with store GSTIN).

### Phase 4: Long-Term Hardening (P3)
1. Evaluate SSR / SSG (Next.js or prerendering) for product catalog to optimize organic search indexing and social link sharing.
2. Implement automated end-to-end synthetic checkout tests running against staging environment.

---

## SECTION D: DOMAIN COVERAGE MATRIX

| # | Domain Name | Status | Summary of Analysis |
|---|---|:---:|---|
| **01** | Authentication & Sessions | PASS WITH FIXES | Triple cookie separation (customer/admin/employee), 60s cache, fix IP spoofing in rate limiter. |
| **02** | Authorization | PASS WITH FIXES | Admin routes strictly guarded; refine employee order transition permissions. |
| **03** | Input Handling & Web Vulns | PASS WITH FIXES | Strict image validation (Sharp/magic bytes); sanitize review text with DOMPurify. |
| **04** | Transport, Secrets & Deps | ACTION REQUIRED | Patch critical/high dependencies; untrack `.env` files in git. |
| **05** | Payments & Checkout | PASS WITH FIXES | Excellent deferred order pattern and paise math; make webhook receiver non-blocking. |
| **06** | Business Logic & Abuse | PASS WITH FIXES | Enforce minimum ₹500 order value; prevent unmoderated review spamming. |
| **07** | Data Layer | PASS | WordPress transient lock pattern works; monitor `wp_options` under peak load. |
| **08** | Backend Reliability & SRE | PASS WITH FIXES | In-memory cache is single-instance; reconcile worker runs reliably via interval timer. |
| **09** | Frontend Performance | PASS | Responsive Vite bundle; add query pagination to product catalog endpoint. |
| **10** | Mobile & Cross-Browser | PASS WITH FIXES | Strong UPI app-switch recovery; remove `user-scalable=no` constraint. |
| **11** | Observability & Logging | PASS | Pino logging with request correlation IDs and sensitive data redaction. |
| **12** | Accessibility (A11Y) | PASS WITH FIXES | Fix viewport zoom; aria-labels are present on primary navigation buttons. |
| **13** | SEO & Social Sharing | ACTION REQUIRED | Update social graph metadata; consider prerendering for catalog crawlers. |
| **14** | Legal, Privacy & Compliance | PASS | Policies published, GDPR/DPDP account deletion implemented, ensure GST compliance. |
| **15** | Third-Party Integrations | PASS | Fail-closed email (Brevo) and gateway (Razorpay) with circuit-breaking agents. |
| **16** | Operations & CI/CD | ACTION REQUIRED | Add PHP syntax checking and security audits to CI pipeline. |
| **17** | Search & Catalog Scale | PASS | Debounced catalog search; paginate `/api/products` for scalability. |
| **18** | Admin & Back-Office Ops | PASS | Full role isolation and audit logging with actor context. |
| **19** | Conversion Rate & UX | PASS | Clean checkout flow with minimum-order guidance and streamlined phone entry. |

---

## SECTION E: STRENGTHS, TESTING & VERIFICATION CHECKLIST

### What Is Done Well (Codebase Strengths)
- **Deferred Order Creation Pattern:** Zero orphaned or ghost WooCommerce orders created prior to Razorpay payment capture. If payment fails or is aborted, zero DB clutter is generated.
- **Image Security & Processing:** Exceptional validation in `imageValidator.js` and `imageProcessor.js`. Magic-byte inspection, dimensions capped at 6000x6000px, EXIF stripping, and WebP re-encoding completely neutralize image bombs and SVG-based XSS.
- **Logging Hygiene:** Structured Pino logger with comprehensive redaction of passwords, tokens, cookies, secrets, and auth headers.
- **App-Switch Payment Recovery:** Robust `visibilitychange` listener in `BillingForm.jsx` automatically polls payment status when returning from mobile UPI applications.

### Missing Tests to Add
1. **Concurrent Webhook Test:** Verify duplicate Razorpay webhooks arriving simultaneously handle locks gracefully without producing duplicate orders.
2. **Rate Limiter Spoof Test:** Verify `getClientIp` rejects fabricated `CF-Connecting-IP` headers when client is not an authenticated reverse proxy.
3. **Review Rating Authorization Test:** Verify unverified reviews cannot skew aggregate ratings.

### External / Cloud Provider Verification Checklist
- [ ] **Cloudflare:** Confirm Cloudflare WAF is active and Origin server firewall only permits Cloudflare ingress IPs.
- [ ] **Razorpay Dashboard:** Ensure Webhook Secret exactly matches `RAZORPAY_WEBHOOK_SECRET` in production `.env`.
- [ ] **Brevo Console:** Verify production sender domain (`mumbaicollection.in`) has valid SPF, DKIM, and DMARC DNS records configured.
- [ ] **WordPress wp-config.php:** Confirm `MUMBAI_INTERNAL_API_KEY` matches backend `.env` and `WP_DEBUG_DISPLAY` is set to `false`.
