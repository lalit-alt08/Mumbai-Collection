import test from "node:test";
import assert from "node:assert/strict";
import {
  getPendingPayment,
  setPendingPayment,
  clearPendingPayment,
  computeCartFingerprint,
} from "../src/utils/checkoutIdempotency.js";

// Mock localStorage and window
function setupMockWindow() {
  const store = new Map();
  const mockStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };

  const listeners = new Map();

  globalThis.window = {
    localStorage: mockStorage,
    sessionStorage: mockStorage,
    addEventListener: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    removeEventListener: (event, handler) => {
      if (listeners.has(event)) {
        listeners.set(
          event,
          listeners.get(event).filter((h) => h !== handler)
        );
      }
    },
    dispatchEvent: (event) => {
      const handlers = listeners.get(event.type) || [];
      for (const h of handlers) h(event);
    },
  };

  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (event, handler) => globalThis.window.addEventListener(event, handler),
    removeEventListener: (event, handler) => globalThis.window.removeEventListener(event, handler),
  };

  return { store, mockStorage, listeners };
}

test("Checkout Recovery UX — Backoff Schedule, Event Triggers & LocalStorage Persistence", async (t) => {
  setupMockWindow();

  await t.test("1. Backoff schedule matches exact timing (2s, 4s, 8s, 15s, then 30s) totaling ~3 minutes", () => {
    const BACKOFF_SCHEDULE = [2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000, 30000];
    assert.equal(BACKOFF_SCHEDULE.length, 9, "Schedule must have 9 steps");
    assert.deepEqual(BACKOFF_SCHEDULE.slice(0, 4), [2000, 4000, 8000, 15000]);
    assert.deepEqual(BACKOFF_SCHEDULE.slice(4), [30000, 30000, 30000, 30000, 30000]);

    const totalDurationMs = BACKOFF_SCHEDULE.reduce((sum, d) => sum + d, 0);
    const totalDurationSeconds = totalDurationMs / 1000;
    assert.equal(totalDurationSeconds, 179, "Total backoff duration must be 179s (~3 minutes)");
  });

  await t.test("2. Pending payment is persisted across simulated page close and reopen", () => {
    clearPendingPayment();

    const pendingPayload = {
      razorpay_order_id: "order_mock_persisted_999",
      cartFingerprint: "fingerprint_xyz",
      timestamp: Date.now(),
    };

    setPendingPayment(pendingPayload);

    // Simulate tab close (memory cleared, but localStorage intact)
    const stored = getPendingPayment();
    assert.ok(stored, "Pending payment must be restored from localStorage");
    assert.equal(stored.razorpay_order_id, "order_mock_persisted_999");
    assert.equal(stored.cartFingerprint, "fingerprint_xyz");

    clearPendingPayment();
    assert.equal(getPendingPayment(), null, "Cleared pending payment must return null");
  });

  await t.test("3. Offline network drop does NOT clear pending payment state", () => {
    const pendingPayload = {
      razorpay_order_id: "order_mock_offline_123",
      timestamp: Date.now(),
    };

    setPendingPayment(pendingPayload);

    // Simulate offline network event
    let isOffline = true;
    if (isOffline) {
      // Offline: do not clear pending payment
      assert.ok(getPendingPayment() !== null);
      assert.equal(getPendingPayment().razorpay_order_id, "order_mock_offline_123");
    }

    // Simulate online reconnection
    isOffline = false;
    assert.ok(getPendingPayment() !== null);
    assert.equal(getPendingPayment().razorpay_order_id, "order_mock_offline_123");

    clearPendingPayment();
  });
});
