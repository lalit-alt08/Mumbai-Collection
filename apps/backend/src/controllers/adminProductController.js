import axios from "axios";
import api from "../config/woocommerce.js";
import { httpsAgent } from "../config/httpAgent.js";
import {
  uploadMedia,
  markMediaAttached,
  deleteMediaIfUnreferenced,
  cleanupPendingOrphanMedia,
} from "../services/wordpressMediaService.js";
import { transformMediaUrls, transformMediaUrl } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { logError, logger } from "../utils/logger.js";

/**
 * Fetch Live Product Stock Counts (Cached for 60s)
 */
export const fetchStockCounts = async () => {
  return serverCache.getOrFetch("product_stock_counts", async () => {
    // 1. Try WordPress custom endpoint if MUMBAI_INTERNAL_API_KEY is configured
    try {
      const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
      const internalKey = process.env.MUMBAI_INTERNAL_API_KEY;
      if (internalKey) {
        const res = await axios.get(`${wpBaseUrl}/wp-json/mumbai-auth/v1/products/stock-counts`, {
          headers: { "X-Mumbai-Internal-Key": internalKey },
          httpsAgent,
          timeout: 4000,
        });
        if (res.data?.success && res.data?.counts) {
          return res.data.counts;
        }
      }
    } catch (wpErr) {
      // Fall through to WooCommerce query
    }

    // 2. Fallback: query WooCommerce with per_page=1 to extract x-wp-total headers
    try {
      const [allRes, inStockRes, outOfStockRes, lowStockRes] = await Promise.all([
        api.get("products", { per_page: 1, status: "publish" }).catch(() => null),
        api.get("products", { per_page: 1, stock_status: "instock", status: "publish" }).catch(() => null),
        api.get("products", { per_page: 1, stock_status: "outofstock", status: "publish" }).catch(() => null),
        api.get("products", { per_page: 1, stock_status: "lowstock", status: "publish" }).catch(() => null),
      ]);

      const all = Number(allRes?.headers?.["x-wp-total"]) || 0;
      const outofstock = Number(outOfStockRes?.headers?.["x-wp-total"]) || 0;
      const lowstock = Number(lowStockRes?.headers?.["x-wp-total"]) || 0;
      let instock = Number(inStockRes?.headers?.["x-wp-total"]) || 0;
      if (!instock && all > 0) {
        instock = Math.max(0, all - outofstock - lowstock);
      }

      return { all, instock, lowstock, outofstock };
    } catch (wcErr) {
      return { all: 0, instock: 0, lowstock: 0, outofstock: 0 };
    }
  }, 60000);
};

/**
 * Product Input Validation Helper
 */
export const validateProductInput = ({
  name,
  regular_price,
  sale_price,
  stock_quantity,
  stock_status,
}) => {
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return "Product name must be a non-empty string.";
    }

    if (name.trim().length > 200) {
      return "Product name cannot exceed 200 characters.";
    }
  }

  if (regular_price !== undefined) {
    const price = Number(regular_price);

    if (!Number.isFinite(price) || price < 0) {
      return "Regular price must be a valid non-negative number.";
    }
  }

  if (sale_price !== undefined && sale_price !== "") {
    const salePrice = Number(sale_price);

    if (!Number.isFinite(salePrice) || salePrice < 0) {
      return "Sale price must be a valid non-negative number.";
    }

    if (
      regular_price !== undefined &&
      salePrice > Number(regular_price)
    ) {
      return "Sale price cannot be greater than regular price.";
    }
  }

  if (stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== "") {
    const stock = Number(stock_quantity);

    if (!Number.isInteger(stock) || stock < 0) {
      return "Stock quantity must be a non-negative integer.";
    }
  }

  if (stock_status !== undefined) {
    const allowedStockStatuses = [
      "instock",
      "outofstock",
      "onbackorder",
    ];

    if (!allowedStockStatuses.includes(stock_status)) {
      return "Invalid stock status.";
    }
  }

  return null;
};

/**
 * Get Products for Inventory Manager with Server-Side Pagination, Search & Stock Filters
 */
export const getAdminProducts = async (req, res) => {
  try {
    const { category, search, page = 1, per_page = 20, stock_status } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));

    const cleanCategory = category && category !== "all" ? String(category).trim() : "all";
    const cleanSearch = search && search.trim() ? search.trim().toLowerCase() : "";
    const ALLOWED_STOCK_STATUSES = ["instock", "outofstock", "onbackorder", "lowstock"];
    const cleanStockStatus = stock_status && ALLOWED_STOCK_STATUSES.includes(stock_status) ? stock_status : "all";

    const cacheKey = `admin_products:${pageNum}:${limit}:${cleanCategory}:${cleanStockStatus}:${cleanSearch}`;

    const cachedData = serverCache.get(cacheKey);
    if (cachedData) {
      return res.json({
        ...cachedData,
        products: transformMediaUrls(cachedData.products, req),
      });
    }

    const queryParams = {
      page: pageNum,
      per_page: limit,
      orderby: "date",
      order: "desc",
    };

    if (cleanCategory !== "all") {
      queryParams.category = cleanCategory;
    }

    if (cleanStockStatus !== "all") {
      queryParams.stock_status = cleanStockStatus;
    }

    if (cleanSearch) {
      queryParams.search = search.trim();
    }

    // Stock counts are independent of the search term. Avoid recalculating the
    // full catalog summary for every keystroke; use the existing cache during
    // searches and refresh it on the unfiltered inventory view.
    const stockCountsPromise = cleanSearch
      ? Promise.resolve(serverCache.get("product_stock_counts"))
      : fetchStockCounts();

    // Parallel fetch: query filtered products and stock summary counts
    const [response, stockCounts] = await Promise.all([
      api.get("products", queryParams),
      stockCountsPromise,
    ]);

    const products = Array.isArray(response.data) ? response.data : [];

    const totalProducts = Number(response.headers?.["x-wp-total"]) || products.length;
    const totalPages = Number(response.headers?.["x-wp-totalpages"]) || Math.ceil(totalProducts / limit) || 1;

    const formatted = products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku || `MC-${p.id}`,
      price: p.price,
      regular_price: p.regular_price,
      sale_price: p.sale_price,
      stock_quantity: p.stock_quantity,
      manage_stock: p.manage_stock,
      stock_status: p.stock_status,
      categories: p.categories?.map((c) => ({ id: c.id, name: c.name, slug: c.slug })) || [],
      image: p.images?.[0]?.src || null,
      images: (p.images || []).map((img) => img.src),
      date_created: p.date_created,
    }));

    const resultPayload = {
      success: true,
      page: pageNum,
      per_page: limit,
      total: totalProducts,
      totalPages,
      count: formatted.length,
      counts: stockCounts,
      products: formatted,
    };

    // Cache product list for 60 seconds
    serverCache.set(cacheKey, resultPayload, 60000);

    res.json({
      ...resultPayload,
      products: transformMediaUrls(formatted, req),
    });
  } catch (error) {
    logError(req, error, "Get admin products error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load products.",
      products: [],
    });
  }
};

/**
 * Update Product Price and Stock Quantity
 */
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { regular_price, sale_price, stock_quantity, stock_status, name } = req.body;

    const validationError = validateProductInput({
      name,
      regular_price,
      sale_price,
      stock_quantity,
      stock_status,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const updatePayload = {};

    if (name !== undefined) updatePayload.name = name.trim();
    if (regular_price !== undefined) updatePayload.regular_price = String(regular_price);
    if (sale_price !== undefined) updatePayload.sale_price = sale_price ? String(sale_price) : "";
    if (stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== "") {
      const stockNum = Number(stock_quantity);
      updatePayload.manage_stock = true;
      updatePayload.stock_quantity = stockNum;
      updatePayload.stock_status = stockNum > 0 ? "instock" : "outofstock";
    } else if (stock_status !== undefined) {
      updatePayload.stock_status = stock_status;
    }

    const response = await api.put(`products/${encodeURIComponent(id)}`, updatePayload);

    // Invalidate product list, stock counts, and public catalog caches
    serverCache.invalidatePrefix("admin_products:");
    serverCache.delete("product_stock_counts");
    serverCache.invalidatePrefix("catalog:");

    logAuditEvent({
      req,
      action: "PRODUCT_UPDATE",
      targetType: "product",
      targetId: id,
      details: updatePayload,
    });

    // If images were updated, mark them as attached
    if (req.body.images || req.body.image_url) {
      const updatedMediaIds = (response.data?.images || []).map((img) => img.id).filter(Boolean);
      if (updatedMediaIds.length > 0) {
        try {
          await markMediaAttached(updatedMediaIds, Number(id));
        } catch (attachErr) {
          logger.warn({ id, err: attachErr.message }, "[adminProductController] Failed to mark media attached for updated product");
        }
      }
    }

    res.json({
      success: true,
      message: `Product #${id} updated successfully.`,
      product: transformMediaUrls(response.data, req),
    });
  } catch (error) {
    logError(req, error, "Update product error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to update product.",
    });
  }
};

/**
 * Permanently Delete Product from WooCommerce Catalog
 */
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const numericId = Number(id);
    if (!id || isNaN(numericId) || numericId <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid numeric Product ID is required.",
      });
    }

    const response = await api.delete(`products/${encodeURIComponent(numericId)}`, {
      force: true,
    });

    // Invalidate product list, stock counts, and public catalog caches
    serverCache.invalidatePrefix("admin_products:");
    serverCache.delete("product_stock_counts");
    serverCache.invalidatePrefix("catalog:");

    logAuditEvent({
      req,
      action: "PRODUCT_DELETE",
      targetType: "product",
      targetId: numericId,
    });

    // Safely cleanup product media that is completely unreferenced elsewhere
    const deletedImages = (response.data?.images || []).map((img) => img.id).filter(Boolean);
    if (deletedImages.length > 0) {
      try {
        await deleteMediaIfUnreferenced(deletedImages, { context: "product_deletion" });
      } catch (cleanErr) {
        logger.warn({ numericId, err: cleanErr.message }, "[adminProductController] Media cleanup after deleting product failed");
      }
    }

    res.json({
      success: true,
      message: `Product #${id} permanently deleted from store catalog.`,
      product: response.data,
    });
  } catch (error) {
    logError(req, error, "Delete product error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to delete product.",
    });
  }
};

/**
 * Upload Product Image to WordPress Media Library (Delegates to wordpressMediaService)
 */
export const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided.",
      });
    }

    const { id, url } = await uploadMedia(req.file, { uploaderId: req.user?.id });

    res.json({
      success: true,
      url: transformMediaUrl(url, req),
      id,
    });
  } catch (error) {
    logError(req, error, "Admin media upload error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to upload image to WordPress Media Library.",
      code: error.response?.data?.code || "media_upload_error",
    });
  }
};

/**
 * Create New Product
 */
export const createProduct = async (req, res) => {
  try {
    const {
      name,
      regular_price,
      sale_price,
      stock_quantity,
      category_ids,
      categories,
      image_url,
      images,
      description,
      short_description,
      sku,
    } = req.body;

    if (!name || regular_price === undefined || regular_price === null || regular_price === "") {
      return res.status(400).json({
        success: false,
        message: "Product name and regular price are required.",
      });
    }

    const validationError = validateProductInput({
      name,
      regular_price,
      sale_price,
      stock_quantity,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const finalStock =
      stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== ""
        ? Number(stock_quantity)
        : 10;

    const catList = Array.isArray(category_ids)
      ? category_ids
      : Array.isArray(categories)
      ? categories
      : [];

    const imgList = Array.isArray(images) && images.length > 0
      ? images.map((img) => (typeof img === "string" ? { src: img } : img))
      : image_url
      ? [{ src: image_url }]
      : [];

    const payload = {
      name: name.trim(),
      type: "simple",
      regular_price: String(regular_price),
      sale_price: sale_price ? String(sale_price) : "",
      description: description || "",
      short_description: short_description || "",
      manage_stock: true,
      stock_quantity: finalStock,
      stock_status: finalStock > 0 ? "instock" : "outofstock",
      categories: catList.map((id) => (typeof id === "object" ? id : { id: Number(id) })),
      images: imgList,
    };

    if (sku && String(sku).trim()) {
      payload.sku = String(sku).trim();
    }

    const response = await api.post("products", payload);

    // Invalidate product list, stock counts, and public catalog caches
    serverCache.invalidatePrefix("admin_products:");
    serverCache.delete("product_stock_counts");
    serverCache.invalidatePrefix("catalog:");

    const createdProduct = response.data;
    const createdProductId = createdProduct?.id;

    // Transition newly uploaded images from 'pending' to 'attached'
    const attachedMediaIds = (createdProduct?.images || []).map((img) => img.id).filter(Boolean);
    if (attachedMediaIds.length > 0 && createdProductId) {
      try {
        await markMediaAttached(attachedMediaIds, createdProductId);
      } catch (attachErr) {
        logger.warn({ createdProductId, err: attachErr.message }, "[adminProductController] Failed to mark media attached for product");
      }
    }

    logAuditEvent({
      req,
      action: "PRODUCT_CREATE",
      targetType: "product",
      targetId: createdProductId,
      details: { name: payload.name, price: payload.regular_price, sku: payload.sku },
    });

    res.status(201).json({
      success: true,
      message: "Product created successfully.",
      product: transformMediaUrls(createdProduct, req),
    });
  } catch (error) {
    logError(req, error, "Create product error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to create product.",
    });
  }
};

/**
 * Manually trigger orphan media cleanup (older than 24h)
 */
export const triggerOrphanCleanup = async (req, res) => {
  try {
    const result = await cleanupPendingOrphanMedia();
    res.json({
      success: true,
      message: "Orphan media cleanup completed.",
      ...result,
    });
  } catch (error) {
    logError(req, error, "Trigger orphan cleanup error");
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to run orphan media cleanup.",
    });
  }
};
