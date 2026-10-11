# Comprehensive User Behavior, Payment Reliability, and Technical SEO Audit

**Audit Date:** October 11, 2026  
**Auditor Roles:** Principal Engineer, Payments-Reliability Reviewer, QA Lead, Technical-SEO Auditor  
**Target Repository:** Mumbai Collection E-Commerce Platform  
**Operational Scope:** React/Vite SPAs (`apps/customer-web`), Node.js/Express Gateway (`apps/backend`), WooCommerce/WordPress Engine (`https://mumbai-collection.local`), Razorpay Payment Gateway (Test Mode).

---

## Executive Summary

This comprehensive audit examines what real users, flaky 4G networks, and hostile browsers do to the Mumbai Collection e-commerce platform. Heavy emphasis was placed on payment safety, distributed state consistency, recovery paths, tampering resistance, and technical SEO discoverability.

### Primary Strengths
1. **Deferred Order Creation Invariant:** Exactly **0** WooCommerce orders are created prior to verified payment capture. Abandoned carts or gateway dismissals never leave orphaned pending orders, nor do they lock WooCommerce inventory.
2. **Authoritative Source of Truth:** The browser *never* decides "paid". Payment capture is verified server-to-server directly against Razorpay's API (`fetchRazorpayPayment`), enforcing currency (`INR`), amount match, and signature verification.
3. **Double-Checked Concurrency & Lock Healing:** Payment finalization employs WordPress MySQL distributed atomic locks (`acquireLock`) with 4-second TTL, stale-lock self-healing, and HPOS-safe double checks before order insertion.
4. **Resilient Background Reconciler:** A dedicated concurrency-guarded background sweeper runs every 10 minutes (and 5 seconds post-boot), sweeping intents stuck in `paid` or `created`, auto-finalizing captured orders, or auto-refunding customers if stock was exhausted during payment.

### Critical Vulnerabilities & Gaps
1. **COD Phone Verification Bypass:** `/api/store/checkout` does not enforce phone verification. An unverified account can place unlimited Cash on Delivery orders, exposing the store to courier-fraud and fake-order spam.
2. **Premature Clearing of Recovery State on Verification Timeout:** If a client verification request times out on a flaky network immediately after money is debited, `BillingForm.jsx` clears `pendingPayment` from `localStorage` in its error catch block, destroying the client's ability to self-recover upon refresh.
3. **OrderSuccess IDOR / Unverified Route False-Positive:** `OrderSuccess.jsx` catches API rejections (401/403/404) and blindly renders "Order placed successfully! 🎉" with fallback defaults.
4. **Complete Client-Side SPA SEO Blind Spot:** Googlebot receives an empty `<div id="root"></div>` shell across all routes; every route shares the identical static `<title>` and OpenGraph tags from `index.html`; `sitemap.xml` has 0 products/categories; 0 JSON-LD structured data schemas exist.
5. **Checkout Rate Limiter (5 per 5 min) Penalizes Legitimate Retries:** `checkoutLimiter` runs *before* `requireIdempotency`. A user experiencing network drops will be blocked with HTTP 429 for up to 300 seconds.

---

## PART 0 — MAP THE PAYMENT STATE MACHINE

### State Transition Diagram

```
                 [ User in Cart (WooCommerce Store API) ]
                                    │
                         POST /api/payments/create-order
                         (Validates Store Hours, Min ₹500,
                          Stock, User Auth & Phone)
                                    │
                                    ▼
       ┌─────────────────────────────────────────────────────────┐
       │ State: INTENT_CREATED ('created')                       │
       │ Store: WordPress MySQL (payment_intents) + serverCache  │
       │ Razorpay Order Created (rcpt_<userId>_<timestamp>)       │
       │ WooCommerce Order: NONE (0 orders exist)                │
       │ TTL: 1 hour                                             │
       └────────────────────────────┬────────────────────────────┘
                                    │
                                    ▼
                     [ Razorpay Modal Opens on Client ]
                                    │
                 ┌──────────────────┴──────────────────┐
                 │                                     │
           User Dismisses                       User Authorizes
                 │                                     │
                 ▼                                     ▼
        State: ABANDONED                     Razorpay Captures
        (Intent expires;                     Money Debited (INR)
         0 stock held)                                 │
                                    ┌──────────────────┴──────────────────┐
                                    │                                     │
                          Client Web Callback                   Razorpay Webhook
                       POST /api/payments/verify           POST /api/payments/webhook
                                    │                                     │
                                    └──────────────────┬──────────────────┘
                                                       │
                                                       ▼
                            ┌────────────────────────────────────────────────────────┐
                            │ Lock: WordPress Distributed Lock (rzp_order_id, 4s)    │
                            │ Verifies: Razorpay API fetch, Status=captured, Amount  │
                            │ Double-Check: findOrderByRazorpayOrderId               │
                            └──────────────────────────┬─────────────────────────────┘
                                                       │
                                   ┌───────────────────┴───────────────────┐
                                   │ Stock Available?                      │
                                   ├───────────────────┬───────────────────┤
                                  YES                  NO                  │
                                   │                   │                   │
                                   ▼                   ▼                   │
                ┌─────────────────────────────┐ ┌────────────────────────┐ │
                │ State: ORDER_CREATED        │ │ State: REFUND_PENDING  │ │
                │ WC Order Created            │ │ Auto-refund Razorpay   │ │
                │ (status: "processing",      │ │ Email customer via     │ │
                │  set_paid: true,            │ │ Brevo                  │ │
                │  transaction_id)            │ │ Transition: REFUNDED   │ │
                │ WC Cart Session Cleared     │ └────────────────────────┘ │
                │ Intent Marked 'order_created│                            │
                └──────────────┬──────────────┘                            │
                               │                                           │
                               ▼                                           │
                 [ Order Success Screen ]                                  │
                                                                           │
                                  If verification dropped / server crashed │
                                                                           ▼
                                                ┌──────────────────────────────────────┐
                                                │ Sweeper Job: runPaymentReconciliation │
                                                │ (Cron: Every 10 min + boot)          │
                                                │ Sweeps 'created' > 10m & 'paid' < 15m│
                                                │ Heals missing order or auto-refunds  │
                                                └──────────────────────────────────────┘
```

### State Storage, Ownership, TTL & Failure Recovery Matrix

| State | Storage Location | Who Can Mutate | TTL | Failure If Next Event Never Arrives |
| :--- | :--- | :--- | :--- | :--- |
| **CART_ACTIVE** | WooCommerce Store API Session / MySQL | Customer | 30 days | Abandoned cart; items remain in stock; cart expires naturally. |
| **INTENT_CREATED** (`created`) | `payment_intents` table & `serverCache` | `createOrder` | 1 hour | No WC order created; stock untouched; reconciler polls Razorpay at 10m. If unpaid, expires at 1h. |
| **GATEWAY_AUTHORIZED** | Razorpay Gateway Servers | Customer & Bank | 15 mins (gateway auth window) | Gateway auto-expires payment attempt; status remains unpaid. |
| **PAYMENT_CAPTURED** | Razorpay API (`status: 'captured'`) | Razorpay Gateway | Permanent | Money held in Razorpay. If client/webhook fail, reconciler discovers capture at 10m. |
| **PAYMENT_PAID** (`paid`) | `payment_intents` table | Webhook / Finalize Handler | 15 mins retry window | Payment captured but WC order failed. Reconciler retries for 15 mins; if retries fail, auto-refunds. |
| **REFUND_PENDING** | `payment_intents` table | Finalize Handler / Reconciler | 10 mins | Reconciler re-queries Razorpay refund status; transitions to `refunded` once verified. |
| **REFUNDED** | `payment_intents` table | Finalize Handler / Reconciler | Permanent | Terminal state. Staff alerted; customer received Brevo email notification. |
| **ORDER_CREATED** | WooCommerce HPOS MySQL (`wp_wc_orders`) | Finalize Handler / Webhook / Reconciler | Permanent | Authoritative order in `processing` status; cart cleared; inventory decremented. |

### Source of Truth Evaluation
- **Deciding "Paid":** The browser is **NEVER** the source of truth.
- Both the browser verification path (`/api/payments/verify`) and webhook (`/api/payments/webhook`) execute `finalizePaymentAndCreateOrder`.
- This function calls Razorpay directly via `fetchRazorpayPayment(rzpPaymentId)`:
  - Validates `rzpPayment.status === "captured"` (`paymentController.js:524`).
  - Validates `rzpPayment.amount === intent.amount_in_paise` (`paymentController.js:643`).
  - Validates `rzpPayment.currency === "INR"` (`paymentController.js:533`).
  - Validates `rzpPayment.order_id === rzpOrderId` (`paymentController.js:512`).

### Idempotency Architecture
- **Client Persistence:** Client computes `computeCartFingerprint` (`items:[...] _total:...`).
- `getOrCreateCheckoutIdempotencyKey` stores `{ fingerprint, key: UUID }` in `localStorage` (`safeStorage.js`).
- If the user refreshes or retries without mutating the cart, the identical key is reused. If cart items or quantities change, a new UUID is generated.
- **Server Persistence:** `requireIdempotency` middleware stores active keys in a Node.js process-memory `Map` with 15-minute TTL (`idempotencyMiddleware.js:8`).
- *Limitation:* The server idempotency cache is in process memory rather than Redis/MySQL. In a clustered/multi-instance deployment, identical requests hitting different containers bypass process memory (though double-checked DB locks in `paymentIntentService` mitigate duplicate orders).

### Reconciliation / Sweeper Worker
- **Schedule:** Scheduled in `apps/backend/src/server.js:46` every 10 minutes, plus an initial run 5 seconds after server boot.
- **Concurrency Guard:** WordPress DB lock `cron_reconciler_worker` (`reconciliationService.js:23`) with a 2-second heartbeat.
- **Persistent Watermark:** Tracks `latestSeenWatermark` in WordPress options to prevent repeated scans of settled records.
- **Handling `paid` (Money debited, no WC order):**
  - If age < 15 minutes: Retries WooCommerce order creation (`reconciliationService.js:104`).
  - If age >= 15 minutes: Retries exhausted. Initiates automated refund via `refundRazorpayPayment`, updates status to `refund_pending` -> `refunded`, and emails the customer (`reconciliationService.js:185`).
- **Handling `created` (Stuck in intent created > 10m):**
  - Queries Razorpay via `fetchRazorpayOrderPayments(rzpOrderId)`.
  - If a captured payment is found: Re-validates stock. If stock is available, finalizes WooCommerce order; if stock is exhausted, auto-refunds immediately (`reconciliationService.js:330-429`).
  - If no payment is found: Leaves intent to expire naturally. No stock is ever decremented.

---

## PART 1 — INTERRUPTION SCENARIOS (EVIDENCE & VERDICTS)

### Section A: Tab & Browser Interruption

#### 1. Close Tab BEFORE Payment Window Opens
- **Condition:** User clicks "Place Order"; `createOrder` returns `{ razorpay_order_id, amount }`; user closes tab before Razorpay modal opens.
- **Money Safe:** Yes. No payment authorization initiated.
- **Order/Stock State:** Exactly 0 WooCommerce orders created. Stock untouched. Payment intent in `payment_intents` table stays in `status = 'created'`.
- **User Experience:** Upon returning, cart is still intact.
- **Recovery:** Customer can reopen cart and proceed to checkout.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/controllers/paymentController.js:11` ("INVARIANT: 0 WooCommerce orders created before payment capture"). Live test verified intent created with `order_id: null`.

#### 2. Close Tab While Payment Window is Open (Before Paying)
- **Condition:** Razorpay modal is open on screen; user kills browser or closes tab without completing payment.
- **Money Safe:** Yes. Razorpay order exists, but payment status on gateway remains unattempted.
- **Order/Stock State:** 0 WooCommerce orders created. Stock not held.
- **User Experience:** Upon reopening site, cart is preserved.
- **Recovery:** User can re-enter checkout anytime.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/controllers/paymentController.js:439`. Razorpay order expires on gateway after 15-30 minutes.

#### 3. Close Tab / Kill Browser AFTER Paying But BEFORE Success Handler Runs
- **Condition:** User completes payment on phone/bank OTP; Razorpay captures funds; browser crashes or user closes window before `handler` executes `/api/payments/verify`.
- **Money Safe:** Yes. Funds captured by Razorpay.
- **Order/Stock State:** Razorpay webhook receives `payment.captured` / `order.paid`; acquires distributed lock; validates stock; creates WooCommerce order in `processing` status; clears cart. If webhook drops, `reconciliationService.js:319` discovers capture within 10 minutes.
- **User Experience:** When reopening `/checkout`, `BillingForm.jsx:88` and `Checkout.jsx:36` inspect `getPendingPayment()`. Calls `/api/payments/check-status`, discovers created order, and automatically navigates to `/order-success/:id`.
- **Recovery:** Completely automatic without support intervention.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/controllers/paymentController.js:1004` (`checkPaymentStatus` calls `finalizePaymentAndCreateOrder` with `source: 'app_switch_recovery'`).

#### 4. Refresh on Payment Page, Success Page, and Failure Page
- **Condition:** Hard reload (F5 / Cmd+R) on `/checkout`, `/order-success/:id`, and during an inline failure.
- **Payment Page:** `Checkout.jsx:36-50` checks for pending payment before declaring cart empty. If paid, redirects to success; if unpaid, reloads cart.
- **Success Page:** `OrderSuccess.jsx:27` queries `getOrderById(id)`. Re-renders order summary without re-executing payment or mutating DB.
- **Failure Page:** State reset; cart remains intact.
- **Verdict:** **PASS**
- **Evidence:** `apps/customer-web/src/pages/Checkout.jsx:36` and `apps/customer-web/src/pages/OrderSuccess.jsx:27`.

#### 5. Back Button After Success, Failure, and Mid-Payment
- **Condition:** Browser History Back navigation.
- **After Success:** Navigates back to `/checkout`. Server cart is empty; checkout renders empty state ("Your cart is empty"). No duplicate submission occurs.
- **Mid-Payment:** Razorpay modal intercepts dismissal via `options.modal.ondismiss` (`BillingForm.jsx:401`), resets submit state, and shows "Payment was cancelled. You can retry paying anytime."
- **After Failure:** Returns to checkout form with fields preserved.
- **Verdict:** **PASS**
- **Evidence:** `apps/customer-web/src/components/checkout/BillingForm.jsx:401-430`.

#### 6. Same Cart Open in Two Tabs: Pay in One, Edit or Pay Again in Other
- **Condition:** Tab 1 opens Razorpay modal for Cart A (₹1,000). Tab 2 adds items (Cart B, ₹1,500). Tab 1 pays.
- **Money Safe:** Yes. Tab 1 pays ₹1,000.
- **Order/Stock State:** Order is fulfilled using `intent.checkout_payload` (Cart A snapshot). Customer's WooCommerce cart session is cleared (`clearCustomerWcCart`).
- **User Experience:** In Tab 2, `BillingForm.jsx:123` detects `itemsFingerprint` mismatch, clearing `pendingPayment`. If Tab 2 submits, server cart is empty (400 Empty Cart).
- **Recovery:** Tab 2 user sees cart updated and can add desired items anew.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/controllers/paymentController.js:786` and `apps/customer-web/src/components/checkout/BillingForm.jsx:138`.

#### 7. Phone Call, App Switch, or Low-Memory Kill Mid-Payment
- **Condition:** Low-end Android 4G phone receives incoming call or kills background tab while user enters OTP in UPI app.
- **Money Safe:** Yes.
- **Order/Stock State:** Webhook finalizes order on server asynchronously.
- **User Experience:** Upon returning to browser, `visibilitychange` listener (`BillingForm.jsx:151`) triggers `verifyPendingOrder()`, polling `/api/payments/check-status` and transitioning to success screen.
- **Verdict:** **PASS**
- **Evidence:** `apps/customer-web/src/components/checkout/BillingForm.jsx:151-160`.

---

### Section B: Network Interruption

#### 8. Wifi/Data OFF Before Clicking Pay
- **Condition:** Device offline when clicking "Place Order".
- **Money Safe:** Yes. Request never leaves device.
- **Order/Stock State:** Unchanged.
- **User Experience:** Inline error: "Unable to load secure payment gateway. Please check your connection and try again."
- **Recovery:** Re-enable connection and click Pay again.
- **Verdict:** **PASS**
- **Evidence:** `apps/customer-web/src/components/checkout/BillingForm.jsx:340`.

#### 9. Network Drops After Create-Order Request Sent but Before Response Arrives
- **Condition:** Server creates Razorpay order `rzp_123`; client disconnects before receiving JSON response; user reconnects and clicks Pay again.
- **Money Safe:** Yes.
- **Order/Stock State:** Client re-sends identical `X-Idempotency-Key` (persisted in `localStorage`). `idempotencyMiddleware.js:89` intercepts key and returns cached `rzp_123` with `_idempotent: true`. No duplicate Razorpay order created.
- **User Experience:** Seamlessly opens Razorpay modal for existing order.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/middlewares/idempotencyMiddleware.js:64-94`.

#### 10. Network Drops During Payment Authorisation (Comes back after 30s, 2m, 10m)
- **Condition:** Connection lost while bank processes transaction.
- **30s / 2m:** Bank completes capture; Razorpay webhook arrives at backend; order created. When device reconnects, `visibilitychange` triggers status check and redirects to success.
- **10m:** Webhook had already processed, or `reconciliationService.js` discovered capture during its 10-minute sweep. Order exists in HPOS.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/services/reconciliationService.js:328`.

#### 11. Network Drops AFTER Payment Succeeds, Verification Call Times Out
- **Condition:** Payment captured by Razorpay; `/api/payments/verify` sent but network drops; Axios throws timeout.
- **Money Safe:** Yes (captured in Razorpay; webhook fulfills order).
- **Order/Stock State:** Consistent on server.
- **User Experience Defect:** In `BillingForm.jsx:457`, `catch (verifyErr)` executes `clearPendingPayment()`. It wipes `localStorage` and displays: *"Payment verification could not be completed. Please check your order history or contact support."* If user refreshes, `verifyPendingOrder()` fails to auto-redirect because pending payment was cleared.
- **Recovery:** User must manually open "My Orders" in account navigation to verify order status.
- **Verdict:** **PARTIAL**
- **Evidence:** `apps/customer-web/src/components/checkout/BillingForm.jsx:458` (`clearPendingPayment()` called inside catch).

#### 12. Switch Wifi <-> Mobile Data Mid-Payment (IP Changes)
- **Condition:** IP changes during checkout from broadband to 4G cell tower.
- **Session / CSRF / Rate Limits:**
  - Session is validated via HTTP-only cookie `mumbai_customer_auth` (`authMiddleware.js:65`). Not bound to IP.
  - CSRF validates `Origin` / `Referer` (`csrfMiddleware.js:89`). Not bound to IP.
  - `checkoutLimiter` is keyed by `user:${userId}` (`rateLimiter.js:145`). Not bound to IP.
- **Result:** User is NOT logged out; checkout proceeds without error.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/middlewares/authMiddleware.js:78` and `apps/backend/src/middlewares/csrfMiddleware.js:90`.

#### 13. Very Slow 3G (10–20s Per Request)
- **Condition:** High latency cellular connection.
- **Client Handling:** Button immediately disabled (`isSubmittingRef.current = true`); displays animated spinner (`Loader2`). Axios timeout is configured for 30,000ms (`paymentService.js:18`).
- **Server Handling:** Rate limiters and store proxies tolerate high request times (`keepAliveTimeout = 65000` in `server.js:42`).
- **Verdict:** **PASS**
- **Evidence:** `apps/customer-web/src/components/checkout/BillingForm.jsx:233` and `apps/backend/src/server.js:42`.

#### 14. Server / WordPress 503 During Checkout and Verification
- **During Checkout:** `createOrder` catches 502/503 from WordPress, returning friendly error. No money debited.
- **During Verification:** Payment captured on Razorpay, but WordPress order creation throws 502.
  - Backend `paymentController.js:841` retains payment intent in `status: 'paid'`, increments attempts, and alerts staff.
  - Background reconciler retries order creation for 15 minutes.
  - If server remains down > 15m, reconciler automatically triggers full refund to customer.
- **User Experience:** User sees temporary error, but money is safeguarded and either fulfilled or refunded.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/controllers/paymentController.js:839` and `apps/backend/src/services/reconciliationService.js:185`.

---

### Section C: App Switch (UPI)

#### 15. UPI Intent to Another App and Back (Same vs. Different Browser)
- **Same Browser:** `visibilitychange` triggers status check -> `/api/payments/check-status` queries Razorpay -> order finalized -> redirects to `/order-success/:id`. **PASS**.
- **Different Browser (e.g. WhatsApp Webview -> External Chrome):** External Chrome has empty `localStorage`. If user navigates to `/checkout`, it cannot auto-detect pending payment from WhatsApp webview. User must log into account and view `/orders`.
- **Verdict:** **PARTIAL**
- **Evidence:** `apps/customer-web/src/components/checkout/BillingForm.jsx:89` (relies on `getPendingPayment()` in local storage).

#### 16. Payment Popup Blocked / In-App Browser Restrictions
- **Condition:** In-app browser (Instagram/Facebook) or aggressive popup blocker.
- **Implementation:** Razorpay Standard Checkout runs as an in-page `iframe` via `checkout.js` (`document.body.appendChild(script)`), not a `window.open` popup.
- **Result:** Popup blockers do not trigger. If CDN fails, `loadRazorpayScript` catches failure and presents actionable error.
- **Verdict:** **PASS**
- **Evidence:** `apps/customer-web/src/components/checkout/BillingForm.jsx:45-70`.

---

### Section D: Time and State Changes While Paying

#### 17. Store Closes Mid-Checkout; Item Sells Out; Price/Coupon Changes
- **Store Closes Mid-Payment:** `paymentController.js:658` detects store closed during capture, but logs a warning and *proceeds* with order creation so customer funds are not stranded.
- **Item Sells Out Mid-Payment:** `paymentController.js:703` detects stock depletion during finalization. Immediately executes `refundRazorpayPayment`, updates status to `refunded`, sends Brevo email to customer, and alerts staff.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/controllers/paymentController.js:658` and `703-780`.

#### 18. Abandoned Payment: Stock Release & Resume Behavior
- **Condition:** User closes modal without paying.
- **Stock Release:** Stock was **never decremented** because 0 WooCommerce orders are created pre-capture. No stock reservation leaks.
- **Resume:** User can resume checkout immediately; cart items remain intact.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/controllers/paymentController.js:11`.

---

### Section E: Provider-Side Events

#### 19. Provider Events: Failed Retries, Replayed Webhooks, Race Conditions
- **payment.failed:** Handled by `rzp.on("payment.failed")` (`BillingForm.jsx:474`). Resets loading state; user can retry immediately with another card/UPI.
- **Webhook Replay:** `handleWebhook` checks `serverCache.get("webhook:event:" + eventId)`. Returns idempotent HTTP 200 without reprocessing.
- **Webhook BEFORE Client Verify:** Webhook acquires lock, creates order, marks intent `order_created`. When client calls `/verify`, line 566 detects existing order and returns `{ success: true, order_id, _idempotent: true }`.
- **Webhook AFTER Client Verify:** Client creates order. Webhook detects existing order via `findOrderByRazorpayOrderId`, marks event processed, returns idempotent 200.
- **Webhook Never Arrives:** Sweeper job queries Razorpay after 10m, creates order or auto-refunds.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/controllers/paymentController.js:546`, `566`, `1073`.

#### 20. Cash on Delivery (COD): Double-Click, Refresh, Two Tabs
- **Client Guard:** `isSubmittingRef.current = true` prevents multiple clicks.
- **Server Guard:** `router.post(["/checkout", "/checkout/"], resolveCheckoutCustomer, checkoutLimiter, requireIdempotency)` in `storeRoutes.js:324-329`. Second concurrent submission waits for the first or receives cached completed order.
- **Two Tabs:** Shared cart session in WooCommerce Store API is emptied upon first order placement; second tab receives empty cart error.
- **Verdict:** **PASS**
- **Evidence:** `apps/backend/src/routes/storeRoutes.js:324-329`.

---

## PART 2 — TAMPERING & MISUSE (SECURITY AUDIT)

```
Test Mode Live Security Verification:
✓ POST /api/payments/webhook [No signature]    --> 400 {"success":false,"message":"Missing signature header."}
✓ POST /api/payments/webhook [Bad signature]   --> 400 {"success":false,"message":"Invalid webhook signature."}
✓ POST /api/payments/verify  [Unauthenticated] --> 401 {"success":false,"message":"Authentication required."}
✓ POST /api/payments/create-order [Unauth]     --> 401 {"success":false,"message":"Authentication required."}
```

### 1. Price, Quantity, Discount, or Currency Tampering
- **Attack:** Attacker alters line items, price, or discount in browser DevTools or replays `/create-order` with custom payload.
- **Defense:** `createOrder` ignores client prices entirely. It queries the customer's authoritative cart directly from WooCommerce Store API (`/wp-json/wc/store/v1/cart`). Amount in paise is calculated strictly server-side.
- **Capture Verification:** `finalizePaymentAndCreateOrder` re-verifies that `rzpPayment.amount === intent.amount_in_paise` and `rzpPayment.currency === "INR"`. Tampered prices fail with HTTP 400.
- **Verdict:** **PASS**

### 2. Address / Pincode / Zone Modification Post-Intent
- **Attack:** User creates payment intent for Pincode 401202, then alters shipping address in another tab before paying.
- **Defense:** Order is fulfilled using the immutable `checkout_payload` snapshot stored in `paymentIntent` when the Razorpay order was initiated (`paymentController.js:786`). Post-intent address alterations do not affect the finalized order.
- **Verdict:** **PASS**

### 3. Direct Invocation of Verification Endpoint (`/api/payments/verify`)
- **Missing / Forged Signature:** Rejected with HTTP 400 (`paymentController.js:481`).
- **Another Customer's Order ID:** `finalizePaymentAndCreateOrder:631` verifies `Number(intent.customer_id) === Number(expectedCustomerId)`. Mismatches return HTTP 403 Forbidden.
- **Payment ID from Another Order:** Razorpay API lookup confirms `rzpPayment.order_id === rzpOrderId` (`paymentController.js:512`). Mismatches return HTTP 400.
- **Replayed Valid Payload:** Intercepted by `findOrderByRazorpayOrderId:566` and returns idempotent success with existing order ID without creating duplicate orders.
- **Verdict:** **PASS**

### 4. Viewing Order Success for Unpaid or Other User's Order
- **API Ownership Guard:** `orderController.js:275-309` verifies `order.customer_id === req.wpUserId` or billing email match. Unauthorized users receive HTTP 403 `FORBIDDEN_ORDER_ACCESS`.
- **Frontend Vulnerability:** In `OrderSuccess.jsx:24-42`, the catch block ignores API errors and displays "Order placed successfully! 🎉".
- **Impact:** While no private customer data is leaked (the API blocks it), the UI falsely confirms an unpaid or non-existent order.
- **Verdict:** **FAIL (Frontend UI State Confusion)**

### 5. Webhook Replay & Spoofing
- **Tampered Webhook:** Rejected with HTTP 400 `Invalid webhook signature`.
- **Replayed Webhook:** Caught by `serverCache.get("webhook:event:" + eventId)`. Acknowledged with HTTP 200 `_idempotent: true`.
- **Verdict:** **PASS**

### 6. Checkout Rate Limiter Exhaustion (`checkoutLimiter: 5 per 5 min`)
- **Vulnerability:** In `apps/backend/src/routes/paymentRoutes.js:34`, `checkoutLimiter` is mounted *before* `requireIdempotency`.
- **Impact:** A legitimate user retrying payment on a flaky connection or changing payment methods will exhaust 5 attempts in 5 minutes and receive HTTP 429 ("Too many checkout attempts. Please try again in a few minutes").
- **Verdict:** **FAIL (Denial of Service for Legitimate Users)**

### 7. Cash on Delivery (COD) Abuse / Fake Orders
- **Vulnerability:** In `apps/backend/src/routes/storeRoutes.js:124-126` and `306-311`, phone verification checks are omitted, and `req.isPhoneVerified = true` is hardcoded.
- **Impact:** Anyone with an account (including newly registered accounts with fake mobile numbers) can place unlimited COD orders without OTP verification.
- **Verdict:** **FAIL (High Fraud Exposure)**

---

## PART 3 — WHAT THE USER SEES & CAN DO

### 1. Unknown Outcome State Handling
- **Requirement:** System must display "Checking your payment status..." (not premature failure or success) while polling the server with backoff.
- **Current State:** If verification fails or times out, `BillingForm.jsx:457` jumps immediately to an alarming error: *"Payment verification could not be completed. Please check your order history or contact support."*
- **Fix Required:** Implement a transitional modal/banner ("Checking payment status with bank...") that polls `/api/payments/check-status` for up to 30 seconds before declaring failure.

### 2. Recovery Without Support Intervention
- **Current State:**
  - If user closes tab and reopens `/checkout`: Self-recovery works seamlessly via `Checkout.jsx:36` (`getPendingPayment()`).
  - If user experienced a verification timeout: Defect in `BillingForm.jsx:458` clears `pendingPayment`, breaking auto-recovery on `/checkout`. User must navigate manually to Account > Orders.
- **Fix Required:** Do not clear `pendingPayment` on network timeouts or 5xx gateway errors.

### 3. Debited-But-No-Order Experience
- **Detection & Action:** Background reconciler detects captured payment within 10 minutes. If stock is intact, order is finalized. If stock ran out, full refund is issued automatically to the customer's bank card/UPI account, and an email notification is sent via Brevo.
- **Support Contact Visibility:** The failure state banner displays a generic message without a direct WhatsApp support or phone link.

---

## PART 4 — TECHNICAL SEO & DISCOVERABILITY AUDIT

```
Live Googlebot Raw HTML Inspection:
$ curl -s -A "Googlebot" http://localhost:5173/ | grep -E "(<title>|<div id=\"root\">|<meta name=\"description\")"
  <title>Mumbai Collection</title>
  <meta name="description" content="Shop toys, stationery, school supplies, and everyday essentials at Mumbai Collection in Vasai." />
  <div id="root"></div>
```

### 1. Googlebot Raw HTML vs. Rendered DOM (Empty SPA Shell)
- **Observed Result:** Every route (Home, Categories, Product Details, Legal Pages) returns the exact same 47-line HTML shell containing `<div id="root"></div>`.
- **Search Engine Consequence:** Google's Web Rendering Service (WRS) must perform a second-wave JavaScript render to discover catalog content. Crawlers without JS execution (social sharing bots on WhatsApp, Instagram, Telegram, Pinterest) index nothing.

### 2. Per-Route Title, Meta Description, Canonical & Social Previews
- **Code Audit:** In `apps/customer-web/index.html`, meta tags are completely static.
- **React Audit:** Searching `apps/customer-web` for `document.title` and `react-helmet` reveals **zero** dynamic title or meta tag management on product or category pages.
- **Social Sharing Hazard:** When a customer shares a product link (e.g. `https://mumbaicollection.in/product/barbie-doll`) on WhatsApp or Instagram, the preview displays:
  - Title: *Mumbai Collection | Toys & Stationery Store*
  - Image: *https://mumbaicollection.in/favicon.svg*
  - Description: *Shop toys, stationery... in Vasai.*
  - The actual product title, price, and image are completely invisible.

### 3. Soft 404 Defect
- **Test:** `GET http://localhost:5173/non-existent-route-12345`
- **Observed Result:** Returns HTTP status **200 OK** with the standard SPA HTML shell.
- **Impact:** Search engine bots crawling discontinued product URLs or deleted categories receive HTTP 200 instead of 404 or 410. This leads to index bloat, duplicate content penalties, and wasted crawl budget.

### 4. Sitemap & Robots.txt Coverage
- **Robots.txt:** Correctly disallows `/account`, `/checkout`, `/cart`, `/orders`, `/track-order`, `/api/`.
- **Sitemap.xml Defect:** `apps/customer-web/public/sitemap.xml` contains only **6 static URLs**:
  - `https://mumbaicollection.in/`
  - `https://mumbaicollection.in/categories`
  - `https://mumbaicollection.in/contact`
  - `https://mumbaicollection.in/privacy-policy`
  - `https://mumbaicollection.in/terms`
  - `https://mumbaicollection.in/return-policy`
- **Omissions:** **0 product URLs** (`/product/:slug`), **0 category URLs** (`/category/:slug`), missing `/shipping-policy`, and missing `<lastmod>` timestamps.

### 5. Structured Data (JSON-LD)
- **Audit:** Zero JSON-LD tags exist in the frontend codebase.
- **Missing Schemas:**
  - `Product` + `Offer` (price, priceCurrency, availability: InStock/OutOfStock).
  - `BreadcrumbList`.
  - `LocalBusiness` / `Store` (Vasai store address, phone, opening hours).
- **Impact:** Complete forfeiture of Google Rich Results (price badges, star ratings, stock status, local pack carousel).

### 6. SSR / SSG / Prerender Evaluation Matrix

| Strategy | Feasibility & Effort | SEO & Social Sharing Impact | Operational Risk | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **Edge Prerendering (e.g. Prerender.io / Cloudflare Worker Prerender)** | Low effort (S) | Solves Googlebot & WhatsApp/Instagram preview problem instantly without refactoring React SPA. | Low; fallback to SPA shell if edge service is slow. | **Recommended for Launch** |
| **Vite SSG (Static Site Generation for Catalog Routes)** | Medium effort (M) | Generates static HTML for all product and category slugs at build time. | Medium; requires build trigger when product details or prices change. | Good First-Month Upgrade |
| **Full Framework Migration (Next.js / Remix)** | Very High effort (L) | Full SSR/ISR capabilities. | High; requires rewriting routing, context providers, and build pipeline. | Later (Not Recommended now) |

---

## PART 5 — OTHER USER BEHAVIOR GAPS

1. **E-Commerce Funnel Analytics:**
   - No Google Analytics 4 (GA4) `begin_checkout`, `add_payment_info`, or `purchase` events are tracked.
   - Cart abandonment cannot be monitored in analytics dashboards.
2. **Missing Legal & Trust Links on Checkout:**
   - `BillingForm.jsx` lacks links to Privacy Policy, Terms of Service, Return Policy, and Shipping Policy.
   - Violates Indian Consumer Protection (E-Commerce) Rules, 2020 and Razorpay compliance requirements.
3. **Mobile Keyboard Overlay:**
   - On narrow mobile viewports (< 375px), opening the on-screen keyboard while filling address lines can obscure the fixed bottom action button.
4. **Form Validation Feedback:**
   - Address fields validate phone numbers and required strings, but pincode validation relies on a simple regex without informing the user if the pincode is outside serviceable delivery zones until backend rejection.

---

## OUTPUT A — SCENARIO MATRIX

| # | Scenario | Tested How | Money Safe? | Order/Stock State | What User Sees | Recoverable? | Verdict | Evidence |
| :-: | :--- | :--- | :-: | :--- | :--- | :-: | :-: | :--- |
| **1** | Close tab before payment window opens | Code trace & test order create | Yes | 0 WC orders; stock untouched; intent in DB | Cart intact on reopen | Yes | **PASS** | `paymentController.js:11, 439` |
| **2** | Close tab while payment window open | Code trace & timeout verification | Yes | 0 WC orders; stock untouched | Cart intact on reopen | Yes | **PASS** | `paymentController.js:439` |
| **3** | Close tab after paying, before client verify | Code trace & recovery logic | Yes | Webhook/reconciler creates WC order in `processing` | Redirects to success on `/checkout` reopen | Yes | **PASS** | `paymentController.js:1004` |
| **4** | Refresh on payment / success / failure page | Page reload in browser & code trace | Yes | Success re-fetches; checkout recovers pending | Preserved state; success displays summary | Yes | **PASS** | `Checkout.jsx:36`, `OrderSuccess.jsx:27` |
| **5** | Back button after success / mid-payment | Browser history simulation | Yes | Empty cart on checkout; modal dismiss handled | "Cart is empty" or "Payment cancelled" | Yes | **PASS** | `BillingForm.jsx:401` |
| **6** | Same cart in two tabs: pay in one, edit other | State sync trace | Yes | Paid items snapshotted; server cart cleared | Tab 2 detects items changed, resets pending | Yes | **PASS** | `paymentController.js:786`, `BillingForm.jsx:123` |
| **7** | App switch / low-memory kill during OTP | VisibilityChange trace | Yes | Order created via webhook/reconciler | Automatically polls and redirects to success | Yes | **PASS** | `BillingForm.jsx:151` |
| **8** | Offline before clicking Pay | Network offline simulation | Yes | No request leaves browser | "Unable to load secure payment gateway" | Yes | **PASS** | `BillingForm.jsx:340` |
| **9** | Network drops after order create request | Idempotency replay test | Yes | Reuses same `razorpay_order_id` via idempotency | Reopens existing payment modal | Yes | **PASS** | `idempotencyMiddleware.js:89` |
| **10** | Network drops during authorization (30s-10m) | Reconciler & webhook flow | Yes | Webhook / reconciler creates WC order | Auto-recovers on next visit | Yes | **PASS** | `reconciliationService.js:328` |
| **11** | Network drops after capture, verify times out | Verification error inspection | Yes | Order created on server | "Verification failed"; clears pending storage | **Partial** | **PARTIAL** | `BillingForm.jsx:458` |
| **12** | Switch Wifi <-> Mobile Data mid-payment | Cookie & CSRF validation test | Yes | Session preserved; CSRF valid; not logged out | Seamless checkout continuation | Yes | **PASS** | `authMiddleware.js:78`, `csrfMiddleware.js:90` |
| **13** | Very slow 3G (10-20s latency) | Timeout configuration check | Yes | Double submission blocked by ref spinner | Loading spinner displayed for 30s | Yes | **PASS** | `BillingForm.jsx:233`, `paymentService.js:18` |
| **14** | Server 503 during verification | Reconciler retry evaluation | Yes | Retained in `paid`; retried for 15m; auto-refunded | Temporary error; funds protected | Yes | **PASS** | `paymentController.js:841`, `reconciliationService.js:185` |
| **15** | UPI intent to different browser | Session isolation analysis | Yes | Order finalized on server | Must log in to view in `/orders` | **Partial** | **PARTIAL** | `BillingForm.jsx:89` |
| **16** | Popup blocked / In-app browser | SDK inspection | Yes | Standard iframe injected; no popup blocked | Normal checkout modal | Yes | **PASS** | `BillingForm.jsx:63` |
| **17** | Store closes or item sells out mid-payment | Code logic analysis | Yes | Store close proceeds; sold out triggers auto-refund | "Item out of stock; automatically refunded" | Yes | **PASS** | `paymentController.js:658, 703` |
| **18** | Abandoned payment stock release | Architecture invariant trace | Yes | 0 stock held pre-capture; no cleanup needed | Resume checkout anytime | Yes | **PASS** | `paymentController.js:11` |
| **19** | Failed retry, replayed webhooks, out-of-order | Webhook handler trace & test | Yes | Distributed lock + event caching prevents duplicate | Immediate retry permitted on failure | Yes | **PASS** | `paymentController.js:546, 1073` |
| **20** | COD double-click / submit from two tabs | Idempotency & session trace | Yes | Idempotency middleware blocks duplicate order | First order succeeds; second shows processed | Yes | **PASS** | `storeRoutes.js:324-329` |

---

## OUTPUT B — FINDINGS TABLE (SORTED BY SEVERITY)

| ID | Where (file:line) | Problem | Scenario | Impact | Fix (Smallest Safe Change) | How to Verify | Effort |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **CRIT-01** | `apps/backend/src/routes/storeRoutes.js:124-126`, `306-311` | Cash on Delivery (COD) does not enforce phone verification; hardcodes `req.isPhoneVerified = true`. | Anyone placing COD order. | **Critical:** Attackers can register accounts with fake numbers and place unlimited COD orders, inflicting heavy courier return costs. | Enforce `if (!sessionData.isPhoneVerified) return res.status(403).json({ code: "PHONE_NOT_VERIFIED" })` in `proxyStoreApi` and `resolveCheckoutCustomer`. | Send COD request from unverified customer cookie; expect 403. | **S** |
| **HIGH-01** | `apps/customer-web/src/components/checkout/BillingForm.jsx:457-465` | `catch (verifyErr)` clears `pendingPayment` on network timeout or 5xx error. | Network drop immediately after payment capture. | **High:** Destroys client-side recovery key. User sees error banner and hard refresh fails to auto-redirect to order success. | Only clear `pendingPayment` on definitive 4xx terminal errors; retain it on timeouts and 5xx errors. | Trigger 504 on verify endpoint; confirm `localStorage` preserves `mumbai_pending_payment`. | **S** |
| **HIGH-02** | `apps/customer-web/src/pages/OrderSuccess.jsx:24-42` | `OrderSuccess.jsx` catches API error and renders "Order placed successfully! 🎉" for non-existent or unpaid orders. | User accesses `/order-success/99999` directly. | **High:** False confirmation of orders; potential social engineering/fraud exploitation. | If `getOrderById` returns error (401/403/404), display an error screen ("Order Not Found or Access Denied") with a link to shop. | Open `/order-success/999999` in browser; verify error screen is displayed. | **S** |
| **HIGH-03** | `apps/customer-web/index.html:1-47` & catalog pages | Empty SPA `<div id="root"></div>` shell; static meta tags; no dynamic title or OpenGraph previews for products. | Search bot crawls catalog; user shares product link on WhatsApp/Instagram. | **High:** Zero social share previews (shows generic site title and favicon); severe delay in Google indexation. | Implement dynamic meta tag updater (`react-helmet-async` or document title hook) plus Edge Prerendering for bots. | Run `curl -A "WhatsApp/2.0"` against product URL; verify product title and image. | **M** |
| **HIGH-04** | `apps/customer-web/public/sitemap.xml:1-34` | Sitemap contains only 6 static URLs; 0 products and 0 categories included; missing `<lastmod>`. | Googlebot sitemap ingestion. | **High:** Search engines cannot discover product catalog through XML sitemap. | Generate dynamic `sitemap.xml` from backend catalog API listing all published products and categories. | Fetch `/sitemap.xml`; verify all product slugs and `<lastmod>` tags exist. | **M** |
| **MED-01** | `apps/backend/src/routes/paymentRoutes.js:34` | `checkoutLimiter` (5 per 5 min) executes *before* `requireIdempotency`. | Legitimate user retrying payment on flaky 4G network. | **Medium:** Legitimate buyers get locked out with HTTP 429 for up to 300 seconds. | Move `requireIdempotency` *before* `checkoutLimiter`, or increase `checkoutLimiter` max to 15 per 5 min. | Send 6 requests with same `X-Idempotency-Key`; verify it does not trigger 429. | **S** |
| **MED-02** | `apps/customer-web/src/components/checkout/BillingForm.jsx` | Checkout page missing required links to Terms, Privacy, Returns, and Shipping policies. | Customer checkout inspection. | **Medium:** Non-compliance with Indian E-Commerce Rules and Razorpay merchant policy. | Add compact footer note below Place Order button with links to `/terms`, `/privacy-policy`, `/return-policy`, and `/shipping-policy`. | Inspect checkout page DOM; confirm all 4 policy links are visible and functional. | **S** |
| **MED-03** | `apps/backend/src/middlewares/idempotencyMiddleware.js:8-27` | Idempotency store uses in-process `Map` rather than distributed Redis or MySQL table. | Clustered/multi-container backend deployments. | **Medium:** Concurrent duplicate requests routed to different server processes bypass process-memory idempotency. | Persist idempotency records in WordPress MySQL table `wp_idempotency_keys` or Redis. | Run two Node processes behind round-robin proxy; verify duplicate replay is blocked. | **M** |
| **MED-04** | `apps/customer-web/src/components/checkout/BillingForm.jsx:433-470` | No backoff polling modal ("Checking payment status...") on unknown outcomes. | Delayed capture or network hiccup. | **Medium:** Premature error banner alarms customer while payment is actively processing. | Add a 30-second backoff polling modal calling `checkPaymentStatus` every 3 seconds before displaying failure. | Simulate 5-second verify delay; verify spinner displays "Checking payment status with bank...". | **M** |
| **LOW-01** | `apps/customer-web/src/pages/OrderSuccess.jsx` & `Checkout.jsx` | Missing GA4 / Meta Pixel e-commerce tracking and purchase event deduplication. | Analytics tracking across funnel. | **Low:** Inability to measure funnel conversion or ROAS. | Implement e-commerce dataLayer push on checkout and deduplicated purchase event on success. | Inspect browser console dataLayer on order completion. | **M** |

---

## OUTPUT C — TECHNICAL SEO SCORECARD

| Check | Result | Evidence | Fix |
| :--- | :---: | :--- | :--- |
| **Googlebot Raw HTML** | **FAIL** | `curl -s -A "Googlebot" http://localhost:5173/` returns empty `<div id="root"></div>`. | Implement Edge Prerender or SSG for catalog routes. |
| **Per-Route Title & Meta Description** | **FAIL** | All pages render `<title>Mumbai Collection</title>` from `index.html`. | Add per-route title/meta tags using `react-helmet-async` or a route hook. |
| **Social OpenGraph / Twitter Cards** | **FAIL** | All URLs share `og:title="Mumbai Collection | Toys & Stationery Store"` and `og:image="favicon.svg"`. | Inject dynamic `og:title`, `og:description`, `og:image` from product API data. |
| **Soft 404 Handling** | **FAIL** | `GET /non-existent-route-12345` returns HTTP status **200 OK**. | Configure server/edge to return HTTP 404 for unmatched catalog slugs. |
| **robots.txt Directives** | **PASS** | Correctly disallows private account and checkout routes. | Add disallow for search queries (`Disallow: /*?*s=`). |
| **sitemap.xml Catalog Coverage** | **FAIL** | Only 6 static pages; 0 products, 0 categories, 0 `<lastmod>`. | Dynamically generate sitemap from WooCommerce catalog API. |
| **Structured Data (JSON-LD)** | **FAIL** | Zero `ld+json` scripts found in codebase. | Add `Product`, `Offer`, `BreadcrumbList`, and `Store` JSON-LD schemas. |
| **Local SEO (Vasai Business Details)** | **PARTIAL** | Address in footer, but no LocalBusiness schema or delivery-area pages. | Add `LocalBusiness` JSON-LD schema with address, coordinates, and hours. |
| **Mobile Core Web Vitals Readiness** | **PASS** | Lightweight Vite bundle with responsive Tailwind CSS layout. | Preconnect font origins and ensure responsive image `srcset`. |
| **Google Merchant Center Feed** | **FAIL** | No automated XML/CSV product feed available. | Create `/api/catalog/merchant-feed.xml` backend endpoint. |

---

## OUTPUT D — TOP 10 FIXES IN PRIORITY ORDER

### Before Launch (Immediate Blockers)
1. **Fix CRIT-01:** Enforce phone verification on Cash on Delivery (`storeRoutes.js`).
2. **Fix HIGH-01:** Prevent `BillingForm.jsx` from wiping `pendingPayment` on verification timeouts.
3. **Fix HIGH-02:** Guard `OrderSuccess.jsx` so unverified/error orders do not display "Order placed successfully! 🎉".
4. **Fix MED-01:** Reorder or loosen `checkoutLimiter` so legitimate retries on flaky networks do not trigger HTTP 429.
5. **Fix MED-02:** Add required legal/policy links (Terms, Privacy, Returns, Shipping) to the Checkout page.

### First Month (High Value Upgrades)
6. **Fix HIGH-03:** Implement dynamic meta tags and Edge Prerendering for catalog pages (resolves Googlebot and WhatsApp/Instagram previews).
7. **Fix HIGH-04:** Implement dynamic `sitemap.xml` endpoint with product and category slugs.
8. **Fix MED-04:** Add 30-second backoff polling modal ("Checking payment status...") on checkout.
9. **Fix Scorecard JSON-LD:** Add `Product` and `LocalBusiness` JSON-LD structured data.

### Later (Scalability & Optimization)
10. **Fix MED-03:** Migrate in-memory idempotency cache to MySQL/Redis for distributed horizontal scaling.

---

## OUTPUT E — NOT TESTED LIST (MANUAL & CONSOLE VERIFICATION STEPS)

The following items cannot be fully verified via local automated tests alone and require production console or physical device checks:

1. **Razorpay Live Dashboard Webhook Configuration:**
   - **Check:** Log into [Razorpay Dashboard](https://dashboard.razorpay.com/) > Settings > Webhooks.
   - **Verify:** Active webhook points to `https://<domain>/api/payments/webhook`.
   - **Events Subscribed:** `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`.
   - **Secret:** Ensure the configured webhook secret matches `RAZORPAY_WEBHOOK_SECRET` in server environment.
2. **Google Search Console URL Inspection:**
   - **Check:** In Search Console, enter `https://mumbaicollection.in/` and click "Test Live URL".
   - **Verify:** Inspect the "View Tested Page" screenshot and DOM to confirm Googlebot renders catalog content.
3. **Google Business Profile (GBP) Consistency:**
   - **Check:** Verify store Name, Address (Vasai West), Phone Number, and Operating Hours match the site's footer and store hours service exactly.
4. **Physical Phone Test in Hostile Network Conditions:**
   - **Check:** On a real Android device with low battery and poor 4G signal:
     - Initiate payment via UPI intent (GPay/PhonePe).
     - Switch airplane mode ON for 10 seconds before completing bank authorization, then turn airplane mode OFF.
     - Return to the browser and confirm the order automatically navigates to Order Success.
