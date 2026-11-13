# Mumbai Collection client release audit

**12 November 2026 · Base revision `70526ae` · Current local working tree**

**Release decision: hold production handover.** The three frontends build and the project already covers the main jobs of an online shop. The checked-in deployment depends on a temporary tunnel, the test baseline has unresolved failures, and the order lifecycle still needs to be proven on a staging environment. The highest-value next step is to complete one test-mode purchase all the way through staff dispatch, customer tracking and reporting.

## What the project does

Mumbai Collection is a **single-retailer e-commerce system** for a local delivery business. It combines a public shopping site, an employee operations panel and an owner dashboard. It is a headless WooCommerce setup. That means React provides the screens and WooCommerce provides the store's data and commerce engine, with a Node API and a custom WordPress plugin connecting the two.

| Part | Who uses it | What it does |
| --- | --- | --- |
| Customer web | Shoppers | Home and promotional banners, category and product search, product details and stock, cart and cart sharing, Razorpay checkout, sign-in and account tools, order history and tracking, policies and WhatsApp support |
| Employee panel | Store and packing staff | Packing alerts, order queues and dispatch, inventory and pricing, product and category management, storefront banners, counter mode |
| Admin dashboard | Owner or manager | Store overview, inventory, customer management and suspensions, employee access, sales reporting, store hours and payment reconciliation controls |
| Backend | All three frontends | Express API for authentication, request validation, search, cart and payment coordination, order operations, rate limiting, caching and alerts |
| WordPress plugin | Backend and WooCommerce | Custom REST endpoints and database operations for accounts, OTPs, stock reservations, payment records, catalog indexing, staff changes and reporting |

React 19, Vite and Tailwind power the interfaces. The Node backend uses Express, Zod, Redis, MiniSearch, Sharp and Pino. WooCommerce remains the source of store records. Razorpay handles payments, Google supports sign-in, and the repository includes Brevo email, web push and Telegram or Discord operations alerts. Most launch-critical risks sit at the boundaries between these services. A frontend can build successfully even when the shop cannot complete an order.

## Repository size

| Area | Files | Code files | Physical code lines |
| --- | ---: | ---: | ---: |
| Customer web | 145 | 118 | 28,265 |
| Employee panel | 70 | 50 | 19,560 |
| Admin dashboard | 42 | 25 | 7,408 |
| Backend | 154 | 149 | 51,067 |
| WordPress plugin | 1 | 1 | 10,215 |
| Root scripts | 6 | 5 | 968 |
| Other tracked files | 40 | 0 | 0 |
| **Total before this report** | **458** | **348** | **117,483** |

Counted existing Git-tracked files before writing this report. All eight pre-existing local edits were included in the line counts and local checks. Code lines cover JS, JSX, PHP, CSS, HTML and shell scripts. The total includes comments and blank lines. There are 105,863 nonblank lines, and 29,817 physical lines belong to 96 test files. The remaining 87,666 physical lines include application code, build files and scripts. Git internals, dependencies, ignored `.env` files and generated outputs are outside the count. `mumbai-auth.php` is the largest source file. Review its individual route handlers alongside their Node callers to keep audits manageable.

## Verification performed

| Check | Result |
| --- | --- |
| Customer web Node tests | 146 passed, 0 failed |
| Employee panel Node tests | 87 passed, 1 failed. The timestamp assertion also failed when run by itself. |
| Admin dashboard Node tests | 2 passed, 0 failed. Both are about retrying reads. |
| Production frontend builds | All three passed locally. These builds verify bundling with the available local configuration. |
| Frontend lint | All three exited successfully and reported warnings. Review the hook dependency warnings first in checkout and order pages. |
| WordPress plugin syntax | Passed with PHP 8.2.29. Activation, schema upgrades and real database behaviour still need staging. |
| Backend Node tests | Isolated Windows run reported **525 passed, 151 failed, 2 cancelled** out of 678. The totals include assertion failures and environment-related errors. |
| Public storefront | The public address opened a browser access challenge. Automatic browser review then rejected page observation after the redirect to `www`. The Product Design audit skill requires screenshots of the actual flow. Public or authenticated screens could not be captured in this run. |

The scope is the repository, its route and feature inventory, selected implementation paths and the checks above. Payment gateway behaviour, real customer and staff sessions, mail and push delivery, deployed headers, production security, measured speed and a real restore still need evidence. The test and acceptance matrix below gives the next checks for each feature. A staging URL and disposable accounts for all three roles would let the visual walkthrough proceed without relying on the challenged public origin or real customer data.

## Findings to act on

### P0 · Replace temporary deployment routing

All three `vercel.json` files point `/api` at a Cloudflare Quick Tunnel. The storefront also sends its sitemap and social product previews to that tunnel. A fresh deployment using these files can lose its API when the tunnel changes or stops. Both staff apps also fall back to `http://localhost:5000/api` if `VITE_API_URL` is missing at build time. That fallback sends a deployed browser to the staff member's own machine. Use a stable HTTPS backend, align the rewrite and browser API strategies, and fail production builds when their required settings are absent. Verify the deployed URLs, protected sessions, sitemap, preview cards and Razorpay callback and webhook separately. A production deployment may have platform overrides that were outside this audit. Evidence is in each app's `vercel.json` and the staff `src/services/authService.js` and API clients. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

### P0 · Prove that a payment produces exactly one correct order

The implementation has signed payment verification, server-side totals, reservations, retry protection, webhook handling, reconciliation and escalated states. The interactions across Razorpay, Redis, Node and WooCommerce matter more than a passing isolated mock. With Razorpay Test Mode and a disposable WooCommerce database, check an ordinary purchase, a failed or dismissed payment, recovery after a browser is closed, a delayed or repeated webhook, the last unit sold with two shoppers, and the refund or escalation path. Check that the charged amount matches the customer quote, stock is correct, the shopper sees a clear status, and Razorpay and WooCommerce agree. Assign a named owner to escalated payments. Evidence is in `apps/backend/src/routes/paymentRoutes.js`, `apps/backend/src/controllers/paymentController.js`, `apps/backend/src/services/reconciliationService.js` and `docs/production-recovery.md`. [Razorpay Web Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps)

### P0 · Produce a repeatable green release test run

The staff date test passes only a timezone-free `date_created` value, then expects it to be read as UTC. The helper treats that WooCommerce field as local Asia/Kolkata time and uses `date_created_gmt` for UTC. The fixture expects `12:18 am` while the helper returns `06:48 pm`. This confirms a disagreement between code, a comment and a test. Compare actual staging payloads with and without the GMT field before choosing which contract to correct. Test the midnight boundary. Evidence is in `apps/employee-panel/tests/ordersTimezoneAndUrlFilter.test.js:46` and `apps/employee-panel/src/utils/orderDate.js:52`.

The backend run showed failures in payment recovery, authentication, analytics refresh, category pagination, stock freshness and cache invalidation. Examples include an invalid mocked category response and a cache test that expected a rejection and received none. Some tests depend on loopback networking or leave work running in this Windows sandbox. A failing suite can account for several failed assertions. Use a clean Linux CI run to tell fixture failures, environment failures and actual product regressions apart. The first run used dummy endpoints and an unreachable Redis and was stopped after it stalled. The isolated rerun disabled local `.env` loading and used dummy integrations and a 20-second test timeout. The repository already warns about test data reaching a real payment storage service. Keep provider mocks and test environment isolation in the release test job. Evidence is in `.github/workflows/ci.yml` and `docs/production-recovery.md`.

### P1 · Use the same timestamp rules across the employee workflow

The order list preserves a missing GMT timestamp as `null`. The packing-alarm endpoint sometimes copies the timezone-free local timestamp into the GMT field. The API's order cursor also treats a timezone-free local fallback as UTC. For an Asia/Kolkata store, orders missing their GMT value can be shifted by five and a half hours in comparisons or cursor order, especially in a mix of older and newer records. Normalize time with the field's original meaning before sorting or sending it. Verify a mixed set of records around midnight on staging. Evidence is in `apps/backend/src/controllers/employeeController.js:76`, `:122`, `:513` and `:1242`, and `apps/employee-panel/src/utils/orderDate.js:52`.

### P1 · Strengthen CI and deployment documentation

The checked-in workflow runs PHP syntax, tests for three of the four apps and frontend builds. It skips the admin test file, frontend lint, a WordPress integration job and browser journeys. The workflow also selects Node 20, which is end of life. Start by verifying Node 24 LTS with all four apps and the hosting provider, then pin the same major in CI, local setup and hosting. Add lint and admin tests to CI, test the matching WordPress plugin on a disposable database, and require the critical browser journeys on a release candidate. Create a root setup guide covering ports, environment variable names, test provider setup and deployment order. The three frontend READMEs are still Vite templates. The existing production recovery guide is a starting point for operations. [Node.js release status](https://nodejs.org/en/about/previous-releases)

### P1 · Fix keyboard access and text contrast on buying screens

- The normal-state product WhatsApp button declares white text on `#1F9D55`. Those colors give about **3.49:1** contrast for the 14 px label, below the usual **4.5:1** WCAG AA target. Darken the button and check both storefront themes. Evidence is in `apps/customer-web/src/components/product/ProductWhatsAppSupport.jsx`. [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- Shared-cart and stock-warning overlays declare `aria-modal` but their implementations have no visible focus-management logic. Confirm that focus enters the overlay, stays inside while it is open, returns to its opener and supports Escape. Use one shared dialog implementation for the critical cart and checkout overlays if the keyboard checks fail. Evidence is in `apps/customer-web/src/components/cart/SharedCartModal.jsx` and `apps/customer-web/src/components/checkout/StockNotificationModal.jsx`. [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- Multi-slide desktop banners auto-advance, and the mobile video can loop while visible. The mobile banner uses a poster and pauses offscreen, which helps. The banner components have no visitor-facing pause control or explicit reduced-motion check in their playback logic. Default to the poster for reduced motion, add a visible pause control for recurring motion, and verify keyboard focus on linked slides. Evidence is in `apps/customer-web/src/components/home/HeroBanner.jsx` and `MobileThinBanner.jsx`. [WCAG pause, stop, hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)

### P1 · Test operational recovery before accepting orders

The repository includes a backup script, health checks, alert queues and a monitoring script. The runbook explicitly says off-server backups and scheduling need deployment setup. Configure an independent uptime check and an alert destination that the client actually watches. Run a restore in staging, document the restore time and the age of the restored data, and verify recent orders, stock, images and payments. Confirm WooCommerce HPOS is authoritative, WordPress cron is running, Redis is healthy, and durable alert and session storage persists across a restart. The API trusts one proxy hop, so confirm the host's actual proxy topology and restrict direct access to the backend listener. Evidence is in `docs/production-recovery.md`, `scripts/production-backup.sh` and `apps/backend/src/app.js:32`.

### P2 · Measure first-load cost and clarify install behaviour

The measured gzip sizes of the main JS chunks were **114.28 kB storefront**, **130.61 kB employee**, and **104.90 kB admin**. The storefront's main CSS was **22.73 kB gzip**. These are build artifacts. A browser session also downloads route chunks, images, fonts and data. Profile home, product and checkout on a slower mobile connection with both static and video banners. Check whether the optional video competes with the product catalog on the first view. Set budgets using measurements from staging. Google's good Core Web Vitals targets are LCP at or below 2.5 s, INP at or below 200 ms and CLS at or below 0.1 at the 75th percentile. Measure real visits after launch. [Core Web Vitals](https://web.dev/articles/vitals)

The storefront includes a web app manifest and an Android Chromium install prompt. The source contains no storefront service-worker registration, so verify installation on real Android and iOS devices and scope any offline promise to what you have demonstrated. The employee panel registers a service worker for its push workflow. Evidence is in `apps/customer-web/index.html`, `apps/customer-web/src/components/common/InstallPrompt.jsx` and `apps/employee-panel/src/main.jsx`.

## Feature-by-feature acceptance checks

Use a seeded staging shop. Include an in-stock item, a sold-out item, a variable product, a one-unit product, a supported and unsupported address, and separate customer, employee and admin accounts. Use real devices for the browser-specific flows. For each row, record the revision, device, account role, expected result, actual result and a screenshot or test trace.

### Customer storefront

| Step | What is implemented | What must work on staging |
| --- | --- | --- |
| 1. Home and discovery | Promotional banners, video poster fallback, category shortcuts, shelves and refresh on return | Open on mobile and desktop in both themes. Test no banners, a broken video, a slow connection and an upstream error. Ensure browsing remains usable when banners fail. |
| 2. Search and categories | Indexed search, category hierarchy, filters, sort and pagination | Try a name, SKU, typo, zero results and renamed item. Change filters while a request is loading. Check browser Back, page boundaries, no duplicates and fresh stock after a staff edit. Decide whether category filters need shareable URLs. |
| 3. Product details and reviews | Gallery, variations, availability, descriptions, related products and reviews | Verify the selected variation determines the image, price and stock. Try a stale deep link, missing image, keyboard gallery, inaccessible variation, review eligibility and review deletion. Check that WhatsApp support meets the client's preference for a blank chat or a product-specific message. |
| 4. Cart and sharing | Cart persistence, stock refresh, share/import, favorites and cross-sells | Add, remove and change quantities as guest and signed-in user. Refresh, sign in, use two tabs, and import a shared cart after a product is unavailable. Check recovery and totals. |
| 5. Addresses and delivery quote | Saved addresses, local zones, shipping quote and availability | Create and edit addresses, check invalid inputs, compare shipping across eligible addresses and verify the closed-store message and next available time. Check that the quote changes when the delivery address or cart changes. |
| 6. Checkout and recovery | Razorpay, server quote check, stock reservation, payment verification and reconciliation | Run the full P0 payment checks. On Android, switch to the test payment app flow and return. Test a refreshed or closed browser and staff visibility of unresolved payments. |
| 7. Orders and tracking | Order list, line items and a live status timeline | Match an order total and status against WooCommerce. Follow packed, out for delivery, delivered, cancelled and refunded states. Verify that an unrelated account cannot access its private details and that expired sessions can recover cleanly. |
| 8. Account lifecycle | Login, registration OTP, Google sign-in, password recovery, profile and account deletion | Verify code delivery, resend and expiry, failed attempts, first Google sign-in, required profile fields, logout and password recovery. Test how account deletion affects signed-in devices and what data is retained for orders. |
| 9. Support, policies and installation | Contact page, WhatsApp, policies, manifest and install prompt | Ask the client to approve the actual delivery, returns and privacy wording. Check phone and WhatsApp links on mobile, proper policy URLs, no personal details in shared URLs, and supported installation behaviour. |

### Employee panel

| Step | What is implemented | What must work on staging |
| --- | --- | --- |
| 1. Sign-in and access | Staff sessions, protected routes and access checks | Check active and deactivated employee accounts, session expiry and separation from admin privileges. Revocation should take effect on a second browser session. |
| 2. Dashboard and order alarms | Work queue, order notices, sound and web push | Trigger a test order while focused and in the background. Test denied permissions, muted audio, reconnection and duplicate events. Confirm the visual queue still works without sound. |
| 3. Orders and dispatch | Status filters, date and location views, packing and bulk dispatch | Work the same test order on two devices. Confirm exactly one successful state change, correct IST timestamps and reliable customer tracking. Verify partial failure and the delivered-order edit lock. Test refund notification using a test recipient. |
| 4. Inventory and prices | Stock and price changes, availability filters, mobile quick adjust | Compare a staff change with WooCommerce and the storefront. Cover a variation, the last unit, a stale edit and two staff members editing one item. |
| 5. Product creation | Catalog inputs, images and upload queue | Create a simple product, upload an acceptable image, reject oversized or unsupported inputs, retry a failed upload, and confirm the product appears in search. Check abandoned media cleanup. |
| 6. Categories and subcategories | Hierarchy, images and ordering | Reorder siblings, move a subcategory, validate what happens to existing products, and test concurrent edits and failed saves. Confirm navigation and search update afterward. |
| 7. Banners | Staff publishing for desktop and mobile, links and mobile video | Publish and disable an image and a video. Check crop, poster, destination, file size and refresh on mobile. Test a failed upload. |
| 8. Counter mode | Wake lock, order alarms and session extension | Run on the actual counter device. Check screen-off behaviour, sleep and wake, browser backgrounding, session expiry and reopening after a network interruption. Confirm the hard-coded sound quiet period of 11:30 pm to 10 am IST fits the client's opening hours and overrides. |

### Admin dashboard

| Step | What is implemented | What must work on staging |
| --- | --- | --- |
| 1. Overview and reconciliation | Summary metrics, recent orders and operational actions | Compare the dashboard with a known fixture. Verify a refresh after a new order and clear error messaging if WordPress or reporting is unavailable. Test access and the outcome of one payment reconciliation action in Test Mode. |
| 2. Inventory | Product search, stock status, price and quantity adjustments | Cross-check stock counts after an employee update and a checkout. Review variable products, stale writes and low-stock thresholds. |
| 3. Customer management | Customer list, filters, detail and order history | Check search and pagination, timezone and location filters, totals and visibility rules for private customer data. |
| 4. Customer suspension | Suspension controls and access revocation | Use a disposable customer, suspend and restore it, and check what happens to existing sessions, pending checkout and old orders. Agree on how support handles an active order after suspension. |
| 5. Employee access | Staff approval, roles, activation and session revocation | Check new staff setup, least privilege and deactivation across devices. Confirm the owner can recover access and can identify who performed important changes. |
| 6. Analytics | Date and product filters, summaries and WooCommerce HPOS reporting | Compare totals against a known paid order, a cancelled order and a partial refund. Verify IST period boundaries, included statuses, tax and shipping treatment, and the outcome when the reporting plugin is unavailable. |
| 7. Store hours | Regular schedules, exceptions and manual override | Test normal hours, overnight schedules, a holiday and force-open or force-close. Verify the same result appears in checkout and staff tools. |

### Shared infrastructure

| Area | Acceptance evidence |
| --- | --- |
| Access and customer data | Verify permitted access for each role, account ownership boundaries, logout and revocation, cookie and CORS configuration, server-side authorization, validation and privacy-safe logs. Run a local source and dependency review for JavaScript and PHP. |
| WordPress and WooCommerce | Install the matching plugin into a fresh staging shop and upgrade a copy of an older staging schema. Confirm HPOS, cron, indexes and data migration. Validate rollback compatibility before changing live storage. |
| Search and caching | Confirm a staff change reaches listings, search, product detail and checkout. Restart Node and temporarily stop staging Redis. Verify which features recover and which safely pause or report degraded status. |
| Uploads and delivery | Measure representative image and video sizes. Check orientation, corruption, failures, CDN or media URL correctness, and cleanup of abandoned media. |
| Monitoring and restore | Verify health alerts, payment exceptions, email and push delivery, disk capacity, backup freshness, an offsite copy and an isolated restore. Record who receives and responds to each alert. |
| SEO and sharing | Check production canonical URLs, `robots.txt`, sitemap URLs and WhatsApp product previews. Confirm staff panels and private order pages are excluded from public indexing. |

## Features to agree with the client

- **Returns and refunds.** The storefront explains a WhatsApp-led returns process. Confirm whether the client wants to handle returns there or wants an order-linked return request and status screen. For either workflow, name the person who confirms the refund in WooCommerce and Razorpay.
- **Offers and payment options.** The storefront has an `applyCoupon` service helper. No shopper-facing coupon entry surfaced in the reviewed routes. Decide whether coupons, cash on delivery or store pickup are promised, then verify the chosen options end to end.
- **Invoices and reports.** Order history shows line-item and tax details. Get a sample of the client-required invoice or export and compare it with what the application and WooCommerce generate. Confirm GST invoice fields and downloadable documents only if the business requires them. Have the client or their accountant approve the format.
- **Staff accountability.** Verify that the client can answer who changed stock, price, order status, staff access or store hours and when. Agree on role granularity and audit history retention before adding a separate audit-log screen.

## Tools worth adopting for this project

These are picks for this stack and launch workflow. There is no common rating scale across design apps, libraries, skills and MCP connectors. A skill gives Codex a repeatable workflow. An MCP connector gives it access to another tool. Tests belong in the repository so they can run on every release.

| Need | Start with | How to use it here |
| --- | --- | --- |
| UX and design | Product Design `audit` skill with the in-app Browser | Capture home → search/category → product → cart → test checkout → tracking. Separately capture packing/dispatch and the manager's inventory or reporting workflow. Use Figma MCP when the client has approved designs to compare. [Figma MCP](https://developers.figma.com/docs/figma-mcp-server/) |
| Component consistency | Storybook once shared components are worth documenting | Start with buttons, input errors, product cards, status chips and dialogs across light/dark and mobile/desktop states. [Storybook accessibility tests](https://storybook.js.org/docs/writing-tests/accessibility-testing) |
| Browser regression and accessibility | Playwright Test with axe | Save repeatable staging journeys and keep traces on failure. Test keyboard and screen reader behaviour manually as well. Playwright MCP is optional for interactive investigation. [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) · [Playwright MCP](https://github.com/microsoft/playwright-mcp) |
| Defensive source security | Codex Security plugin for targeted source review, GitHub security checks for recurring coverage | Review authentication, payment state changes, staff permissions and the PHP bridge. Use Dependabot and secret scanning if available. Use CodeQL for JS and Semgrep with PHP and WordPress-aware rules for the plugin. Confirm coverage and manually review important findings. [Codex Security](https://learn.chatgpt.com/docs/security) · [GitHub code security](https://docs.github.com/en/code-security) · [Semgrep language support](https://docs.semgrep.dev/supported-languages) |
| Frontend speed | Chrome DevTools and Lighthouse | Compare cold loads for home, product and cart on mobile. Inspect what competes with the main product image or blocks interaction. Add Chrome DevTools MCP only if you want Codex to inspect traces. [Lighthouse](https://developer.chrome.com/docs/lighthouse/overview) · [Chrome DevTools MCP](https://developer.chrome.com/blog/chrome-devtools-mcp) |
| Backend load | Grafana k6 | On staging, measure p95 latency and errors for category, search and quote requests while watching WordPress, Redis and the VPS. Agree on realistic traffic and acceptable thresholds with the client. [k6](https://grafana.com/docs/k6/latest/) |
| Animation | Existing CSS and Swiper first, Motion for React when the UI needs coordinated transitions | Use short state transitions and keep cart, checkout and staff actions immediate. Respect reduced motion. Fix the banner pause behaviour before adding more animation. [Motion accessibility](https://motion.dev/docs/react-accessibility) |
| WordPress integration | Disposable staging WordPress, or `wp-env` if the team needs a local fixture | Install WooCommerce and this plugin with fake data and gateway credentials. Run PHP and database checks there. [WordPress development environments](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/) |

## How to audit with fewer Codex tokens

- **GPT-6.1 Sol at Medium** is my default for this repo. Give it one journey and one revision at a time. Raise it to High for payment or role logic that crosses apps. **GPT-6 Luna** at Low or Medium fits test summaries, route inventories and duplicate triage. **GPT-6.1 Terra** fits screenshot comparisons. Use **GPT-6 Astra at High** for a final independent review of payment recovery, inventory races, and auth across Node and WordPress after you have test evidence. Use the models available in your Codex picker. [Codex models](https://learn.chatgpt.com/docs/models)
- Run the actual checks first. Feed Codex the failure count, failing test names and a short error excerpt. Keep raw logs and test traces available for follow-up. The model should read the code that owns the behaviour, its caller and its test before expanding to other files.
- Keep an audit tracker with one row per issue or acceptance check. Include status, owner, affected role, source or test evidence, commit and retest result. Reuse the existing `audits/` feature notes to locate code, then verify current behaviour against the release commit.
- Use a fresh focused chat per major journey. Give it the relevant route, feature note, prior accepted findings and actual test result. Exclude dependencies, builds, screenshots unrelated to the current issue and raw secrets. After a fix, review the changed files and rerun the impacted tests and one cross-app smoke journey.

Copyable audit prompt:

```text
Audit one journey in Mumbai Collection: [journey]. Review revision [commit].
Start at [route or file] and trace only the relevant UI, API, WordPress handler and tests.
Run the focused tests using fixtures or staging test credentials. Save verbose output to a log.
Report each confirmed issue with severity, file and line, user impact, and the smallest fix.
Label anything that still needs staging evidence. List the checked steps and the test result.
Keep the summary under 400 words. Do not change code in this pass.
```

## Client handover sequence

1. **Deploy staging on stable HTTPS.** Fix the temporary routing and staff API fallbacks. Deploy the matching Node and WordPress versions, verify WooCommerce HPOS and cron, and keep the test database, payment account and email delivery isolated.
2. **Make release checks repeatable.** Resolve the employee date contract and the backend test failures. Run a supported Node LTS, admin tests, frontend lint and the high-value browser checks in CI. Attach the passing run and exact revision to the release.
3. **Rehearse one real business day on staging.** The client creates or changes a product, a test shopper places and tracks an order, an employee packs and dispatches it, and the owner checks the report. Then rehearse a payment recovery, a refund, a staff access change and a closed-store checkout. Record outcomes.
4. **Verify recovery and ownership.** Prove the offsite backup and restore, uptime checks and payment exception alerts. Record who owns the domains, hosting, WordPress, Razorpay, mail and monitoring, and how support handles refunds or downtime. Share credentials through the client's password manager. Supply a one-page operating guide with links and named contacts.
5. **Ask for client sign-off on the release candidate.** Confirm catalog, delivery zones, hours, policies, billing or invoice expectations and role access. Save the exact deployment and rollback instructions. After cutover, have the client approve and execute any controlled live payment check, then monitor order flow and alerts during the first selling window.
