import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  transformMediaUrl,
  transformSrcset,
  transformMediaUrls,
} from "../src/utils/mediaUrl.js";
import mediaRoutes from "../src/routes/mediaRoutes.js";
import { MemoryCache, serverCache } from "../src/utils/memoryCache.js";
import {
  closeRedis,
  _setRedisClientForTesting,
  _setRedisConfiguredForTesting,
} from "../src/config/redis.js";
import {
  refreshCategoryCache,
  _setFetchCategoriesForTesting,
  _getCategoriesWithStaleFallbackForTesting,
} from "../src/controllers/productController.js";

test.after(async () => {
  _setRedisConfiguredForTesting(null);
  _setRedisClientForTesting(undefined);
  _setFetchCategoriesForTesting(null);
  await closeRedis();
});

// ============================================================================
// 1. MEDIA URL TRANSFORMATION TESTS
// ============================================================================

test("1. Media URL: transformMediaUrl rewrites WordPress uploads to /api/media/uploads/ and preserves query strings", () => {
  const wpUrl = "https://mumbai-collection.local/wp-content/uploads/2026/04/earphone.webp?v=123";
  assert.equal(
    transformMediaUrl(wpUrl),
    "/api/media/uploads/2026/04/earphone.webp?v=123"
  );

  const httpWpUrl = "http://mumbaicollection.local/wp-content/uploads/products/watch-300x300.jpg";
  assert.equal(
    transformMediaUrl(httpWpUrl),
    "/api/media/uploads/products/watch-300x300.jpg"
  );

  const relativeWpUrl = "/wp-content/uploads/2026/04/cable.png";
  assert.equal(
    transformMediaUrl(relativeWpUrl),
    "/api/media/uploads/2026/04/cable.png"
  );
});

test("2. Media URL: transformMediaUrl preserves non-WordPress CDNs, placeholders, and data/blob URIs (even if path contains /wp-content/uploads/)", () => {
  // External CDN with regular path
  assert.equal(
    transformMediaUrl("https://images.unsplash.com/photo-12345?auto=format"),
    "https://images.unsplash.com/photo-12345?auto=format"
  );
  assert.equal(
    transformMediaUrl("https://cdn.example.com/assets/logo.png"),
    "https://cdn.example.com/assets/logo.png"
  );

  // Crucial: External WordPress-style CDN URLs must NOT be hijacked into local media proxy
  const externalWpCdn = "https://cdn.example.com/wp-content/uploads/2026/04/product.webp";
  assert.equal(transformMediaUrl(externalWpCdn), externalWpCdn);

  const thirdPartyWp = "https://images.thirdparty.org/assets/wp-content/uploads/hero.jpg?v=9";
  assert.equal(transformMediaUrl(thirdPartyWp), thirdPartyWp);

  assert.equal(
    transformMediaUrl("/product-placeholder.svg"),
    "/product-placeholder.svg"
  );
  assert.equal(
    transformMediaUrl("data:image/svg+xml;base64,PHN2ZyB..."),
    "data:image/svg+xml;base64,PHN2ZyB..."
  );
  assert.equal(
    transformMediaUrl("blob:http://localhost:5173/abc-123"),
    "blob:http://localhost:5173/abc-123"
  );
  assert.equal(transformMediaUrl(null), null);
  assert.equal(transformMediaUrl(undefined), undefined);
  assert.equal(transformMediaUrl(""), "");
});

test("3. Media URL: transformSrcset rewrites multi-candidate URLs while preserving width and density descriptors and data-URIs with commas", () => {
  const srcset =
    "https://mumbai-collection.local/wp-content/uploads/2026/04/shoe-300x300.jpg 300w, " +
    "https://mumbai-collection.local/wp-content/uploads/2026/04/shoe-768x768.jpg 768w, " +
    "https://mumbai-collection.local/wp-content/uploads/2026/04/shoe.jpg 1024w";

  const transformed = transformSrcset(srcset);
  assert.equal(
    transformed,
    "/api/media/uploads/2026/04/shoe-300x300.jpg 300w, " +
      "/api/media/uploads/2026/04/shoe-768x768.jpg 768w, " +
      "/api/media/uploads/2026/04/shoe.jpg 1024w"
  );

  const densitySrcset =
    "http://mumbaicollection.local/wp-content/uploads/icon.png 1x, " +
    "http://mumbaicollection.local/wp-content/uploads/icon@2x.png 2x";
  assert.equal(
    transformSrcset(densitySrcset),
    "/api/media/uploads/icon.png 1x, /api/media/uploads/icon@2x.png 2x"
  );

  // Data-URI candidate containing internal comma must NOT be fragmented
  const dataUriSrcset =
    "data:image/png;base64,iVBORw0KGgo= 1x, https://mumbai-collection.local/wp-content/uploads/hero.jpg 2x";
  const transformedDataUri = transformSrcset(dataUriSrcset);
  assert.equal(
    transformedDataUri,
    "data:image/png;base64,iVBORw0KGgo= 1x, /api/media/uploads/hero.jpg 2x"
  );
});

test("4. Media URL: transformMediaUrls deep-walks objects and ensures thumbnail, src, and srcset are all rewritten", () => {
  const productPayload = {
    id: 101,
    name: "Wireless Earbuds",
    images: [
      {
        id: 501,
        src: "https://mumbai-collection.local/wp-content/uploads/2026/04/earbuds.jpg",
        thumbnail: "https://mumbai-collection.local/wp-content/uploads/2026/04/earbuds-300x300.jpg?v=1",
        srcset:
          "https://mumbai-collection.local/wp-content/uploads/2026/04/earbuds-300x300.jpg 300w, https://mumbai-collection.local/wp-content/uploads/2026/04/earbuds.jpg 600w",
      },
    ],
    categories: [
      {
        id: 19,
        name: "Electronics",
        image: {
          src: "https://mumbai-collection.local/wp-content/uploads/2026/04/cat-electronics.jpg",
        },
      },
    ],
  };

  const rewritten = transformMediaUrls(productPayload);

  // Crucial: ProductCard.jsx consumes image.thumbnail || image.src
  assert.equal(
    rewritten.images[0].thumbnail,
    "/api/media/uploads/2026/04/earbuds-300x300.jpg?v=1"
  );
  assert.equal(
    rewritten.images[0].src,
    "/api/media/uploads/2026/04/earbuds.jpg"
  );
  assert.equal(
    rewritten.images[0].srcset,
    "/api/media/uploads/2026/04/earbuds-300x300.jpg 300w, /api/media/uploads/2026/04/earbuds.jpg 600w"
  );
  assert.equal(
    rewritten.categories[0].image.src,
    "/api/media/uploads/2026/04/cat-electronics.jpg"
  );
});

// ============================================================================
// 2. MEDIA ROUTE SECURITY & VALIDATION TESTS
// ============================================================================

test("5. Media Proxy: Rejects single and double-encoded traversal, null bytes, CRLF, and unapproved extensions", async () => {
  const app = express();
  app.use("/api/media", mediaRoutes);

  const server = app.listen(0);
  const port = server.address().port;

  const rawHttpGet = (requestPath) => {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: requestPath,
          method: "GET",
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            let parsed = null;
            try {
              parsed = JSON.parse(body);
            } catch (_) {
              parsed = body;
            }
            resolve({ status: res.statusCode, body: parsed });
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  };

  try {
    // 5.1 Traversal via raw HTTP path
    const res1 = await rawHttpGet("/api/media/uploads/../../secret.jpg");
    assert.equal(res1.status, 400);
    assert.equal(res1.body.message, "Invalid media path.");

    // 5.2 Traversal with single URL-encoded dots (%2e%2e)
    const res2 = await rawHttpGet("/api/media/uploads/%2e%2e/etc/passwd.png");
    assert.equal(res2.status, 400);
    assert.equal(res2.body.message, "Invalid media path.");

    // 5.3 Double-encoded traversal (%252e%252e)
    const resDouble = await rawHttpGet("/api/media/uploads/%252e%252e/secret.jpg");
    assert.equal(resDouble.status, 400);
    assert.equal(resDouble.body.message, "Invalid media path.");

    // 5.4 Null byte injection (%00)
    const res3 = await rawHttpGet("/api/media/uploads/test%00image.jpg");
    assert.equal(res3.status, 400);
    assert.equal(res3.body.message, "Invalid media path.");

    // 5.5 CRLF injection (%0d%0a)
    const res4 = await rawHttpGet("/api/media/uploads/test%0d%0asomething.jpg");
    assert.equal(res4.status, 400);
    assert.equal(res4.body.message, "Invalid media path.");

    // 5.6 Unsupported executable / script extensions
    const res5 = await rawHttpGet("/api/media/uploads/script.php");
    assert.equal(res5.status, 403);
    assert.equal(res5.body.message, "Unsupported file type.");

    const res6 = await rawHttpGet("/api/media/uploads/exploit.exe");
    assert.equal(res6.status, 403);
    assert.equal(res6.body.message, "Unsupported file type.");

    // 5.7 Missing path
    const res7 = await rawHttpGet("/api/media/uploads/");
    assert.equal(res7.status, 400);
    assert.equal(res7.body.message, "Media path is required.");
  } finally {
    server.close();
  }
});

// ============================================================================
// 3. MEMORY CACHE & DISTRIBUTED INVALIDATION DEGRADATION TESTS
// ============================================================================

test("6. MemoryCache: Invalidation succeeds cleanly when Redis is not configured (single-process dev)", async () => {
  _setRedisConfiguredForTesting(false);
  _setRedisClientForTesting(null);

  const cache = new MemoryCache({ defaultTtlMs: 5000 });
  cache.set("catalog:item1", { id: 1 });
  assert.equal(cache.get("catalog:item1")?.id, 1);

  cache.invalidatePrefix("catalog:");
  assert.equal(cache.get("catalog:item1"), null);

  const status = await cache.flushPendingInvalidations();
  assert.deepEqual(status, {
    localInvalidated: true,
    distributedInvalidated: false,
    degraded: false,
  });
});

test("7. MemoryCache: Invalidation reports degraded when Redis is configured but unavailable", async () => {
  _setRedisConfiguredForTesting(true);
  _setRedisClientForTesting(null); // Redis client not active

  const cache = new MemoryCache({ defaultTtlMs: 5000 });
  cache.set("category:19", { id: 19 });

  cache.delete("category:19");
  assert.equal(cache.get("category:19"), null);

  await assert.rejects(
    async () => {
      await cache.flushPendingInvalidations();
    },
    (err) => {
      assert.equal(err.degraded, true);
      assert.equal(err.localInvalidated, true);
      assert.equal(err.distributedInvalidated, false);
      assert.match(err.message, /Distributed cache invalidation failed/);
      return true;
    }
  );
});

test("8. MemoryCache: Earlier invalidation failure is NOT masked by later successful invalidation", async () => {
  let callCount = 0;
  const mockRedis = {
    incr: async (key) => {
      callCount++;
      // Fail on first operation, succeed on subsequent operations
      if (callCount === 1) {
        throw new Error("Redis cluster failover in progress");
      }
      return callCount;
    },
    publish: async () => 1,
  };

  _setRedisConfiguredForTesting(true);
  _setRedisClientForTesting(mockRedis);

  const cache = new MemoryCache({ defaultTtlMs: 5000 });
  cache.set("catalog:1", "data 1");
  cache.set("category:1", "data 2");

  // Invalidate two separate prefixes
  cache.invalidatePrefix("catalog:");  // Will fail Redis incr
  cache.invalidatePrefix("category:"); // Will succeed Redis incr

  // Both local caches were cleared
  assert.equal(cache.get("catalog:1"), null);
  assert.equal(cache.get("category:1"), null);

  // flushPendingInvalidations must detect the earlier failure and throw degraded error
  await assert.rejects(
    async () => {
      await cache.flushPendingInvalidations();
    },
    (err) => {
      assert.equal(err.degraded, true);
      assert.equal(err.localInvalidated, true);
      assert.equal(err.distributedInvalidated, false);
      assert.match(err.message, /Redis cluster failover in progress/);
      return true;
    }
  );
});

test("9. MemoryCache: Concurrent invalidation batches do not cross-contaminate errors", async () => {
  // Batch A targets failing operations, Batch B targets healthy operations
  let callCount = 0;
  const mockRedis = {
    incr: async (key) => {
      callCount++;
      // Fail on Batch A key, succeed on Batch B key
      if (key.includes("fail_ns")) {
        throw new Error("Batch A Redis timeout");
      }
      return 1;
    },
    publish: async () => 1,
  };

  _setRedisConfiguredForTesting(true);
  _setRedisClientForTesting(mockRedis);

  const cache = new MemoryCache({ defaultTtlMs: 5000 });

  const batchA = cache.createInvalidationBatch();
  const batchB = cache.createInvalidationBatch();

  batchA.invalidatePrefix("fail_ns:");
  batchB.invalidatePrefix("success_ns:");

  // Run flushes concurrently
  const [resA, resB] = await Promise.allSettled([
    batchA.flush(),
    batchB.flush(),
  ]);

  // Batch A must reject with degraded error
  assert.equal(resA.status, "rejected");
  assert.equal(resA.reason.degraded, true);
  assert.match(resA.reason.message, /Batch A Redis timeout/);

  // Batch B must resolve cleanly with healthy synchronization (no error stealing!)
  assert.equal(resB.status, "fulfilled");
  assert.deepEqual(resB.value, {
    localInvalidated: true,
    distributedInvalidated: true,
    degraded: false,
  });
});

// ============================================================================
// 4. CATEGORY REVISION FENCING & PRODUCTION CONTROLLER RACE AUDIT
// ============================================================================

test("10. Category Revision Fencing: Production refreshCategoryCache halts seeding stale last-known cache when invalidated mid-flight", async () => {
  const CATEGORY_LAST_KNOWN_KEY = "resilience:catalog_categories:last_known";
  const CATEGORY_CACHE_KEY = "catalog:categories:all";

  // Reset cache state
  serverCache.store.delete(CATEGORY_LAST_KNOWN_KEY);
  serverCache.store.delete(CATEGORY_CACHE_KEY);

  let delayedResolve;
  const slowFetchPromise = new Promise((resolve) => {
    delayedResolve = resolve;
  });

  // Inject delayed category fetcher into production controller
  _setFetchCategoriesForTesting(() => slowFetchPromise);

  try {
    // Initiate real production background category refresh
    const refreshPromise = refreshCategoryCache();

    // While slow fetch is running, an employee updates/reorders categories, causing invalidation:
    serverCache.invalidatePrefix("category:");

    // Now slow fetch completes with stale category data:
    delayedResolve([{ id: 18, name: "Old Stationery", menu_order: 10 }]);
    await refreshPromise;

    // Production check: stale data must NOT have repopulated last-known fallback cache
    assert.equal(
      serverCache.get(CATEGORY_LAST_KNOWN_KEY),
      null,
      "Stale categories must not populate last-known fallback after mid-flight invalidation"
    );
  } finally {
    _setFetchCategoriesForTesting(null);
  }
});

test("11. Generation Fencing: setFenced rejects Redis write when Redis generations advance mid-flight", async () => {
  const redisStore = new Map();
  const mockRedis = {
    mget: async (k1, k2) => [redisStore.get(k1) || "0", redisStore.get(k2) || "0"],
    get: async (k) => redisStore.get(k) || null,
    incr: async (k) => {
      const v = (parseInt(redisStore.get(k) || "0", 10) + 1).toString();
      redisStore.set(k, v);
      return parseInt(v, 10);
    },
    psetex: async (k, ttl, v) => {
      redisStore.set(k, v);
      return "OK";
    },
  };

  _setRedisConfiguredForTesting(true);
  _setRedisClientForTesting(mockRedis);

  const cache = new MemoryCache({ defaultTtlMs: 5000 });
  const fence = await cache.createFence("test:key");
  assert.equal(fence.globalGen, "0");

  // Invalidate Redis generation externally
  await mockRedis.incr("mumbai:cache:global_gen:v3");

  // Attempt fenced write with outdated fence
  const stored = await cache.setFenced("test:key", { value: 123 }, 5000, fence);
  assert.equal(stored, false, "setFenced must return false and discard write when Redis generation advanced");
});

test("12. Fallback Safety: getCategoriesWithStaleFallback does not seed last-known cache unversioned", async () => {
  const CATEGORY_LAST_KNOWN_KEY = "resilience:catalog_categories:last_known";
  const CATEGORY_CACHE_KEY = "catalog:categories:all";

  serverCache.store.delete(CATEGORY_LAST_KNOWN_KEY);
  serverCache.store.set(CATEGORY_CACHE_KEY, {
    value: [{ id: 19, name: "Electronics" }],
    expiresAt: Date.now() + 60000,
  });

  const result = await _getCategoriesWithStaleFallbackForTesting();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 19);

  // Crucial: last-known cache must NOT have been seeded unversioned from local RAM!
  assert.equal(
    serverCache.get(CATEGORY_LAST_KNOWN_KEY),
    null,
    "last-known cache must not be seeded unversioned from local memory"
  );
});
