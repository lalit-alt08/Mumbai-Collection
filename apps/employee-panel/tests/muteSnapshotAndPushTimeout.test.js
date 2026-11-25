import test from "node:test";
import assert from "node:assert/strict";

test("Employee Mute-All Snapshot & Push Registration Timeout Suite", async (t) => {
  await t.test("1. muteAllOrderAlarms([101, 102]) preserves newly arrived unacknowledged order 103", async () => {
    const {
      restoreOrderAlarms,
      muteAllOrderAlarms,
      getUnacknowledgedOrders,
      subscribeToAlarmState,
      resetNotificationController,
    } = await import("../src/utils/orderNotification.js");

    resetNotificationController();
    let latestState = null;
    const unsubscribe = subscribeToAlarmState((state) => {
      latestState = state;
    });

    try {
      restoreOrderAlarms([101, 102, 103]);

      muteAllOrderAlarms([101, 102]);
      assert.deepEqual(getUnacknowledgedOrders(), [103]);
      assert.deepEqual(latestState?.unacknowledgedOrders, [103]);
    } finally {
      unsubscribe();
      resetNotificationController();
    }
  });

  await t.test("2. registerPushNotificationService fails cleanly instead of hanging when serviceWorker.ready stalls", async () => {
    const origWindow = globalThis.window;
    const origNavigator = globalThis.navigator;
    const origNotification = globalThis.Notification;
    const origTimeout = globalThis.setTimeout;

    globalThis.window = {
      PushManager: function () {},
    };
    globalThis.navigator = {
      serviceWorker: {
        ready: new Promise(() => {}), // Never resolves
      },
    };
    globalThis.Notification = { permission: "granted" };
    // Speed up the 3000ms timer in test so it completes instantly
    globalThis.setTimeout = (fn) => origTimeout(fn, 10);

    try {
      const { registerPushNotificationService } = await import("../src/utils/pushSubscription.js");
      const result = await registerPushNotificationService();
      assert.equal(result.supported, true);
      assert.equal(result.subscribed, false);
      assert.equal(result.reason, "service_worker_unavailable");
    } finally {
      globalThis.setTimeout = origTimeout;
      globalThis.window = origWindow;
      globalThis.navigator = origNavigator;
      globalThis.Notification = origNotification;
    }
  });
});
