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
const wpPluginSource = fs.readFileSync(path.join(repoRoot, "mumbai-auth.php"), "utf8");
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
    assert.deepEqual(capturedDeleteBody, { password: "", delete_token: "c".repeat(64) });
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

  // Accurate copy without misleading "email OTP first" sign-in wording
  assert.doesNotMatch(ssoFn, /sign in with your password or email OTP first/i);
  assert.match(ssoFn, /Forgot Password/i);
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
