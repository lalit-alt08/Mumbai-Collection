import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCartFingerprint,
  generateUUID,
  getOrCreateCheckoutIdempotencyKey,
  clearCheckoutIdempotencyKey,
  CHECKOUT_IDEMP_STORAGE_KEY,
} from "../src/utils/checkoutIdempotency.js";

// Minimal mock for browser window.sessionStorage
function setupMockSessionStorage() {
  const store = new Map();
  const mockStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };

  globalThis.window = {
    sessionStorage: mockStorage,
  };

  return { store, mockStorage };
}

test("Checkout Idempotency Persistence & Cart Fingerprinting Suite", async (t) => {
  await t.test("1. computeCartFingerprint produces deterministic signatures regardless of item order", () => {
    const cartA = {
      items: [
        { id: 101, variation_id: 201, quantity: 2 },
        { id: 102, variation_id: null, quantity: 1 },
      ],
      totals: { total_price: "249900" },
    };

    const cartB = {
      items: [
        { id: 102, variation_id: null, quantity: 1 },
        { id: 101, variation_id: 201, quantity: 2 },
      ],
      totals: { total_price: "249900" },
    };

    const fpA = computeCartFingerprint(cartA);
    const fpB = computeCartFingerprint(cartB);

    assert.equal(fpA, fpB, "Cart fingerprints must match regardless of item sorting");
    assert.ok(fpA.includes("101:201:2"), "Fingerprint must contain item 101");
    assert.ok(fpA.includes("102::1"), "Fingerprint must contain item 102");
    assert.ok(fpA.includes("249900"), "Fingerprint must contain cart total");
  });

  await t.test("2. computeCartFingerprint changes when quantities, items, variations, or totals change", () => {
    const baseCart = {
      items: [{ id: 50, variation_id: null, quantity: 1 }],
      totals: { total_price: "99900" },
    };
    const baseFp = computeCartFingerprint(baseCart);

    // Quantity change
    const qtyCart = {
      items: [{ id: 50, variation_id: null, quantity: 2 }],
      totals: { total_price: "199800" },
    };
    assert.notEqual(computeCartFingerprint(qtyCart), baseFp);

    // Variation change
    const varCart = {
      items: [{ id: 50, variation_id: 501, quantity: 1 }],
      totals: { total_price: "99900" },
    };
    assert.notEqual(computeCartFingerprint(varCart), baseFp);

    // Total change
    const totalCart = {
      items: [{ id: 50, variation_id: null, quantity: 1 }],
      totals: { total_price: "89900" },
    };
    assert.notEqual(computeCartFingerprint(totalCart), baseFp);

    // Empty / null cart
    assert.equal(computeCartFingerprint(null), "empty");
  });

  await t.test("3. getOrCreateCheckoutIdempotencyKey generates and persists stable key for identical cart", () => {
    const { store } = setupMockSessionStorage();

    const cart = {
      items: [{ id: 77, variation_id: null, quantity: 1 }],
      totals: { total_price: "150000" },
    };

    // First call: generates new key and stores in sessionStorage
    const key1 = getOrCreateCheckoutIdempotencyKey(cart);
    assert.ok(key1, "Key must be generated");
    assert.ok(store.has(CHECKOUT_IDEMP_STORAGE_KEY), "Key must be persisted in sessionStorage");

    // Second call: must return EXACT same key
    const key2 = getOrCreateCheckoutIdempotencyKey(cart);
    assert.equal(key2, key1, "Same cart must reuse persisted idempotency key");

    // Simulated page refresh: new call reads stored key
    const key3 = getOrCreateCheckoutIdempotencyKey(cart);
    assert.equal(key3, key1, "Page reload with same cart must reuse persisted idempotency key");
  });

  await t.test("4. getOrCreateCheckoutIdempotencyKey regenerates fresh key when cart fingerprint changes", () => {
    const { store } = setupMockSessionStorage();

    const initialCart = {
      items: [{ id: 88, quantity: 1 }],
      totals: { total_price: "50000" },
    };

    const key1 = getOrCreateCheckoutIdempotencyKey(initialCart);
    assert.ok(key1);

    // Modify cart (e.g. customer added another item or changed quantity)
    const modifiedCart = {
      items: [
        { id: 88, quantity: 1 },
        { id: 99, quantity: 2 },
      ],
      totals: { total_price: "120000" },
    };

    const key2 = getOrCreateCheckoutIdempotencyKey(modifiedCart);
    assert.notEqual(key2, key1, "Modified cart must generate a NEW idempotency key to prevent order collision");

    const storedEntry = JSON.parse(store.get(CHECKOUT_IDEMP_STORAGE_KEY));
    assert.equal(storedEntry.key, key2, "Session storage must be updated with the new key");
  });

  await t.test("5. clearCheckoutIdempotencyKey wipes stored key on successful checkout", () => {
    const { store } = setupMockSessionStorage();

    const cart = {
      items: [{ id: 10, quantity: 1 }],
      totals: { total_price: "60000" },
    };

    const key1 = getOrCreateCheckoutIdempotencyKey(cart);
    assert.ok(store.has(CHECKOUT_IDEMP_STORAGE_KEY));

    // Simulate order success cleanup
    clearCheckoutIdempotencyKey();
    assert.equal(store.has(CHECKOUT_IDEMP_STORAGE_KEY), false, "Storage must be cleared on success");

    // Next checkout attempt gets a fresh key
    const key2 = getOrCreateCheckoutIdempotencyKey(cart);
    assert.notEqual(key2, key1, "Next checkout must receive a fresh key after clearance");
  });

  await t.test("6. Graceful fallback when sessionStorage throws (e.g. private browsing / quota exceeded)", () => {
    // Mock sessionStorage that throws on access
    globalThis.window = {
      sessionStorage: {
        getItem: () => {
          throw new Error("SecurityError: Storage disabled");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      },
    };

    const cart = {
      items: [{ id: 5, quantity: 1 }],
      totals: { total_price: "50000" },
    };

    // Should not throw, should return a valid fallback key
    let key;
    assert.doesNotThrow(() => {
      key = getOrCreateCheckoutIdempotencyKey(cart);
    });
    assert.ok(key, "Must return a fallback idempotency key even if storage fails");
  });

  await t.test("7. Total mismatch (409) flow: clearing key allows subsequent attempt to acquire fresh key", () => {
    const { store } = setupMockSessionStorage();

    const cart = {
      items: [{ id: 10, quantity: 1 }],
      totals: { total_price: "60000" },
    };

    const keyBeforeMismatch = getOrCreateCheckoutIdempotencyKey(cart);
    assert.ok(store.has(CHECKOUT_IDEMP_STORAGE_KEY));

    // Simulated 409 woocommerce_rest_checkout_total_mismatch error handling
    clearCheckoutIdempotencyKey();
    assert.equal(store.has(CHECKOUT_IDEMP_STORAGE_KEY), false, "Storage must be cleared on 409 mismatch");

    // Next attempt gets a fresh key even if cart hasn't changed yet
    const keyAfterMismatch = getOrCreateCheckoutIdempotencyKey(cart);
    assert.notEqual(keyAfterMismatch, keyBeforeMismatch, "Next checkout attempt must get fresh idempotency key");
  });

  await t.test("8. In-flight processing (409) flow: key is retained so duplicate submission is prevented", () => {
    const { store } = setupMockSessionStorage();

    const cart = {
      items: [{ id: 10, quantity: 1 }],
      totals: { total_price: "60000" },
    };

    const keyInFlight = getOrCreateCheckoutIdempotencyKey(cart);
    assert.ok(store.has(CHECKOUT_IDEMP_STORAGE_KEY));

    // On "Request is currently being processed", clearCheckoutIdempotencyKey is NOT called
    // so key remains identical
    const keyRetry = getOrCreateCheckoutIdempotencyKey(cart);
    assert.equal(keyRetry, keyInFlight, "In-flight conflict must retain key to prevent duplicate orders");
  });
});

