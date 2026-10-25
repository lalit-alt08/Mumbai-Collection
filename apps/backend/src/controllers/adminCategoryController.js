import api from "../config/woocommerce.js";
import { transformMediaUrls } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { logError, logger } from "../utils/logger.js";
import { isSafeExternalImageUrl } from "../utils/imageValidator.js";
import { fetchAllProductCategories } from "../services/productService.js";
import { markMediaAttached, deleteMediaIfUnreferenced } from "../services/wordpressMediaService.js";

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
        const sorted = [...categories].sort((a, b) => {
          const orderA = typeof a.menu_order === "number" && a.menu_order > 0 ? a.menu_order : 9999;
          const orderB = typeof b.menu_order === "number" && b.menu_order > 0 ? b.menu_order : 9999;
          if (orderA !== orderB) return orderA - orderB;
          return a.id - b.id;
        });

        return sorted.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          parent: c.parent,
          count: c.count,
          menu_order: c.menu_order || 0,
          image: c.image
            ? { id: c.image.id, src: c.image.src, name: c.image.name, alt: c.image.alt }
            : null,
        }));
      },
      120000
    );

    res.json({
      success: true,
      categories: transformMediaUrls(formattedCategories, req),
    });
  } catch (error) {
    logError(req, error, "Get categories error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load categories.",
      categories: [],
    });
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

    // Invalidate catalog cache so public categories immediately update
    serverCache.invalidatePrefix("catalog:");
    serverCache.invalidatePrefix("category:");
    serverCache.delete("admin:categories");
    serverCache.delete("seo:sitemap_xml");

    logAuditEvent({
      req,
      action: "CATEGORY_CREATE",
      targetType: "category",
      targetId: cat.id,
      details: { name: cat.name, slug: cat.slug, parent: payload.parent ?? cat.parent ?? 0 },
    });

    res.status(201).json({
      success: true,
      message: `Category "${cat.name}" created successfully.`,
      category: {
        id: cat.id,
        name: cat.name,
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
    const statusCode = error.response?.status || 500;
    const rawMessage = error.response?.data?.message || error.message || "Failed to create category.";

    let userMessage = rawMessage;
    if (
      rawMessage.toLowerCase().includes("already exists") ||
      error.response?.data?.code === "term_exists"
    ) {
      userMessage = "A category with this name already exists.";
    }

    res.status(statusCode).json({
      success: false,
      message: userMessage,
    });
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

    // Invalidate catalog cache so public categories immediately update
    serverCache.invalidatePrefix("catalog:");
    serverCache.invalidatePrefix("category:");
    serverCache.delete("admin:categories");
    serverCache.delete("seo:sitemap_xml");

    logAuditEvent({
      req,
      action: "CATEGORY_UPDATE",
      targetType: "category",
      targetId: numericId,
      details: { name: cat.name, updatedFields: Object.keys(payload) },
    });

    res.json({
      success: true,
      message: `Category "${cat.name}" updated successfully.`,
      category: {
        id: cat.id,
        name: cat.name,
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
    const statusCode = error.response?.status || 500;
    const rawMessage = error.response?.data?.message || error.message || "Failed to update category.";

    let userMessage = rawMessage;
    if (
      rawMessage.toLowerCase().includes("already exists") ||
      error.response?.data?.code === "term_exists"
    ) {
      userMessage = "A category with this name already exists.";
    }

    res.status(statusCode).json({
      success: false,
      message: userMessage,
    });
  }
};

/**
 * Reorder Product Categories in WooCommerce
 */
export const reorderCategories = async (req, res) => {
  try {
    const { category_ids } = req.body;

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

    // Reordering is only for top-level storefront departments. Do not trust
    // the employee UI to keep child terms or the protected fallback category
    // out of a crafted request.
    const categoriesById = new Map();
    for (let offset = 0; offset < parsedIds.length; offset += 100) {
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
    let failedIds = [];

    try {
      const batchRes = await api.post("products/categories/batch", {
        update: updateBatch,
      });

      const updates = Array.isArray(batchRes.data?.update) ? batchRes.data.update : [];
      const failedItems = updates.filter((item) => item.error || !item.id);
      if (failedItems.length > 0) {
        failedIds = failedItems.map((item) => item.id || "unknown");
        logger.error({ failedIds }, "[reorderCategories] WooCommerce batch returned per-category errors");
      } else if (updates.length < updateBatch.length) {
        const returnedIds = new Set(updates.map((item) => item.id));
        failedIds = parsedIds.filter((id) => !returnedIds.has(id));
      } else {
        batchSucceeded = true;
      }
    } catch (batchErr) {
      logger.warn({ err: batchErr.message }, "Batch reorder API failed, falling back to parallel updates");
    }

    // If batch update failed or had item-level errors, execute fallback with strict per-item verification
    if (!batchSucceeded) {
      const results = await Promise.allSettled(
        parsedIds.map((id, index) =>
          api.put(`products/categories/${id}`, {
            menu_order: index + 1,
          })
        )
      );

      const rejected = [];
      results.forEach((r, idx) => {
        if (r.status === "rejected" || r.value?.data?.error) {
          rejected.push(parsedIds[idx]);
          const errMsg = r.status === "rejected" ? r.reason?.message : r.value?.data?.error?.message;
          logger.error({ id: parsedIds[idx], err: errMsg }, "Failed to update menu_order for category");
        }
      });

      if (rejected.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Failed to update category order for ${rejected.length} category(ies): ${rejected.join(", ")}.`,
          failed_ids: rejected,
        });
      }
    } else if (failedIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Failed to update category order for ${failedIds.length} category(ies): ${failedIds.join(", ")}.`,
        failed_ids: failedIds,
      });
    }

    // Invalidate catalog cache so public categories immediately reflect new merchandising order
    serverCache.invalidatePrefix("catalog:");
    serverCache.delete("admin:categories");
    serverCache.delete("seo:sitemap_xml");

    logAuditEvent({
      req,
      action: "CATEGORY_REORDER",
      targetType: "category",
      targetId: "batch",
      details: { count: parsedIds.length, ordered_ids: parsedIds },
    });

    res.json({
      success: true,
      message: "Category merchandising order updated successfully.",
      ordered_ids: parsedIds,
    });
  } catch (error) {
    logError(req, error, "Reorder categories error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to reorder categories.",
    });
  }
};
