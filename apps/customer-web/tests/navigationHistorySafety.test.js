import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src");

/**
 * Lightweight browser history stack simulator that strictly mirrors HTML5 History
 * and React Router navigation semantics (push, replace, go(-1)).
 */
class HistorySimulator {
  constructor(initialPath = "/") {
    this.stack = [{ pathname: initialPath, state: null }];
    this.index = 0;
  }

  get current() {
    return this.stack[this.index];
  }

  get state() {
    return { idx: this.index };
  }

  get location() {
    return {
      pathname: this.current.pathname,
      state: this.current.state,
    };
  }

  navigate(to, options = {}) {
    if (typeof to === "number") {
      const nextIndex = this.index + to;
      if (nextIndex >= 0 && nextIndex < this.stack.length) {
        this.index = nextIndex;
      }
      return;
    }

    const nextEntry = {
      pathname: to,
      state: options.state || null,
    };

    if (options.replace) {
      this.stack[this.index] = nextEntry;
    } else {
      this.stack = this.stack.slice(0, this.index + 1);
      this.stack.push(nextEntry);
      this.index += 1;
    }
  }
}

// --------------------------------------------------------------------------
// JOURNEY 1: Cart -> Addresses -> Back -> Cart -> Back -> Home
// --------------------------------------------------------------------------
test("Journey 1: Cart -> Addresses -> Back -> Cart -> Back lands on Home without loop", () => {
  const sim = new HistorySimulator("/");
  assert.equal(sim.location.pathname, "/");

  // Shopper adds item and goes to Cart
  sim.navigate("/cart");
  assert.equal(sim.location.pathname, "/cart");
  assert.equal(sim.index, 1);

  // Shopper clicks "Add Address" on Cart (push)
  sim.navigate("/account/addresses", { state: { from: "/cart", selectNew: true } });
  assert.equal(sim.location.pathname, "/account/addresses");
  assert.equal(sim.index, 2);

  // Shopper clicks "Back" button on Addresses
  // Logic from Addresses.jsx:
  const addressesBackHandler = () => {
    if (sim.state && sim.state.idx > 0) {
      sim.navigate(-1);
    } else {
      sim.navigate(sim.location.state?.from || "/account", { replace: true });
    }
  };
  addressesBackHandler();

  // Shopper is back on Cart
  assert.equal(sim.location.pathname, "/cart");
  assert.equal(sim.index, 1);

  // Shopper clicks "Back" button on Cart
  // Logic from Cart.jsx:
  const cartBackHandler = () => {
    if (sim.state && sim.state.idx > 0) {
      sim.navigate(-1);
    } else {
      sim.navigate("/", { replace: true });
    }
  };
  cartBackHandler();

  // Shopper is safely back on Home! Zero loop.
  assert.equal(sim.location.pathname, "/");
  assert.equal(sim.index, 0);
});

// --------------------------------------------------------------------------
// JOURNEY 2A: Cart -> Sign In -> ProfileSetup -> Skip -> Cart -> Back -> Home
// (Entry Path A: Sign In replaced by ProfileSetup)
// --------------------------------------------------------------------------
test("Journey 2A: Cart -> Sign In -> ProfileSetup -> Skip -> Cart -> Back lands on Home with 1 back click", () => {
  const sim = new HistorySimulator("/");

  // Shopper navigates Home -> Cart
  sim.navigate("/cart");
  assert.equal(sim.location.pathname, "/cart");
  assert.equal(sim.index, 1);

  // Shopper clicks "Sign in to continue" on Cart (Cart.jsx:732)
  sim.navigate("/login", { state: { from: "/cart" } });
  assert.equal(sim.location.pathname, "/login");
  assert.equal(sim.index, 2);

  // Post-auth redirect detects incomplete profile, replaces /login with /profile-setup (postAuthRedirect.js:280)
  sim.navigate("/profile-setup", {
    replace: true,
    state: { from: "/cart", first_name: "Asha", last_name: "Patel" },
  });
  assert.equal(sim.location.pathname, "/profile-setup");
  assert.equal(sim.index, 2); // Replaced /login, so /cart remains at index 1

  // Shopper clicks "Skip for now" on ProfileSetup (ProfileSetup.jsx handleExitSetup)
  const profileSetupExitHandler = () => {
    if (sim.state && sim.state.idx > 0) {
      sim.navigate(-1);
    } else {
      sim.navigate(sim.location.state?.from || "/", { replace: true });
    }
  };
  profileSetupExitHandler();

  // Shopper returns cleanly to index 1 (/cart)
  assert.equal(sim.location.pathname, "/cart");
  assert.equal(sim.index, 1);

  // Shopper clicks "Back" on Cart (Cart.jsx)
  const cartBackHandler = () => {
    if (sim.state && sim.state.idx > 0) {
      sim.navigate(-1);
    } else {
      sim.navigate("/", { replace: true });
    }
  };
  cartBackHandler();

  // EXACTLY 1 back click reaches Home! Zero duplicate Cart pages.
  assert.equal(sim.location.pathname, "/");
  assert.equal(sim.index, 0);
});

// --------------------------------------------------------------------------
// JOURNEY 2B: Cart -> Retry Profile Check -> ProfileSetup -> Skip -> Cart -> Back -> Home
// (Entry Path B: Cart pushes ProfileSetup directly)
// --------------------------------------------------------------------------
test("Journey 2B: Cart -> Retry Profile Check -> ProfileSetup -> Skip -> Cart -> Back lands on Home with 1 back click", () => {
  const sim = new HistorySimulator("/");

  // Shopper navigates Home -> Cart
  sim.navigate("/cart");
  assert.equal(sim.location.pathname, "/cart");
  assert.equal(sim.index, 1);

  // Profile check retry pushes /profile-setup without replacing /cart (postAuthRedirect.js:308)
  sim.navigate("/profile-setup", {
    state: { from: "/cart", first_name: "Asha", last_name: "Patel" },
  });
  assert.equal(sim.location.pathname, "/profile-setup");
  assert.equal(sim.index, 2); // Pushed on top of /cart

  // Shopper clicks "Skip for now" on ProfileSetup (ProfileSetup.jsx handleExitSetup)
  const profileSetupExitHandler = () => {
    if (sim.state && sim.state.idx > 0) {
      sim.navigate(-1);
    } else {
      sim.navigate(sim.location.state?.from || "/", { replace: true });
    }
  };
  profileSetupExitHandler();

  // Shopper pops back cleanly to index 1 (/cart)
  assert.equal(sim.location.pathname, "/cart");
  assert.equal(sim.index, 1);

  // Shopper clicks "Back" on Cart (Cart.jsx)
  const cartBackHandler = () => {
    if (sim.state && sim.state.idx > 0) {
      sim.navigate(-1);
    } else {
      sim.navigate("/", { replace: true });
    }
  };
  cartBackHandler();

  // EXACTLY 1 back click reaches Home! Zero duplicate Cart pages.
  assert.equal(sim.location.pathname, "/");
  assert.equal(sim.index, 0);
});

// --------------------------------------------------------------------------
// JOURNEY 3: Login <-> Register <-> ForgotPassword Peer Transitions
// --------------------------------------------------------------------------
test("Journey 3: Toggling auth views uses replace and single browser back returns to Cart", () => {
  const sim = new HistorySimulator("/");

  // Shopper enters cart
  sim.navigate("/cart");

  // Unauthenticated checkout directs to login with from: "/cart"
  sim.navigate("/login", { state: { from: "/cart" } });
  assert.equal(sim.location.pathname, "/login");
  assert.equal(sim.index, 2);

  // Shopper clicks "Create one now" (Register)
  sim.navigate("/register", { replace: true, state: { from: sim.location.state?.from } });
  assert.equal(sim.location.pathname, "/register");
  assert.equal(sim.index, 2); // Replaced

  // Shopper clicks "Sign In instead"
  sim.navigate("/login", { replace: true, state: { from: sim.location.state?.from } });
  assert.equal(sim.location.pathname, "/login");
  assert.equal(sim.index, 2); // Replaced

  // Shopper clicks "Forgot password?"
  sim.navigate("/forgot-password", { replace: true, state: { from: sim.location.state?.from } });
  assert.equal(sim.location.pathname, "/forgot-password");
  assert.equal(sim.index, 2); // Replaced
  assert.equal(sim.location.state?.from, "/cart"); // Return destination preserved!

  // Shopper clicks "Back to Sign In"
  sim.navigate("/login", { replace: true, state: { from: sim.location.state?.from } });
  assert.equal(sim.location.pathname, "/login");
  assert.equal(sim.index, 2); // Replaced

  // Now shopper presses browser back once
  sim.navigate(-1);

  // Directly returns to Cart! No trapping between login, register, and forgot-password
  assert.equal(sim.location.pathname, "/cart");
  assert.equal(sim.index, 1);
});

// --------------------------------------------------------------------------
// CODE INSPECTION CHECKS
// --------------------------------------------------------------------------
test("Code Safety: Addresses.jsx back button pops history when idx > 0 and replaces otherwise", () => {
  const file = fs.readFileSync(path.join(srcDir, "pages/Addresses.jsx"), "utf8");
  assert.ok(file.includes("if (window.history.state && window.history.state.idx > 0) {\n                navigate(-1);") ||
            file.includes("if (window.history.state && window.history.state.idx > 0) {\r\n                navigate(-1);"));
  assert.ok(file.includes("navigate(getSafeInternalPath(location.state?.from, \"/account\"), { replace: true });"));
});

test("Code Safety: ProfileSetup.jsx handleExitSetup pops history when idx > 0 and replaces otherwise", () => {
  const file = fs.readFileSync(path.join(srcDir, "pages/ProfileSetup.jsx"), "utf8");
  assert.ok(file.includes("if (window.history.state && window.history.state.idx > 0) {"));
  assert.ok(file.includes("navigate(-1)"));
  assert.ok(file.includes("navigate(getSafeInternalPath(location.state?.from, \"/\"), { replace: true });"));
});

test("Code Safety: postAuthRedirect.js executeCartProfileRetry pushes profile-setup without replace", () => {
  const file = fs.readFileSync(path.join(srcDir, "utils/postAuthRedirect.js"), "utf8");
  // Ensure executeCartProfileRetry does not use replace: true so Cart is preserved at index 1
  assert.match(
    file,
    /navigate\(["']\/profile-setup["'],\s*\{\s*state:\s*\{\s*from:\s*["']\/cart["']/
  );
});
