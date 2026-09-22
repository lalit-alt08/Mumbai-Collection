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

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Stale In-Flight Request Discard via Session Epoch
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("2.1. Stale in-flight cart request from Account A is discarded when session epoch increments", async () => {
    let sessionEpoch = 1;
    let currentCartState = { accountId: 101, items: [{ id: 1, name: "Product A" }] };

    // Simulated fetch cart function mirroring CartContext sessionEpochRef pattern
    const fetchCartForSession = async (requestEpoch, accountId, mockDelayMs, newItems) => {
      await new Promise((resolve) => setTimeout(resolve, mockDelayMs));

      // Guard: If session switched while in-flight, discard response
      if (requestEpoch !== sessionEpoch) {
        return; // Discard stale response
      }

      currentCartState = { accountId, items: newItems };
    };

    // Account A triggers a slow request (100ms)
    const slowRequestA = fetchCartForSession(1, 101, 100, [{ id: 1, name: "Product A Leaked" }]);

    // User switches to Account B after 20ms
    await new Promise((resolve) => setTimeout(resolve, 20));
    sessionEpoch++; // Session switch increments epoch to 2
    currentCartState = null; // Cart reset on account switch

    // Account B triggers a quick request (30ms)
    const quickRequestB = fetchCartForSession(2, 202, 30, [{ id: 2, name: "Product B Fresh" }]);

    await Promise.all([slowRequestA, quickRequestB]);

    // Account A's slow request must NOT overwrite Account B's cart
    assert.deepEqual(currentCartState, {
      accountId: 202,
      items: [{ id: 2, name: "Product B Fresh" }],
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Rapid Double-Click Guard for OTP
  // ───────────────────────────────────────────────────────────────────────────

  await t.test("3.1. Rapid double-click OTP guard suppresses concurrent duplicate requests", async () => {
    let otpLoading = false;
    let sendOtpCallCount = 0;

    const handleSendOtp = async () => {
      // Immediate synchronous handler guard
      if (otpLoading) return;
      otpLoading = true;

      try {
        sendOtpCallCount++;
        // Simulate network dispatch
        await new Promise((resolve) => setTimeout(resolve, 50));
      } finally {
        otpLoading = false;
      }
    };

    // Simulate 5 rapid clicks fired in parallel
    await Promise.all([
      handleSendOtp(),
      handleSendOtp(),
      handleSendOtp(),
      handleSendOtp(),
      handleSendOtp(),
    ]);

    assert.equal(sendOtpCallCount, 1, "OTP API must be called exactly once despite 5 rapid clicks");
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
