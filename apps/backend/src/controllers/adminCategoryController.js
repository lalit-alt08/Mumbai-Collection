import api from "../config/woocommerce.js";
import { transformMediaUrls } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { logError, logger } from "../utils/logger.js";
import { isSafeExternalImageUrl } from "../utils/imageValidator.js";

/**
 * Get Product Categories from WooCommerce
 */
export const getAdminCategories = async (req, res) => {
  try {
    const response = await api.get("products/categories", {
      per_page: 100,
      hide_empty: false,
    });

    const categories = Array.isArray(response.data) ? response.data : [];

    // Sort by menu_order ascending (new categories with menu_order 0 or unassigned appear at the end)
    const sorted = [...categories].sort((a, b) => {
      const orderA = typeof a.menu_order === "number" && a.menu_order > 0 ? a.menu_order : 9999;
      const orderB = typeof b.menu_order === "number" && b.menu_order > 0 ? b.menu_order : 9999;
      if (orderA !== orderB) return orderA - orderB;
      return a.id - b.id;
    });

    const formattedCategories = sorted.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parent: c.parent,
      count: c.count,
      menu_order: c.menu_order || 0,
      image: c.image
        ? {
            id: c.image.id,
            src: c.image.src,
            name: c.image.name,
            alt: c.image.alt,
          }
        : null,
    }));

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
    const { name, image_id, image_url, description } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required.",
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

    // Invalidate catalog cache so public categories immediately update
    serverCache.invalidatePrefix("catalog:");

    logAuditEvent({
      req,
      action: "CATEGORY_CREATE",
      targetType: "category",
      targetId: cat.id,
      details: { name: cat.name, slug: cat.slug },
    });

    res.status(201).json({
      success: true,
      message: `Category "${cat.name}" created successfully.`,
      category: {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
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
    const { name, image_id, image_url, description } = req.body;

    const numericId = parseInt(id, 10);
    if (!id || isNaN(numericId) || numericId <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid positive numeric category ID is required.",
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
      payload.name = name.trim();
    }

    if (description !== undefined) {
      payload.description = typeof description === "string" ? description.trim() : "";
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

    // Invalidate catalog cache so public categories immediately update
    serverCache.invalidatePrefix("catalog:");

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
