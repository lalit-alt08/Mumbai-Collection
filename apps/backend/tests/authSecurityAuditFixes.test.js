import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";

process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || "test_otp_hmac_secret_1234567890";
process.env.WORDPRESS_URL = process.env.WORDPRESS_URL || "http://wp.local";
process.env.MUMBAI_INTERNAL_API_KEY = process.env.MUMBAI_INTERNAL_API_KEY || "test_internal_key";
process.env.MOCK_EMAIL = "true";

import wp from "../src/services/wordpress.js";
import { processSendOtp, processVerifyOtp } from "../src/services/authOtpService.js";
import { buildOtpEmailHtml } from "../src/services/brevoService.js";
import { deleteAccount } from "../src/controllers/profileController.js";
import { schemas } from "../src/middlewares/requestValidation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const wpPluginSource = fs.readFileSync(path.join(repoRoot, "apps/wordpress-plugin/mumbai-auth.php"), "utf8");
const profileRoutesSource = fs.readFileSync(
  path.join(repoRoot, "apps/backend/src/routes/profileRoutes.js"),
  "utf8"
);

const makeRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    clearedCookies: [],
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    clearCookie(name) {
      this.clearedCookies.push(name);
      return this;
    },
  };
  return res;
};

test("Finding #1: delete_account OTP requires auth, uses WP-authoritative email, and warns of permanent deletion", async () => {
  // 1a. Validation schema accepts delete_account purpose
  assert.doesNotThrow(() => schemas.otpSend.parse({ purpose: "delete_account" }));
  assert.doesNotThrow(() => schemas.otpVerify.parse({ purpose: "delete_account", otp: "123456" }));

  // 1b. Unauthenticated send & verify fail with 401
  const unauthSendRes = makeRes();
  await processSendOtp({ body: { email: "victim@example.com", purpose: "delete_account" } }, unauthSendRes);
  assert.equal(unauthSendRes.statusCode, 401);

  const unauthVerifyRes = makeRes();
  await processVerifyOtp({ body: { email: "victim@example.com", otp: "123456", purpose: "delete_account" } }, unauthVerifyRes);
  assert.equal(unauthVerifyRes.statusCode, 401);

  // 1c. Authenticated send passes user_id to WP and returns deletion confirmation message
  const origWpPost = wp.post;
  let capturedStorePayload = null;
  let capturedVerifyPayload = null;
  wp.post = async (url, payload) => {
    if (url.includes("/otp/store")) {
      capturedStorePayload = payload;
      return {
        data: {
          success: true,
          user_found: true,
          email: "real-owner@example.com",
          name: "Real Owner",
        },
      };
    }
    if (url.includes("/otp/verify")) {
      capturedVerifyPayload = payload;
      return {
        data: {
          success: true,
          message: "Account deletion code verified.",
          delete_token: "a".repeat(64),
        },
      };
    }
    throw new Error(`Unexpected WP URL: ${url}`);
  };

  try {
    const sendRes = makeRes();
    await processSendOtp(
      {
        body: { email: "spoofed@example.com", purpose: "delete_account" },
        user: { id: 77, email: "real-owner@example.com" },
      },
      sendRes
    );
    assert.equal(sendRes.statusCode, 200);
    assert.equal(capturedStorePayload.user_id, 77);
    assert.equal(capturedStorePayload.purpose, "delete_account");
    assert.match(sendRes.body.message, /deletion/i);

    const verifyRes = makeRes();
    await processVerifyOtp(
      {
        body: { email: "real-owner@example.com", otp: "654321", purpose: "delete_account" },
        wpUserId: 77,
      },
      verifyRes
    );
    assert.equal(verifyRes.statusCode, 200);
    assert.equal(capturedVerifyPayload.user_id, 77);
    assert.equal(capturedVerifyPayload.purpose, "delete_account");
    assert.equal(verifyRes.body.delete_token, "a".repeat(64));
    assert.equal(verifyRes.body.reset_token, undefined);
  } finally {
    wp.post = origWpPost;
  }

  // 1d. Brevo HTML template explicitly warns about permanent account deletion
  const html = buildOtpEmailHtml({ toName: "Asha", otp: "654321", purpose: "delete_account" });
  assert.match(html, /Confirm Permanent Account Deletion/);
  assert.match(html, /permanently delete your Mumbai Collection account/i);
  assert.doesNotMatch(html, /Reset Your Password/);
});

test("Finding #1: deleteAccount rejects password reset_token and forwards only delete_token", async () => {
  // Route middleware checks delete_token, never reset_token
  assert.match(profileRoutesSource, /req\.body\?\.delete_token/);
  assert.doesNotMatch(profileRoutesSource, /req\.body\?\.reset_token/);

  // Controller rejects reset_token-only body with 400
  const rejectRes = makeRes();
  await deleteAccount(
    {
      wpUserId: 77,
      body: { reset_token: "b".repeat(64) },
      cookies: {},
      headers: {},
    },
    rejectRes
  );
  assert.equal(rejectRes.statusCode, 400);

  // Controller rejects password-only body with 400 when delete_token is missing
  const rejectPwRes = makeRes();
  await deleteAccount(
    {
      wpUserId: 77,
      body: { password: "SecretPassword123!" },
      cookies: {},
      headers: {},
    },
    rejectPwRes
  );
  assert.equal(rejectPwRes.statusCode, 400);

  // Controller forwards delete_token to WordPress DELETE /profile
  const origAxiosDelete = axios.delete;
  let capturedDeleteBody = null;
  axios.delete = async (_url, config) => {
    capturedDeleteBody = config.data;
    return { data: { success: true, message: "Your account has been permanently deleted." } };
  };

  try {
    const okRes = makeRes();
    await deleteAccount(
      {
        wpUserId: 77,
        body: { delete_token: "c".repeat(64) },
        cookies: {},
        headers: {},
      },
      okRes
    );
    assert.equal(okRes.statusCode, 200);
    assert.deepEqual(capturedDeleteBody, { delete_token: "c".repeat(64) });
  } finally {
    axios.delete = origAxiosDelete;
  }

  // WordPress mumbai_delete_account validates _mumbai_delete_auth_token, never _mumbai_reset_auth_token
  const deleteFnStart = wpPluginSource.indexOf("function mumbai_delete_account(");
  const deleteFnSlice = wpPluginSource.slice(deleteFnStart, deleteFnStart + 4500);
  assert.match(deleteFnSlice, /get_param\('delete_token'\)/);
  assert.match(deleteFnSlice, /_mumbai_delete_auth_token/);
  assert.doesNotMatch(deleteFnSlice, /_mumbai_reset_auth_token/);
});

test("Finding #2: mumbai-auth.php cross-revokes all password recovery credentials across every reset/change path", () => {
  assert.match(wpPluginSource, /function mumbai_clear_all_password_recovery_credentials\(\$user_id/);
  assert.match(wpPluginSource, /function mumbai_get_credential_version\(\$user_id\)/);

  const helperStart = wpPluginSource.indexOf("function mumbai_clear_all_password_recovery_credentials(");
  const helperSlice = wpPluginSource.slice(helperStart, helperStart + 1100);
  for (const metaKey of [
    "_mumbai_credential_version",
    "_mumbai_reset_token",
    "_mumbai_reset_expires",
    "_mumbai_reset_token_cred_ver",
    "_mumbai_reset_auth_token",
    "_mumbai_reset_auth_expires",
    "_mumbai_reset_auth_cred_ver",
    "_mumbai_otp_hash",
    "_mumbai_otp_expires",
    "_mumbai_otp_attempts",
    "_mumbai_otp_purpose",
    "_mumbai_otp_pending_phone",
    "_mumbai_otp_cred_ver",
  ]) {
    assert.ok(helperSlice.includes(metaKey), `Helper should clear/advance ${metaKey}`);
  }

  const resetLinkFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_reset_password("),
    wpPluginSource.indexOf("function mumbai_logout(")
  );
  assert.match(resetLinkFn, /mumbai_clear_all_password_recovery_credentials\(\$user->ID\)/);

  const otpResetFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_otp_reset_password("),
    wpPluginSource.indexOf("function mumbai_product_create_operation(")
  );
  assert.match(otpResetFn, /mumbai_clear_all_password_recovery_credentials\(\$user->ID\)/);

  const saveProfileFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_save_profile_locked("),
    wpPluginSource.indexOf("function mumbai_check_profile_complete(")
  );
  assert.match(saveProfileFn, /mumbai_clear_all_password_recovery_credentials\(\$user_id\)/);
});

test("Finding #3 & #4: mumbai_sso shares mumbai_reg_ lock, verifies _google_sub before session lock, and uses accurate linking copy", () => {
  const ssoFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_sso("),
    wpPluginSource.indexOf("function mumbai_register(")
  );

  // Shared email lock with mumbai_register
  assert.match(ssoFn, /\$reg_lock\s*=\s*'mumbai_reg_'\s*\.\s*md5\(strtolower\(trim\(\$email\)\)\)/);
  assert.match(ssoFn, /SELECT GET_LOCK\(%s, 5\)/);
  assert.match(ssoFn, /SELECT RELEASE_LOCK\(%s\)/);

  // _google_sub persistence verified before issuing session
  assert.match(ssoFn, /sso_link_persistence_failed/);

  // RELEASE_LOCK happens BEFORE mumbai_with_user_session_lock (no nested MySQL GET_LOCK)
  const releaseIdx = ssoFn.indexOf("SELECT RELEASE_LOCK(%s)");
  const sessionLockIdx = ssoFn.indexOf("mumbai_with_user_session_lock");
  assert.ok(releaseIdx > 0 && sessionLockIdx > releaseIdx, "mumbai_reg_ lock must be released before session lock");

  // Accurate copy without misleading "email OTP first" or dual-method linking wording
  assert.doesNotMatch(ssoFn, /sign in with your password or email OTP first/i);
  assert.match(ssoFn, /sso_email_uses_password/);
});

test("Finding #5: privileged/staff/admin accounts are blocked across all storefront password recovery endpoints", () => {
  assert.match(wpPluginSource, /function mumbai_is_privileged_account\(\$user\)/);

  const forgotFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_forgot_password("),
    wpPluginSource.indexOf("function mumbai_reset_password(")
  );
  assert.match(forgotFn, /mumbai_is_privileged_account\(\$user\)/);

  const resetFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_reset_password("),
    wpPluginSource.indexOf("function mumbai_logout(")
  );
  assert.match(resetFn, /mumbai_is_privileged_account\(\$user\)/);

  const otpStoreFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_otp_store("),
    wpPluginSource.indexOf("function mumbai_otp_invalidate(")
  );
  assert.match(otpStoreFn, /mumbai_is_privileged_account\(\$user\)/);

  const otpVerifyFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_otp_verify_locked("),
    wpPluginSource.indexOf("function mumbai_otp_reset_password(")
  );
  assert.match(otpVerifyFn, /mumbai_is_privileged_account\(\$user\)/);

  const otpResetFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_otp_reset_password("),
    wpPluginSource.indexOf("function mumbai_product_create_operation(")
  );
  assert.match(otpResetFn, /mumbai_is_privileged_account\(\$user\)/);
});

test("Google-only accounts cannot set or reset a separate store password end-to-end", () => {
  assert.match(wpPluginSource, /function mumbai_is_google_only_account\(\$user\)/);

  const loginFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_login("),
    wpPluginSource.indexOf("function mumbai_is_privileged_account(")
  );
  assert.match(loginFn, /mumbai_is_google_only_account\(\$user\)/);

  const forgotFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_forgot_password("),
    wpPluginSource.indexOf("function mumbai_reset_password(")
  );
  assert.match(forgotFn, /mumbai_is_google_only_account\(\$user\)/);

  const otpStoreFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_otp_store("),
    wpPluginSource.indexOf("function mumbai_otp_invalidate(")
  );
  assert.match(otpStoreFn, /mumbai_is_google_only_account\(\$user\)/);

  const saveProfileFn = wpPluginSource.slice(
    wpPluginSource.indexOf("function mumbai_save_profile_locked("),
    wpPluginSource.indexOf("function mumbai_check_profile_complete(")
  );
  assert.match(saveProfileFn, /google_account_password_disabled/);

  const profileSource = fs.readFileSync(
    path.resolve(__dirname, "../../customer-web/src/pages/Profile.jsx"),
    "utf8"
  );
  assert.doesNotMatch(profileSource, /Sign-In Password \(Optional\)/);
  assert.doesNotMatch(profileSource, /mode:\s*"set_password"/);

  const forgotSource = fs.readFileSync(
    path.resolve(__dirname, "../../customer-web/src/pages/ForgotPassword.jsx"),
    "utf8"
  );
  assert.doesNotMatch(forgotSource, /isSetPasswordMode/);
  assert.doesNotMatch(forgotSource, /set_password/);
  assert.doesNotMatch(forgotSource, /google_account_only/);
  assert.match(forgotSource, /https:\/\/myaccount\.google\.com\/security/);
  assert.match(forgotSource, /aria-label=\{showPassword \? "Hide password" : "Show password"\}/);
  assert.match(forgotSource, /aria-label=\{showConfirmPassword \? "Hide confirm password" : "Show confirm password"\}/);

  const accountSource = fs.readFileSync(
    path.resolve(__dirname, "../../customer-web/src/pages/Account.jsx"),
    "utf8"
  );
  assert.doesNotMatch(accountSource, /GoogleAuthButton/);
  assert.doesNotMatch(accountSource, /mode="link"/);
});

test("processSendOtp keeps public reset_password response neutral and sends zero emails when WP returns user_found=false (Google-only or unknown)", async () => {
  const originalWpPost = wp.post;
  try {
    wp.post = async () => ({
      data: {
        success: true,
        user_found: false,
        message: "If an account is registered with this email, an OTP has been sent.",
      },
    });

    const req = {
      body: { email: "googleuser@example.com", purpose: "reset_password" },
      headers: {},
    };
    const res = makeRes();
    await processSendOtp(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.code, undefined);
    assert.match(res.body.message, /If an account is registered/i);
  } finally {
    wp.post = originalWpPost;
  }
});

test("processVerifyOtp normalizes 400/401/404 reset_password errors to one neutral response", async () => {
  const { processVerifyOtp } = await import("../src/services/authOtpService.js");
  const originalWpPost = wp.post;
  try {
    for (const status of [400, 401, 404]) {
      wp.post = async () => {
        const err = new Error("Upstream error");
        err.response = { status, data: { code: `err_${status}`, message: `Specific detail ${status}` } };
        throw err;
      };
      const req = {
        body: { email: "user@example.com", otp: "123456", purpose: "reset_password" },
        headers: {},
      };
      const res = makeRes();
      await processVerifyOtp(req, res);

      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, {
        success: false,
        code: "invalid_otp",
        message: "Invalid or expired OTP.",
      });
    }
  } finally {
    wp.post = originalWpPost;
  }
});

test("accountLoginThrottle applies progressive per-account cooldowns across rotating IPs and clears on success", async () => {
  const { createAccountLoginThrottle } = await import("../src/middlewares/rateLimiter.js");
  const throttle = createAccountLoginThrottle({
    staffThreshold: 3,
    customerThreshold: 5,
    cooldownScheduleSec: [15, 30, 60],
  });

  const makeThrottleRes = () => {
    const headers = {};
    return {
      statusCode: 200,
      headers,
      body: null,
      set(k, v) { headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
  };

  // Staff account hits progressive cooldown after 3 failures even when requests come from rotating IPs
  await throttle.recordFailure("Staff@Example.com", "admin");
  await throttle.recordFailure("staff@example.com", "admin");
  let nextCalled = false;
  await throttle({ body: { email: "staff@example.com", context: "admin" }, ip: "1.1.1.1" }, makeThrottleRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true, "Under threshold should still pass");

  const third = await throttle.recordFailure("staff@example.com", "admin");
  assert.equal(third.cooldownSec, 15);

  // Request from a completely different IP is blocked by per-account cooldown
  const blockedRes = makeThrottleRes();
  nextCalled = false;
  await throttle({ body: { email: "STAFF@example.com", context: "admin" }, ip: "9.9.9.9" }, blockedRes, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(blockedRes.statusCode, 429);
  assert.ok(Number(blockedRes.headers["Retry-After"]) >= 1);
  assert.equal(blockedRes.body.success, false);

  // With no panel hint, the controller and throttle both select Customer.
  const defaultContextRes = makeThrottleRes();
  await throttle({ body: { email: "staff@example.com" }, ip: "9.9.9.9" }, defaultContextRes, () => { nextCalled = true; });
  assert.equal(nextCalled, true, "Admin cooldown must not block a default Customer login");
  assert.equal(defaultContextRes.statusCode, 200);

  // Subsequent failure escalates cooldown progressively (15s -> 30s)
  const fourth = await throttle.recordFailure("staff@example.com", "admin");
  assert.equal(fourth.cooldownSec, 30);

  // Successful login clears the throttle state immediately
  await throttle.recordSuccess("staff@example.com", "admin");
  nextCalled = false;
  await throttle({ body: { email: "staff@example.com", context: "admin" }, ip: "8.8.8.8" }, makeThrottleRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true, "Cleared after successful login");
});

test("accountLoginThrottle isolates contexts and performs atomic concurrent updates via Redis eval", async () => {
  const { createAccountLoginThrottle } = await import("../src/middlewares/rateLimiter.js");
  const { _setRedisClientForTesting } = await import("../src/config/redis.js");

  const fakeRedisStore = new Map();
  const fakeRedis = {
    async get(key) {
      return fakeRedisStore.get(key) ?? null;
    },
    async del(key) {
      fakeRedisStore.delete(key);
      return 1;
    },
    async eval(_script, _numKeys, key, nowStr, windowMsStr, thresholdStr, scheduleRaw) {
      const now = Number(nowStr);
      const windowMs = Number(windowMsStr);
      const threshold = Number(thresholdStr);
      const schedule = String(scheduleRaw).split(",").map(Number);

      let count = 1;
      let expiresAt = now + windowMs;
      const cur = fakeRedisStore.get(key);
      if (cur) {
        const [c, e] = String(cur).split("|").map(Number);
        if (Number.isFinite(c) && Number.isFinite(e) && now < e) {
          count = c + 1;
          expiresAt = e;
        }
      }
      let cooldownSec = 0;
      if (count >= threshold) {
        const idx = Math.min(count - threshold, schedule.length - 1);
        cooldownSec = schedule[idx];
      }
      const blockedUntil = cooldownSec > 0 ? now + cooldownSec * 1000 : 0;
      fakeRedisStore.set(key, `${count}|${expiresAt}|${blockedUntil}`);
      return [count, cooldownSec, blockedUntil];
    },
  };

  const makeThrottleRes = () => {
    const headers = {};
    return {
      statusCode: 200,
      headers,
      body: null,
      set(k, v) { headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
  };

  try {
    _setRedisClientForTesting(fakeRedis);
    const throttle = createAccountLoginThrottle({
      staffThreshold: 3,
      customerThreshold: 3,
      cooldownScheduleSec: [15, 30],
    });

    // Concurrent failures on customer login must not lose increments
    const results = await Promise.all([
      throttle.recordFailure("dual@example.com", "customer"),
      throttle.recordFailure("dual@example.com", "customer"),
      throttle.recordFailure("dual@example.com", "customer"),
    ]);
    assert.deepEqual(
      results.map((r) => r.count).sort((a, b) => a - b),
      [1, 2, 3],
      "Atomic Redis eval must preserve every concurrent failure count"
    );

    // Customer login for dual@example.com is blocked, while admin login with same email stays unblocked
    const custRes = makeThrottleRes();
    let custNext = false;
    await throttle({ body: { email: "dual@example.com", context: "customer" }, ip: "1.2.3.4" }, custRes, () => { custNext = true; });
    assert.equal(custNext, false);
    assert.equal(custRes.statusCode, 429);

    const adminRes = makeThrottleRes();
    let adminNext = false;
    await throttle({ body: { email: "dual@example.com", context: "admin" }, ip: "1.2.3.4" }, adminRes, () => { adminNext = true; });
    assert.equal(adminNext, true);

    // Omitting body.context while providing X-Mumbai-Panel resolves the single panel via resolveContext
    const headerAdminRes = makeThrottleRes();
    let headerAdminNext = false;
    await throttle(
      { body: { email: "dual@example.com" }, headers: { "x-mumbai-panel": "admin" }, ip: "1.2.3.4" },
      headerAdminRes,
      () => { headerAdminNext = true; }
    );
    assert.equal(headerAdminNext, true);

    const headerCustRes = makeThrottleRes();
    let headerCustNext = false;
    await throttle(
      { body: { email: "dual@example.com" }, headers: { "x-mumbai-panel": "customer" }, ip: "1.2.3.4" },
      headerCustRes,
      () => { headerCustNext = true; }
    );
    assert.equal(headerCustNext, false);
    assert.equal(headerCustRes.statusCode, 429);

    const defaultContextRes = makeThrottleRes();
    await throttle({ body: { email: "dual@example.com" }, ip: "1.2.3.4" }, defaultContextRes, () => {
      assert.fail("A request without a panel hint must enforce the Customer cooldown");
    });
    assert.equal(defaultContextRes.statusCode, 429);

    await throttle.recordSuccess("dual@example.com", "customer");
  } finally {
    _setRedisClientForTesting(null);
  }
});
