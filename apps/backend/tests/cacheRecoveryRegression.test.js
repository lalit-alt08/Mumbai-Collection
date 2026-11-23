import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryCache } from "../src/utils/memoryCache.js";

test("a repeated invalidation remains pending until a second replay", async () => {
  let online = false;
  let resume;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  let bumps = 0;
  const redis = { incr: async () => ++bumps, publish: async () => { started(); await gate; } };
  const cache = new MemoryCache({ persistencePath: null, subscriberProvider: () => null,
    redisProvider: () => online ? redis : null, redisConfiguredCheck: () => true,
    redisActiveCheck: () => online });
  cache.invalidatePrefix("products:");
  online = true;
  const replay = cache._flushFailedInvalidations();
  await entered;
  online = false;
  cache.invalidatePrefix("products:");
  resume();
  await replay;
  assert.equal(cache.failedInvalidations.size, 1);
  online = true;
  await cache._flushFailedInvalidations();
  assert.equal(bumps, 2);
  assert.equal(cache.failedInvalidations.size, 0);
});

test("direct reads miss when their namespace has a pending invalidation", () => {
  const cache = new MemoryCache({ persistencePath: null, subscriberProvider: () => null,
    redisProvider: () => null, redisConfiguredCheck: () => true, redisActiveCheck: () => false });
  cache.set("catalog:product:51", { stock: 5 });
  cache.delete("catalog:product:50");
  assert.equal(cache.get("catalog:product:51"), null);
});

test("unwritable or corrupt spool fences shared cache on restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cache-recovery-"));
  const blocker = join(dir, "file");
  writeFileSync(blocker, "not a directory");
  for (const path of [join(blocker, "queue.json"), join(dir, "corrupt.json")]) {
    if (path.endsWith("corrupt.json")) writeFileSync(path, "broken json");
    const redis = { get: async () => JSON.stringify({ stock: 5 }), pttl: async () => 30000,
      incr: async () => { throw new Error("offline"); } };
    const cache = new MemoryCache({ persistencePath: path, fenceOnStart: true,
      subscriberProvider: () => null, redisProvider: () => redis,
      redisConfiguredCheck: () => true, redisActiveCheck: () => true,
      generationReader: async () => ["1", "1"] });
    assert.deepEqual(await cache.getOrFetch("catalog:product:1", async () => ({ stock: 0 })), { stock: 0 });
  }
});
