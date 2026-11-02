import test from "node:test";
import assert from "node:assert/strict";
import api from "../src/config/woocommerce.js";
import { serverCache } from "../src/utils/memoryCache.js";
import { closeRedis } from "../src/config/redis.js";
import {
  reorderCategories,
  invalidateAllCategoryCaches,
  _setRedisClientForTesting,
} from "../src/controllers/adminCategoryController.js";

test.after(async () => {
  await closeRedis();
});

const createMockRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
  };
  return res;
};

const createTestMockRedis = () => {
  let storedOwner = null;
  return {
    set: async (key, owner) => {
      storedOwner = owner;
      return "OK";
    },
    get: async () => storedOwner,
    eval: async () => 1,
    del: async () => 1,
    incr: async () => 1,
    publish: async () => 1,
    stealLock: () => {
      storedOwner = "stolen_by_another_process";
    },
  };
};

test("1. Cache Invalidation: invalidateAllCategoryCaches purges resilience fallback, catalog, and admin caches", async () => {
  serverCache.set("catalog:home_shelves:default", [{ id: 19, name: "Electronics" }]);
  serverCache.set("category:19:details", { id: 19, name: "Electronics" });
  serverCache.set("admin_products:cat_19", [{ id: 101, name: "Headphones" }]);
  serverCache.set("admin:categories", [{ id: 19, name: "Electronics" }]);
  serverCache.set("admin:categories:hierarchy", [{ id: 19, children: [] }]);
  serverCache.set("resilience:catalog_categories:last_known", [{ id: 19, name: "Stale Fallback" }]);
  serverCache.set("seo:sitemap_xml", "<xml>sitemap</xml>");

  assert.ok(serverCache.get("resilience:catalog_categories:last_known"));
  assert.ok(serverCache.get("catalog:home_shelves:default"));

  await invalidateAllCategoryCaches();

  assert.equal(serverCache.get("catalog:home_shelves:default"), null);
  assert.equal(serverCache.get("category:19:details"), null);
  assert.equal(serverCache.get("admin_products:cat_19"), null);
  assert.equal(serverCache.get("admin:categories"), null);
  assert.equal(serverCache.get("admin:categories:hierarchy"), null);
  assert.equal(serverCache.get("resilience:catalog_categories:last_known"), null);
  assert.equal(serverCache.get("seo:sitemap_xml"), null);
});

test("2. Redis Outage Fail-Closed: returns HTTP 503 REORDER_LOCK_UNAVAILABLE during Redis outage", async () => {
  _setRedisClientForTesting(null);

  try {
    const req = {
      body: {
        category_ids: [19, 18, 17],
      },
    };
    const res = createMockRes();

    await reorderCategories(req, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body?.code, "REORDER_LOCK_UNAVAILABLE");
    assert.equal(res.body?.success, false);
  } finally {
    _setRedisClientForTesting(undefined);
  }
});

test("3. Concurrency Throttle: fallback updates category positions with concurrency <= 5", async () => {
  const originalGet = api.get;
  const originalPost = api.post;
  const originalPut = api.put;

  _setRedisClientForTesting(createTestMockRedis());

  const testCategoryIds = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]; // 12 categories
  let activeConcurrency = 0;
  let maxObservedConcurrency = 0;
  const updatedPutIds = [];

  api.get = async (path, params) => {
    if (path === "products/categories") {
      return {
        data: testCategoryIds.map((id, idx) => ({
          id,
          name: `Category ${id}`,
          slug: `category-${id}`,
          parent: 0,
          menu_order: idx + 1,
        })),
      };
    }
    return originalGet.call(api, path, params);
  };

  // Simulate batch API failure to force fallback path
  api.post = async (path, payload) => {
    if (path === "products/categories/batch") {
      throw new Error("WooCommerce batch update simulated failure");
    }
    return originalPost.call(api, path, payload);
  };

  api.put = async (path, payload) => {
    if (path.startsWith("products/categories/")) {
      const match = path.match(/products\/categories\/(\d+)/);
      const catId = match ? Number(match[1]) : 0;
      activeConcurrency++;
      if (activeConcurrency > maxObservedConcurrency) {
        maxObservedConcurrency = activeConcurrency;
      }

      // Small async delay to observe parallel concurrency
      await new Promise((r) => setTimeout(r, 20));

      activeConcurrency--;
      updatedPutIds.push(catId);
      return {
        data: {
          id: catId,
          menu_order: payload.menu_order,
        },
      };
    }
    return originalPut.call(api, path, payload);
  };

  try {
    const req = {
      body: {
        category_ids: testCategoryIds,
      },
    };
    const res = createMockRes();

    await reorderCategories(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(updatedPutIds.length, 12);
    assert.ok(
      maxObservedConcurrency <= 5,
      `Expected max concurrency <= 5, got ${maxObservedConcurrency}`
    );
    assert.ok(
      maxObservedConcurrency >= 2,
      `Expected chunking with parallel requests, observed ${maxObservedConcurrency}`
    );
  } finally {
    _setRedisClientForTesting(undefined);
    api.get = originalGet;
    api.post = originalPost;
    api.put = originalPut;
  }
});

test("4. Distributed Lock: acquires 30s lock and releases with owner-verified Lua script on finish", async () => {
  const originalGet = api.get;
  const originalPost = api.post;

  const testCategoryIds = [19, 18];
  let lockAcquired = false;
  let lockReleased = false;
  let recordedLockOwner = null;
  const evalCalls = [];

  const mockRedis = {
    set: async (key, owner, mode, ttl, flag) => {
      if (key === "lock:category:reorder" && flag === "NX") {
        lockAcquired = true;
        recordedLockOwner = owner;
        assert.equal(ttl, 30000);
        return "OK";
      }
      return null;
    },
    get: async (key) => {
      if (key === "lock:category:reorder") return recordedLockOwner;
      return null;
    },
    incr: async () => 1,
    publish: async () => 1,
    del: async () => 1,
    eval: async (script, numKeys, key, owner, ...args) => {
      evalCalls.push({ script, key, owner, args });
      if (script.includes("return redis.call('del', KEYS[1])")) {
        if (owner === recordedLockOwner) {
          lockReleased = true;
          return 1;
        }
      }
      if (script.includes("return redis.call('pexpire', KEYS[1], tonumber(ARGV[2]))")) {
        if (owner === recordedLockOwner) return 1;
      }
      return 0;
    },
  };

  _setRedisClientForTesting(mockRedis);

  api.get = async (path) => {
    if (path === "products/categories") {
      return {
        data: testCategoryIds.map((id, idx) => ({
          id,
          name: `Category ${id}`,
          slug: `category-${id}`,
          parent: 0,
          menu_order: idx + 1,
        })),
      };
    }
    return originalGet.call(api, path);
  };

  api.post = async (path, payload) => {
    if (path === "products/categories/batch") {
      return {
        data: {
          update: payload.update.map((item) => ({ id: item.id })),
        },
      };
    }
    return originalPost.call(api, path, payload);
  };

  try {
    const req = {
      body: {
        category_ids: testCategoryIds,
      },
    };
    const res = createMockRes();

    await reorderCategories(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.ok(lockAcquired, "Redis distributed lock must be acquired");
    assert.ok(lockReleased, "Redis distributed lock must be released with owner verification");
    assert.ok(recordedLockOwner, "Lock owner token must be generated");
  } finally {
    _setRedisClientForTesting(undefined);
    api.get = originalGet;
    api.post = originalPost;
  }
});

test("5. Lock Contention: returns HTTP 409 REORDER_IN_PROGRESS when lock is held by another worker", async () => {
  const mockRedis = {
    set: async () => null, // Lock acquisition denied (another process has NX)
    eval: async () => 0,
    get: async () => "other_owner",
  };

  _setRedisClientForTesting(mockRedis);

  try {
    const req = {
      body: {
        category_ids: [19, 18],
      },
    };
    const res = createMockRes();

    await reorderCategories(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.code, "REORDER_IN_PROGRESS");
    assert.equal(res.body?.success, false);
  } finally {
    _setRedisClientForTesting(undefined);
  }
});

test("6. Union of Explicit Failures + Omitted IDs + Malformed IDs in Batch", async () => {
  const originalGet = api.get;
  const originalPost = api.post;
  const originalPut = api.put;

  const testCategoryIds = [101, 102, 103, 104];
  const putCalls = [];

  _setRedisClientForTesting(createTestMockRedis());

  api.get = async (path) => {
    if (path === "products/categories") {
      return {
        data: testCategoryIds.map((id, idx) => ({
          id,
          name: `Category ${id}`,
          slug: `cat-${id}`,
          parent: 0,
          menu_order: idx + 1,
        })),
      };
    }
    return originalGet.call(api, path);
  };

  // Batch returns:
  // - 101: success
  // - 102: explicit failure
  // - 103: omitted completely from update response
  // - malformed object without id or with null id
  // - 104: success
  api.post = async (path) => {
    if (path === "products/categories/batch") {
      return {
        data: {
          update: [
            { id: 101, menu_order: 1 },
            { id: 102, error: { message: "Internal update failure" } },
            { id: null, error: { message: "Unknown DB crash" } },
            { id: 104, menu_order: 4 },
          ],
        },
      };
    }
    return originalPost.call(api, path);
  };

  api.put = async (path, payload) => {
    if (path.startsWith("products/categories/")) {
      const match = path.match(/products\/categories\/(\d+)/);
      const catId = match ? Number(match[1]) : 0;
      putCalls.push({ path, catId, payload });
      return {
        data: { id: catId, menu_order: payload.menu_order },
      };
    }
    return originalPut.call(api, path, payload);
  };

  try {
    const req = {
      body: {
        category_ids: testCategoryIds,
      },
    };
    const res = createMockRes();

    await reorderCategories(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    // Must retry BOTH 102 (explicit failure) AND 103 (omitted ID)
    const retriedIds = putCalls.map((c) => c.catId);
    assert.deepEqual(retriedIds.sort(), [102, 103]);
    // Must NEVER call /products/categories/unknown or /products/categories/null
    for (const call of putCalls) {
      assert.ok(!call.path.includes("unknown"), "Must not call /unknown");
      assert.ok(!call.path.includes("null"), "Must not call /null");
      assert.ok(Number.isInteger(call.catId) && call.catId > 0, "All retried IDs must be positive integers");
    }
  } finally {
    _setRedisClientForTesting(undefined);
    api.get = originalGet;
    api.post = originalPost;
    api.put = originalPut;
  }
});

test("7. Lock Loss Detection: halts writes and aborts with 409 if lock is seized by another process", async () => {
  const originalGet = api.get;
  const originalPost = api.post;

  const testCategoryIds = [19, 18];
  let putExecuted = false;

  const mockRedis = {
    set: async () => "OK",
    // When checking lock ownership or renewing, return someone else's owner token!
    get: async () => "stolen_by_another_worker",
    eval: async () => 0,
  };
  _setRedisClientForTesting(mockRedis);

  api.get = async (path) => {
    if (path === "products/categories") {
      return {
        data: testCategoryIds.map((id, idx) => ({
          id,
          name: `Category ${id}`,
          slug: `cat-${id}`,
          parent: 0,
          menu_order: idx + 1,
        })),
      };
    }
    return originalGet.call(api, path);
  };

  api.post = async (path) => {
    if (path === "products/categories/batch") {
      putExecuted = true;
      return { data: { update: [] } };
    }
    return originalPost.call(api, path);
  };

  try {
    const req = {
      body: {
        category_ids: testCategoryIds,
      },
    };
    const res = createMockRes();

    await reorderCategories(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.code, "LOCK_LOST");
    assert.equal(putExecuted, false, "Must abort before batch writes when lock is lost");
  } finally {
    _setRedisClientForTesting(undefined);
    api.get = originalGet;
    api.post = originalPost;
  }
});

test("8. Authoritative Verification: fails with HTTP 500 if WooCommerce menu_order does not match expected", async () => {
  const originalGet = api.get;
  const originalPost = api.post;

  const testCategoryIds = [19, 18];

  _setRedisClientForTesting(createTestMockRedis());

  let getCallCount = 0;
  api.get = async (path) => {
    if (path === "products/categories") {
      getCallCount++;
      if (getCallCount === 1) {
        // Initial metadata check: valid categories
        return {
          data: testCategoryIds.map((id) => ({
            id,
            name: `Category ${id}`,
            slug: `cat-${id}`,
            parent: 0,
          })),
        };
      }
      // Final authoritative verification: category 18 failed to persist menu_order 2
      return {
        data: [
          { id: 19, menu_order: 1 },
          { id: 18, menu_order: 99 }, // Mismatched menu_order!
        ],
      };
    }
    return originalGet.call(api, path);
  };

  api.post = async (path, payload) => {
    if (path === "products/categories/batch") {
      return {
        data: {
          update: payload.update.map((item) => ({ id: item.id })),
        },
      };
    }
    return originalPost.call(api, path, payload);
  };

  try {
    const req = {
      body: {
        category_ids: testCategoryIds,
      },
    };
    const res = createMockRes();

    await reorderCategories(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body?.code, "REORDER_VERIFICATION_FAILED");
    assert.equal(res.body?.mismatches?.length, 1);
    assert.equal(res.body?.mismatches[0].id, 18);
    assert.equal(res.body?.mismatches[0].expected, 2);
    assert.equal(res.body?.mismatches[0].actual, 99);
  } finally {
    _setRedisClientForTesting(undefined);
    api.get = originalGet;
    api.post = originalPost;
  }
});

test("9. Distributed Cache Invalidation: flushPendingInvalidations rejects if earlier invalidation in batch fails", async () => {
  const incrCalls = [];
  const mockBatchRedis = {
    incr: async (key) => {
      incrCalls.push(key);
      if (key.includes("catalog")) {
        // First invalidation fails!
        throw new Error("Redis cluster node timeout incrementing catalog epoch");
      }
      // Subsequent invalidations (category, seo, etc.) succeed!
      return 1;
    },
    publish: async () => 1,
  };

  _setRedisClientForTesting(mockBatchRedis);

  try {
    // Perform multiple sequential invalidations as done in invalidateAllCategoryCaches
    serverCache.invalidatePrefix("catalog:");
    serverCache.invalidatePrefix("category:");
    serverCache.delete("seo:sitemap_xml");

    // flushPendingInvalidations MUST reject because the catalog invalidation failed,
    // even though category and seo invalidations succeeded afterwards!
    await assert.rejects(
      async () => {
        await serverCache.flushPendingInvalidations();
      },
      (err) => {
        assert.ok(err.message.includes("Redis cluster node timeout"), "Must retain first failure in batch");
        return true;
      }
    );

    // After throwing, the error queue is drained so subsequent clean batches can succeed
    _setRedisClientForTesting({
      incr: async () => 1,
      publish: async () => 1,
    });
    serverCache.invalidatePrefix("catalog:");
    await serverCache.flushPendingInvalidations(); // Cleanly resolves!
  } finally {
    _setRedisClientForTesting(undefined);
  }
});

test("10. Heartbeat Renewal Timer: periodic renewal returning 0 marks lock lost and halts subsequent writes", async () => {
  const originalGet = api.get;
  const originalPost = api.post;

  const testCategoryIds = [19, 18];
  let putExecuted = false;
  let storedOwner = null;

  // Configure timer interval to 15ms
  const { _setRenewIntervalForTesting } = await import("../src/controllers/adminCategoryController.js");
  _setRenewIntervalForTesting(15);

  const mockRedis = {
    set: async (key, owner) => {
      storedOwner = owner;
      return "OK";
    },
    get: async () => storedOwner, // Ownership check initially passes!
    incr: async () => 1,
    publish: async () => 1,
    del: async () => 1,
    eval: async (script) => {
      if (script.includes("pexpire")) {
        // The heartbeat timer renewal fires and returns 0 (lock lost)!
        return 0;
      }
      return 1;
    },
  };
  _setRedisClientForTesting(mockRedis);

  api.get = async (path) => {
    if (path === "products/categories") {
      return {
        data: testCategoryIds.map((id, idx) => ({
          id,
          name: `Category ${id}`,
          slug: `cat-${id}`,
          parent: 0,
          menu_order: idx + 1,
        })),
      };
    }
    return originalGet.call(api, path);
  };

  // Simulate in-flight operation taking 35ms so the 15ms heartbeat timer actually fires!
  api.post = async (path, payload) => {
    if (path === "products/categories/batch") {
      await new Promise((r) => setTimeout(r, 35));
      putExecuted = true;
      return {
        data: {
          update: payload.update.map((item) => ({ id: item.id })),
        },
      };
    }
    return originalPost.call(api, path, payload);
  };

  try {
    const req = {
      body: {
        category_ids: testCategoryIds,
      },
    };
    const res = createMockRes();

    await reorderCategories(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.code, "LOCK_LOST");
  } finally {
    _setRenewIntervalForTesting(undefined);
    _setRedisClientForTesting(undefined);
    api.get = originalGet;
    api.post = originalPost;
  }
});

