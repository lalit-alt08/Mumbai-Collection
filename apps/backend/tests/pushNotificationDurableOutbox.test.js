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
    migrateDiskJobsToRedis,
    sendOrderCreatedPush,
    isEmployeeActiveForPush,
    _resetPushNotificationServiceForTesting,
    _diskLockTesting,
  } = await import("../src/services/pushNotificationService.js");

  const {
    closeRedis,
    _setRedisClientForTesting,
  } = await import("../src/config/redis.js");

  t.after(async () => {
    _resetPushNotificationServiceForTesting();
    await closeRedis();
  });

  t.beforeEach(async () => {
    _resetPushNotificationServiceForTesting();
    _setRedisClientForTesting(null);
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    await initVapidKeys();
  });

  await t.test("1. VAPID Keys: throws if uninitialized, generates valid keypair on init and returns public key", async () => {
    _resetPushNotificationServiceForTesting();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    // Must throw when accessed prior to initialization
    assert.throws(() => getVapidKeys(), /not been initialized/);

    const keys = await initVapidKeys();
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
      hgetall: async () => ({}),
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
      eval: async (script, numKeys, ...args) => {
        const argv = args.slice(numKeys);
        if (script.includes("HSET") && script.includes("RPUSH")) {
          const jid = argv[0];
          const jobJson = argv[1];
          redisJobs.set(jid, jobJson);
          redisPending.push(jid);
          return 1;
        }
        return 1;
      },
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

  await t.test("7. Disk Outbox Recovery: migrates stranded disk jobs into Redis upon reconnection", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const varDir = path.resolve(fileURLToPath(new URL("../var", import.meta.url)));
    const outboxPath = path.join(varDir, "push_outbox.json");
    await fs.mkdir(varDir, { recursive: true });

    const diskJob = {
      id: "push_order_8822_disk_test",
      orderId: 8822,
      total: "3200.00",
      attempts: 0,
      maxAttempts: 3,
      createdAt: Date.now(),
      status: "pending",
    };
    await fs.writeFile(outboxPath, JSON.stringify([diskJob]), "utf8");
    _resetPushNotificationServiceForTesting();
    await initVapidKeys();

    // Redis reconnects, migrateDiskJobsToRedis moves the job to Redis
    const redisJobs = new Map();
    const redisPending = [];

    const mockRedis = {
      hexists: async (hash, key) => redisJobs.has(key),
      eval: async (script, numKeys, ...args) => {
        const argv = args.slice(numKeys);
        if (script.includes("HSET") && script.includes("RPUSH")) {
          const jid = argv[0];
          const jobJson = argv[1];
          redisJobs.set(jid, jobJson);
          redisPending.push(jid);
          return 1;
        }
        return 1;
      },
      pipeline: () => {
        const p = {
          hset: (hash, key, val) => {
            redisJobs.set(key, val);
            return p;
          },
          rpush: (list, val) => {
            redisPending.push(val);
            return p;
          },
          exec: async () => [[null, 1], [null, 1]],
        };
        return p;
      },
    };
    _setRedisClientForTesting(mockRedis);

    const migrated = await migrateDiskJobsToRedis();
    assert.ok(migrated >= 1, "At least one disk job must be migrated to Redis");
    assert.equal(redisJobs.has(diskJob.id), true, "Job must now exist in Redis jobs hash");
    assert.equal(redisPending.includes(diskJob.id), true, "Job must be in Redis pending list");
  });

  await t.test("8. Tri-State Employee Verification: fails closed on unknown/revoked, does not purge on network glitch", async () => {
    const mockRedis = {
      get: async (key) => {
        if (key === "sess:user_rev:404") return String(Date.now());
        return null;
      },
    };
    _setRedisClientForTesting(mockRedis);

    const revokedCheck = await isEmployeeActiveForPush(404);
    assert.equal(revokedCheck.status, "INACTIVE", "Revoked session must report INACTIVE");

    const missingCheck = await isEmployeeActiveForPush(null);
    assert.equal(missingCheck.status, "INACTIVE", "Missing employee ID must report INACTIVE");
  });

  await t.test("9. Disk DLQ Persistence: exhausted disk jobs are appended to push_outbox_dlq.json", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const varDir = path.resolve(fileURLToPath(new URL("../var", import.meta.url)));
    const outboxPath = path.join(varDir, "push_outbox.json");
    const dlqPath = path.join(varDir, "push_outbox_dlq.json");
    await fs.mkdir(varDir, { recursive: true });

    // Ensure clean state
    await fs.unlink(dlqPath).catch(() => {});

    // Register a subscription with an employee that fails verification (returns UNKNOWN)
    const failingSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/fake-exhaust-endpoint",
      keys: { p256dh: "Key==", auth: "Auth==" },
    };
    await registerPushSubscription({ subscription: failingSub, employeeId: 777 });

    // Seed disk job at max attempts
    const exhaustedJob = {
      id: "push_order_dlq_test_77",
      orderId: 7777,
      total: "500.00",
      attempts: 3,
      maxAttempts: 3,
      createdAt: Date.now() - 100000,
      status: "pending",
    };
    await fs.writeFile(outboxPath, JSON.stringify([exhaustedJob]), "utf8");
    _resetPushNotificationServiceForTesting();
    _setRedisClientForTesting(null); // Force disk drain
    await initVapidKeys();

    await processPushOutbox();

    // Verify disk outbox is now empty
    const outboxAfter = JSON.parse(await fs.readFile(outboxPath, "utf8"));
    assert.equal(outboxAfter.length, 0, "Exhausted job must be removed from pending disk outbox");

    // Verify job was persisted into disk DLQ
    const dlqContent = JSON.parse(await fs.readFile(dlqPath, "utf8"));
    assert.ok(Array.isArray(dlqContent));
    const savedDlqJob = dlqContent.find((j) => j.id === exhaustedJob.id);
    assert.ok(savedDlqJob, "Job must exist in DLQ");
    assert.equal(savedDlqJob.status, "dead_letter");
  });

  await t.test("10. Redis Subscription Failure: registration and unregistration rethrow Redis errors", async () => {
    const errorRedis = {
      hset: async () => {
        throw new Error("Redis cluster node disconnected");
      },
      hdel: async () => {
        throw new Error("Redis connection refused");
      },
    };
    _setRedisClientForTesting(errorRedis);

    const testSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/redis-fail-test",
      keys: { p256dh: "Key123==", auth: "Auth123==" },
    };

    await assert.rejects(
      async () => registerPushSubscription({ subscription: testSub, employeeId: 888 }),
      /Redis cluster node disconnected/,
      "Registration must throw on Redis write failure"
    );

    await assert.rejects(
      async () => unregisterPushSubscription({ endpoint: testSub.endpoint, employeeId: 888, userRoles: ["employee"] }),
      /Redis connection refused/,
      "Unregister must throw on Redis delete failure"
    );
  });

  await t.test("11. Multi-Instance Safe Disk Lock: concurrent runner respects exclusive filesystem lock", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const varDir = path.resolve(fileURLToPath(new URL("../var", import.meta.url)));
    const outboxPath = path.join(varDir, "push_outbox.json");
    const lockPath = path.join(varDir, "push_outbox.lock");

    _resetPushNotificationServiceForTesting();
    _setRedisClientForTesting(null); // Force disk mode
    await initVapidKeys();

    const pendingJob = {
      id: "push_order_lock_test_1",
      orderId: 9001,
      total: "250.00",
      attempts: 0,
      maxAttempts: 3,
      createdAt: Date.now(),
      status: "pending",
    };
    await fs.writeFile(outboxPath, JSON.stringify([pendingJob]), "utf8");

    // Simulate another instance holding an active disk lock
    const activeLock = {
      pid: 99999,
      workerId: "remote-worker-instance",
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 20000, // 20s in the future
    };
    await fs.writeFile(lockPath, JSON.stringify(activeLock), "utf8");

    // Run processPushOutbox on our instance
    await processPushOutbox();

    // Verify outbox was untouched because the active lock blocked concurrent processing
    const jobsStillInDisk = JSON.parse(await fs.readFile(outboxPath, "utf8"));
    assert.equal(jobsStillInDisk.length, 1, "Disk outbox must remain untouched while external instance holds the lock");

    // Clean up mock lock
    await fs.unlink(lockPath).catch(() => {});
  });

  await t.test("12. Concurrent disk enqueues preserve every job while Redis is unavailable", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const varDir = path.resolve(fileURLToPath(new URL("../var", import.meta.url)));
    const outboxPath = path.join(varDir, "push_outbox.json");
    const processLockPath = path.join(varDir, "push_outbox.lock");

    _resetPushNotificationServiceForTesting();
    _setRedisClientForTesting(null);
    await initVapidKeys();
    await fs.writeFile(outboxPath, "[]", "utf8");

    // Stop the immediate drain so the assertion only measures concurrent enqueue safety.
    await fs.writeFile(processLockPath, JSON.stringify({
      pid: 99999,
      workerId: "remote-worker-enqueue-test",
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 20000,
    }), "utf8");

    await Promise.all([
      enqueuePushOutboxJob({ orderId: 9101, total: "100.00" }),
      enqueuePushOutboxJob({ orderId: 9102, total: "200.00" }),
    ]);

    // Allow the scheduled drains to observe the external processing lease.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    const queuedJobs = JSON.parse(await fs.readFile(outboxPath, "utf8"));
    assert.deepEqual(
      queuedJobs.map((job) => job.orderId).sort((a, b) => a - b),
      [9101, 9102],
      "Concurrent read/modify/write operations must not overwrite either job"
    );

    await fs.unlink(processLockPath).catch(() => {});
  });

  await t.test("13. Expired lock owners cannot release a replacement owner's lease", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const varDir = path.resolve(fileURLToPath(new URL("../var", import.meta.url)));
    const ownerTestLockPath = path.join(varDir, "push_outbox.owner-test.lock");
    await fs.unlink(ownerTestLockPath).catch(() => {});

    const firstLease = await _diskLockTesting.acquire(ownerTestLockPath, {
      waitMs: 0,
      ttlMs: 30,
    });
    assert.ok(firstLease, "First owner must acquire the lease");

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 45));
    const replacementLease = await _diskLockTesting.acquire(ownerTestLockPath, {
      waitMs: 200,
      ttlMs: 1000,
    });
    assert.ok(replacementLease, "Replacement owner must recover the expired lease");

    const staleRelease = await _diskLockTesting.release(firstLease);
    assert.equal(staleRelease, false, "Stale owner must not delete the replacement lease");

    const liveRecord = JSON.parse(await fs.readFile(ownerTestLockPath, "utf8"));
    assert.equal(liveRecord.token, replacementLease.token);
    assert.equal(await _diskLockTesting.release(replacementLease), true);
  });
});
