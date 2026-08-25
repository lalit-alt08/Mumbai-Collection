import api from "../config/woocommerce.js";

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

    res.json({
      success: true,
      categories: sorted.map((c) => ({
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
      })),
    });
  } catch (error) {
    console.error("Get categories error:", error.response?.data || error.message);
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

    if (!image_id && !image_url) {
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

    if (image_id) {
      payload.image = { id: Number(image_id) };
    } else if (image_url) {
      payload.image = { src: image_url };
    }

    const response = await api.post("products/categories", payload);
    const cat = response.data;

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
    console.error("Create category error:", error.response?.data || error.message);
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
      payload.image = { id: Number(image_id) };
    } else if (image_url) {
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
    console.error("Update category error:", error.response?.data || error.message);
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

    const validIds = category_ids
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id) && id > 0);

    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid numeric category IDs provided.",
      });
    }

    // Try WooCommerce Batch Update API
    const updateBatch = validIds.map((id, index) => ({
      id,
      menu_order: index + 1,
    }));

    try {
      await api.post("products/categories/batch", {
        update: updateBatch,
      });
    } catch (batchErr) {
      console.warn("Batch reorder fallback to parallel updates:", batchErr.message);
      // Fallback: update each category's menu_order
      await Promise.all(
        validIds.map((id, index) =>
          api.put(`products/categories/${id}`, {
            menu_order: index + 1,
          }).catch((err) => {
            console.error(`Failed to update menu_order for category #${id}:`, err.message);
          })
        )
      );
    }

    res.json({
      success: true,
      message: "Category merchandising order updated successfully.",
      ordered_ids: validIds,
    });
  } catch (error) {
    console.error("Reorder categories error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to reorder categories.",
    });
  }
};
