# Docker Setup Guide (Local Dev & Backend Image)

This guide gets a developer from a fresh machine to a working **MySQL + WordPress + WooCommerce + `mumbai-auth.php` + Redis + Node API** stack in a few commands, without manually setting up LocalWP.

> Your existing LocalWP workflow remains completely untouched—Docker runs on its own ports (`8085` for WordPress, `5000` for Node API, `6379` for Redis) and volumes.

---

## Step 1: Install Docker

### Windows 10 / 11
1. Open **PowerShell as Administrator** and install WSL 2:
   ```powershell
   wsl --install
   ```
2. **Restart Windows** when prompted.
3. Download and install **Docker Desktop for Windows**: https://www.docker.com/products/docker-desktop/
   - During setup, keep **"Use WSL 2 instead of Hyper-V"** checked.
4. Launch **Docker Desktop** and wait until the bottom-left status says **Engine running**.
5. Verify in a regular PowerShell window:
   ```powershell
   docker --version
   docker compose version
   ```

### macOS / Linux
- **macOS:** Install Docker Desktop for Mac (Apple Silicon or Intel) from https://www.docker.com/products/docker-desktop/.
- **Linux:** Install Docker Engine + the Compose plugin (`docker-compose-plugin`) via your distro's package manager or https://docs.docker.com/engine/install/.

---

## Step 2: Configure Local Docker Environment

All Docker files are organized in the `docker/` folder. From the repository root:

```powershell
Copy-Item docker/.env.example docker/.env
```
*(macOS/Linux: `cp docker/.env.example docker/.env`)*

The defaults in `docker/.env.example` work out of the box for local development (`MOCK_EMAIL=true`, so OTP codes print in the backend logs without requiring Brevo keys). Fill in `GOOGLE_CLIENT_ID` / `RAZORPAY_*` only if you want to test Google SSO or Razorpay locally.

> Never commit `docker/.env` (it is already ignored by `.gitignore`).

---

## Step 3: Start the Backend Stack

You can run directly from `docker/`:

```powershell
cd docker
docker compose up -d --build
```

Or from the repository root:
```powershell
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build
```

What happens automatically on the first boot (~1–2 minutes while WooCommerce installs):
1. **`mysql`** starts and initializes the `mumbai_wp` database.
2. **`redis`** starts with persistence enabled (`redis://redis:6379`).
3. **`wordpress`** starts on `http://localhost:8085` with `mumbai-auth.php` bind-mounted live from `apps/wordpress-plugin/mumbai-auth.php` (edits take effect immediately—no manual sync needed).
4. **`wordpress-init`** runs once to install WordPress, set pretty permalinks (`/%postname%/`), install & activate **WooCommerce**, activate **Mumbai Collection Auth**, and seed the dev WooCommerce REST API key.
5. **`backend`** builds `apps/backend/Dockerfile`, connects to `http://wordpress` and `redis://redis:6379`, watches `apps/backend/src` for live code edits, and exposes `http://localhost:5000`.

Check progress and status:
```powershell
cd docker
docker compose ps
docker compose logs -f wordpress-init
docker compose logs -f backend
```

---

## Step 4: Verify Services Are Healthy

1. **Node Backend:** Open http://localhost:5000 → should return `Backend is running`.
2. **WordPress Admin:** Open http://localhost:8085/wp-admin → sign in with `WP_ADMIN_USER` / `WP_ADMIN_PASSWORD` from `.env.docker` (default `admin` / `AdminDevPass123!`).
3. **WordPress REST API (`mumbai-auth.php`):** Open http://localhost:8085/wp-json/mumbai-auth/v1/me → should return JSON (`{"logged_in":false,...}`).

---

## Step 5: Run the React Frontends Natively (Fast HMR)

Keep the three Vite apps running natively on your machine so hot reload stays instant:

- **Customer Storefront** (`http://localhost:5173`):
  ```powershell
  cd apps/customer-web
  $env:VITE_WORDPRESS_PROXY_TARGET="http://localhost:8085"
  pnpm dev
  ```
  *(macOS/Linux: `VITE_WORDPRESS_PROXY_TARGET=http://localhost:8080 pnpm dev`)*
- **Admin Dashboard** (`http://localhost:5174`):
  ```powershell
  cd apps/admin-dashboard
  pnpm dev
  ```
- **Employee Panel** (`http://localhost:5175`):
  ```powershell
  cd apps/employee-panel
  pnpm dev
  ```

---

## Common Commands

From `docker/` (or add `-f docker/docker-compose.yml --env-file docker/.env` from root):

| Task | Command |
| :--- | :--- |
| Stop containers (keep DB & WP data) | `docker compose stop` |
| Start again later | `docker compose up -d` |
| Rebuild backend after changing `package.json` | `docker compose up -d --build backend` |
| View mock OTP emails & backend logs | `docker compose logs -f backend` |
| Wipe all local Docker data & start completely fresh | `docker compose down -v` |

---

## Deploying `apps/backend` in Production

`apps/backend/Dockerfile` is also production-ready (non-root `node` user, production-only dependencies, built-in `HEALTHCHECK`). Point Render, Railway, Fly.io, Coolify, or your VPS Docker runner at:
- **Build context:** `apps/backend`
- **Dockerfile path:** `apps/backend/Dockerfile`
- **Port:** `5000`
- **Required env vars:** See `apps/backend/.env.example` (including `NODE_ENV=production`, real HTTPS `WORDPRESS_URL`/`WOOCOMMERCE_URL`, WooCommerce keys, `MUMBAI_INTERNAL_API_KEY`, `OTP_HMAC_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `REDIS_URL`).
