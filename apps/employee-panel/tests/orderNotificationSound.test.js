import test from "node:test";
import assert from "node:assert/strict";

test("Employee Panel Order Sound & Test Sound Regression Suite", async (t) => {
  await t.test("1. isOrderAlarmQuietHours identifies 23:30-10:00 IST overnight window accurately", async () => {
    const { isOrderAlarmQuietHours } = await import("../src/utils/orderNotification.js");
    assert.equal(isOrderAlarmQuietHours(new Date("2026-11-26T01:10:00+05:30")), true);
    assert.equal(isOrderAlarmQuietHours(new Date("2026-11-25T23:45:00+05:30")), true);
    assert.equal(isOrderAlarmQuietHours(new Date("2026-11-26T10:05:00+05:30")), false);
    assert.equal(isOrderAlarmQuietHours(new Date("2026-11-26T15:30:00+05:30")), false);
  });

  await t.test("2. testOrderAlertSound and armOrderAlarm(playTestSound) play even during quiet hours without double-playing", async () => {
    const origWindow = globalThis.window;
    const origAudio = globalThis.Audio;
    const origLocalStorage = globalThis.localStorage;
    const RealDate = globalThis.Date;

    let bufferPlayCount = 0;
    let html5UnmutedPlayCount = 0;
    let html5MutedPrimeCount = 0;

    // Force clock to 01:10 AM IST (inside quiet hours)
    globalThis.Date = class MockDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : ["2026-11-26T01:10:00+05:30"]));
      }
      static now() {
        return new RealDate("2026-11-26T01:10:00+05:30").getTime();
      }
    };

    class MockAudioContext {
      constructor() {
        this.state = "suspended";
        this.currentTime = 0;
        this.destination = {};
      }
      async resume() {
        this.state = "running";
      }
      decodeAudioData(_buf, resolve) {
        const decoded = { duration: 1.5 };
        if (typeof resolve === "function") resolve(decoded);
        return Promise.resolve(decoded);
      }
      createBufferSource() {
        return {
          buffer: null,
          onended: null,
          connect() {},
          disconnect() {},
          stop() {},
          start() {
            bufferPlayCount += 1;
          },
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        };
      }
      createOscillator() {
        return {
          type: "sine",
          frequency: { setValueAtTime() {} },
          onended: null,
          connect() {},
          disconnect() {},
          start() {},
          stop() {},
        };
      }
    }

    class MockAudio {
      constructor(src) {
        this.src = src;
        this.volume = 1;
        this.muted = false;
        this.currentTime = 0;
        this.preload = "none";
      }
      async play() {
        if (this.muted || this.volume === 0) {
          html5MutedPrimeCount += 1;
        } else {
          html5UnmutedPlayCount += 1;
        }
      }
      pause() {}
    }

    globalThis.window = {
      AudioContext: MockAudioContext,
      atob: (str) => Buffer.from(str, "base64").toString("binary"),
      addEventListener() {},
    };
    globalThis.Audio = MockAudio;
    globalThis.localStorage = { setItem() {}, getItem() { return null; } };

    try {
      const mod = await import(`../src/utils/orderNotification.js?case=${Date.now()}`);
      mod.resetNotificationController();

      // Test Sound button must play even at 01:10 AM IST
      await mod.testOrderAlertSound();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(bufferPlayCount, 1, "testOrderAlertSound should play custom voice buffer during quiet hours");
      assert.equal(html5UnmutedPlayCount, 0, "HTML5 fallback must not double-play when Web Audio succeeds");

      // Enable Sound button must prime silently and play test sound once out loud
      const armRes = await mod.armOrderAlarm({ playTestSound: true });
      assert.equal(armRes.armed, true);
      assert.equal(armRes.voiceArmed, true);
      assert.equal(html5MutedPrimeCount, 1, "armOrderAlarm should silently prime HTML5 Audio");
      assert.equal(html5UnmutedPlayCount, 0, "armOrderAlarm must not leave HTML5 Audio playing on top of Web Audio");
      assert.equal(bufferPlayCount, 2, "armOrderAlarm({ playTestSound: true }) should play the test sound once");

      // Automatic background trigger during quiet hours stays silent but queues the order
      mod.triggerNewOrderNotification({ orderId: 9991 });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(bufferPlayCount, 2, "automatic order alarm must stay silent during overnight quiet hours");
      assert.deepEqual(mod.getUnacknowledgedOrders(), [9991]);
      mod.resetNotificationController();
    } finally {
      globalThis.Date = RealDate;
      globalThis.window = origWindow;
      globalThis.Audio = origAudio;
      globalThis.localStorage = origLocalStorage;
    }
  });
});
