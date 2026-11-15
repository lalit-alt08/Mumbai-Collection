# Organization and handover follow-up

Review date: 2026-11-15. Local results are not a production readiness approval.

## Changes made

- Added project setup guidance and a feature map; replaced frontend template READMEs.
- Exposed the existing admin tests through `pnpm test` and CI.
- Updated selected authentication tests with WordPress-shaped session cookies,
  atomic registration expectations and the owner-confirmed paid-checkout rule.
- Added a session-expiry regression check using formatted WordPress cookies.

The owner confirmed that a valid delivery number is sufficient for paid orders.
The historical `requireVerifiedPhone` name does not describe the present behavior;
its production logic was not changed as part of this work. Verify other flows
independently; this decision does not automatically remove their checks.

## Tests requiring follow-up

An attempted full backend run did not finish and was stopped after reporting
failures. The following isolated suites also reported failures in a local mocked
test environment; investigate causes before changing assertions or shipping:

- `analyticsAccuracy.test.js`: manual-refresh tests expected WooCommerce calls
  that were not observed (3 failing subtests).
- `categoryPaginationAndSearchScaling.test.js`: category response validation,
  expected media URL, and stock-refresh calls (3 failing tests).
- `categoryReorderConcurrency.test.js`: an invalidation test expected a rejection;
  the isolated run did not exit promptly and was stopped.

These observations do not establish whether the cause is outdated tests, test
environment, a regression, or a combination. Compare the current contracts,
isolate mocks, and rerun the complete CI-equivalent suite before release.

## Release handover checklist

- Review staged and unstaged changes together, including extracted files that are
  currently untracked. The Git index can differ from the working tree.
- Record ownership and recovery access for hosting, domain, WordPress,
  WooCommerce, Redis, Google, Brevo, Razorpay, DNS and source control privately.
- Configure production secrets, HTTPS, allowed origins, webhook endpoints,
  monitoring, durable storage and cron. Never put credentials in this repository.
- Restore a backup in an isolated environment and document the result.
- Exercise customer sign-in, payment success/failure and reconciliation, stock
  competition, staff fulfillment, admin access and recovery in staging.
- Follow `docs/production-recovery.md` for operational details and coordinate
  deployment of the custom plugin with the Node backend.
