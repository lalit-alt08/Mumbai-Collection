import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import axios from "axios";
import wp from "../src/services/wordpress.js";
import { login, logout, me } from "../src/controllers/authController.js";
import {
  requireAuth,
  rolesMatchAuthContext,
  setSessionCache,
  getSessionValidation,
  invalidateSessionCache,
} from "../src/middlewares/authMiddleware.js";

// Helper to simulate an Express request through a middleware or controller
const simulate = async (fn, req) => {
  let statusCode = 200;
  let responseData = null;
  let cookiesSet = {};
  let cookiesCleared = {};
  let nextCalled = false;
  let nextError = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    cookie(name, value, options) {
      cookiesSet[name] = { value, options };
      return this;
    },
    clearCookie(name, options) {
      cookiesCleared[name] = options;
      return this;
    },
  };

  const next = (err) => {
    nextCalled = true;
    nextError = err;
  };

  await fn(req, res, next);
  return { statusCode, responseData, cookiesSet, cookiesCleared, nextCalled, nextError };
};

test("Focused Authentication & Role Isolation Security Suite", async (suite) => {
  const originalWpPost = wp.post;
  const originalAxiosPost = axios.post;
  const originalAxiosGet = axios.get;

  suite.after(async () => {
    wp.post = originalWpPost;
    axios.post = originalAxiosPost;
    axios.get = originalAxiosGet;
    const { closeRedis } = await import("../src/config/redis.js");
    await closeRedis();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Role Matching & Isolation
  // ─────────────────────────────────────────────────────────────
  await suite.test("1. rolesMatchAuthContext enforces strict role boundaries", () => {
    // Admin context
    assert.strictEqual(rolesMatchAuthContext("admin", ["administrator"]), true);
    assert.strictEqual(rolesMatchAuthContext("admin", ["employee"]), false);
    assert.strictEqual(rolesMatchAuthContext("admin", ["customer"]), false);
    assert.strictEqual(rolesMatchAuthContext("admin", []), false);

    // Employee context
    assert.strictEqual(rolesMatchAuthContext("employee", ["employee"]), true);
    assert.strictEqual(rolesMatchAuthContext("employee", ["administrator"]), true);
    assert.strictEqual(rolesMatchAuthContext("employee", ["shop_manager"]), true);
    assert.strictEqual(rolesMatchAuthContext("employee", ["customer"]), false);
    assert.strictEqual(rolesMatchAuthContext("employee", []), false);

    // Customer context
    assert.strictEqual(rolesMatchAuthContext("customer", ["customer"]), true);
    assert.strictEqual(rolesMatchAuthContext("customer", ["subscriber"]), true);
    assert.strictEqual(rolesMatchAuthContext("customer", []), true); // default/mock
    assert.strictEqual(rolesMatchAuthContext("customer", ["administrator"]), false); // admin blocked from customer
    assert.strictEqual(rolesMatchAuthContext("customer", ["employee"]), false); // staff blocked from customer
  });

  // ─────────────────────────────────────────────────────────────
  // 2. requireAuth Contextual Enforcement
  // ─────────────────────────────────────────────────────────────
  await suite.test("2. requireAuth rejects mismatched role sessions (VIP Door Security)", async () => {
    const adminAuth = requireAuth("admin");
    const customerCookie = `logged_in=customer_sess_${crypto.randomBytes(8).toString("hex")}`;

    // Seed session cache with a legitimate CUSTOMER session
    setSessionCache(customerCookie, {
      userId: 77,
      name: "Normal Customer",
      roles: ["customer"],
      email: "customer@example.com",
      timestamp: Date.now(),
    });

    // Customer attempts to hit an ADMIN endpoint using their customer token placed in mumbai_admin_auth
    const req = {
      cookies: {
        mumbai_admin_auth: customerCookie,
      },
      headers: {},
    };

    const result = await simulate(adminAuth, req);
    assert.strictEqual(result.statusCode, 403, "Customer session on admin route must receive 403 Forbidden");
    assert.strictEqual(result.responseData.success, false);
    assert.strictEqual(result.nextCalled, false, "next() must NEVER be called when role does not match context");
  });

  await suite.test("3. requireAuth accepts legitimate matching role sessions", async () => {
    const adminAuth = requireAuth("admin");
    const adminCookie = `logged_in=admin_sess_${crypto.randomBytes(8).toString("hex")}`;

    setSessionCache(adminCookie, {
      userId: 1,
      name: "Store Administrator",
      roles: ["administrator"],
      email: "admin@mumbaicollection.in",
      timestamp: Date.now(),
    });

    const req = {
      cookies: {
        mumbai_admin_auth: adminCookie,
      },
      headers: {},
    };

    const result = await simulate(adminAuth, req);
    assert.strictEqual(result.nextCalled, true, "Valid administrator session must pass requireAuth('admin')");
    assert.strictEqual(req.user.id, 1);
    assert.strictEqual(req.user.roles.includes("administrator"), true);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Password Login Role Enforcement
  // ─────────────────────────────────────────────────────────────
  await suite.test("4. Password login verifies panel context against returned roles", async () => {
    // Mock WordPress login response returning a CUSTOMER
    wp.post = async () => ({
      data: {
        success: true,
        session: "test_session_token",
        cookie_name: "logged_in",
        user: {
          id: 10,
          roles: ["customer"],
          email: "customer@test.com",
        },
      },
    });

    // Customer logs in via customer panel -> should succeed (200)
    const customerReq = {
      body: { email: "customer@test.com", password: "Password123!" },
      headers: { "x-mumbai-panel": "customer" },
    };
    const custRes = await simulate(login, customerReq);
    assert.strictEqual(custRes.statusCode, 200);
    assert.strictEqual(custRes.responseData.success, true);
    assert.ok(custRes.cookiesSet["mumbai_customer_auth"]);

    // Customer tries logging into ADMIN panel -> should be rejected with 403
    const adminReq = {
      body: { email: "customer@test.com", password: "Password123!" },
      headers: { "x-mumbai-panel": "admin" },
    };
    const adminRes = await simulate(login, adminReq);
    assert.strictEqual(adminRes.statusCode, 403, "Customer credentials must be rejected on Admin panel");
    assert.strictEqual(adminRes.responseData.success, false);
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Logout & Session Invalidation
  // ─────────────────────────────────────────────────────────────
  await suite.test("5. Logout invalidates session in cache and clears panel cookies", async () => {
    const testCookie = `logged_in=logout_test_${crypto.randomBytes(8).toString("hex")}`;
    setSessionCache(testCookie, {
      userId: 55,
      name: "Logout User",
      roles: ["customer"],
      email: "logout@test.com",
      timestamp: Date.now(),
    });

    const initial = await getSessionValidation(testCookie);
    assert.strictEqual(initial.valid, true, "Session must be valid initially");

    let wpLogoutCalled = false;
    axios.post = async (url) => {
      if (url.includes("/logout")) {
        wpLogoutCalled = true;
      }
      return { data: { success: true } };
    };

    const logoutReq = {
      cookies: { mumbai_customer_auth: testCookie },
      headers: { "x-mumbai-panel": "customer" },
    };

    const logoutRes = await simulate(logout, logoutReq);
    assert.strictEqual(logoutRes.statusCode, 200);
    assert.strictEqual(logoutRes.responseData.success, true);

    await invalidateSessionCache(testCookie);
    const postLogout = await getSessionValidation(testCookie);
    assert.strictEqual(postLogout.valid, false, "Session validation must fail after invalidation");
    assert.ok(logoutRes.cookiesCleared["mumbai_customer_auth"], "Auth cookie must be cleared");
    assert.strictEqual(wpLogoutCalled, true, "WordPress server-side logout must be triggered");
  });

  // ─────────────────────────────────────────────────────────────
  // 5. /auth/me Session Restoration & Cache
  // ─────────────────────────────────────────────────────────────
  await suite.test("6. /auth/me restores authenticated profile from session cache", async () => {
    const meCookie = `logged_in=me_test_${crypto.randomBytes(8).toString("hex")}`;
    setSessionCache(meCookie, {
      userId: 88,
      name: "Cached Profile User",
      roles: ["customer"],
      email: "cached@example.com",
      username: "cacheduser",
      timestamp: Date.now(),
    });

    const meReq = {
      cookies: { mumbai_customer_auth: meCookie },
      query: { context: "customer" },
      headers: {},
    };

    const meRes = await simulate(me, meReq);
    assert.strictEqual(meRes.statusCode, 200);
    assert.strictEqual(meRes.responseData.logged_in, true);
    assert.strictEqual(meRes.responseData.user.id, 88);
    assert.strictEqual(meRes.responseData.user.email, "cached@example.com");
  });
});
