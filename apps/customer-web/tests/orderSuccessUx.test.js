import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("OrderSuccess UX, Dark/Light Theme Alignment, and Success Chime Suite", async (t) => {
  const orderSuccessSrc = readFileSync(new URL("../src/pages/OrderSuccess.jsx", import.meta.url), "utf8");
  const indexCssSrc = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

  await t.test("1. Removes party emoji, intro thank-you text, and bottom packing helper copy", () => {
    assert.equal(orderSuccessSrc.includes("🎉"), false);
    assert.equal(orderSuccessSrc.includes("Thank you for shopping with Mumbai Collection"), false);
    assert.equal(orderSuccessSrc.includes("Our local team will begin packing and dispatching your order shortly."), false);
  });

  await t.test("2. Sets confirmed standard Est. Delivery to Same Day Delivery with safe loading/failure guards", () => {
    assert.equal(orderSuccessSrc.includes("Same Day Delivery"), true);
    assert.equal(orderSuccessSrc.includes("Checking delivery timing…"), true);
    assert.equal(orderSuccessSrc.includes("Delivery timing unavailable"), true);
    assert.equal(orderSuccessSrc.includes("Delivery timing will be confirmed by the store"), false);
  });

  await t.test("3. Uses larger animated checkmark, continuous orbit ring, sonar waves, sparkles, and full light/dark CSS alignment", () => {
    assert.match(orderSuccessSrc, /h-24 w-24/);
    assert.match(orderSuccessSrc, /order-success-check-path/);
    assert.match(orderSuccessSrc, /order-success-ring-path/);
    assert.match(orderSuccessSrc, /order-success-tick-orbit/);
    assert.match(orderSuccessSrc, /order-success-tick-ripple-2/);
    assert.match(orderSuccessSrc, /order-success-tick-spark/);
    assert.match(orderSuccessSrc, /order-success-tick-sheen/);
    assert.match(indexCssSrc, /orderSuccessDrawCheck/);
    assert.match(indexCssSrc, /orderSuccessRingSweep/);
    assert.match(indexCssSrc, /orderSuccessOrbitSpin/);
    assert.match(indexCssSrc, /orderSuccessDiscBreath/);
    assert.match(indexCssSrc, /orderSuccessSpark/);
    assert.match(indexCssSrc, /orderSuccessSheen/);
    assert.match(indexCssSrc, /prefers-reduced-motion: reduce/);
    assert.match(indexCssSrc, /html\[data-store-theme="dark"\] \.order-success-card/);
    assert.match(indexCssSrc, /html\[data-store-theme="dark"\] \.order-success-tick-ring/);
    assert.match(indexCssSrc, /html\[data-store-theme="dark"\] \.order-success-tick-orbit/);
    assert.match(indexCssSrc, /html\[data-store-theme="dark"\] \.order-success-spark-accent/);
    assert.match(indexCssSrc, /html\[data-store-theme="dark"\] \.order-success-secondary/);
  });

  await t.test("4. playOrderSuccessSound plays celebratory chime once per order and deduplicates repeat visits", async () => {
    const origWindow = globalThis.window;
    const origSessionStorage = globalThis.sessionStorage;

    let startedNotes = 0;
    const store = new Map();

    class MockAudioContext {
      constructor() {
        this.state = "suspended";
        this.currentTime = 0;
        this.destination = {};
      }
      async resume() {
        this.state = "running";
      }
      createOscillator() {
        return {
          type: "sine",
          frequency: { setValueAtTime() {} },
          connect() {},
          start() {
            startedNotes += 1;
          },
          stop() {},
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
        };
      }
    }

    globalThis.window = { AudioContext: MockAudioContext };
    globalThis.sessionStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };

    try {
      const { unlockSuccessSound, playOrderSuccessSound } = await import(`../src/utils/successSound.js?v=${Date.now()}`);
      unlockSuccessSound();
      const first = await playOrderSuccessSound("7523");
      const second = await playOrderSuccessSound("7523");
      assert.equal(first, true);
      assert.equal(second, false);
      assert.ok(startedNotes >= 4, "chime should schedule ascending chord notes");
    } finally {
      globalThis.window = origWindow;
      globalThis.sessionStorage = origSessionStorage;
    }
  });

  await t.test("5. Replaces document reload heuristic with session-scoped celebration matching SPA and 303 redirect paths", async () => {
    assert.equal(orderSuccessSrc.includes('getEntriesByType("navigation")'), false);

    const origWindow = globalThis.window;
    const origSessionStorage = globalThis.sessionStorage;
    const origLocalStorage = globalThis.localStorage;
    const sessionMap = new Map();
    const localMap = new Map();

    globalThis.window = {
      sessionStorage: {
        getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null),
        setItem: (k, v) => sessionMap.set(k, String(v)),
        removeItem: (k) => sessionMap.delete(k),
      },
      localStorage: {
        getItem: (k) => (localMap.has(k) ? localMap.get(k) : null),
        setItem: (k, v) => localMap.set(k, String(v)),
        removeItem: (k) => localMap.delete(k),
      },
    };
    globalThis.sessionStorage = globalThis.window.sessionStorage;
    globalThis.localStorage = globalThis.window.localStorage;

    try {
      const {
        markPendingCheckoutCelebration,
        clearPendingCheckoutCelebration,
        buildOrderSuccessNavigationState,
        hasMatchingDirectCheckoutCelebration,
        matchesServerConfirmedCheckoutCelebration,
        consumePendingCheckoutCelebration,
      } = await import(`../src/utils/checkoutIdempotency.js?v=${Date.now()}`);

      // A. Server 303 callback redirect (/order-success?order=7523) after pending Razorpay session
      markPendingCheckoutCelebration({ userId: 42, razorpayOrderId: "order_rzp_101" });
      assert.equal(
        matchesServerConfirmedCheckoutCelebration({
          userId: 42,
          order: { id: 7523, razorpay_order_id: "order_rzp_999" },
        }),
        false
      );
      assert.equal(
        matchesServerConfirmedCheckoutCelebration({
          userId: 42,
          order: { id: 7523, razorpay_order_id: "order_rzp_101" },
        }),
        true
      );
      consumePendingCheckoutCelebration();
      assert.equal(
        matchesServerConfirmedCheckoutCelebration({
          userId: 42,
          order: { id: 7523, razorpay_order_id: "order_rzp_101" },
        }),
        false
      );

      // B. SPA checkout flow (even if storefront had an earlier reload) verifies once and fails after consumption
      const navState = buildOrderSuccessNavigationState({ userId: 42, orderId: 7524 });
      assert.equal(
        hasMatchingDirectCheckoutCelebration({
          userId: 42,
          orderId: 7524,
          token: navState.confirmationToken,
        }),
        true
      );
      assert.equal(
        hasMatchingDirectCheckoutCelebration({
          userId: 99,
          orderId: 7524,
          token: navState.confirmationToken,
        }),
        false
      );
      consumePendingCheckoutCelebration();
      assert.equal(
        hasMatchingDirectCheckoutCelebration({
          userId: 42,
          orderId: 7524,
          token: navState.confirmationToken,
        }),
        false
      );

      // C. Cancelled checkout clears pending celebration marker
      markPendingCheckoutCelebration({ userId: 42, razorpayOrderId: "order_rzp_202" });
      clearPendingCheckoutCelebration();
      assert.equal(
        matchesServerConfirmedCheckoutCelebration({
          userId: 42,
          order: { id: 7525, razorpay_order_id: "order_rzp_202" },
        }),
        false
      );
    } finally {
      globalThis.window = origWindow;
      globalThis.sessionStorage = origSessionStorage;
      globalThis.localStorage = origLocalStorage;
    }
  });
});
