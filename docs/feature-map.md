# Feature map and maintenance notes

This is a starting map, not a complete specification. See [runtime flows](runtime-flows.md)
for API paths and debugging. Follow imports and route
middleware when changing a feature; WordPress hooks and plugin endpoints can also
affect the result.

| Flow | Frontend starting points | Backend starting points |
| --- | --- | --- |
| Sign-in, registration and OTP | `customer-web/src/pages/Login.jsx`, `Register.jsx`, `services/authService.js`, `context/AuthContext.jsx` | `routes/authRoute.js`, `controllers/authController.js`, `services/authOtpService.js`, `services/googleAuthService.js`, `utils/authCookieUtils.js`, `middlewares/authMiddleware.js` |
| Product browsing | `customer-web/src/pages/Category.jsx`, `ProductDetails.jsx`, `components/product/` | `routes/productRoutes.js`, `controllers/productController.js`, `services/productService.js`, `services/searchIndexService.js` |
| Cart and checkout | `customer-web/src/pages/Cart.jsx`, `components/checkout/`, `context/CartContext.jsx` | `routes/paymentRoutes.js`, `controllers/paymentController.js`, `services/paymentIntentService.js`, `services/reconciliationService.js` |
| Customer orders | `customer-web/src/pages/Orders.jsx`, `TrackOrder.jsx`, `components/orders/` | `routes/orderRoutes.js`, order controller and WooCommerce integration |
| Employee fulfillment | `employee-panel/src/pages/Orders.jsx`, `components/orders/`, `services/employeeApi.js` | `routes/employeeRoutes.js`, `controllers/employeeController.js`, `services/employeeAlarmService.js`, `services/orderNotificationService.js` |
| Inventory and catalog | Employee and admin `pages/Products.jsx`; employee `AddProduct.jsx` | `routes/employeeRoutes.js`, `routes/adminRoutes.js`, employee/admin product controllers, `mumbai-auth.php` |
| Customer profile and addresses | `customer-web/src/pages/Profile.jsx`, `ProfileSetup.jsx`, `Addresses.jsx` | `routes/profileRoutes.js`, `routes/addressRoute.js`, `controllers/profileController.js`, `controllers/addressController.js`, `mumbai-auth.php` |

Paths in the backend column are relative to `apps/backend/src/`, except for
`mumbai-auth.php`, which is at repository root. Frontend paths are relative to
`apps/`. API route prefixes are registered in `apps/backend/src/app.js`.

## High-risk changes

* Authentication: preserve panel isolation, cookie attributes, revocation and
  expiry checks, Google account linking and OTP response contracts.
* Payments and stock: preserve webhook/callback signature verification,
  idempotency, stock reservations, order metadata, retries and reconciliation.
  Use isolated staging and gateway test mode for end-to-end checks.
* Employee orders: preserve acknowledgements, alarms, status transitions and
  bulk-action eligibility. Exercise concurrent operations before release.

The authentication refactor, session lookup, role-isolation and registration
suites passed locally after updating outdated fixtures and checkout-policy
assertions. This does not replace integration tests against WordPress and Redis.
The wider backend run exposed other failures; see `audits/organization-follow-up.md`.

Checkout policy confirmed by the project owner: a valid delivery contact phone
is sufficient for paid orders; account-phone verification is not required. The
historical middleware export `requireVerifiedPhone` validates the submitted
contact's format. Other flows may have their own verification requirements.

## Change management

Group changes by feature and review `git status`, including untracked files,
before committing. Commit extracted modules with their callers and tests. Do not
commit runtime data (`apps/backend/var`), dependencies, builds, local secrets or
customer data. Coordinate plugin and backend versions when deploying; see
`production-recovery.md` for backups, restore and operational dependencies.
