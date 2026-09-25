# Mumbai Collection Auth WordPress Plugin (`mumbai-auth.php`)

## Overview

`mumbai-auth.php` is a custom, standalone WordPress plugin built specifically for the Mumbai Collection e-commerce ecosystem. It exposes specialized REST API endpoints under `/wp-json/mumbai-auth/v1/` that serve as the authoritative authentication, session validation, user profile, and operational configuration provider for the Node.js/Express backend (`apps/backend`).

---

## Role in Architecture

```
[Customer / Employee / Admin Frontends]
                 │
                 ▼ (HTTP Cookies / CSRF / CORS)
          [Node.js Backend]
                 │
                 ▼ (Internal HTTP / REST)
       [WordPress + mumbai-auth.php]
                 │
                 ▼
       [WooCommerce DB / wp_users]
```

1. **Authentication & Sessions**: Handles login, registration, password resets, and session verification (`/me`). Node.js proxies authentication and caches validated sessions in-memory for 60 seconds.
2. **Customer Profiles & Addresses**: Stores customer metadata (full name, phone verification status, age, saved delivery addresses) directly in WordPress user meta.
3. **Store Operating Hours**: Persists IST-based operating schedules and manual override modes into WordPress options table (`mumbai_store_hours_config`).
4. **Customer Suspension**: Persists suspension state, reasons, and expiry in WordPress user meta (`_mumbai_is_suspended`, `_mumbai_suspended_until`).

---

## Key REST API Endpoints (`/wp-json/mumbai-auth/v1/`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /login | POST | Authenticates user credentials, sets session, returns auth cookie name/value |
| /register | POST | Registers new user account with default customer role |
| /logout | POST | Invalidates server-side WordPress session |
| /me | GET | Validates session cookie, returns user ID, email, roles, phone verification, and suspension status |
| /profile | GET / PUT | Retrieves or updates customer full name, phone, and age |
| /profile/complete | GET | Checks whether mandatory profile fields are completed |
| /addresses | GET / POST | Retrieves or creates saved shipping addresses |
| /addresses/:id | PUT / DELETE | Updates or deletes a saved shipping address |
| /otp/send | POST | Generates and sends 6-digit OTP via Brevo |
| /otp/verify | POST | Verifies OTP code for mobile verification or password reset |
| /otp/reset-password | POST | Resets password using validated OTP reset token |
| /store-hours | GET / PUT | Reads or updates store operating hours configuration |
| /customer-suspension/* | GET / POST | Lookup, suspend, and unsuspend customer accounts |

---

## Deployment Instructions

### 1. Installation into WordPress
1. Locate `mumbai-auth.php` at the repository root.
2. Copy `mumbai-auth.php` into your WordPress plugins directory:
   ```bash
   wp-content/plugins/mumbai-auth/mumbai-auth.php
   ```
   *(Alternatively, place it directly in `wp-content/plugins/` or symlink it during local development).*
3. Log in to WordPress Admin (`/wp-admin`) -> **Plugins** -> **Installed Plugins**.
4. Locate **Mumbai Collection Auth** and click **Activate**.

### 2. Configuration (`wp-config.php`)
Add the following required configuration constants to your WordPress `wp-config.php` (above `/* That's all, stop editing! */`):

```php
// Required: Shared secret key between Node.js backend and WordPress
define('MUMBAI_INTERNAL_API_KEY', 'your_secure_internal_api_key_here');

// Required: Frontend URL for CORS and password reset redirection
define('MUMBAI_FRONTEND_URL', 'https://mumbai-collection.vercel.app');

// Production Hardening: Disable built-in theme/plugin code editor
define('DISALLOW_FILE_EDIT', true);

// Production Hardening: Disable error output and debug logging
define('WP_DEBUG', false);
define('WP_DEBUG_LOG', false);
define('WP_DEBUG_DISPLAY', false);

// Optional: Maximum failed login attempts before lockout (default: 5)
define('MUMBAI_MAX_LOGIN_ATTEMPTS', 5);

// Optional: Lockout duration in seconds (default: 900 / 15 minutes)
define('MUMBAI_LOCKOUT_DURATION', 900);
```

### 3. Backend Alignment
Ensure the Node.js backend `.env` has the matching internal key:
```env
MUMBAI_INTERNAL_API_KEY=your_secure_internal_api_key_here
WORDPRESS_URL=https://your-wordpress-domain.com
```

---

## Security Considerations

- **Shared Secret Protection**: Administrative and profile endpoints require the `X-Mumbai-Internal-Key` header matching `MUMBAI_INTERNAL_API_KEY`.
- **Fail-Closed Design**: If `MUMBAI_INTERNAL_API_KEY` is not defined in `wp-config.php`, the plugin displays an administrative notice and blocks internal API access.
- **Brute-Force Protection**: Enforces rate limiting on login attempts with transient-based lockouts.
