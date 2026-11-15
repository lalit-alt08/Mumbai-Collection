# Independent employee panel risk review

Date: 15 November 2026

## Scope and confidence

Reviewed the eight employee feature documents as a checklist and traced representative frontend, Node routes/controllers and WordPress integration in the current working tree. This is a source-based risk review plus the tests listed below, not proof that every path is safe. The repository contains existing staged, unstaged and untracked work; this report reflects that working tree. No application code was changed for this review.

Evidence labels: **source-confirmed** means the stated behavior follows directly from the implementation; it does not imply a live production reproduction. **Needs reproduction** means the risk follows from the asynchronous flow or environment but was not demonstrated in a real browser or multi-worker deployment.

## Findings, in priority order

### 1. High — dashboard can show zero orders or stock during an upstream outage

**Source-confirmed.** `apps/backend/src/controllers/employeeController.js:466` catches failures from individual WooCommerce/WordPress requests and replaces them with empty arrays or zeros (`:482–516`). The result is then returned as `success: true` and cached for 90 seconds (`:570–590`). If the relevant sources fail, staff can see zero orders or no low-stock products even though the real data is unknown. The failure can persist in the cache after recovery. The dashboard also uses the count to decide whether to announce new orders (`apps/employee-panel/src/pages/Dashboard.jsx:68`).

**Recommendation:** distinguish zero from unavailable. Return per-section degraded/error indicators, retain clearly dated last-known values where appropriate, and avoid caching a fabricated zero as a healthy response. Test individual and simultaneous upstream failures, recovery, and notification behavior.

### 2. High — product creation assumes ten units when staff have not entered stock

**Source-confirmed; business-rule risk.** The add-product form starts with `stock_quantity: 10` (`apps/employee-panel/src/pages/AddProduct.jsx:58`); the backend also defaults an omitted quantity to 10 (`apps/backend/src/controllers/adminProductController.js:551`) and its schema allows omission (`apps/backend/src/middlewares/requestValidation.js:135–139`). An employee who overlooks the prefilled value can publish a product with ten units that may not exist. This is not an authorization bypass, but it can cause overselling if the number is not verified.

**Recommendation:** ask the store owner whether ten is intentional. If not, require an explicit quantity or use a safe zero/draft default. Confirm WooCommerce stock and storefront behavior in an end-to-end test.

### 3. Medium — concurrent banner edits can overwrite each other

**Source-confirmed from write path; simultaneous-user test still needed.** The employee page sends the entire locally held banner array for each edit (`apps/employee-panel/src/pages/Banners.jsx:151–163`), the Node service forwards that array (`apps/backend/src/services/bannerService.js:194–230`), and WordPress replaces the option (`mumbai-auth.php:3310`). No expected version is supplied in this path. Two employees editing different banners from stale snapshots can save in sequence; the later whole-array save can erase the earlier change. The idempotency key addresses duplicate requests, not conflicting edits. The thin banner is also saved as a whole separate object (`mumbai-auth.php:3404`).

**Recommendation:** use a server-side version/compare-and-set, reject stale saves with a clear reload message, or perform an atomic targeted update. Test two sessions and both edit orders, including thin-banner edits.

### 4. Medium — internal error details may be returned to staff

**Source-confirmed.** Employee order handlers use upstream `message` or `error.message` directly in responses (`apps/backend/src/controllers/employeeController.js:272–275`, `:293–295`, `:323–325`). Banner and upload handlers use similar patterns (`apps/backend/src/controllers/bannerController.js:124,159`; `apps/backend/src/controllers/employeeController.js:86–88`). A service or database error can therefore reveal internal paths or service details to an authenticated employee. This finding does not establish that unauthenticated customers can call these protected routes.

**Recommendation:** map recognized business errors to safe messages and codes, return a generic message for unexpected upstream failures, and retain diagnostic details in appropriately redacted server logs. Add tests containing a fake internal path and secret in upstream errors.

### 5. Medium — screen wake lock can race with disable or a second request

**Needs browser reproduction; source-level race.** `apps/employee-panel/src/hooks/useWakeLock.js:23–32` checks only an already-resolved sentinel and does not track an in-flight request. Both the enabled effect and the toggle path can request a lock (`:53–59`, `:88–100`). A request that resolves after disable/unmount can still set a lock; overlapping requests can replace the tracked sentinel, and an old release event can clear the newer reference. This can lead to an incorrect indicator or a screen remaining awake unexpectedly. Browser behavior varies.

**Recommendation:** serialize requests, check current enabled/mounted state when the promise resolves, release unwanted late locks, and only clear the reference for the matching sentinel. Test delayed promises, rapid toggles, background/foreground and unmount, then test supported phones.

### 6. Medium — order page sends regular polling requests even with the live stream open

**Source-confirmed; actual load not measured.** `apps/employee-panel/src/pages/Orders.jsx:509–568,602–608` opens an event stream but also calls alarm and list checks every eight seconds while visible. That is up to 7.5 scheduled cycles per minute per visible tab, with up to two client checks per cycle; in-flight coalescing and skips reduce actual traffic (`apps/employee-panel/src/utils/ordersPipelineCoordinator.js:88–104`). It is not valid to assume every check always reaches WooCommerce. This load grows with staff tabs and workers, but polling also provides recovery when events are missed.

**Recommendation:** measure Node request rate, WordPress calls, query duration, reconnects and alarm delay with realistic active tabs. Consider slower safety polling when the stream is healthy while retaining a tested recovery mechanism; avoid eliminating fallback blindly.

### 7. Medium — dashboard browser cache is not scoped to a session

**Source-confirmed, impact dependent on shared-device workflow.** `apps/employee-panel/src/pages/Dashboard.jsx:29–35,84` stores the last overview in a module variable without a user key or age limit. In a single browser tab, a logout and another login can initially render that old data, and a background refresh failure need not display an error (`:89–100`). The overview contains operational order information. This does not grant access to protected APIs, and the data may be shared legitimately by staff.

**Recommendation:** clear cache on logout/session changes or bind it to the current identity, and show when displayed data is stale or refresh fails. Test sequential staff sessions in one tab.

### 8. Low — image upload instructions disagree with validation

**Source-confirmed.** Add Product describes images up to 10 MB (`apps/employee-panel/src/pages/AddProduct.jsx:910`), but checks for 5 MB after compression (`:299`). The text can mislead staff, although a larger original may pass if compressed sufficiently.

**Recommendation:** state the actual post-compression limit and test large JPEG/PNG/WebP and unsupported HEIC messages on target phones.

## Feature-by-feature coverage

| Feature | Reviewed and findings | Remaining verification |
| --- | --- | --- |
| Dashboard | Upstream fallbacks and shared client cache: findings 1 and 7. | Run a staged outage and recovery; verify counts and notification accuracy with more than 100 active orders. |
| Orders and dispatch | Role guards, bounded batch size and order-list/alarm polling reviewed; findings 4 and 6. | Real parallel dispatch/status changes, unpaid orders, alarms, disconnects and multi-device acknowledgement. |
| Products and stock | Stock update path requires `expected_stock_quantity` (`apps/backend/src/controllers/adminProductController.js:455–461`), which is a useful concurrency safeguard. | Test competing staff and checkout inventory updates against the actual installed plugin and database. |
| Add product | Default inventory and upload wording: findings 2 and 8. | Verify abandoned uploads, failed creation and duplicate submissions on staging; check media cleanup before removing anything. |
| Categories | Authenticated role guard and distributed reorder-lock code were reviewed. | Run multi-worker reorder and lock-expiry tests with production-like Redis and WordPress. Lock code alone does not prove atomic completion. |
| Subcategories | Category routes and feature structure reviewed; no additional specific defect established in this pass. | Test parent mapping, concurrent edits and image upload failure/cleanup against real WordPress. |
| Homepage banners | Whole-object writes can lose concurrent edits; upstream error exposure: findings 3 and 4. | Test two real employee sessions, failed video/image uploads, public cache behavior and multi-worker propagation. The banner service has in-flight coalescing and an upstream-read cooldown (`apps/backend/src/services/bannerService.js:109–128`); no claim of unrestricted public cache bypass is made. |
| Counter mode and wake lock | Possible async race: finding 5. | Test target iPhone/Android browsers, sleep/background, denied permissions, sound unlock and reconnect. |

## Security and operational boundaries

Employee endpoints examined use `requireAuth("employee")` and role checks (`apps/backend/src/routes/employeeRoutes.js:155–357`); image and video upload routes additionally use upload rate limiting and buffer validation. These are useful controls, not a complete penetration test. Verify that the business intends every employee to have the available stock, order, product, banner and media permissions. Also verify CSRF, session revocation, internal WordPress endpoint protection, production Redis settings and real plugin deployment in an integrated staging environment.

## Tests run

- `pnpm --filter employee-panel test`: **88 passed, 0 failed**.
- From `apps/backend`: `node --test --test-concurrency=1 tests/employeePackingAlarmsHandler.test.js tests/employeeOrderServerPagination.test.js tests/employeeAccess.test.js`: **27 passed, 0 failed**.
- These suites include mocked dependencies and do not establish live WooCommerce, Redis, browser, performance, cross-session or multi-worker correctness. No live destructive operations, production load tests, full security scan or full application test suite were performed.

## Suggested order of work

1. Agree the stock-default business rule and fix dashboard outage visibility.
2. Add stale-write protection to banner editing and sanitize employee-facing unexpected errors.
3. Fix and test wake-lock concurrency and session-scoped dashboard cache.
4. Measure polling and optimize only after proving alarm recovery still works.
5. Run the feature-specific staging scenarios above on actual WordPress/Redis and target mobile browsers.
