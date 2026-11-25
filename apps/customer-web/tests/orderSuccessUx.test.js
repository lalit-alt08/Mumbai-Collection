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

  await t.test("2. Sets standard Est. Delivery to Same Day Delivery", () => {
    assert.equal(orderSuccessSrc.includes("Same Day Delivery"), true);
    assert.equal(orderSuccessSrc.includes("Delivery timing will be confirmed by the store"), false);
  });

  await t.test("3. Uses larger animated checkmark and full light/dark CSS alignment with reduced-motion support", () => {
    assert.match(orderSuccessSrc, /h-24 w-24/);
    assert.match(orderSuccessSrc, /order-success-check-path/);
    assert.match(indexCssSrc, /orderSuccessDrawCheck/);
    assert.match(indexCssSrc, /prefers-reduced-motion: reduce/);
    assert.match(indexCssSrc, /html\[data-store-theme="dark"\] \.order-success-card/);
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
});
