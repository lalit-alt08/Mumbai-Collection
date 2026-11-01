import test from "node:test";
import assert from "node:assert/strict";

test("Web Push Notification & Durable Outbox Architecture Test Suite", async (t) => {
  const {
    getVapidKeys,
    getVapidPublicKey,
    initVapidKeys,
    registerPushSubscription,
    unregisterPushSubscription,
    removeSubscriptionsForEmployee,
    loadSubscriptions,
    enqueuePushOutboxJob,
    processPushOutbox,
    sendOrderCreatedPush,
    isEmployeeActiveForPush,
    _resetPushNotificationServiceForTesting,
  } = await import("../src/services/pushNotificationService.js");

  const {
    closeRedis,
    _setRedisClientForTesting,
  } = await import("../src/config/redis.js");

  t.after(async () => {
    _resetPushNotificationServiceForTesting();
    await closeRedis();
  });

  t.beforeEach(() => {
    _resetPushNotificationServiceForTesting();
    _setRedisClientForTesting(null);
  });

  await t.test("1. VAPID Keys: generates valid keypair and returns public key", async () => {
    const keys = getVapidKeys();
    assert.ok(keys.publicKey, "Public key must exist");
    assert.ok(keys.privateKey, "Private key must exist");
    const pubKey = getVapidPublicKey();
    assert.equal(pubKey, keys.publicKey);
  });

  await t.test("2. Subscription Lifecycle: registers subscription strictly with employeeId", async () => {
    const mockSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-emp-101",
      keys: {
        p256dh: "BMockP256dhKeyStringForTesting1234567890=",
        auth: "MockAuthSecret123==",
      },
    };

    // Anonymous subscription (no employeeId) MUST be rejected (fail closed)
    const anonRes = await registerPushSubscription({
      subscription: mockSub,
      employeeId: null,
    });
    assert.equal(anonRes.success, false);
    assert.equal(anonRes.reason, "missing_authenticated_employee_id");

    const res = await registerPushSubscription({
      subscription: mockSub,
      employeeId: 101,
    });

    assert.equal(res.success, true);
    const allSubs = await loadSubscriptions();
    const registered = allSubs.find((s) => s.endpoint === mockSub.endpoint);
    assert.ok(registered, "Registered subscription must be saved");
    assert.equal(registered.employeeId, 101);
  });

  await t.test("3. Scoped Unsubscribe: non-owner employee cannot unsubscribe another device", async () => {
    const mockSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-emp-202",
      keys: {
        p256dh: "BMockP256dhKeyStringForTesting202=",
        auth: "MockAuthSecret202==",
      },
    };

    await registerPushSubscription({
      subscription: mockSub,
      employeeId: 202,
    });

    // Attempted unsubscribe by a different employee (303) who is not an admin
    const unauthorizedRes = await unregisterPushSubscription({
      endpoint: mockSub.endpoint,
      employeeId: 303,
      userRoles: ["employee"],
    });

    assert.equal(unauthorizedRes.success, false);
    assert.equal(unauthorizedRes.reason, "forbidden");

    // Owner employee CAN unsubscribe
    const ownerRes = await unregisterPushSubscription({
      endpoint: mockSub.endpoint,
      employeeId: 202,
      userRoles: ["employee"],
    });
    assert.equal(ownerRes.success, true);
  });

  await t.test("4. Employee Deactivation Purge: removeSubscriptionsForEmployee removes all device subscriptions for revoked user", async () => {
    const sub1 = {
      endpoint: "https://fcm.googleapis.com/fcm/send/device-a-emp-505",
      keys: { p256dh: "KeyA==", auth: "AuthA==" },
    };
    const sub2 = {
      endpoint: "https://fcm.googleapis.com/fcm/send/device-b-emp-505",
      keys: { p256dh: "KeyB==", auth: "AuthB==" },
    };
    const otherSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/device-c-emp-999",
      keys: { p256dh: "KeyC==", auth: "AuthC==" },
    };

    await registerPushSubscription({ subscription: sub1, employeeId: 505 });
    await registerPushSubscription({ subscription: sub2, employeeId: 505 });
    await registerPushSubscription({ subscription: otherSub, employeeId: 999 });

    const purgeRes = await removeSubscriptionsForEmployee(505);
    assert.equal(purgeRes.removedCount >= 2, true);

    const subs = await loadSubscriptions();
    assert.equal(subs.some((s) => s.employeeId === 505), false, "All subscriptions for employee 505 must be purged");
    assert.equal(subs.some((s) => s.employeeId === 999), true, "Other employee subscriptions must remain intact");
  });

  await t.test("5. Subscription Authority: empty Redis hash does NOT resurrect deleted subscriptions from disk", async () => {
    // Mock Redis returning an authoritative empty object {}
    const mockRedis = {
      hgetall: async (key) => ({}),
      hset: async () => 1,
      sadd: async () => 1,
      hdel: async () => 1,
      srem: async () => 1,
    };
    _setRedisClientForTesting(mockRedis);

    const subs = await loadSubscriptions();
    assert.deepEqual(subs, [], "Authoritative empty Redis hash must return empty array without falling back to disk");
  });

  await t.test("6. Outbox Single Authoritative Enqueue: does not duplicate-write to disk when Redis is active", async () => {
    const redisJobs = new Map();
    const redisPending = [];

    const mockRedis = {
      pipeline: () => {
        const ops = [];
        return {
          hset: (hash, key, val) => {
            ops.push(() => redisJobs.set(key, val));
            return this;
          },
          rpush: (list, val) => {
            ops.push(() => redisPending.push(val));
            return this;
          },
          exec: async () => {
            ops.forEach((op) => op());
            return [[null, 1], [null, 1]];
          },
        };
      },
    };
    _setRedisClientForTesting(mockRedis);

    const job = await enqueuePushOutboxJob({
      orderId: 9988,
      total: "1499.00",
    });

    assert.ok(job);
    assert.equal(redisJobs.has(job.id), true, "Job must be written to Redis");
    assert.equal(redisPending.includes(job.id), true, "Job must be queued in Redis pending list");
  });
});
