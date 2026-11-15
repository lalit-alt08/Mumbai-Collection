# Independent customer storefront risk review

Date: 2026-11-15. Scope: the ten existing customer audit documents, current
customer storefront, relevant Node routes/services, and selected custom-plugin
integration points. This is a source review with targeted mocked tests; it is
not a penetration test, a production load test, or proof that every branch is
safe. No application behavior was changed as part of this review.

The earlier documents are useful feature maps, but some are outdated. For
example, the index contains duplicate tables, a checkout entry marked pending
alongside one marked complete, and filesystem links that do not point to the
present audit directory. Validate claims against current code and tests.

## Findings, ordered by priority

### High: support-required payment can lose its local recovery reference

**Evidence:** `apps/backend/src/controllers/paymentController.js:1448` returns
`terminal: true` and `support_required: true` for an escalated payment, with a
message telling the customer not to pay again. `usePendingPayment.js:72-80`
treats any terminal state alike, removes the pending-payment record and retires
the idempotency key. Similar terminal handling is in `useRazorpayCheckout.js:244`
and `pages/Orders.jsx:147`. The checkout UI derives its active-pending state
from that stored record (`BillingForm.jsx:417-419`).

**Impact:** the support reference and blocking state can disappear while the
payment still needs staff review; a customer may start a new attempt despite the
warning. This is a source-traced risk; an actual duplicate charge was not tested.
Confirm the full UX in staging using a simulated escalation. Treat
`support_required`, pending refunds, completed refunds and safely cancelled
attempts as distinct states. Preserve a recoverable reference and a clear support
message until the business-defined resolution, with tests across reloads and tabs.

### High: wishlist updates can overwrite each other across Node workers

**Evidence:** `apps/backend/src/services/favoritesService.js:46-60` serializes
mutations with an in-process `Map`; `:121-142` and `:172-193` do a fresh read
followed by a whole-list write. Separate processes do not share this lock. The
per-process read cache lasts 60 seconds (`:18,75-76`), so workers can also
briefly return different results.

**Reproduction:** with mocked WooCommerce and two isolated module instances
representing workers, simultaneous additions of items 2 and 3 to `[1]` ended
as `[1,3]`, losing item 2. This demonstrates the application-level race, not a
live multi-server WordPress test. It applies when concurrent requests reach
different processes or instances; a single process uses its local lock.

**Recommendation:** move each add/remove to a genuinely atomic authoritative
operation, or implement a cross-process concurrency strategy with verified
failure behavior and cache invalidation. Test simultaneous adds/removes across
workers and outage recovery. Avoid adding extra WooCommerce reads as a substitute
for atomic writes.

### Medium: wishlist errors can look like an empty account

**Evidence:** `favoritesService.js:90-101` returns an empty list if a customer
metadata fetch fails and no cached list exists. `favoritesController.js:55-72`
returns success with zero favorites. Product hydration also logs rejected
WooCommerce requests but returns success (`:87-120`); `Favorites.jsx` shows
“No saved favorites yet” when its list is empty.

**Reproduction:** a mocked WooCommerce outage returned HTTP 200 with
`success: true`, `count: 0`, `favorites: []`. This does not itself erase saved
favorites, but it misleads the customer and masks a service failure.
Return a recoverable error or explicit degraded/stale state, and show retry UI.
Preserve the existing fail-closed behavior on mutation reads.

### Medium: shared cart silently omits unavailable products

**Evidence:** `productController.js:219-238` filters the `/products/by-ids`
response to in-stock products even when the customer requests selection details.
The shared-cart flow at `customer-web/src/pages/Cart.jsx:141-150` drops IDs not
returned. Its later out-of-stock display path (`:156-177`) cannot show an item
already removed from the response.

**Impact:** a partially unavailable shared cart can appear incomplete without
explaining which items disappeared. This is a source-traced behavior; test with
one available and one unavailable product, including variations. Consider a
selection-specific response that represents unavailable IDs without making them
purchasable; do not weaken checkout's authoritative stock checks.

### Medium: callback logs can contain unsanitized request fields

**Evidence:** `apps/backend/src/controllers/paymentController.js:1383-1385`
logs the entire callback body when required fields are missing. Pino redaction in
`utils/logger.js:34-39` covers selected names and paths, not every possible body
field or payment signature. An incomplete callback can contain a signature or
other unanticipated sensitive data. No real callback data was accessed.

**Recommendation:** log only an allowlisted error reason and presence flags;
avoid raw callback bodies. Test redaction with partial and malformed payloads.
Review log access and retention as part of operations.

### Medium: `/auth/me` performs a WooCommerce customer read on every successful customer request

**Evidence:** `authController.js:373-384` calls `wcApi.get(customers/${userId})`
for every successful customer `/me`, even when session data is already available.
The storefront calls `/me` on session restoration and explicit refresh; when
reconnecting it can retry every 10 seconds while visible (`AuthContext.jsx:63,
261-263,315-328`). Retries occur only while reconnecting, not continuously for
every signed-in session.

**Impact:** each relevant successful call adds a WooCommerce customer read and
its latency; the actual production volume was not measured. Consider a short,
per-user profile cache or targeted lookup only when data is incomplete, with
invalidation on profile changes and careful protection against cross-user data.
Keep session, role and revocation checks authoritative.

### Medium: wishlist stock refresh ignores older loaded pages

`Favorites.jsx:23` passes only the last 24 loaded items to `useLiveProductStock`.
When more pages are loaded, earlier displayed items stop receiving this refresh.
Stock can therefore look stale until another authoritative check. The checkout
still has its own stock checks; no oversell is established here. Test a wishlist
over 24 items and consider refreshing the visible viewport or a bounded rotating
set rather than polling an unlimited list.

### Medium: tracking polling can reschedule after cleanup

In `TrackOrder.jsx:171-176`, the timer awaits `fetchOrder` and then calls
`scheduleNextPoll()`. Cleanup at `:199-203` clears the current timer and aborts
the request, but the scheduled callback has no disposed guard before scheduling
again after the await. An unmount or order change during a request can therefore
leave another timer scheduled. This is a source-traced race; reproduce with a
delayed request and navigation. Add a lifecycle guard and verify no background
requests continue after leaving the page.

### Low: duplicated and unmeasured polling can add load

`useLiveProductStock.js` runs every 30 seconds while visible, refreshes on mount
and wake, and has a 15-second wake cooldown. Several pages and components use
independent hook instances; product detail and related products can poll at the
same time. Node caches exact stock-ID batches for five seconds in
`productController.js:245-250`. Requests are batched and hidden tabs are
skipped, which are useful protections; neither network volume nor WooCommerce CPU
was measured. Instrument cache hit rates and requests per route before changing
intervals; consider shared polling or viewport-based refresh if data warrants it.

## Feature-by-feature coverage

| Feature | Findings and observations |
| --- | --- |
| Home/discovery | Homepage shelves use a bounded four-worker pool and caching. Stock polling is a load candidate; measure cold and warm requests. |
| Catalog/category/search | Pagination, rate limiting and caching exist. The stock poll finding applies; earlier local category/search suite failures remain unresolved. Test filtered pagination, no-result and upstream failure cases. |
| Product details | Product HTML is sanitized by DOMPurify (`components/product/ProductDescription.jsx`). Detail and related components have separate stock hooks. Sanitization was inspected, not penetration-tested. |
| Cart/share | Shared-cart unavailable items can disappear as described above. Variation lookup uses bounded concurrency; authoritative checkout validation remains essential. |
| Checkout/payment | Escalated/terminal recovery state needs attention. Owner confirmed valid delivery contact is sufficient for paid checkout; account-phone verification is not required for that path. See test limitations below. |
| Addresses/zones | Customer authentication and server validation are present. The prior address-lock changes need a real concurrent database test and address-update/delete regression checks; no new confirmed address defect found in this pass. |
| Orders/invoices | The order controller checks customer ownership on individual orders and filters listing results by customer ID. Verify invoices, guest/legacy orders and cross-account access in isolated integration tests. |
| Tracking | Polling cleanup race described above. Tracking checks ownership through the customer order endpoint. Test terminal states, hidden tabs, slow networks and navigation. |
| Authentication/onboarding | Session role, expiry and revocation checks exist; `/me` WooCommerce load noted above. Run real WordPress/Redis outage, role isolation and passwordless account tests before release. |
| Profile/wishlist | Wishlist outage, concurrent mutation and stock-refresh findings above. Account deletion is sensitive; use staging accounts and verify the Google-only and password flows. |

These observations are not a complete security guarantee. Automated tools do not
replace tests against a configured staging deployment and a review of external
service settings.

## Verification and limitations

* Customer frontend tests: `pnpm test` in `apps/customer-web` — 154 passed.
* Targeted payment/order/stock backend test selection: 81 reported tests,
  52 passed and 29 failed (Node counts parent suite failures as well as failing
  subtests). Some callback tests reported `fetch failed`; exact environment cause
  was not established. Durable reconciliation had 7 failing subtests, including
  a test double missing `fetchMultipleRefund`; other mismatches need individual
  investigation. These failures do not prove live payments are broken, and they
  do mean the payment safety claims are not fully verified by this run.
* Wishlist outage and concurrent-write reproductions used mocked WooCommerce;
  no customer data or production systems were changed.
* No browser journey, real payment, real WordPress concurrency test, load test,
  dependency vulnerability scan, or full security penetration test was performed.
* The repository contains staged and unstaged changes. Findings describe the
  current working tree and can change with subsequent edits.

## Suggested order of work

1. Reproduce the support-required payment UX and implement a safe recovery state.
2. Resolve payment/reconciliation test failures and run the full backend suite in
   an isolated CI-like environment; then exercise test-mode capture, duplicate
   callbacks, refund and webhook races against staging.
3. Fix cross-worker wishlist mutation and outage reporting; test the real shared
   database and multiple workers.
4. Fix shared-cart availability and tracking cleanup; add focused regressions.
5. Measure `/me`, catalog/stock and tracking request rates and upstream latency
   before changing cache TTLs or polling intervals.
6. Verify addresses, account deletion, order ownership, and customer role isolation
   end to end with separate staging users. Update the old audit index after review.
