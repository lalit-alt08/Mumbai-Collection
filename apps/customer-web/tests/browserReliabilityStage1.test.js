import test from "node:test";
import assert from "node:assert/strict";
import { safeStorage, safeSessionStorage } from "../src/utils/safeStorage.js";
import {
  getPendingPayment,
  setPendingPayment,
  clearPendingPayment,
  computeCartFingerprint,
} from "../src/utils/checkoutIdempotency.js";

test("Stage 1 — Critical Browser Reliability Suite", async (t) => {
  await t.test("1. safeStorage: stores, retrieves, and removes keys normally", () => {
    safeStorage.setItem("test_key", "test_val");
    assert.equal(safeStorage.getItem("test_key"), "test_val");

    safeStorage.removeItem("test_key");
    assert.equal(safeStorage.getItem("test_key"), null);
  });

  await t.test("2. safeStorage: getJSON and setJSON handle valid and invalid JSON safely", () => {
    const data = { id: 123, name: "Mumbai User" };
    safeStorage.setJSON("test_json", data);
    assert.deepEqual(safeStorage.getJSON("test_json"), data);

    // Invalid JSON returns default value
    safeStorage.setItem("bad_json", "{not_valid_json}");
    assert.equal(safeStorage.getJSON("bad_json", null), null);
    assert.deepEqual(safeStorage.getJSON("bad_json", {}), {});

    // Missing key returns default value
    assert.equal(safeStorage.getJSON("nonexistent_key", "fallback"), "fallback");

    safeStorage.removeItem("test_json");
    safeStorage.removeItem("bad_json");
  });

  await t.test("3. safeStorage: works in memory fallback when storage throws", () => {
    // Force in-memory fallback by simulating unavailable storage
    const originalWindow = globalThis.window;
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError: Access is denied");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {
          throw new Error("SecurityError: Access is denied");
        },
      },
    };

    assert.doesNotThrow(() => {
      safeStorage.setItem("fallback_key", "fallback_value");
      const val = safeStorage.getItem("fallback_key");
      assert.equal(val, "fallback_value");
      safeStorage.removeItem("fallback_key");
      assert.equal(safeStorage.getItem("fallback_key"), null);
    });

    globalThis.window = originalWindow;
  });

  await t.test("4. safeSessionStorage: operations and fallbacks operate independently", () => {
    safeSessionStorage.setJSON("session_test", { session: true });
    assert.deepEqual(safeSessionStorage.getJSON("session_test"), { session: true });
    safeSessionStorage.removeItem("session_test");
    assert.equal(safeSessionStorage.getItem("session_test"), null);
  });

  await t.test("5. Razorpay Pending Payment Persistence: sets, gets, and clears state", () => {
    const mockCart = {
      items: [{ id: 10, quantity: 1 }],
      totals: { total_price: "99900" },
    };
    const fingerprint = computeCartFingerprint(mockCart);
    const pendingData = {
      order_id: 1234,
      razorpay_order_id: "order_rzp_5678",
      cartFingerprint: fingerprint,
      timestamp: Date.now(),
    };

    setPendingPayment(pendingData);
    const retrieved = getPendingPayment();
    assert.deepEqual(retrieved, pendingData);

    clearPendingPayment();
    assert.equal(getPendingPayment(), null);
  });

});
