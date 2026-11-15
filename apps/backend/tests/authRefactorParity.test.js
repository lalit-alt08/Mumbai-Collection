import test from "node:test";
import assert from "node:assert/strict";
import {
  attachSessionCookiesAndCache,
  buildUserProfile,
} from "../src/utils/authCookieUtils.js";
import { login, googleLogin, register, me } from "../src/controllers/authController.js";
import wp from "../src/services/wordpress.js";
import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import { _getSessionCacheForTesting, getSessionValidation } from "../src/middlewares/authMiddleware.js";

test("Authentication Refactor Parity & Invariant Verification Suite", async (suite) => {
  const originalWpPost = wp.post;
  const originalAxiosPost = axios.post;
  const originalOAuthVerify = OAuth2Client.prototype.verifyIdToken;

  suite.after(async () => {
    wp.post = originalWpPost;
    axios.post = originalAxiosPost;
    OAuth2Client.prototype.verifyIdToken = originalOAuthVerify;
    const { closeRedis } = await import("../src/config/redis.js");
    await closeRedis();
  });

  // 1. /auth/me profile format: strictly contains has_usable_password and no unexpected extra fields
  await suite.test("1. buildUserProfile produces exact contract shape with has_usable_password", () => {
    const session = {
      userId: 42,
      name: "Test User",
      username: "testuser",
      email: "test@example.com",
      phone: "9820123456",
      firstName: "Test",
      lastName: "User",
      isGoogleUser: true,
      hasUsablePassword: false,
      isPhoneVerified: true,
      verifiedPhone: "+919820123456",
    };

    const profile = buildUserProfile(session, ["customer"]);

    assert.strictEqual(profile.has_usable_password, false, "Must return snake_case has_usable_password for frontend compatibility");
    assert.strictEqual(profile.hasUsablePassword, undefined, "Must not introduce extraneous camelCase field into response shape");
    assert.strictEqual(profile.is_google_user, true);
    assert.strictEqual(profile.id, 42);
    assert.strictEqual(profile.is_phone_verified, true);
    assert.strictEqual(profile.verified_phone, "+919820123456");
  });

  // 2. Session expiry defaults: registration uses 30-day fallback; login/Google SSO use null when missing
  await suite.test("2. Session expiry defaults: registration uses 30-day fallback; login uses null", () => {
    const dummyReq = { secure: true, headers: {} };
    const cookiesSet = {};
    const dummyRes = {
      cookie(name, val, opts) {
        cookiesSet[name] = { val, opts };
      },
    };

    // Case A: Login with missing expires_at and unparseable cookie -> computedExpiresAt must be null
    const loginResult = attachSessionCookiesAndCache(dummyRes, dummyReq, {
      data: {
        session: "opaque_session_token",
        cookie_name: "wordpress_logged_in_test",
      },
      user: { id: 10, email: "user@example.com", has_usable_password: true },
      context: "customer",
      cookieConfig: { auth: "mumbai_customer_auth", nonce: "mumbai_customer_nonce" },
      isRegistration: false,
    });
    assert.strictEqual(loginResult.computedExpiresAt, null, "Login without explicit expiry must result in null");

    // Case B: Registration with missing expires_at -> computedExpiresAt must fallback to 30 days
    const nowSec = Math.floor(Date.now() / 1000);
    const regResult = attachSessionCookiesAndCache(dummyRes, dummyReq, {
      data: {
        session: "opaque_reg_session",
        cookie_name: "wordpress_logged_in_reg",
      },
      user: { id: 20, email: "reg@example.com" },
      context: "customer",
      cookieConfig: { auth: "mumbai_customer_auth", nonce: "mumbai_customer_nonce" },
      isRegistration: true,
    });
    assert.ok(regResult.computedExpiresAt > (nowSec + 29 * 86400) * 1000, "Registration must provide 30-day fallback");
    assert.ok(regResult.computedExpiresAt <= (nowSec + 31 * 86400) * 1000);
  });

  await suite.test("2b. WordPress cookie deadline is used and an expired session is rejected", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = `expiry_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const options = {
      user: { id: 707, roles: ["customer"] },
      cookieConfig: { auth: "mumbai_customer_auth", nonce: "mumbai_customer_nonce" },
    };
    const result = attachSessionCookiesAndCache({ cookie() {} }, { headers: {} }, {
      ...options,
      isRegistration: true,
      data: { cookie_name: "wordpress_logged_in_test", session: `user|${now + 3600}|${token}|hmac` },
    });
    assert.strictEqual(result.computedExpiresAt, (now + 3600) * 1000);

    const previousGet = axios.get;
    axios.get = async () => ({ data: { logged_in: true, current_user_id: 708, roles: ["customer"] } });
    try {
      const expired = await getSessionValidation(`wordpress_logged_in_test=user|${now - 60}|${token}_expired|hmac`);
      assert.strictEqual(expired.valid, false);
      assert.strictEqual(expired.error, "SESSION_EXPIRED");
    } finally {
      axios.get = previousGet;
    }
  });

  // 3. Password usable defaults: login requires explicit true; registration defaults to true unless explicitly false
  await suite.test("3. Password usable defaults: login requires explicit true; registration defaults to true", () => {
    const dummyReq = { secure: true, headers: {} };
    const dummyRes = { cookie: () => {} };

    // Login with missing has_usable_password
    attachSessionCookiesAndCache(dummyRes, dummyReq, {
      data: {
        session: "sess_login_pw",
        cookie_name: "wp_login",
      },
      user: { id: 30, email: "pw@example.com" }, // has_usable_password omitted
      context: "customer",
      cookieConfig: { auth: "mumbai_customer_auth", nonce: "mumbai_customer_nonce" },
      isRegistration: false,
    });

    const cachedLogin = _getSessionCacheForTesting("wp_login=sess_login_pw");
    assert.strictEqual(cachedLogin.hasUsablePassword, false, "Login must require explicit true for has_usable_password");

    // Registration with missing has_usable_password
    attachSessionCookiesAndCache(dummyRes, dummyReq, {
      data: {
        session: "sess_reg_pw",
        cookie_name: "wp_reg",
      },
      user: { id: 40, email: "regpw@example.com" }, // has_usable_password omitted
      context: "customer",
      cookieConfig: { auth: "mumbai_customer_auth", nonce: "mumbai_customer_nonce" },
      isRegistration: true,
    });

    const cachedReg = _getSessionCacheForTesting("wp_reg=sess_reg_pw");
    assert.strictEqual(cachedReg.hasUsablePassword, true, "Registration defaults hasUsablePassword to true when not false");
  });

  // 4. Google Nonce fallback: returns nonce cookie even if session was not established
  await suite.test("4. Google sign-in sets nonce cookie independently if returned without session", async () => {
    OAuth2Client.prototype.verifyIdToken = async () => ({
      getPayload: () => ({
        email: "googleuser@example.com",
        name: "Google User",
        sub: "google-uid-12345",
        email_verified: true,
      }),
    });

    axios.post = async (url) => {
      if (url.includes("/wp-json/mumbai-auth/v1/sso")) {
        return {
          data: {
            success: true,
            user: { id: 50, email: "googleuser@example.com", roles: ["customer"] },
            rest_nonce: "independent_google_nonce",
            // session and cookie_name omitted (incomplete upstream response)
          },
        };
      }
      return { data: {} };
    };

    const cookies = {};
    const req = {
      body: { credential: "fake_jwt_token" },
      headers: { "x-mumbai-panel": "customer" },
    };
    const res = {
      cookie(name, val) {
        cookies[name] = val;
      },
      status() {
        return this;
      },
      json() {
        return this;
      },
    };

    await googleLogin(req, res);

    assert.strictEqual(
      cookies.mumbai_customer_nonce,
      "independent_google_nonce",
      "Nonce cookie must be set even if session credentials were not returned"
    );
  });
});
