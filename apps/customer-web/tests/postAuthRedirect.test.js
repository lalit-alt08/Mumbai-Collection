import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolvePostAuthDestination,
  executePostAuthNavigation,
  executeCartProfileRetry,
} from "../src/utils/postAuthRedirect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customerWebSrc = path.resolve(__dirname, "../src");

test("Cart sign-up/login with incomplete profile routes to /profile-setup and returns to /cart after setup", async () => {
  const dest = await resolvePostAuthDestination({
    from: "/cart",
    hasCartItems: true,
    user: { id: 10, first_name: "Asha", last_name: "Patel" },
    checkProfileComplete: async () => ({ complete: false, profile_complete: false, address_complete: false }),
  });

  assert.deepEqual(dest, {
    status: "incomplete",
    pathname: "/profile-setup",
    state: {
      from: "/cart",
      first_name: "Asha",
      last_name: "Patel",
    },
  });
});

test("Cart sign-in with complete profile goes straight to /cart without forcing /profile-setup", async () => {
  const dest = await resolvePostAuthDestination({
    from: "/cart",
    hasCartItems: true,
    user: { id: 10, first_name: "Asha", last_name: "Patel" },
    checkProfileComplete: async () => ({ complete: true, profile_complete: true, address_complete: true }),
  });

  assert.deepEqual(dest, { status: "complete", pathname: "/cart" });
});

test("Header sign-in with empty guest cart waits for authenticated saved cart and routes incomplete profile to /profile-setup -> /cart", async () => {
  const navigated = [];
  let waitedUserId = null;

  const result = await executePostAuthNavigation({
    from: undefined,
    hasCartItems: false,
    user: { id: 42, first_name: "Priya", last_name: "Nair" },
    waitForAuthenticatedCart: async (userId) => {
      waitedUserId = userId;
      await new Promise((r) => setTimeout(r, 15));
      return { items: [{ key: "k1", id: 101, quantity: 1 }] };
    },
    checkProfileComplete: async () => ({ complete: false }),
    navigate: (path, opts) => navigated.push({ path, opts }),
  });

  assert.equal(waitedUserId, 42);
  assert.equal(result.status, "incomplete");
  assert.deepEqual(navigated, [
    {
      path: "/profile-setup",
      opts: {
        replace: true,
        state: {
          from: "/cart",
          first_name: "Priya",
          last_name: "Nair",
        },
      },
    },
  ]);
});

test("Header sign-in with empty guest cart and empty authenticated cart goes to Home without calling profile check", async () => {
  let profileCheckCalled = false;
  const navigated = [];

  const result = await executePostAuthNavigation({
    from: undefined,
    hasCartItems: false,
    user: { id: 42 },
    waitForAuthenticatedCart: async () => ({ items: [] }),
    checkProfileComplete: async () => {
      profileCheckCalled = true;
      return { complete: false };
    },
    navigate: (path, opts) => navigated.push({ path, opts }),
  });

  assert.equal(profileCheckCalled, false);
  assert.equal(result.status, "default");
  assert.deepEqual(navigated, [{ path: "/", opts: { replace: true, state: undefined } }]);
});

test("Explicit non-cart protected route (e.g. /account/favorites) is respected without waiting for cart or profile check", async () => {
  let cartCalled = false;
  let profileCalled = false;
  const dest = await resolvePostAuthDestination({
    from: "/account/favorites",
    hasCartItems: false,
    checkAuthenticatedCart: async () => {
      cartCalled = true;
      return { items: [{ id: 1 }] };
    },
    checkProfileComplete: async () => {
      profileCalled = true;
      return { complete: false };
    },
  });

  assert.equal(cartCalled, false);
  assert.equal(profileCalled, false);
  assert.deepEqual(dest, { status: "default", pathname: "/account/favorites" });
});

test("Finding #1: 401 from /api/profile/complete clears expired session and preserves /cart on /login redirect", async () => {
  let sessionExpiredCalled = false;
  let unauthorizedMessage = null;
  const navigated = [];

  const result = await executePostAuthNavigation({
    from: "/cart",
    hasCartItems: true,
    user: { id: 77 },
    checkProfileComplete: async () => {
      const err = new Error("Unauthorized");
      err.response = { status: 401 };
      throw err;
    },
    handleSessionExpired: () => {
      sessionExpiredCalled = true;
    },
    onUnauthorized: (msg) => {
      unauthorizedMessage = msg;
    },
    navigate: (path, opts) => navigated.push({ path, opts }),
  });

  assert.equal(result.status, "unauthorized");
  assert.equal(sessionExpiredCalled, true);
  assert.match(unauthorizedMessage, /session expired/i);
  assert.deepEqual(navigated, [
    {
      path: "/login",
      opts: {
        replace: true,
        state: {
          from: "/cart",
          message: "Your session expired. Please sign in again to continue.",
        },
      },
    },
  ]);
});

test("Finding #3: Delayed profile check after unmount or account switch does not navigate or mutate session", async () => {
  let active = true;
  let resolveProfile;
  const navigated = [];
  let sessionExpiredCalled = false;

  const pending = executePostAuthNavigation({
    from: "/cart",
    hasCartItems: true,
    user: { id: 10 },
    isAttemptActive: () => active,
    checkProfileComplete: () =>
      new Promise((resolve) => {
        resolveProfile = resolve;
      }),
    handleSessionExpired: () => {
      sessionExpiredCalled = true;
    },
    navigate: (path, opts) => navigated.push({ path, opts }),
  });

  // Simulate customer navigating away or switching accounts before response arrives
  active = false;
  resolveProfile({ complete: false });

  const result = await pending;
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(navigated.length, 0);
  assert.equal(sessionExpiredCalled, false);
});

test("Finding #3: Delayed cart merge after unmount cancels before calling profile check", async () => {
  let active = true;
  let resolveCart;
  let profileCheckCalled = false;
  const navigated = [];

  const pending = executePostAuthNavigation({
    from: undefined,
    hasCartItems: false,
    user: { id: 11 },
    isAttemptActive: () => active,
    waitForAuthenticatedCart: () =>
      new Promise((resolve) => {
        resolveCart = resolve;
      }),
    checkProfileComplete: async () => {
      profileCheckCalled = true;
      return { complete: false };
    },
    navigate: (path, opts) => navigated.push({ path, opts }),
  });

  active = false;
  resolveCart({ items: [{ id: 1 }] });

  const result = await pending;
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(profileCheckCalled, false);
  assert.equal(navigated.length, 0);
});

test("Finding #4: Malformed or missing complete field is treated as unavailable with retryable Cart notice", async () => {
  for (const malformedPayload of [null, undefined, {}, { success: true }, { complete: "yes" }]) {
    const dest = await resolvePostAuthDestination({
      from: "/cart",
      hasCartItems: true,
      checkProfileComplete: async () => malformedPayload,
    });

    assert.deepEqual(dest, {
      status: "unavailable",
      pathname: "/cart",
      state: { profileCheckUnavailable: true },
    });
  }
});

test("Transient 503 outage fails open to /cart with retryable profileCheckUnavailable notice", async () => {
  const dest = await resolvePostAuthDestination({
    from: "/cart",
    hasCartItems: true,
    checkProfileComplete: async () => {
      const err = new Error("503 Service Unavailable");
      err.response = { status: 503 };
      throw err;
    },
  });

  assert.deepEqual(dest, {
    status: "unavailable",
    pathname: "/cart",
    state: { profileCheckUnavailable: true },
  });
});

test("Saved cart timeout or error returns distinct cart_unavailable state instead of treating cart as empty", async () => {
  for (const unavailableResult of [
    { status: "unavailable", reason: "timeout", cart: null },
    { status: "unavailable", reason: "error", cart: null },
    null,
  ]) {
    let profileCalled = false;
    const navigated = [];
    const result = await executePostAuthNavigation({
      from: undefined,
      hasCartItems: false,
      user: { id: 42 },
      waitForAuthenticatedCart: async () => unavailableResult,
      checkProfileComplete: async () => {
        profileCalled = true;
        return { complete: false };
      },
      navigate: (path, opts) => navigated.push({ path, opts }),
    });

    assert.equal(profileCalled, false);
    assert.equal(result.status, "cart_unavailable");
    assert.deepEqual(navigated, [
      {
        path: "/",
        opts: { replace: true, state: { cartCheckUnavailable: true } },
      },
    ]);
  }
});

test("Structured confirmed empty cart returns cleanly to Home without cartCheckUnavailable banner", async () => {
  const navigated = [];
  const result = await executePostAuthNavigation({
    from: undefined,
    hasCartItems: false,
    user: { id: 42 },
    waitForAuthenticatedCart: async () => ({ status: "confirmed", cart: { items: [] } }),
    navigate: (path, opts) => navigated.push({ path, opts }),
  });

  assert.equal(result.status, "default");
  assert.deepEqual(navigated, [{ path: "/", opts: { replace: true, state: undefined } }]);
});

test("Cart profile Retry ignores stale 401 and incomplete responses after unmount or account switch", async () => {
  // Stale incomplete response after leaving cart
  let active1 = true;
  let resolveCheck1;
  const navigated1 = [];
  let onIncompleteCalled = false;

  const p1 = executeCartProfileRetry({
    user: { id: 10, first_name: "Asha", last_name: "Patel" },
    isRetryActive: () => active1,
    checkProfileComplete: () => new Promise((r) => { resolveCheck1 = r; }),
    onIncomplete: () => { onIncompleteCalled = true; },
    navigate: (path, opts) => navigated1.push({ path, opts }),
  });

  active1 = false;
  resolveCheck1({ complete: false });
  assert.deepEqual(await p1, { status: "cancelled" });
  assert.equal(onIncompleteCalled, false);
  assert.equal(navigated1.length, 0);

  // Stale 401 response after switching accounts
  let active2 = true;
  let rejectCheck2;
  const navigated2 = [];
  let sessionExpiredCalled = false;

  const p2 = executeCartProfileRetry({
    user: { id: 10 },
    isRetryActive: () => active2,
    checkProfileComplete: () => new Promise((_, rej) => { rejectCheck2 = rej; }),
    handleSessionExpired: () => { sessionExpiredCalled = true; },
    navigate: (path, opts) => navigated2.push({ path, opts }),
  });

  active2 = false;
  const err401 = new Error("Unauthorized");
  err401.response = { status: 401 };
  rejectCheck2(err401);
  assert.deepEqual(await p2, { status: "cancelled" });
  assert.equal(sessionExpiredCalled, false);
  assert.equal(navigated2.length, 0);
});

test("Cart profile Retry handles active incomplete, complete, malformed, and 401 outcomes", async () => {
  const navIncomplete = [];
  let clearedIncomplete = false;
  const r1 = await executeCartProfileRetry({
    user: { id: 10, first_name: "Asha", last_name: "Patel" },
    checkProfileComplete: async () => ({ complete: false }),
    onIncomplete: () => { clearedIncomplete = true; },
    navigate: (p, o) => navIncomplete.push({ p, o }),
  });
  assert.deepEqual(r1, { status: "incomplete" });
  assert.equal(clearedIncomplete, true);
  assert.equal(navIncomplete[0].p, "/profile-setup");
  assert.equal(navIncomplete[0].o.state.from, "/cart");

  let clearedComplete = false;
  const r2 = await executeCartProfileRetry({
    checkProfileComplete: async () => ({ complete: true }),
    onComplete: () => { clearedComplete = true; },
  });
  assert.deepEqual(r2, { status: "complete" });
  assert.equal(clearedComplete, true);

  let clearedMalformed = false;
  const r3 = await executeCartProfileRetry({
    checkProfileComplete: async () => ({ success: true }),
    onComplete: () => { clearedMalformed = true; },
    onIncomplete: () => { clearedMalformed = true; },
  });
  assert.deepEqual(r3, { status: "unavailable" });
  assert.equal(clearedMalformed, false);

  let expired = false;
  const nav401 = [];
  const r4 = await executeCartProfileRetry({
    checkProfileComplete: async () => {
      const err = new Error("Unauthorized");
      err.response = { status: 401 };
      throw err;
    },
    handleSessionExpired: () => { expired = true; },
    navigate: (p, o) => nav401.push({ p, o }),
  });
  assert.deepEqual(r4, { status: "unauthorized" });
  assert.equal(expired, true);
  assert.equal(nav401[0].p, "/login");
  assert.equal(nav401[0].o.state.from, "/cart");
});

test("Login, Register, and GoogleAuthButton capture pre-auth attempt & epoch BEFORE starting auth requests", () => {
  const loginSrc = fs.readFileSync(path.join(customerWebSrc, "pages/Login.jsx"), "utf8");
  assert.ok(
    loginSrc.indexOf("const preAuthEpoch") < loginSrc.indexOf("await login(email, password)"),
    "Login must capture preAuthEpoch before await login()"
  );
  assert.ok(
    loginSrc.indexOf("await confirmAuthenticatedUser(response.user)") > loginSrc.indexOf("await login(email, password)") &&
    loginSrc.indexOf("await confirmAuthenticatedUser(response.user)") < loginSrc.indexOf("loginUser(confirmedUser)"),
    "Login must confirm browser session before loginUser(confirmedUser)"
  );
  assert.ok(
    loginSrc.indexOf("if (!isPreAuthActive())") < loginSrc.indexOf("loginUser(confirmedUser)"),
    "Login must verify isPreAuthActive() before loginUser()"
  );

  const regSrc = fs.readFileSync(path.join(customerWebSrc, "pages/Register.jsx"), "utf8");
  assert.ok(
    regSrc.indexOf("const preAuthEpoch") < regSrc.indexOf("await verifyOtp("),
    "Register must capture preAuthEpoch before await verifyOtp/register"
  );
  assert.ok(
    regSrc.indexOf("if (!isPreAuthActive())") < regSrc.indexOf("loginUser(confirmedUser)"),
    "Register must verify isPreAuthActive() before loginUser()"
  );

  const googleSrc = fs.readFileSync(path.join(customerWebSrc, "components/auth/GoogleAuthButton.jsx"), "utf8");
  assert.ok(
    googleSrc.indexOf("pendingPopupAttemptRef.current = { attemptId, preAuthEpoch }") > 0,
    "GoogleAuthButton must capture attemptId & preAuthEpoch when popup opens"
  );
  assert.ok(
    googleSrc.indexOf("if (!isPreAuthActive())") < googleSrc.indexOf("await googleLogin(payload)"),
    "GoogleAuthButton must verify popup attempt before exchanging Google code with Node"
  );
  assert.ok(
    googleSrc.indexOf("await confirmAuthenticatedUser(res?.user)") > googleSrc.indexOf("await googleLogin(payload)") &&
    googleSrc.indexOf("await confirmAuthenticatedUser(res?.user)") < googleSrc.indexOf("loginUser(confirmedUser)"),
    "GoogleAuthButton must confirm browser session before loginUser(confirmedUser)"
  );
});

test("Brand-new registration skips waitForAuthenticatedCart so empty-cart direct signups go straight to Home", async () => {
  const regSrc = fs.readFileSync(path.join(customerWebSrc, "pages/Register.jsx"), "utf8");
  assert.match(
    regSrc,
    /waitForAuthenticatedCart:\s*null/,
    "Register.jsx must pass waitForAuthenticatedCart: null for brand-new accounts"
  );

  const googleSrc = fs.readFileSync(path.join(customerWebSrc, "components/auth/GoogleAuthButton.jsx"), "utf8");
  assert.match(
    googleSrc,
    /waitForAuthenticatedCart:\s*res\?\.is_new_user\s*\?\s*null\s*:\s*waitForAuthenticatedCart/,
    "GoogleAuthButton.jsx must skip waitForAuthenticatedCart when res?.is_new_user is true"
  );

  let profileCalled = false;
  const navigated = [];
  const result = await executePostAuthNavigation({
    from: undefined,
    hasCartItems: false,
    user: { id: 99, first_name: "Lalit", last_name: "Sirvi" },
    waitForAuthenticatedCart: null,
    checkProfileComplete: async () => {
      profileCalled = true;
      return { complete: false };
    },
    navigate: (p, o) => navigated.push({ p, o }),
  });

  assert.equal(profileCalled, false);
  assert.equal(result.status, "default");
  assert.deepEqual(navigated, [{ p: "/", o: { replace: true, state: undefined } }]);
});

test("Register guards already-signed-in users and shows neutral Google/password sign-in guidance on 409 email_exists", () => {
  const regSrc = fs.readFileSync(path.join(customerWebSrc, "pages/Register.jsx"), "utf8");
  assert.match(regSrc, /isAlreadySignedIn/);
  assert.match(regSrc, /Your account is linked to Google/);
  assert.match(regSrc, /googleBusy/);
  assert.match(
    regSrc,
    /An account with this email already exists\. Please sign in with your password or Continue with Google\./
  );

  const detailsSrc = fs.readFileSync(
    path.join(customerWebSrc, "components/auth/RegisterDetailsStep.jsx"),
    "utf8"
  );
  assert.match(detailsSrc, /disabled=\{loading \|\| googleBusy\}/);
  assert.match(detailsSrc, /onBusyChange=\{onGoogleBusyChange\}/);

  const authCtxSrc = fs.readFileSync(path.join(customerWebSrc, "context/AuthContext.jsx"), "utf8");
  assert.match(authCtxSrc, /mc_auth_session_change/);
  assert.match(authCtxSrc, /isUnverified:\s*true/);
  assert.match(authCtxSrc, /const isAccountSwitch = prevId && String\(prevId\) !== String\(userData\.id\)/);
  assert.match(authCtxSrc, /logoutApi\(\{\s*force:\s*true\s*\}\)/);
  assert.match(authCtxSrc, /logoutPending/);

  const accountSrc = fs.readFileSync(path.join(customerWebSrc, "pages/Account.jsx"), "utf8");
  assert.match(accountSrc, /Retry Server Sign Out/);
  assert.match(accountSrc, /Sign Out on This Device/);

  const loginSrc = fs.readFileSync(path.join(customerWebSrc, "pages/Login.jsx"), "utf8");
  assert.match(loginSrc, /void reconcileSupersededAuth\(\)/);

  const googleSrc = fs.readFileSync(
    path.join(customerWebSrc, "components/auth/GoogleAuthButton.jsx"),
    "utf8"
  );
  assert.match(googleSrc, /void reconcileSupersededAuth\(\)/);
  assert.match(googleSrc, /onBusyChangeRef\.current\?\.\(false\)/);
});
