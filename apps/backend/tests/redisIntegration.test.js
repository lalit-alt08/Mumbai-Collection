import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { serverCache } from "../src/utils/memoryCache.js";
import { getRedisClient, isRedisActive } from "../src/config/redis.js";

describe("Redis & In-Memory Hybrid Cache Architecture Test Suite", () => {
  test("1. Fallback Driver: Cache operations work seamlessly without an active Redis server", async () => {
    const testKey = `test:item:${Date.now()}`;
    let fetchCount = 0;

    const fetcher = async () => {
      fetchCount++;
      return { id: 101, name: "Test Saree", price: 1499 };
    };

    // First call executes fetcher
    const firstCall = await serverCache.getOrFetch(testKey, fetcher, 5000);
    assert.equal(fetchCount, 1);
    assert.equal(firstCall.name, "Test Saree");

    // Second call serves from L1 cache (fetchCount does not increase)
    const secondCall = await serverCache.getOrFetch(testKey, fetcher, 5000);
    assert.equal(fetchCount, 1);
    assert.deepEqual(secondCall, firstCall);

    // Deletion clears key cleanly
    serverCache.delete(testKey);
    const afterDelete = serverCache.get(testKey);
    assert.equal(afterDelete, null);
  });

  test("2. Single-Flight Coalescing: Concurrent burst requests execute fetchFn only once", async () => {
    const burstKey = `test:burst:${Date.now()}`;
    let executionCounter = 0;

    const slowFetcher = async () => {
      executionCounter++;
      await new Promise((r) => setTimeout(r, 60));
      return { stock: 45, status: "in_stock" };
    };

    // 10 concurrent requests for the exact same key
    const results = await Promise.all([
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
      serverCache.getOrFetch(burstKey, slowFetcher, 5000),
    ]);

    // All 10 callers received identical data
    assert.equal(results.length, 10);
    results.forEach((res) => {
      assert.equal(res.stock, 45);
    });

    // Authoritative fetcher was executed exactly ONCE
    assert.equal(executionCounter, 1);

    serverCache.delete(burstKey);
  });

  test("3. Prefix Invalidation: Clears group cache keys (e.g. products, store-hours)", async () => {
    const prefix = "catalog:prod:";
    serverCache.set(`${prefix}1`, { id: 1 }, 5000);
    serverCache.set(`${prefix}2`, { id: 2 }, 5000);
    serverCache.set("other:key", { id: 99 }, 5000);

    assert.ok(serverCache.get(`${prefix}1`));
    assert.ok(serverCache.get(`${prefix}2`));
    assert.ok(serverCache.get("other:key"));

    serverCache.invalidatePrefix(prefix);

    assert.equal(serverCache.get(`${prefix}1`), null);
    assert.equal(serverCache.get(`${prefix}2`), null);
    assert.ok(serverCache.get("other:key")); // Unrelated key is preserved

    serverCache.delete("other:key");
  });

  test("4. Subscriber Reconnects: Does not duplicate message listeners and flushes local cache on reconnect", async () => {
    const { EventEmitter } = await import("node:events");
    const { MemoryCache } = await import("../src/utils/memoryCache.js");

    class MockSubscriber extends EventEmitter {
      constructor() {
        super();
        this.status = "connecting";
        this.subscribedChannels = [];
      }
      async subscribe(ch) {
        this.subscribedChannels.push(ch);
      }
    }

    const mockSub = new MockSubscriber();
    const cache = new MemoryCache({
      subscriberProvider: () => mockSub,
      redisProvider: () => null,
      redisConfiguredCheck: () => false,
      redisActiveCheck: () => false,
      generationReader: async () => ["0", "0"],
    });

    // Populate local cache
    cache.set("item:1", { name: "Pen" }, 10000);
    assert.ok(cache.get("item:1"));

    // Simulate 3 reconnect cycles
    mockSub.emit("ready");
    mockSub.emit("ready");
    mockSub.emit("ready");

    // Wait for async subscription and clear promise to settle
    await new Promise((resolve) => setImmediate(resolve));

    // Verify message listener is attached exactly ONCE (preventing memory leak / duplicate calls)
    assert.equal(mockSub.listenerCount("message"), 1);

    // Verify local cache was cleared on reconnect to prevent serving data that changed while disconnected
    assert.equal(cache.get("item:1"), null);
  });

  test("5. Accurate Local TTL: Caps in-memory TTL to Redis remaining PTTL", async () => {
    const { MemoryCache } = await import("../src/utils/memoryCache.js");

    const mockRedis = {
      async get() {
        return JSON.stringify({ id: 42, stock: 5 });
      },
      async pttl() {
        return 120; // Only 120ms remaining in Redis
      },
    };

    const cache = new MemoryCache({
      subscriberProvider: () => null,
      redisProvider: () => mockRedis,
      redisConfiguredCheck: () => true,
      redisActiveCheck: () => true,
      generationReader: async () => ["1", "1"],
    });

    // Caller requests full 60000ms TTL, but Redis only has 120ms left
    const result = await cache.getOrFetch("products:42", async () => ({ id: 42, stock: 100 }), 60000);
    assert.equal(result.stock, 5);

    // Immediately available in local cache
    assert.ok(cache.get("products:42"));

    // Wait 150ms (after Redis TTL has elapsed)
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify local cache correctly expired rather than living for 60s
    assert.equal(cache.get("products:42"), null);
  });

  test("6. Expired / Zero PTTL or Late Invalidation Delay: Treats zero or elapsed PTTL as a cache miss", async () => {
    const { MemoryCache } = await import("../src/utils/memoryCache.js");

    // Case A: PTTL returns -2 (key expired in Redis)
    const mockRedisExpired = {
      async get() { return JSON.stringify({ id: 10, stock: 5 }); },
      async pttl() { return -2; },
      async psetex() {},
    };

    let fetchCountA = 0;
    const cacheA = new MemoryCache({
      subscriberProvider: () => null,
      redisProvider: () => mockRedisExpired,
      redisConfiguredCheck: () => true,
      redisActiveCheck: () => true,
      generationReader: async () => ["1", "1"],
    });

    const resA = await cacheA.getOrFetch("products:10", async () => {
      fetchCountA++;
      return { id: 10, stock: 0 }; // Authoritative fresh stock
    }, 60000);

    // Stale Redis data with pttl -2 was NOT returned; fresh fetchFn executed
    assert.equal(fetchCountA, 1);
    assert.equal(resA.stock, 0);

    // Case B: 15ms left in Redis, but generation check takes 25ms
    const mockRedisLate = {
      async get() { return JSON.stringify({ id: 20, stock: 99 }); },
      async pttl() { return 15; },
      async psetex() {},
    };

    let fetchCountB = 0;
    const cacheB = new MemoryCache({
      subscriberProvider: () => null,
      redisProvider: () => mockRedisLate,
      redisConfiguredCheck: () => true,
      redisActiveCheck: () => true,
      generationReader: async () => {
        await new Promise((r) => setTimeout(r, 25)); // 25ms delay > 15ms remaining PTTL!
        return ["1", "1"];
      },
    });

    const resB = await cacheB.getOrFetch("products:20", async () => {
      fetchCountB++;
      return { id: 20, stock: 1 };
    }, 60000);

    // Expired during generation check -> treated as a miss, fresh fetch executed
    assert.equal(fetchCountB, 1);
    assert.equal(resB.stock, 1);
  });

  test("7. Outage Invalidation Replay: Queues invalidation when Redis is offline and replays on reconnect to prevent stale reads", async () => {
    const { MemoryCache } = await import("../src/utils/memoryCache.js");

    let redisOnline = false;
    let nsGen = 1;
    const mockStore = new Map();

    const mockRedis = {
      async get(key) { return mockStore.get(key) || null; },
      async pttl() { return 50000; },
      async psetex(key, ttl, val) { mockStore.set(key, val); },
      async incr() { nsGen++; return nsGen; },
      async publish() { return 1; },
    };

    const cache = new MemoryCache({
      subscriberProvider: () => null,
      redisProvider: () => (redisOnline ? mockRedis : null),
      redisConfiguredCheck: () => true,
      redisActiveCheck: () => redisOnline,
      generationReader: async () => ["1", String(nsGen)],
    });

    // 1. Initial state: Redis is online, product 50 has stock = 5
    redisOnline = true;
    mockStore.set("1:catalog:1:products:50", JSON.stringify({ id: 50, stock: 5 }));

    const initial = await cache.getOrFetch("products:50", async () => ({ id: 50, stock: 5 }));
    assert.equal(initial.stock, 5);

    // 2. Redis goes offline
    redisOnline = false;

    // 3. Stock update happens: 5 -> 0. Invalidation is fired while Redis is down
    cache.invalidatePrefix("products:50");

    // Local cache is immediately cleared
    assert.equal(cache.get("products:50"), null);

    // 4. Redis comes back online
    redisOnline = true;

    // 5. Customer views product 50. Queued invalidation replays, bumping nsGen before reading!
    let authoritativeFetchCalled = false;
    const afterRecovery = await cache.getOrFetch("products:50", async () => {
      authoritativeFetchCalled = true;
      return { id: 50, stock: 0 };
    });

    // Stale stock 5 was NOT served; generation bumped and fresh stock 0 was fetched
    assert.equal(authoritativeFetchCalled, true);
    assert.equal(afterRecovery.stock, 0);
  });
});
