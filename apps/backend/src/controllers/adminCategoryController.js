import api from "../config/woocommerce.js";
import { transformMediaUrls } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";
import { logError, logger } from "../utils/logger.js";
import { isSafeExternalImageUrl } from "../utils/imageValidator.js";
import { fetchAllProductCategories } from "../services/productService.js";
import { decodeHtmlEntities } from "../utils/textUtils.js";
import { markMediaAttached, deleteMediaIfUnreferenced } from "../services/wordpressMediaService.js";
import { sanitizeUpstreamError } from "../utils/upstreamError.js";
import { getRedisClient, isRedisActive, isRedisConfigured, _setRedisClientForTesting as _setRedisInConfig } from "../config/redis.js";
import { randomUUID } from "node:crypto";

let localReorderMutex = Promise.resolve();

let _testRedisClient = undefined;
export const _setRedisClientForTesting = (client) => {
  _testRedisClient = client;
  if (typeof _setRedisInConfig === "function") _setRedisInConfig(client);
};

let _testRenewIntervalMs = undefined;
export const _setRenewIntervalForTesting = (intervalMs) => {
  _testRenewIntervalMs = intervalMs;
};

const LOCK_TTL_MS = 30000;
const RENEW_INTERVAL_MS = 10000;

const LUA_RENEW_LOCK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], tonumber(ARGV[2]))
else
  return 0
end
`;

const LUA_RELEASE_LOCK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

/**
 * Shared category cache invalidator for category create, update, and reorder.
 * Clears catalog, category, admin products, hierarchy, and last-known resilience caches.
 * Awaits Redis generation bumps to guarantee immediate freshness across cluster instances.
 */
export const invalidateAllCategoryCaches = async () => {
  const batch = typeof serverCache.createInvalidationBatch === "function"
    ? serverCache.createInvalidationBatch()
    : null;

  if (batch) {
    batch.invalidatePrefix("catalog:");
    batch.invalidatePrefix("category:");
    batch.invalidatePrefix("admin_products:");
    batch.delete("admin:categories");
    batch.delete("admin:categories:hierarchy");
    batch.delete("resilience:catalog_categories:last_known");
    batch.delete("seo:sitemap_xml");
  } else {
    serverCache.invalidatePrefix("catalog:");
    serverCache.invalidatePrefix("category:");
    serverCache.invalidatePrefix("admin_products:");
    serverCache.delete("admin:categories");
    serverCache.delete("admin:categories:hierarchy");
    serverCache.delete("resilience:catalog_categories:last_known");
    serverCache.delete("seo:sitemap_xml");
  }

  try {
    if (batch) {
      const syncResult = await batch.flush();
      return syncResult;
    } else if (typeof serverCache.flushPendingInvalidations === "function") {
      const syncResult = await serverCache.flushPendingInvalidations();
      return syncResult;
    } else if (serverCache.pendingInvalidations) {
      await serverCache.pendingInvalidations;
    }
    return {
      localInvalidated: true,
      distributedInvalidated: isRedisConfigured() && isRedisActive(),
      degraded: false,
    };
  } catch (err) {
    logger.warn(
      { err: err.message },
      "[adminCategoryController] Distributed cache invalidation degraded; cluster sync fallback active"
    );
    return {
      localInvalidated: true,
      distributedInvalidated: false,
      degraded: true,
      error: err.message,
    };
  }
};

const isUncategorizedCategory = (category) =>
  String(category?.slug || "").toLowerCase() === "uncategorized" ||
  String(category?.name || "").toLowerCase() === "uncategorized";

/**
 * Check if targetParentId is a descendant of categoryId (circular hierarchy prevention)
 */
export const isDescendantCategory = (categoryId, targetParentId, allCategories) => {
  const catId = Number(categoryId);
  let currentParentId = Number(targetParentId);
  const visited = new Set();
  const parentMap = new Map();

  for (const c of allCategories) {
    if (c && c.id) {
      parentMap.set(Number(c.id), Number(c.parent) || 0);
    }
  }

  while (currentParentId > 0 && !visited.has(currentParentId)) {
    if (currentParentId === catId) {
      return true; // targetParentId is a descendant of categoryId
    }
    visited.add(currentParentId);
    currentParentId = parentMap.get(currentParentId) || 0;
  }

  return false;
};

/**
 * Walk only the proposed parent's ancestors through WooCommerce rather than
 * loading the entire category tree for a single parent-change validation.
 */
const isDescendantCategoryFromWoo = async (categoryId, targetParent, initialParent) => {
  const targetId = Number(categoryId);
  let current = initialParent;
  let currentId = Number(targetParent);
  const visited = new Set();

  for (let depth = 0; currentId > 0 && depth < 100; depth += 1) {
    if (currentId === targetId) return true;
    if (visited.has(currentId)) return true; // Fail closed on an already-corrupt cycle.
    visited.add(currentId);

    if (!current || Number(current.id) !== currentId) {
      const response = await api.get(`products/categories/${currentId}`, { _fields: "id,parent" });
      current = response.data;
    }
    if (!current?.id) return true; // Fail closed if an ancestor cannot be verified.
    currentId = Number(current.parent) || 0;
  }

  // A chain that exceeds the guard is not safe to accept as a valid hierarchy.
  return currentId > 0;
};

/**
 * Get Product Categories from WooCommerce
 */
export const getAdminCategories = async (req, res) => {
  try {
    const formattedCategories = await serverCache.getOrFetch(
      "admin:categories",
      async () => {
        const categories = await fetchAllProductCategories({
          fields: "id,name,slug,parent,count,menu_order,image",
        });
        const categoryList = Array.isArray(categories) ? categories : [];
        const categoryById = new Map(categoryList.map((c) => [Number(c.id), c]));
        const descendantCounts = new Map();

        // Calculate rolled-up descendant product counts
        for (const c of categoryList) {
          const directCount = Number(c.count) || 0;
          if (directCount <= 0) continue;
          let current = c;
          const visited = new Set();
          while (current && current.parent && Number(current.parent) > 0 && !visited.has(Number(current.parent))) {
            const pId = Number(current.parent);
            visited.add(pId);
            descendantCounts.set(pId, (descendantCounts.get(pId) || 0) + directCount);
            current = categoryById.get(pId);
          }
        }

        const sorted = [...categoryList].sort((a, b) => {
          const orderA = typeof a.menu_order === "number" && a.menu_order > 0 ? a.menu_order : 9999;
          const orderB = typeof b.menu_order === "number" && b.menu_order > 0 ? b.menu_order : 9999;
          if (orderA !== orderB) return orderA - orderB;
          return a.id - b.id;
        });

        return sorted.map((c) => {
          const directCount = Number(c.count) || 0;
          const totalCount = directCount + (descendantCounts.get(Number(c.id)) || 0);
          return {
            id: c.id,
            name: decodeHtmlEntities(c.name),
            slug: c.slug,
            parent: c.parent,
            count: directCount,
            direct_count: directCount,
            total_count: totalCount,
            menu_order: c.menu_order || 0,
            image: c.image
              ? { id: c.image.id, src: c.image.src, name: c.image.name, alt: c.image.alt }
              : null,
          };
        });
      },
      120000
    );

    res.json({
      success: true,
      categories: transformMediaUrls(formattedCategories, req),
    });
  } catch (error) {
    logError(req, error, "Get categories error");
    const safeError = sanitizeUpstreamError(error, "Failed to load categories.");
    res.status(safeError.status).json({ ...safeError.payload, categories: [] });
  }
};

/**
 * Create a new Product Category in WooCommerce
 */
export const createCategory = async (req, res) => {
  try {
    const { name, image_id, image_url, description, parent } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required.",
      });
    }
    if (name.trim().toLowerCase() === "uncategorized") {
      return res.status(400).json({
        success: false,
        message: "The name Uncategorized is reserved for the protected system category.",
      });
    }

    const hasImageId = image_id !== undefined && image_id !== null && image_id !== "";
    const hasImageUrl = image_url !== undefined && image_url !== null && image_url !== "";

    if (!hasImageId && !hasImageUrl) {
      return res.status(400).json({
        success: false,
        message: "Category image is required.",
      });
    }

    const payload = {
      name: name.trim(),
    };

    if (description && typeof description === "string" && description.trim()) {
      payload.description = description.trim();
    }

    if (parent !== undefined && parent !== null) {
      const numParent = Number(parent);
      if (!Number.isInteger(numParent) || numParent < 0) {
        return res.status(400).json({
          success: false,
          message: "Parent category ID must be a non-negative integer.",
        });
      }
      if (numParent > 0) {
        const parentResponse = await api.get(`products/categories/${numParent}`, {
          _fields: "id,name,slug,parent",
        });
        const parentCategory = parentResponse.data;
        if (!parentCategory || Number(parentCategory.id) !== numParent) {
          return res.status(400).json({
            success: false,
            message: "The selected parent category does not exist.",
          });
        }
        if (Number(parentCategory.parent) > 0) {
          return res.status(400).json({
            success: false,
            message: "Subcategories can only be placed under a top-level department.",
          });
        }
        if (isUncategorizedCategory(parentCategory)) {
          return res.status(400).json({
            success: false,
            message: "The protected Uncategorized category cannot be used as a department.",
          });
        }
      }
      payload.parent = numParent;
    }

    if (hasImageId) {
      const numId = Number(image_id);
      if (!Number.isInteger(numId) || numId <= 0) {
        return res.status(400).json({
          success: false,
          message: "A valid positive numeric image ID is required.",
        });
      }
      payload.image = { id: numId };
    } else if (hasImageUrl) {
      const isSafe = await isSafeExternalImageUrl(image_url);
      if (!isSafe) {
        return res.status(400).json({
          success: false,
          message: "Invalid or restricted category image URL. Localhost and private network addresses are blocked.",
        });
      }
      payload.image = { src: image_url };
    }

    const response = await api.post("products/categories", payload);
    const cat = response.data;

    if (payload.image?.id && cat?.id) {
      try {
        await markMediaAttached([payload.image.id], cat.id, "category");
      } catch (attachErr) {
        logger.warn({ categoryId: cat.id, err: attachErr.message }, "[adminCategoryController] Failed to mark category image attached");
      }
    }

    // Invalidate catalog and resilience cache so public categories immediately update
    const cacheSync = await invalidateAllCategoryCaches();

    res.status(201).json({
      cache_sync: cacheSync,
      success: true,
      message: `Category "${decodeHtmlEntities(cat.name)}" created successfully.`,
      category: {
        id: cat.id,
        name: decodeHtmlEntities(cat.name),
        slug: cat.slug,
        parent: typeof cat.parent === "number" ? cat.parent : (payload.parent || 0),
        count: cat.count || 0,
        image: cat.image
          ? {
              id: cat.image.id,
              src: cat.image.src,
              name: cat.image.name,
              alt: cat.image.alt,
            }
          : null,
      },
    });
  } catch (error) {
    logError(req, error, "Create category error");
    const safeError = sanitizeUpstreamError(error, "Failed to create category.");
    const rawMessage = String(error.response?.data?.message || "");
    if (
      rawMessage.toLowerCase().includes("already exists") ||
      error.response?.data?.code === "term_exists"
    ) {
      safeError.payload.message = "A category with this name already exists.";
    }
    res.status(safeError.status).json(safeError.payload);
  }
};

/**
 * Update an existing Product Category in WooCommerce
 */
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, image_id, image_url, description, parent } = req.body;

    const numericId = parseInt(id, 10);
    if (!id || isNaN(numericId) || numericId <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid positive numeric category ID is required.",
      });
    }

    const currentResponse = await api.get(`products/categories/${numericId}`, {
      _fields: "id,name,slug,parent,image",
    });
    const currentCategory = currentResponse.data;
    if (!currentCategory?.id || Number(currentCategory.id) !== numericId) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }
    if (isUncategorizedCategory(currentCategory)) {
      return res.status(400).json({
        success: false,
        message: "The protected Uncategorized category cannot be edited.",
      });
    }

    const payload = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Category name cannot be empty.",
        });
      }
      if (name.trim().toLowerCase() === "uncategorized") {
        return res.status(400).json({
          success: false,
          message: "The name Uncategorized is reserved for the protected system category.",
        });
      }
      payload.name = name.trim();
    }

    if (description !== undefined) {
      payload.description = typeof description === "string" ? description.trim() : "";
    }

    if (parent !== undefined && parent !== null) {
      const numParent = Number(parent);
      if (!Number.isInteger(numParent) || numParent < 0) {
        return res.status(400).json({
          success: false,
          message: "Parent category ID must be a non-negative integer.",
        });
      }

      if (numParent === numericId) {
        return res.status(400).json({
          success: false,
          message: "A category cannot be its own parent.",
        });
      }

      if (numParent > 0) {
        const parentResponse = await api.get(`products/categories/${numParent}`, {
          _fields: "id,name,slug,parent",
        });
        const parentCategory = parentResponse.data;
        if (!parentCategory || Number(parentCategory.id) !== numParent) {
          return res.status(400).json({
            success: false,
            message: "The selected parent category does not exist.",
          });
        }
        if (Number(parentCategory.parent) > 0) {
          return res.status(400).json({
            success: false,
            message: "Subcategories can only be placed under a top-level department.",
          });
        }
        if (isUncategorizedCategory(parentCategory)) {
          return res.status(400).json({
            success: false,
            message: "The protected Uncategorized category cannot be used as a department.",
          });
        }
        if (await isDescendantCategoryFromWoo(numericId, numParent, parentCategory)) {
          return res.status(400).json({
            success: false,
            message: "Cannot select a descendant category as the parent (circular hierarchy).",
          });
        }

        const childrenResponse = await api.get("products/categories", {
          parent: numericId,
          per_page: 1,
          hide_empty: false,
          _fields: "id",
        });
        if (!Array.isArray(childrenResponse.data)) {
          throw new Error("Invalid WooCommerce category hierarchy response");
        }
        const hasChildren = childrenResponse.data.length > 0;
        if (hasChildren) {
          return res.status(400).json({
            success: false,
            message: "A department with subcategories cannot itself be moved under another department.",
          });
        }
      }

      payload.parent = numParent;
    }

    if (image_id !== undefined && image_id !== null && image_id !== "") {
      const numId = Number(image_id);
      if (!Number.isInteger(numId) || numId <= 0) {
        return res.status(400).json({
          success: false,
          message: "A valid positive numeric image ID is required.",
        });
      }
      payload.image = { id: numId };
    } else if (image_url) {
      const isSafe = await isSafeExternalImageUrl(image_url);
      if (!isSafe) {
        return res.status(400).json({
          success: false,
          message: "Invalid or restricted category image URL. Localhost and private network addresses are blocked.",
        });
      }
      payload.image = { src: image_url };
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No category changes provided.",
      });
    }

    // Update the existing WooCommerce category in place
    const response = await api.put(`products/categories/${numericId}`, payload);
    const cat = response.data;

    if (payload.image && cat?.id) {
      if (payload.image.id) {
        try {
          await markMediaAttached([payload.image.id], cat.id, "category");
        } catch (attachErr) {
          logger.warn({ categoryId: cat.id, err: attachErr.message }, "[adminCategoryController] Failed to mark updated category image attached");
        }
      }
      const previousImageId = Number(currentCategory.image?.id) || 0;
      const nextImageId = Number(payload.image.id) || 0;
      if (previousImageId > 0 && previousImageId !== nextImageId) {
        try {
          await deleteMediaIfUnreferenced([previousImageId], { context: "category_image_replaced" });
        } catch (cleanupErr) {
          logger.warn({ categoryId: cat.id, mediaId: previousImageId, err: cleanupErr.message }, "[adminCategoryController] Failed to clean up replaced category image");
        }
      }
    }

    // Invalidate catalog and resilience cache so public categories immediately update
    const cacheSync = await invalidateAllCategoryCaches();

    res.json({
      cache_sync: cacheSync,
      success: true,
      message: `Category "${decodeHtmlEntities(cat.name)}" updated successfully.`,
      category: {
        id: cat.id,
        name: decodeHtmlEntities(cat.name),
        slug: cat.slug,
        parent: typeof cat.parent === "number" ? cat.parent : (payload.parent !== undefined ? payload.parent : (cat.parent || 0)),
        count: cat.count || 0,
        image: cat.image
          ? {
              id: cat.image.id,
              src: cat.image.src,
              name: cat.image.name,
              alt: cat.image.alt,
            }
          : null,
      },
    });
  } catch (error) {
    logError(req, error, "Update category error");
    const safeError = sanitizeUpstreamError(error, "Failed to update category.");
    const rawMessage = String(error.response?.data?.message || "");
    if (
      rawMessage.toLowerCase().includes("already exists") ||
      error.response?.data?.code === "term_exists"
    ) {
      safeError.payload.message = "A category with this name already exists.";
    }
    res.status(safeError.status).json(safeError.payload);
  }
};

/**
 * Reorder Product Categories in WooCommerce
 */
export const reorderCategories = async (req, res) => {
  const { category_ids } = req.body || {};

  if (!Array.isArray(category_ids) || category_ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: "An array of category IDs in the desired order is required.",
    });
  }

  const parsedIds = [];
  for (const id of category_ids) {
    const parsed = Number(id);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid category ID: ${id}. All elements must be positive integers.`,
      });
    }
    parsedIds.push(parsed);
  }

  const uniqueSet = new Set(parsedIds);
  if (uniqueSet.size !== parsedIds.length) {
    return res.status(400).json({
      success: false,
      message: "Duplicate category IDs are not allowed in reorder list.",
    });
  }

  const isProduction = process.env.NODE_ENV === "production";
  const effectiveRedis = _testRedisClient !== undefined ? _testRedisClient : getRedisClient();
  const redisConfigured = isRedisConfigured();
  const redisActive = isRedisActive();

  // Fail-closed on Redis outage in production or when explicitly simulating an outage in tests.
  // In development, remote Upstash Redis is used when available, but a process-local mutex
  // fallback is permitted if Upstash is temporarily unreachable.
  const requireDistributedLock = isProduction || _testRedisClient === null;

  if (requireDistributedLock && (_testRedisClient === null || !redisConfigured || !redisActive || !effectiveRedis)) {
    return res.status(503).json({
      success: false,
      code: "REORDER_LOCK_UNAVAILABLE",
      message: "Category reordering requires distributed lock coordination and is temporarily unavailable.",
    });
  }

  const redis = effectiveRedis;
  const lockKey = "lock:category:reorder";
  const lockOwner = randomUUID();
  let acquiredRedisLock = false;
  let lockLost = false;
  let renewTimer = null;

  const isLockHeldByUs = async () => {
    if (!acquiredRedisLock || !redis) return true;
    if (lockLost) return false;
    try {
      if (typeof redis.get === "function") {
        const currentOwner = await redis.get(lockKey);
        if (currentOwner !== lockOwner) {
          lockLost = true;
          return false;
        }
      }
      return true;
    } catch (err) {
      if (requireDistributedLock) {
        lockLost = true;
        return false;
      }
      return true;
    }
  };

  const assertLockHeld = async () => {
    if (acquiredRedisLock && redis) {
      if (lockLost || !(await isLockHeldByUs())) {
        const err = new Error("Distributed reorder lock lost during operation; aborting to prevent split-brain writes");
        err.statusCode = 409;
        err.code = "LOCK_LOST";
        throw err;
      }
    }
  };

  if (redis) {
    try {
      const acquired = await redis.set(lockKey, lockOwner, "PX", LOCK_TTL_MS, "NX");
      if (!acquired) {
        return res.status(409).json({
          success: false,
          code: "REORDER_IN_PROGRESS",
          message: "A category reordering operation is currently in progress. Please wait a moment and retry.",
        });
      }
      acquiredRedisLock = true;

      // Heartbeat renewal: renew lock every 10 seconds via owner-checked Lua script so reorders >30s maintain ownership
      renewTimer = setInterval(async () => {
        try {
          let renewed = 0;
          if (typeof redis.eval === "function") {
            renewed = await redis.eval(LUA_RENEW_LOCK, 1, lockKey, lockOwner, LOCK_TTL_MS);
          } else if (typeof redis.pexpire === "function") {
            const current = await redis.get?.(lockKey);
            if (current === lockOwner) {
              await redis.pexpire(lockKey, LOCK_TTL_MS);
              renewed = 1;
            }
          }
          if (Number(renewed) !== 1) {
            lockLost = true;
            logger.error(
              { lockKey, lockOwner, renewed },
              "[adminCategoryController] Distributed reorder lock renewal returned 0; lock lease was lost"
            );
          }
        } catch (err) {
          lockLost = true;
          logger.error(
            { err: err.message, lockKey, lockOwner },
            "[adminCategoryController] Exception during distributed reorder lock renewal; marking lock as lost"
          );
        }
      }, _testRenewIntervalMs !== undefined ? _testRenewIntervalMs : RENEW_INTERVAL_MS);
      if (typeof renewTimer.unref === "function") renewTimer.unref();
    } catch (err) {
      if (requireDistributedLock) {
        logError(req, err, "Distributed category reorder lock acquisition failed in production");
        return res.status(503).json({
          success: false,
          code: "REORDER_LOCK_UNAVAILABLE",
          message: "Category reordering requires distributed lock coordination and is temporarily unavailable.",
        });
      }
      logger.warn(
        { err: err?.message },
        "[adminCategoryController] Upstash Redis lock acquisition failed, falling back to process-local mutex in development"
      );
    }
  } else if (!isProduction) {
    logger.warn(
      "[adminCategoryController] Redis is not active; using process-local mutex fallback for category reorder in development"
    );
  }

  const previousQueue = localReorderMutex;
  let releaseLocal;
  localReorderMutex = new Promise((resolve) => { releaseLocal = resolve; });

  try {
    await previousQueue;
    await assertLockHeld();

    // Reordering is only for top-level storefront departments. Do not trust
    // the employee UI to keep child terms or the protected fallback category
    // out of a crafted request.
    const categoriesById = new Map();
    for (let offset = 0; offset < parsedIds.length; offset += 100) {
      await assertLockHeld();
      const chunk = parsedIds.slice(offset, offset + 100);
      const response = await api.get("products/categories", {
        include: chunk.join(","),
        per_page: chunk.length,
        hide_empty: false,
        _fields: "id,name,slug,parent",
      });
      for (const category of Array.isArray(response.data) ? response.data : []) {
        categoriesById.set(Number(category.id), category);
      }
    }

    const missingCategoryIds = parsedIds.filter((id) => !categoriesById.has(id));
    if (missingCategoryIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `One or more categories no longer exist: ${missingCategoryIds.join(", ")}. Refresh and try again.`,
      });
    }
    const invalidOrderCategories = parsedIds.filter((id) => {
      const category = categoriesById.get(id);
      return Number(category.parent) > 0 || isUncategorizedCategory(category);
    });
    if (invalidOrderCategories.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Only top-level departments can be reordered.",
        invalid_ids: invalidOrderCategories,
      });
    }

    // Try WooCommerce Batch Update API
    const updateBatch = parsedIds.map((id, index) => ({
      id,
      menu_order: index + 1,
    }));

    let batchSucceeded = false;
    let idsToRetry = [];

    try {
      await assertLockHeld();
      const batchRes = await api.post("products/categories/batch", {
        update: updateBatch,
      });

      const updates = Array.isArray(batchRes.data?.update) ? batchRes.data.update : [];
      const successfulIds = new Set();

      for (const item of updates) {
        const numId = Number(item?.id);
        if (Number.isInteger(numId) && numId > 0 && !item.error) {
          successfulIds.add(numId);
        }
      }

      // Complete union of explicit errors, omitted IDs, and malformed responses
      idsToRetry = parsedIds.filter((id) => !successfulIds.has(id));

      if (idsToRetry.length === 0 && updates.length >= parsedIds.length) {
        batchSucceeded = true;
      } else {
        logger.warn(
          { totalRequested: parsedIds.length, missingOrFailedCount: idsToRetry.length, idsToRetry },
          "[reorderCategories] Batch update had missing or failed categories; falling back to parallel updates"
        );
      }
    } catch (batchErr) {
      logger.warn({ err: batchErr.message }, "Batch reorder API failed, falling back to parallel updates");
      idsToRetry = parsedIds;
    }

    // If batch update failed or had item-level errors/omissions, retry with bounded concurrency (<= 5)
    if (!batchSucceeded) {
      const CONCURRENCY_LIMIT = 5;
      const orderMap = new Map(parsedIds.map((id, index) => [id, index + 1]));
      const rejected = [];

      for (let i = 0; i < idsToRetry.length; i += CONCURRENCY_LIMIT) {
        await assertLockHeld();
        const chunk = idsToRetry.slice(i, i + CONCURRENCY_LIMIT);
        const chunkResults = await Promise.allSettled(
          chunk.map((id) =>
            api.put(`products/categories/${id}`, {
              menu_order: orderMap.get(id),
            })
          )
        );

        chunkResults.forEach((r, idx) => {
          const catId = chunk[idx];
          if (r.status === "rejected" || r.value?.data?.error) {
            rejected.push(catId);
            const errMsg = r.status === "rejected" ? r.reason?.message : r.value?.data?.error?.message;
            logger.error({ id: catId, err: errMsg }, "Failed to update menu_order for category");
          }
        });
      }

      if (rejected.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Failed to update category order for ${rejected.length} category(ies): ${rejected.join(", ")}.`,
          failed_ids: rejected,
        });
      }
    }

    // Authoritative Final Verification: Re-fetch WooCommerce categories to confirm final menu_order
    await assertLockHeld();
    const verifiedOrderMap = new Map();
    for (let offset = 0; offset < parsedIds.length; offset += 100) {
      await assertLockHeld();
      const chunk = parsedIds.slice(offset, offset + 100);
      const verifyRes = await api.get("products/categories", {
        include: chunk.join(","),
        per_page: chunk.length,
        hide_empty: false,
        _fields: "id,menu_order",
      });
      for (const cat of Array.isArray(verifyRes.data) ? verifyRes.data : []) {
        if (cat && cat.id) {
          verifiedOrderMap.set(Number(cat.id), Number(cat.menu_order));
        }
      }
    }

    const verificationMismatches = [];
    parsedIds.forEach((id, index) => {
      const expectedOrder = index + 1;
      const actualOrder = verifiedOrderMap.get(id);
      if (actualOrder !== expectedOrder) {
        verificationMismatches.push({
          id,
          expected: expectedOrder,
          actual: actualOrder ?? null,
        });
      }
    });

    if (verificationMismatches.length > 0) {
      logger.error(
        { mismatchCount: verificationMismatches.length, verificationMismatches },
        "[reorderCategories] Authoritative verification failed: WooCommerce menu_order mismatch"
      );
      return res.status(500).json({
        success: false,
        code: "REORDER_VERIFICATION_FAILED",
        message: `Authoritative verification failed for ${verificationMismatches.length} category(ies). WooCommerce menu_order did not persist correctly.`,
        mismatches: verificationMismatches,
      });
    }

    // Invalidate catalog and resilience cache so public categories immediately reflect new merchandising order
    await assertLockHeld();
    const cacheSync = await invalidateAllCategoryCaches();
    await assertLockHeld();

    res.json({
      success: true,
      message: cacheSync?.degraded
        ? "Category merchandising order updated and verified. Note: Distributed cache invalidation was degraded; local instances will refresh shortly."
        : "Category merchandising order updated and verified successfully.",
      ordered_ids: parsedIds,
      cache_sync: cacheSync,
    });
  } catch (error) {
    if (error.code === "LOCK_LOST" || error.statusCode === 409) {
      logger.error({ err: error.message }, "[reorderCategories] Operation aborted because distributed lock was lost");
      return res.status(409).json({
        success: false,
        code: "LOCK_LOST",
        message: "Category reordering was aborted because the distributed lock was lost to another process.",
      });
    }
    logError(req, error, "Reorder categories error");
    const safeError = sanitizeUpstreamError(error, "Failed to reorder categories.");
    res.status(safeError.status).json(safeError.payload);
  } finally {
    if (renewTimer) clearInterval(renewTimer);
    if (typeof releaseLocal === "function") releaseLocal();
    if (acquiredRedisLock && redis) {
      try {
        if (typeof redis.eval === "function") {
          await redis.eval(LUA_RELEASE_LOCK, 1, lockKey, lockOwner);
        } else {
          const current = await redis.get?.(lockKey);
          if (current === lockOwner) {
            await redis.del?.(lockKey);
          }
        }
      } catch (err) {
        logger.warn({ err: err?.message }, "[adminCategoryController] Failed to release reorder lock");
      }
    }
  }
};
