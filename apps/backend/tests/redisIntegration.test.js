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
});
