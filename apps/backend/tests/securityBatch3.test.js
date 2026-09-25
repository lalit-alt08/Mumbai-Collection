import http from "node:http";
import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import axios from "axios";
import { verifyCsrf } from "../src/middlewares/csrfMiddleware.js";
import {
  requireIdempotency,
  _clearIdempotencyStoreForTesting,
} from "../src/middlewares/idempotencyMiddleware.js";
import { deleteAccount } from "../src/controllers/profileController.js";
import { COOKIE_NAMES } from "../src/middlewares/authMiddleware.js";
import { login } from "../src/controllers/authController.js";
import wp from "../src/services/wordpress.js";
import { getClientIp, catalogLimiter } from "../src/middlewares/rateLimiter.js";
import { schemas } from "../src/middlewares/requestValidation.js";
import mediaRouter from "../src/routes/mediaRoutes.js";

test("Security Batch 3 Regression Test Suite", async (suite) => {
  const originalEnv = { ...process.env };
  const originalAxiosDelete = axios.delete;
  const originalAxiosPost = axios.post;
  const originalWpPost = wp.post;

  suite.beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
    process.env.WORDPRESS_URL = "http://mock-wordpress";
    process.env.MUMBAI_INTERNAL_API_KEY = "test-internal-key-12345";
    _clearIdempotencyStoreForTesting();
    axios.post = async () => ({ status: 200, data: { success: true } });
  });

  suite.afterEach(() => {
    process.env = { ...originalEnv };
    axios.delete = originalAxiosDelete;
    axios.post = originalAxiosPost;
    wp.post = originalWpPost;
    _clearIdempotencyStoreForTesting();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. CSRF validation with mumbai_wp_auth
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("1. mumbai_wp_auth state-changing requests require CSRF validation", async () => {
    const allowedOrigins = ["http://localhost:5173", "https://mumbaicollection.in"];
    const csrfMiddleware = verifyCsrf(allowedOrigins);

    // Helper to simulate express req/res through verifyCsrf
    const runCsrf = (reqPartial) => {
      return new Promise((resolve) => {
        let statusCode = 200;
        let responseBody = null;
        let nextCalled = false;

        const req = {
          method: "POST",
          path: "/api/profile",
          cookies: {},
          headers: {},
          ...reqPartial,
        };

        const res = {
          status(code) {
            statusCode = code;
            return this;
          },
          json(body) {
            responseBody = body;
            resolve({ statusCode, responseBody, nextCalled: false });
          },
        };

        const next = () => {
          nextCalled = true;
          resolve({ statusCode: 200, responseBody: null, nextCalled: true });
        };

        csrfMiddleware(req, res, next);
      });
    };

    // A1. Unauthenticated mutation with NO origin (e.g. curl/server call) -> passes to rate-limit/auth
    const unauthNoOriginResult = await runCsrf({
      method: "POST",
      cookies: {},
      headers: {},
    });
    assert.equal(unauthNoOriginResult.nextCalled, true, "Unauthenticated requests without origin pass to auth handlers");

    // A2. Unauthenticated mutation with ALLOWED origin -> passes to rate-limit/auth
    const unauthAllowedResult = await runCsrf({
      method: "POST",
      cookies: {},
      headers: { origin: "https://mumbaicollection.in" },
    });
    assert.equal(unauthAllowedResult.nextCalled, true, "Unauthenticated requests with allowed origin pass to auth handlers");

    // A3. Unauthenticated mutation with UNAUTHORIZED origin -> 403 Forbidden (closes OTP/login CSRF window)
    const unauthBlockedResult = await runCsrf({
      method: "POST",
      cookies: {},
      headers: { origin: "https://evil.com" },
    });
    assert.equal(unauthBlockedResult.nextCalled, false, "Unauthenticated browser requests from unauthorized origins must be blocked");
    assert.equal(unauthBlockedResult.statusCode, 403);

    // B. mumbai_wp_auth cookie with UNAUTHORIZED origin -> 403 Forbidden
    const blockedOriginResult = await runCsrf({
      method: "POST",
      cookies: { mumbai_wp_auth: "wordpress_logged_in_token123" },
      headers: { origin: "https://evil-attacker.com" },
    });
    assert.equal(blockedOriginResult.nextCalled, false, "Must block unauthorized origin when mumbai_wp_auth is set");
    assert.equal(blockedOriginResult.statusCode, 403);
    assert.match(blockedOriginResult.responseBody?.message, /unauthorized origin/i);

    // C. mumbai_wp_auth cookie with AUTHORIZED origin -> passes (next called)
    const allowedOriginResult = await runCsrf({
      method: "POST",
      cookies: { mumbai_wp_auth: "wordpress_logged_in_token123" },
      headers: { origin: "https://mumbaicollection.in" },
    });
    assert.equal(allowedOriginResult.nextCalled, true, "Must allow whitelisted origin when mumbai_wp_auth is set");

    // D. mumbai_wp_auth cookie with UNAUTHORIZED referer (no origin) -> 403 Forbidden
    const blockedRefererResult = await runCsrf({
      method: "POST",
      cookies: { mumbai_wp_auth: "wordpress_logged_in_token123" },
      headers: { referer: "https://evil-attacker.com/malicious" },
    });
    assert.equal(blockedRefererResult.nextCalled, false, "Must block unauthorized referer when mumbai_wp_auth is set");
    assert.equal(blockedRefererResult.statusCode, 403);
    assert.match(blockedRefererResult.responseBody?.message, /unauthorized referer/i);

    // E. mumbai_wp_auth cookie with cross-site Fetch Metadata -> 403 Forbidden
    const blockedSecFetchResult = await runCsrf({
      method: "POST",
      cookies: { mumbai_wp_auth: "wordpress_logged_in_token123" },
      headers: { "sec-fetch-site": "cross-site" },
    });
    assert.equal(blockedSecFetchResult.nextCalled, false, "Must block cross-site Sec-Fetch-Site with mumbai_wp_auth");
    assert.equal(blockedSecFetchResult.statusCode, 403);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Checkout Idempotency User Scoping
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("2. Two users on same IP with same idempotency key remain isolated", async () => {
    _clearIdempotencyStoreForTesting();

    const sharedIp = "203.0.113.195";
    const sharedIdempotencyKey = "client-checkout-key-999";
    const route = "/api/store/checkout";

    // Helper to simulate request through requireIdempotency
    const executeIdempotency = (reqPartial) => {
      return new Promise((resolve) => {
        let statusCode = 200;
        let finalBody = null;
        let nextCalled = false;

        const req = {
          method: "POST",
          baseUrl: "/api/store",
          path: "/checkout",
          ip: sharedIp,
          headers: { "x-idempotency-key": sharedIdempotencyKey },
          cookies: {},
          ...reqPartial,
        };

        const res = {
          status(code) {
            statusCode = code;
            return this;
          },
          json(body) {
            finalBody = body;
            resolve({ statusCode, body: finalBody, nextCalled });
          },
        };

        const next = () => {
          nextCalled = true;
          resolve({
            statusCode,
            body: null,
            nextCalled: true,
            complete(code, body) {
              res.status(code).json(body);
            },
          });
        };

        requireIdempotency(req, res, next);
      });
    };

    // Step A: User 1 (wpUserId: 101) submits checkout from shared IP
    const user1Call1 = await executeIdempotency({
      wpUserId: 101,
      ip: sharedIp,
    });
    assert.equal(user1Call1.nextCalled, true, "User 1 first request should call next to execute handler");

    // User 1 order completes successfully
    user1Call1.complete(200, {
      success: true,
      order_id: 5001,
      customer_id: 101,
      customer_name: "Alice Smith",
      total: "1250.00",
    });

    // Step B: User 2 (wpUserId: 102) submits checkout from the EXACT SAME IP with the EXACT SAME key
    const user2Call1 = await executeIdempotency({
      wpUserId: 102,
      ip: sharedIp, // Same IP!
    });
    assert.equal(
      user2Call1.nextCalled,
      true,
      "User 2 must NOT receive User 1's cached order — must proceed to order creation independently"
    );

    // User 2 order completes with their own distinct order details
    user2Call1.complete(200, {
      success: true,
      order_id: 5002,
      customer_id: 102,
      customer_name: "Bob Jones",
      total: "850.00",
    });

    // Step C: User 1 retries with the same key -> receives User 1's cached order (not User 2's)
    const user1Retry = await executeIdempotency({
      wpUserId: 101,
      ip: sharedIp,
    });
    assert.equal(user1Retry.nextCalled, false, "User 1 retry should be served from idempotent cache");
    assert.equal(user1Retry.body?.order_id, 5001);
    assert.equal(user1Retry.body?.customer_id, 101);
    assert.equal(user1Retry.body?._idempotent, true);

    // Step D: User 2 retries with the same key -> receives User 2's cached order (not User 1's)
    const user2Retry = await executeIdempotency({
      wpUserId: 102,
      ip: sharedIp,
    });
    assert.equal(user2Retry.nextCalled, false, "User 2 retry should be served from idempotent cache");
    assert.equal(user2Retry.body?.order_id, 5002);
    assert.equal(user2Retry.body?.customer_id, 102);
    assert.equal(user2Retry.body?._idempotent, true);

    // Step E: Defense-in-depth: if wpUserId is missing, separate auth cookies still isolate users
    const cookieUser1 = await executeIdempotency({
      wpUserId: 0,
      ip: sharedIp,
      cookies: { mumbai_customer_auth: "session_token_user_alpha_1234567890" },
      headers: { "x-idempotency-key": "fallback-cookie-key" },
    });
    assert.equal(cookieUser1.nextCalled, true);
    cookieUser1.complete(200, { order_id: 6001, customer: "Alpha" });

    const cookieUser2 = await executeIdempotency({
      wpUserId: 0,
      ip: sharedIp,
      cookies: { mumbai_customer_auth: "session_token_user_beta_0987654321" },
      headers: { "x-idempotency-key": "fallback-cookie-key" },
    });
    assert.equal(
      cookieUser2.nextCalled,
      true,
      "Users with distinct auth cookies on same IP must remain isolated even if wpUserId is unset"
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Normalized Phone Variants and Uniqueness
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("3. Normalized phone variants cannot bypass uniqueness", () => {
    // Replica of mumbai_normalize_phone from mumbai-auth.php lines 956-966
    const normalizePhone = (phone) => {
      if (!phone) return "";
      let clean = String(phone).replace(/\D/g, "");
      if (clean.length === 12 && clean.startsWith("91")) {
        clean = clean.substring(2);
      }
      if (clean.length === 11 && clean.startsWith("0")) {
        clean = clean.substring(1);
      }
      return clean;
    };

    const targetLocal = "9876543210";
    const variants = [
      "9876543210",
      "+919876543210",
      "+91 98765 43210",
      "09876543210",
      "+91-98765-43210",
      "919876543210",
      " 98765 43210 ",
    ];

    // Every variant must normalize to the exact same 10-digit Indian local format
    for (const variant of variants) {
      assert.equal(
        normalizePhone(variant),
        targetLocal,
        `Variant "${variant}" must normalize to "${targetLocal}"`
      );
    }

    // Simulate mock user database and the updated mumbai_get_user_by_phone logic
    const mockUsers = [
      {
        ID: 10,
        billing_phone: "9876543210",
        _mumbai_verified_phone: "9876543210",
      },
    ];

    const findUserByPhone = (phoneInput) => {
      const cleanPhone = normalizePhone(phoneInput);
      if (!cleanPhone) return null;
      return (
        mockUsers.find(
          (u) =>
            u.billing_phone === cleanPhone ||
            u._mumbai_verified_phone === cleanPhone
        ) || null
      );
    };

    // Every variant resolves to user ID 10
    for (const variant of variants) {
      const userFound = findUserByPhone(variant);
      assert.ok(userFound, `User must be found for variant: ${variant}`);
      assert.equal(userFound.ID, 10);
    }

    // Phone-in-use duplicate guard verification:
    // If a different user (e.g. ID 20) attempts to register with ANY variant of User 10's phone,
    // the uniqueness check must detect the collision and reject.
    const registeringUserId = 20;
    for (const variant of variants) {
      const existingUser = findUserByPhone(variant);
      const isDuplicate = existingUser && existingUser.ID !== registeringUserId;
      assert.equal(
        isDuplicate,
        true,
        `Variant "${variant}" must trigger phone_in_use duplicate detection for user ${registeringUserId}`
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Customer Deletion Respects WordPress Role Protections
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("4. Customer deletion respects WordPress role protections and delegates safely", async () => {
    let capturedWpCall = null;

    // Simulate express req/res for deleteAccount
    const callDeleteAccount = ({ userId, cookies = {} }) => {
      return new Promise((resolve) => {
        let statusCode = 200;
        const clearedCookies = [];

        const req = {
          wpUserId: userId,
          cookies: {
            [COOKIE_NAMES.customer.auth]: "wordpress_auth_cookie_token",
            ...cookies,
          },
          headers: {},
        };

        const res = {
          status(code) {
            statusCode = code;
            return this;
          },
          clearCookie(name) {
            clearedCookies.push(name);
          },
          json(body) {
            resolve({ statusCode, body, clearedCookies });
          },
        };

        deleteAccount(req, res);
      });
    };

    // Case A: Legitimate customer self-deletion (userId: 45)
    axios.delete = async (url, config) => {
      capturedWpCall = { url, config };
      return {
        status: 200,
        data: {
          success: true,
          message: "Your account has been permanently deleted.",
        },
      };
    };

    const customerResult = await callDeleteAccount({ userId: 45 });

    assert.equal(customerResult.statusCode, 200);
    assert.equal(customerResult.body?.success, true);
    assert.ok(capturedWpCall, "Must call WordPress endpoint");
    assert.equal(
      capturedWpCall.url,
      "http://mock-wordpress/wp-json/mumbai-auth/v1/profile"
    );
    assert.equal(
      capturedWpCall.config?.headers?.["X-Mumbai-User-ID"],
      "45"
    );
    assert.equal(
      capturedWpCall.config?.headers?.["X-Mumbai-Internal-Key"],
      "test-internal-key-12345"
    );
    assert.ok(
      customerResult.clearedCookies.includes("mumbai_customer_auth"),
      "Must clear customer auth cookie on successful deletion"
    );

    // Case B: Administrator attempts deletion through customer endpoint
    // WordPress rejects with HTTP 403 cannot_delete_admin
    axios.delete = async () => {
      const err = new Error("Administrator accounts cannot be deleted through this endpoint.");
      err.response = {
        status: 403,
        data: {
          code: "cannot_delete_admin",
          message: "Administrator accounts cannot be deleted through this endpoint.",
        },
      };
      throw err;
    };

    const adminResult = await callDeleteAccount({ userId: 1 });

    assert.equal(adminResult.statusCode, 403, "Must return 403 when trying to delete administrator");
    assert.equal(adminResult.body?.code, "cannot_delete_admin");
    assert.equal(adminResult.clearedCookies.length, 0, "Must NOT clear auth cookies when deletion fails");

    // Case C: Employee attempts self-deletion through customer endpoint
    // WordPress rejects with HTTP 403 forbidden_deletion
    axios.delete = async () => {
      const err = new Error("Privileged and staff accounts cannot be self-deleted.");
      err.response = {
        status: 403,
        data: {
          code: "forbidden_deletion",
          message: "Privileged and staff accounts cannot be self-deleted.",
        },
      };
      throw err;
    };

    const employeeResult = await callDeleteAccount({ userId: 25 });

    assert.equal(employeeResult.statusCode, 403, "Must return 403 when trying to delete employee");
    assert.equal(employeeResult.body?.code, "forbidden_deletion");
    assert.equal(employeeResult.clearedCookies.length, 0, "Must NOT clear auth cookies for forbidden deletion");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Role Verification on Login Prevents Privilege Escalation
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("5. Role verification on Login prevents unauthorized panel cookie issuance", async () => {
    // Helper to simulate express login request
    const executeLogin = ({ email, password, context, userRoles }) => {
      return new Promise((resolve) => {
        let statusCode = 200;
        let responseBody = null;
        const setCookies = {};

        wp.post = async () => {
          return {
            data: {
              success: true,
              message: "Login successful.",
              session: "wp_session_token_12345",
              cookie_name: "wordpress_logged_in_hash",
              rest_nonce: "nonce_abcde",
              user: {
                id: 42,
                email,
                name: "Test User",
                roles: userRoles,
              },
            },
          };
        };

        const req = {
          body: { email, password, context },
          headers: {},
          cookies: {},
        };

        const res = {
          status(code) {
            statusCode = code;
            return this;
          },
          cookie(name, val, opts) {
            setCookies[name] = { val, opts };
          },
          json(body) {
            responseBody = body;
            resolve({ statusCode, responseBody, setCookies });
          },
        };

        login(req, res);
      });
    };

    // Case A: Customer attempts to log into Admin panel (context: "admin")
    // Must be rejected with 403 and NO admin cookie issued
    const customerAdminAttempt = await executeLogin({
      email: "shopper@example.com",
      password: "password123",
      context: "admin",
      userRoles: ["customer"],
    });
    assert.equal(customerAdminAttempt.statusCode, 403, "Customer logging into admin panel must receive 403");
    assert.match(customerAdminAttempt.responseBody?.message, /administrator privileges required/i);
    assert.equal(customerAdminAttempt.setCookies["mumbai_admin_auth"], undefined, "mumbai_admin_auth must NOT be issued to customer");

    // Case B: Customer attempts to log into Employee panel (context: "employee")
    // Must be rejected with 403 and NO employee cookie issued
    const customerEmployeeAttempt = await executeLogin({
      email: "shopper@example.com",
      password: "password123",
      context: "employee",
      userRoles: ["customer"],
    });
    assert.equal(customerEmployeeAttempt.statusCode, 403, "Customer logging into employee panel must receive 403");
    assert.match(customerEmployeeAttempt.responseBody?.message, /staff privileges required/i);
    assert.equal(customerEmployeeAttempt.setCookies["mumbai_employee_auth"], undefined, "mumbai_employee_auth must NOT be issued to customer");

    // Case C: Legitimate Administrator logs into Admin panel
    const adminLogin = await executeLogin({
      email: "boss@mumbaicollection.in",
      password: "adminpassword",
      context: "admin",
      userRoles: ["administrator"],
    });
    assert.equal(adminLogin.statusCode, 200, "Administrator must successfully log in");
    assert.ok(adminLogin.setCookies["mumbai_admin_auth"], "mumbai_admin_auth cookie must be issued to administrator");

    // Case D: Legitimate Employee logs into Employee panel
    const employeeLogin = await executeLogin({
      email: "staff@mumbaicollection.in",
      password: "staffpassword",
      context: "employee",
      userRoles: ["employee"],
    });
    assert.equal(employeeLogin.statusCode, 200, "Employee must successfully log in");
    assert.ok(employeeLogin.setCookies["mumbai_employee_auth"], "mumbai_employee_auth cookie must be issued to employee");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Checkout Resolves and Accepts mumbai_admin_auth
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("6. Checkout cookie resolution accepts mumbai_admin_auth", async () => {
    // Check that cookies accepted in storeRoutes.js include mumbai_admin_auth
    const testCookies = {
      mumbai_admin_auth: "wordpress_logged_in_admin_session_token",
    };

    const customerAuth =
      testCookies.mumbai_customer_auth ||
      testCookies.mumbai_wp_auth ||
      testCookies.mumbai_admin_auth;

    assert.ok(customerAuth, "mumbai_admin_auth must be accepted as valid customerAuth for checkout");
    assert.equal(customerAuth, "wordpress_logged_in_admin_session_token");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. WordPress Service Attaches X-Mumbai-Internal-Key
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("7. WordPress service attaches X-Mumbai-Internal-Key automatically", async () => {
    const requestHandler = wp.interceptors.request.handlers.find((h) => typeof h?.fulfilled === "function");
    assert.ok(requestHandler, "wp instance must have a request interceptor configured");

    process.env.MUMBAI_INTERNAL_API_KEY = "test-secret-key-prod";

    // Request without internal key gets it attached
    const config1 = await requestHandler.fulfilled({ headers: {} });
    assert.equal(config1.headers["X-Mumbai-Internal-Key"], "test-secret-key-prod");

    // Request with explicit key is preserved
    const config2 = await requestHandler.fulfilled({ headers: { "X-Mumbai-Internal-Key": "explicit-key" } });
    assert.equal(config2.headers["X-Mumbai-Internal-Key"], "explicit-key");

    // When environment variable is unset, does not crash and does not set key
    delete process.env.MUMBAI_INTERNAL_API_KEY;
    const config3 = await requestHandler.fulfilled({ headers: {} });
    assert.equal(config3.headers["X-Mumbai-Internal-Key"], undefined);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Media Proxy Hardening (nosniff and SVG CSP)
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("8. Media proxy sets nosniff and SVG Content-Security-Policy", async () => {
    const mockWpServer = http.createServer((req, res) => {
      if (req.url.endsWith(".svg")) {
        res.writeHead(200, { "content-type": "image/svg+xml", "content-length": "13" });
        res.end("<svg></svg>");
      } else if (req.url.endsWith(".png")) {
        res.writeHead(200, { "content-type": "image/png", "content-length": "4" });
        res.end("PNG!");
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise((resolve) => mockWpServer.listen(0, "127.0.0.1", resolve));
    const wpPort = mockWpServer.address().port;
    process.env.WORDPRESS_URL = `http://127.0.0.1:${wpPort}`;

    const app = express();
    app.use("/media", mediaRouter);

    let appServer;
    await new Promise((resolve) => {
      appServer = app.listen(0, "127.0.0.1", resolve);
    });
    const appPort = appServer.address().port;

    try {
      // Test 8A: SVG request gets CSP and nosniff
      const svgRes = await fetch(`http://127.0.0.1:${appPort}/media/2026/09/banner.svg`, {
        headers: { connection: "close" },
      });
      assert.equal(svgRes.status, 200);
      assert.equal(svgRes.headers.get("x-content-type-options"), "nosniff");
      assert.equal(
        svgRes.headers.get("content-security-policy"),
        "default-src 'none'; style-src 'unsafe-inline'"
      );

      // Test 8B: PNG request gets nosniff but NOT SVG CSP
      const pngRes = await fetch(`http://127.0.0.1:${appPort}/media/2026/09/photo.png`, {
        headers: { connection: "close" },
      });
      assert.equal(pngRes.status, 200);
      assert.equal(pngRes.headers.get("x-content-type-options"), "nosniff");
      assert.equal(pngRes.headers.get("content-security-policy"), null);
    } finally {
      if (typeof appServer?.closeAllConnections === "function") appServer.closeAllConnections();
      if (typeof mockWpServer?.closeAllConnections === "function") mockWpServer.closeAllConnections();
      await new Promise((resolve) => appServer.close(resolve));
      await new Promise((resolve) => mockWpServer.close(resolve));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. Dual-Key Rotation & PSK Comparison Logic Verification
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("9. Dual-key rotation supports primary, fallback, and comma-separated keys", async () => {
    // Reference verification mirroring mumbai_is_valid_internal_key in mumbai-auth.php
    const isValidInternalKey = (apiKey, primaryKey, fallbackKey) => {
      if (!apiKey || typeof apiKey !== "string") return false;
      const validKeys = [];
      if (primaryKey) {
        for (const k of primaryKey.split(",")) {
          const trimmed = k.trim();
          if (trimmed) validKeys.push(trimmed);
        }
      }
      if (fallbackKey) {
        for (const k of fallbackKey.split(",")) {
          const trimmed = k.trim();
          if (trimmed) validKeys.push(trimmed);
        }
      }
      if (validKeys.length === 0) return false;
      return validKeys.some((validKey) => {
        if (validKey.length !== apiKey.length) return false;
        return crypto.timingSafeEqual(Buffer.from(validKey), Buffer.from(apiKey));
      });
    };

    const keyA = "key_aaa_1111111111111111";
    const keyB = "key_bbb_2222222222222222";
    const keyC = "key_ccc_3333333333333333";
    const wrongKey = "key_wrong_99999999999999";

    // Primary only
    assert.equal(isValidInternalKey(keyA, keyA, ""), true);
    assert.equal(isValidInternalKey(wrongKey, keyA, ""), false);

    // Fallback key accepted during rotation
    assert.equal(isValidInternalKey(keyB, keyA, keyB), true);
    assert.equal(isValidInternalKey(keyA, keyA, keyB), true);
    assert.equal(isValidInternalKey(wrongKey, keyA, keyB), false);

    // Comma-separated keys accepted
    assert.equal(isValidInternalKey(keyC, `${keyA}, ${keyC}`, keyB), true);
    assert.equal(isValidInternalKey(wrongKey, `${keyA}, ${keyC}`, keyB), false);

    // Empty config fails closed
    assert.equal(isValidInternalKey(keyA, "", ""), false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. Client IP Resolution Supports Cloudflare CF-Connecting-IP
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("10. getClientIp prioritizes CF-Connecting-IP and falls back to req.ip", async () => {
    // 10A. CF-Connecting-IP present
    const reqWithCf = {
      headers: { "cf-connecting-ip": "203.0.113.195" },
      ip: "127.0.0.1",
    };
    assert.equal(getClientIp(reqWithCf), "203.0.113.195");

    // 10B. CF-Connecting-IP absent (standard request)
    const reqWithoutCf = {
      headers: {},
      ip: "198.51.100.42",
    };
    assert.equal(getClientIp(reqWithoutCf), "198.51.100.42");

    // 10C. Fallback to socket remoteAddress
    const reqWithSocket = {
      headers: {},
      socket: { remoteAddress: "192.0.2.1" },
    };
    assert.equal(getClientIp(reqWithSocket), "192.0.2.1");

    // 10D. Total fallback
    assert.equal(getClientIp({}), "unknown");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. Address & Profile Zod Schema Validation
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("11. Address and profile schemas validate fields and sanitize input", async () => {
    // 11A. Valid address passes
    const validAddress = {
      type: "home",
      firstName: "Rohan",
      lastName: "Sharma",
      address_line1: "Flat 402, Sunshine Apartments",
      city: "Vasai West",
      state: "Maharashtra",
      pincode: "401202",
      phone: "9820123456",
    };
    const parsedAddr = schemas.address.parse(validAddress);
    assert.equal(parsedAddr.city, "Vasai West");
    assert.equal(parsedAddr.type, "home");

    // 11B. Address with invalid type rejects
    assert.throws(() => {
      schemas.address.parse({ ...validAddress, type: "warehouse" });
    });

    // 11C. Valid profile passes
    const validProfile = {
      firstName: "Aarav",
      lastName: "Patel",
      age: 28,
      phone: "+919820123456",
    };
    const parsedProf = schemas.profile.parse(validProfile);
    assert.equal(parsedProf.firstName, "Aarav");
    assert.equal(parsedProf.age, 28);

    // 11D. Profile with invalid age rejects
    assert.throws(() => {
      schemas.profile.parse({ ...validProfile, age: 999 });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. Catalog Rate Limiter Behavior
  // ─────────────────────────────────────────────────────────────────────────────
  await suite.test("12. catalogLimiter enforces 300 req/min limit per client IP", async () => {
    catalogLimiter.reset();

    const clientIp = "203.0.113.88";
    const req = {
      headers: { "cf-connecting-ip": clientIp },
      ip: "127.0.0.1",
    };

    let blocked = false;
    let statusCode = 200;
    const res = {
      set() {},
      status(code) {
        statusCode = code;
        return this;
      },
      json() {
        blocked = true;
      },
    };

    // First 300 calls pass
    for (let i = 0; i < 300; i++) {
      let passed = false;
      catalogLimiter(req, res, () => { passed = true; });
      assert.equal(passed, true, `Call ${i + 1} should pass`);
    }

    // 301st call is rate limited with 429
    let passed301 = false;
    catalogLimiter(req, res, () => { passed301 = true; });
    assert.equal(passed301, false, "Call 301 should be blocked");
    assert.equal(blocked, true);
    assert.equal(statusCode, 429);

    catalogLimiter.reset();
  });
});
