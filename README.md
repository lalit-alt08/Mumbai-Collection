# Mumbai Collection

Mumbai Collection is a local-commerce application with a customer storefront,
employee panel, admin dashboard, Node API, and a custom WordPress plugin used
alongside WooCommerce. WordPress/WooCommerce stores commerce data; the Node API
coordinates application-specific operations and external services.

## Project map

| Location | Responsibility |
| --- | --- |
| `apps/customer-web` | Customer storefront and checkout (React/Vite) |
| `apps/employee-panel` | Staff orders, inventory, banners and categories (React/Vite) |
| `apps/admin-dashboard` | Admin operations and reporting (React/Vite) |
| `apps/backend` | Node/Express API, authentication, payments and integrations |
| `mumbai-auth.php` | Custom WordPress plugin and protected endpoints |
| `docs/feature-map.md` | Starting points for the principal user flows |
| `docs/runtime-flows.md` | API call paths, payment recovery and request tracing |
| `docs/production-recovery.md` | Operational backup, restore and recovery guidance |
| `audits/` | Existing audits and release-readiness notes |

Each application has its own `package.json` and `pnpm-lock.yaml`; this checkout
does not define a root pnpm workspace. `packages/` is currently a placeholder.

## Local setup

1. Install Node.js and pnpm. CI uses Node 20 and pnpm 10.34.5; verify the Node
   version also satisfies the installed Vite and other dependency requirements.
2. Set up a local WordPress site with WooCommerce, a database and the custom
   plugin. Use a separate test environment and test payment credentials.
3. Copy `apps/backend/.env.example` to `apps/backend/.env` and fill in your
   own local values. This example is a starting point, not a complete production
   configuration. Do not commit `.env` files or share credentials.
4. Install dependencies independently in `apps/backend`, `apps/customer-web`,
   `apps/employee-panel`, and `apps/admin-dashboard` using `pnpm install
   --frozen-lockfile` from each directory.
5. In separate terminals, run `pnpm dev` in each of those four directories.
   The backend defaults to port 5000, the customer app normally to 5173, the
   admin app to 5174 and the employee app to 5175. Vite may choose another port
   if one is occupied; configure allowed origins to match the actual ports.

The customer Vite configuration proxies `/api` to `localhost:5000` and
`/api/store` to `https://mumbai-collection.local`. Adjust local configuration
for a different WordPress domain. Frontends support `VITE_API_URL`; see each
app's source and example environment files before setting deployment values.

### WordPress plugin

Install `mumbai-auth.php` as a WordPress plugin and activate it on the matching
site. The backend's `pnpm sync:plugin` command **overwrites** its configured
LocalWP destination; review `scripts/sync-localwp-plugin.js` and set
`LOCALWP_PLUGIN_PATH` to the intended plugin file before using it. Test plugin
changes against a backup or isolated staging site before deployment.

## Tests and builds

Run `pnpm test` and `pnpm build` inside each frontend directory; the backend
uses `pnpm test`. The exact CI environment and commands are in
`.github/workflows/ci.yml`. Some backend authentication tests currently need
fixture/contract investigation; see `docs/feature-map.md`. A passing build
does not replace end-to-end testing against WordPress and test payment services.

## Handover

Record the production architecture, domains, service owners, access procedure,
environment variables, backup schedule, restore exercise and monitoring contacts
in a private client handover. Never put live keys or customer data in this repo.
Use `docs/production-recovery.md` when planning operations and recovery.
