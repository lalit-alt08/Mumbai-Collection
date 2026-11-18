# Staff & Admin Account Recovery Procedure

## Why Staff Recovery Is Not on the Storefront
Privileged WordPress roles (`administrator`, `employee`, `shop_manager`) are intentionally blocked from customer-facing password recovery (`/forgot-password`, `/reset-password`, OTP password reset) and Google Sign-In (`mumbai-auth.php`: `mumbai_is_privileged_account`). This prevents unauthenticated storefront traffic from enumerating or targeting internal staff accounts.

---

## 1. Recovering an Employee (`employee` / `shop_manager`) Account
Performed by an authorized **Administrator (Store Owner)**:

1. Sign in to WordPress Admin (`<WORDPRESS_URL>/wp-admin`).
2. Go to **Users → All Users** and select the locked-out employee account.
3. Under **Account Management**, click **Set New Password** (generate a strong password meeting the 8+ character, upper/lower/number/symbol policy) or click **Send Reset Link**.
4. Click **Log Out Everywhere Else** to revoke any stale WordPress sessions, then click **Update User**.
5. Complete **Step 3 (Immediate App-Level Session Revocation)** below so cached Express sessions cannot remain usable during the 60-second session cache window.
6. Deliver the temporary password out-of-band (in person or via verified store channel) and have the employee sign in at the Employee Panel (`/login`) and verify access.

---

## 2. Recovering an Administrator (Store Owner) Account

### Option A — WordPress Native Lost Password (Standard)
1. Open `<WORDPRESS_URL>/wp-login.php?action=lostpassword`.
2. Enter the administrator email address and complete the WordPress reset link sent to the owner's email inbox.
3. Sign in to `wp-admin` and click **Log Out Everywhere Else** on the Administrator profile.
4. Complete **Step 3 (Immediate App-Level Session Revocation)** below.
5. Confirm login at the Admin Dashboard (`/login`).

### Option B — Server / Local Sites WP-CLI Fallback (If Email Is Unavailable)
1. Open a shell with access to the WordPress installation (Local Sites → **Open site shell**, or SSH on production host).
2. Run:
   ```bash
   wp user update <admin_username_or_email> --user_pass="<NEW_STRONG_PASSWORD>"
   wp user session destroy <admin_username_or_email> --all
   ```
3. Clear any login lockout metadata if needed:
   ```bash
   wp user meta delete <admin_user_id> _mumbai_failed_logins
   wp user meta delete <admin_user_id> _mumbai_lockout_until
   ```
4. Complete **Step 3 (Immediate App-Level Session Revocation)** below.
5. Verify sign-in at both `<WORDPRESS_URL>/wp-admin` and the Admin Dashboard (`/login`), and confirm older sessions are rejected with `401`.

---

## 3. Immediate App-Level Session Revocation (Closing the 60-Second Node Cache Window)

The Node API caches validated sessions in memory (`SESSION_CACHE_TTL = 60s` in `apps/backend/src/middlewares/authMiddleware.js`) and shares revocations across instances via Redis. A password reset performed directly inside `wp-admin` or WP-CLI bypasses the Node password-change endpoint, so previously validated staff cookies could remain accepted by Express for up to **60 seconds** unless cleared at the app layer.

After any out-of-band staff/admin password reset (especially during suspected compromise):

1. **Advance the WordPress session version** so any pre-reset session token is permanently rejected on validation:
   ```bash
   CURRENT_VER=$(wp user meta get <user_id> _mumbai_session_version)
   NEXT_VER=$(( ${CURRENT_VER:-1} + 1 ))
   wp user meta update <user_id> _mumbai_session_version "$NEXT_VER"
   ```
2. **Clear the Node API in-memory session cache immediately**:
   - **Recommended:** Perform a rolling restart / reload of the Node backend process(es) (e.g., `pm2 reload mumbai-backend` or restarting the Render/container service), which empties every worker's 60-second `sessionCache` map immediately.
   - If you cannot restart the Node backend immediately, treat old staff cookies as potentially valid for up to 60 seconds after Step 1, then verify revocation once 60 seconds have elapsed.
3. **Verify revocation**: Confirm an old staff/admin session cookie receives `401 Unauthorized` from `GET /api/auth/me?context=admin` (or `context=employee`) before concluding recovery.
