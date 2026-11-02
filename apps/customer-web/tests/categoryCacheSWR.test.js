import test from "node:test";
import assert from "node:assert/strict";
import safeStorage from "../src/utils/safeStorage.js";
import {
  getCachedCategories,
  getCategories,
  getCategoriesSWR,
  _setCachedCategoriesForTesting,
  _resetCategoryCacheForTesting,
  _setCatalogClientForTesting,
} from "../src/services/productService.js";

const STORAGE_KEY = "catalog_categories_v1";

test("Category SWR Lifecycle & Cache Freshness", async (t) => {
  t.beforeEach(() => {
    safeStorage.removeItem(STORAGE_KEY);
    _setCachedCategoriesForTesting(null);
    _setCatalogClientForTesting(null);
  });

  t.afterEach(() => {
    safeStorage.removeItem(STORAGE_KEY);
    _setCachedCategoriesForTesting(null);
    _setCatalogClientForTesting(null);
  });

  await t.test("1. Cached categories appear immediately", () => {
    const cachedTree = [
      { id: 19, name: "Electronics", menu_order: 1 },
      { id: 18, name: "Stationery", menu_order: 2 },
    ];
    safeStorage.setJSON(STORAGE_KEY, {
      version: 1,
      cachedAt: Date.now(),
      categories: cachedTree,
    });
    _resetCategoryCacheForTesting();

    // Instant synchronous hydration: UI doesn't need to wait for network
    const initial = getCachedCategories();
    assert.deepEqual(initial, cachedTree);
  });

  await t.test("2. Fresh network categories replace cached ordering", async () => {
    const oldOrder = [
      { id: 19, name: "Electronics", menu_order: 1 },
      { id: 18, name: "Stationery", menu_order: 2 },
    ];
    const newNetworkOrder = [
      { id: 18, name: "Stationery", menu_order: 1 }, // Reordered!
      { id: 19, name: "Electronics", menu_order: 2 },
      { id: 17, name: "Toys", menu_order: 3 },
    ];

    safeStorage.setJSON(STORAGE_KEY, {
      version: 1,
      cachedAt: Date.now(),
      categories: oldOrder,
    });
    _resetCategoryCacheForTesting();

    assert.deepEqual(getCachedCategories(), oldOrder);

    // Mock catalogClient to return fresh network data without contacting external services
    _setCatalogClientForTesting({
      get: async (url) => {
        if (url === "/products/categories") {
          return { data: newNetworkOrder, status: 200 };
        }
        throw new Error(`Unexpected mock URL: ${url}`);
      },
    });

    const freshResult = await getCategories();
    assert.deepEqual(freshResult, newNetworkOrder);

    // In-memory cache must be updated
    assert.deepEqual(getCachedCategories(), newNetworkOrder);

    // Storage must be updated with the fresh tree
    const persisted = safeStorage.getJSON(STORAGE_KEY);
    assert.deepEqual(persisted.categories, newNetworkOrder);
  });

  await t.test("3. Network failure retains the cached tree", async () => {
    const existingCache = [
      { id: 19, name: "Electronics", menu_order: 1 },
      { id: 18, name: "Stationery", menu_order: 2 },
    ];

    safeStorage.setJSON(STORAGE_KEY, {
      version: 1,
      cachedAt: Date.now(),
      categories: existingCache,
    });
    _resetCategoryCacheForTesting();

    _setCatalogClientForTesting({
      get: async (url) => {
        if (url === "/products/categories") {
          throw new Error("Network timeout contacting catalog backend");
        }
        throw new Error(`Unexpected mock URL: ${url}`);
      },
    });

    await assert.rejects(() => getCategories(), /Network timeout/);

    // Graceful degradation: in-memory and persisted storage retain valid cached tree
    assert.deepEqual(getCachedCategories(), existingCache);
    const persisted = safeStorage.getJSON(STORAGE_KEY);
    assert.deepEqual(persisted.categories, existingCache);
  });

  await t.test("4. Full browser/module reload hydrates from persisted storage and still revalidates", async () => {
    const persistedState = [
      { id: 28, name: "Artist", menu_order: 1 },
      { id: 17, name: "Toys", menu_order: 2 },
    ];
    safeStorage.setJSON(STORAGE_KEY, {
      version: 1,
      cachedAt: Date.now() - 60000, // 1 min ago
      categories: persistedState,
    });

    // Simulate page reload
    _resetCategoryCacheForTesting();

    // 1. Immediately available on mount
    assert.deepEqual(getCachedCategories(), persistedState);

    // 2. Background revalidation fires and updates to latest
    const revalidatedState = [
      { id: 19, name: "Electronics", menu_order: 1 },
      { id: 28, name: "Artist", menu_order: 2 },
      { id: 17, name: "Toys", menu_order: 3 },
    ];

    _setCatalogClientForTesting({
      get: async (url) => {
        if (url === "/products/categories") {
          return { data: revalidatedState, status: 200 };
        }
        throw new Error(`Unexpected mock URL: ${url}`);
      },
    });

    const networkResult = await getCategories();
    assert.deepEqual(networkResult, revalidatedState);
    assert.deepEqual(getCachedCategories(), revalidatedState);
    const afterRevalidation = safeStorage.getJSON(STORAGE_KEY);
    assert.deepEqual(afterRevalidation.categories, revalidatedState);
  });

  await t.test("5. getCategoriesSWR returns cached data synchronously and triggers background callback", async () => {
    const cachedState = [{ id: 19, name: "Electronics", menu_order: 1 }];
    const networkState = [
      { id: 19, name: "Electronics", menu_order: 1 },
      { id: 18, name: "Stationery", menu_order: 2 },
    ];

    safeStorage.setJSON(STORAGE_KEY, {
      version: 1,
      cachedAt: Date.now(),
      categories: cachedState,
    });
    _resetCategoryCacheForTesting();

    _setCatalogClientForTesting({
      get: async (url) => {
        if (url === "/products/categories") {
          return { data: networkState, status: 200 };
        }
        throw new Error(`Unexpected mock URL: ${url}`);
      },
    });

    let callbackFiredWith = null;
    let resolveCallback;
    const callbackPromise = new Promise((resolve) => {
      resolveCallback = resolve;
    });

    // Synchronous immediate return
    const syncResult = getCategoriesSWR((fresh) => {
      callbackFiredWith = fresh;
      resolveCallback();
    });

    assert.deepEqual(syncResult, cachedState);

    // Await background revalidation completion
    await callbackPromise;
    assert.deepEqual(callbackFiredWith, networkState);
    assert.deepEqual(getCachedCategories(), networkState);
  });

  await t.test("6. getCategories({ bypassDedup: true }) executes a fresh request bypassing in-flight deduplication", async () => {
    let callCount = 0;
    const version1 = [{ id: 1, name: "V1" }];
    const version2 = [{ id: 2, name: "V2" }];

    _setCatalogClientForTesting({
      get: async () => {
        callCount++;
        return { data: callCount === 1 ? version1 : version2, status: 200 };
      },
    });

    // First request
    const p1 = getCategories();
    // Concurrent second request with bypassDedup: true must not deduplicate
    const p2 = getCategories({ bypassDedup: true });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(callCount, 2);
    assert.deepEqual(r1, version1);
    assert.deepEqual(r2, version2);
  });

  await t.test("7. Out-of-order responses do not overwrite newer committed category data", async () => {
    const versionA = [{ id: 1, name: "Older Request A" }];
    const versionB = [{ id: 2, name: "Newer Request B" }];

    let resolveRequestA;
    const promiseA = new Promise((resolve) => {
      resolveRequestA = resolve;
    });

    let resolveRequestB;
    const promiseB = new Promise((resolve) => {
      resolveRequestB = resolve;
    });

    _setCatalogClientForTesting({
      get: async (url, options) => {
        // First request created (Request A)
        if (!options?.isRequestB) {
          return promiseA;
        }
        // Second request created (Request B)
        return promiseB;
      },
    });

    // 1. Request A starts first
    const reqA = getCategories();

    // 2. Request B starts second with bypassDedup: true
    const reqB = getCategories({ bypassDedup: true, isRequestB: true });

    // 3. Request B resolves FIRST
    resolveRequestB({ data: versionB, status: 200 });
    const resultB = await reqB;
    assert.deepEqual(resultB, versionB);

    // Verify cache has version B
    assert.deepEqual(getCachedCategories(), versionB);
    assert.deepEqual(safeStorage.getJSON(STORAGE_KEY).categories, versionB);

    // 4. Request A resolves LATER with older data
    resolveRequestA({ data: versionA, status: 200 });
    const resultA = await reqA;
    assert.deepEqual(resultA, versionA);

    // Crucial: Cached categories and storage must NOT be overwritten by older Request A!
    assert.deepEqual(
      getCachedCategories(),
      versionB,
      "Newer response B must remain in memory cache when older request A finishes late"
    );
    assert.deepEqual(
      safeStorage.getJSON(STORAGE_KEY).categories,
      versionB,
      "Newer response B must remain in safeStorage when older request A finishes late"
    );
  });
});
