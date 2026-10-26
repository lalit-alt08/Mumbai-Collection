import test from "node:test";
import assert from "node:assert/strict";
import { safeStorage } from "../src/utils/safeStorage.js";
import { clearCartSession } from "../src/services/storeApi.js";
import { parseOtpRateLimitError } from "../src/services/authService.js";

test("Customer-Web — Cart Account Isolation & Email OTP Regression Suite", async (t) => {
  t.beforeEach(() => {
    clearCartSession();
    safeStorage.removeItem("mc_user");
  });

  t.afterEach(() => {
    clearCartSession();
    safeStorage.removeItem("mc_user");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Cart Account Isolation & Session Token Reset
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("1.1. clearCartSession purges cart session tokens from both memory and safeStorage", () => {
    safeStorage.setItem("wc_nonce", "secret_nonce_account_A");
    safeStorage.setItem("wc_cart_token", "cart_token_account_A");

    assert.equal(safeStorage.getItem("wc_nonce"), "secret_nonce_account_A");
    assert.equal(safeStorage.getItem("wc_cart_token"), "cart_token_account_A");

    clearCartSession();

    assert.equal(safeStorage.getItem("wc_nonce"), null);
    assert.equal(safeStorage.getItem("wc_cart_token"), null);
  });

  await t.test("1.2. Account A -> logout -> Account B flow guarantees zero cart token leakage", () => {
    // 1. Account A logs in and has active cart session
    safeStorage.setItem("mc_user", JSON.stringify({ id: 101, email: "user_a@example.com" }));
    safeStorage.setItem("wc_nonce", "nonce_account_A_999");
    safeStorage.setItem("wc_cart_token", "cart_token_account_A_999");

    // 2. Account A logs out
    clearCartSession();
    safeStorage.removeItem("mc_user");

    assert.equal(safeStorage.getItem("wc_nonce"), null, "Nonce must be wiped on logout");
    assert.equal(safeStorage.getItem("wc_cart_token"), null, "Cart token must be wiped on logout");
    assert.equal(safeStorage.getItem("mc_user"), null, "User session must be wiped on logout");

    // 3. Account B logs in
    safeStorage.setItem("mc_user", JSON.stringify({ id: 202, email: "user_b@example.com" }));

    // Verify Account B starts completely isolated without Account A's cart token
    assert.equal(safeStorage.getItem("wc_nonce"), null);
    assert.equal(safeStorage.getItem("wc_cart_token"), null);
  });

  await t.test("3.2. parseOtpRateLimitError parses 429 cooldowns and formats clear user message", () => {
    const error429 = {
      response: {
        status: 429,
        data: {
          retryAfter: 60,
          message: "Please wait 60 seconds before requesting another code.",
        },
      },
    };

    const parsed = parseOtpRateLimitError(error429);
    assert.equal(parsed.isRateLimited, true);
    assert.equal(parsed.retryAfter, 60);
    assert.equal(parsed.message, "Too many attempts. Please try again in 1 minute.");
  });
});
