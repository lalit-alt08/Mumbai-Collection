import wp from "../services/wordpress.js";
import axios from "axios";
import api from "../config/woocommerce.js";
import { httpsAgent } from "../config/httpAgent.js";
import {
  uploadMedia,
  markMediaAttached,
  cleanupPendingOrphanMedia,
} from "../services/wordpressMediaService.js";
import { transformMediaUrls, transformMediaUrl } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";
import { searchIndexService } from "../services/searchIndexService.js";
import { logError, logger } from "../utils/logger.js";
import { isSafeExternalImageUrl } from "../utils/imageValidator.js";
import { sanitizeUpstreamError } from "../utils/upstreamError.js";

export const EDITABLE_PRODUCT_SCOPE = { context: "edit", include_status: ["any"] };
export const PRODUCT_STOCK_COUNTS_CACHE_KEY = "product_stock_counts";

const invalidateInventoryCaches = async () => {
  const batch = serverCache.createInvalidationBatch();
  batch.invalidatePrefix("admin_products:");
  batch.delete(PRODUCT_STOCK_COUNTS_CACHE_KEY);
  // This prefix also evicts admin:analytics:overview.
  batch.invalidatePrefix("admin:analytics");
  batch.invalidatePrefix("catalog:");
  batch.delete("admin:categories");
  batch.delete("seo:sitemap_xml");
  searchIndexService.markDirty();

  try {
    await batch.flush();
  } catch (error) {
    logger.warn({ err: error.message }, "Product saved, but shared inventory cache invalidation is degraded");
  }
};

const isProtectedUncategorized = (category) =>
  String(category?.slug || "").toLowerCase() === "uncategorized" ||
  String(category?.name || "").toLowerCase() === "uncategorized";

const normalizeCategoryIds = (categoryIds, categories) => {
  const source = Array.isArray(categoryIds) ? categoryIds : Array.isArray(categories) ? categories : [];
  return [...new Set(source.map((category) => Number(typeof category === "object" ? category?.id : category)))];
};

/**
 * Validate the chosen WooCommerce terms at the API boundary. Products may be
 * assigned directly to a department or to one of its direct subcategories.
 * WooCommerce remains the source of truth; browser-supplied parent data is not.
 */
const validateProductCategories = async ({
  category_ids,
  categories,
  department_id,
  subcategory_id,
  required = false,
}) => {
  const hasHierarchyFields = department_id !== undefined || subcategory_id !== undefined;
  let ids = normalizeCategoryIds(category_ids, categories);

  if (hasHierarchyFields) {
    const departmentId = Number(department_id);
    const childId = subcategory_id === undefined ? 0 : Number(subcategory_id);
    if (!Number.isInteger(departmentId) || departmentId <= 0) {
      return { error: "Choose a valid department for this product." };
    }
    if (childId && (!Number.isInteger(childId) || childId <= 0 || childId === departmentId)) {
      return { error: "Choose a valid subcategory for this product." };
    }
    const canonicalId = childId || departmentId;
    if (ids.length > 0 && (ids.length !== 1 || ids[0] !== canonicalId)) {
      return { error: "The selected product category does not match its department and subcategory." };
    }
    ids = [canonicalId];
  }

  if (required && ids.length === 0) {
    return { error: "Choose a department before creating this product." };
  }
  if (!ids.length) return { ids };
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { error: "Product categories must use valid positive IDs." };
  }

  const lookupIds = [...new Set([
    ...ids,
    ...(hasHierarchyFields && Number(department_id) > 0 ? [Number(department_id)] : []),
  ])];
  const response = await api.get("products/categories", {
    include: lookupIds.join(","),
    per_page: Math.min(100, lookupIds.length),
    hide_empty: false,
    _fields: "id,name,slug,parent",
  });
  const found = Array.isArray(response.data) ? response.data : [];
  const categoryMap = new Map(found.map((category) => [Number(category.id), category]));
  if (lookupIds.some((id) => !categoryMap.has(id))) {
    return { error: "One or more selected product categories no longer exist. Refresh the category list and try again." };
  }

  const missingParentIds = [...new Set(ids
    .map((id) => Number(categoryMap.get(id)?.parent) || 0)
    .filter((parentId) => parentId > 0 && !categoryMap.has(parentId)))];
  if (missingParentIds.length > 0) {
    const parentResponse = await api.get("products/categories", {
      include: missingParentIds.join(","),
      per_page: Math.min(100, missingParentIds.length),
      hide_empty: false,
      _fields: "id,name,slug,parent",
    });
    for (const parent of Array.isArray(parentResponse.data) ? parentResponse.data : []) {
      categoryMap.set(Number(parent.id), parent);
    }
    if (missingParentIds.some((id) => !categoryMap.has(id))) {
      return { error: "A selected subcategory's parent department could not be verified." };
    }
  }

  for (const id of ids) {
    const category = categoryMap.get(id);
    if (!category || isProtectedUncategorized(category)) {
      return { error: "Products cannot be assigned to the protected Uncategorized category." };
    }
    const parentId = Number(category.parent) || 0;
    if (parentId > 0) {
      const parent = categoryMap.get(parentId);
      if (!parent) {
        return { error: "A subcategory must be assigned with its valid parent department." };
      }
      if ((Number(parent.parent) || 0) > 0 || isProtectedUncategorized(parent)) {
        return { error: "Products can only use a department or one of its direct subcategories." };
      }
    }
  }

  if (hasHierarchyFields) {
    const department = categoryMap.get(Number(department_id));
    const child = subcategory_id === undefined ? null : categoryMap.get(Number(subcategory_id));
    if (!department || (Number(department.parent) || 0) > 0 || isProtectedUncategorized(department)) {
      return { error: "The selected department is invalid. Refresh the category list and try again." };
    }
    if (child && Number(child.parent) !== Number(department.id)) {
      return { error: "The selected subcategory does not belong to that department." };
    }
  }

  return { ids };
};

/**
 * Fetch Live Product Stock Counts (Cached for 60s)
 */
export const fetchStockCounts = async ({ bypassCache = false } = {}) => {
  const normalizeCounts = (counts) => {
    const fields = ["all", "instock", "onbackorder", "outofstock", "lowstock"];
    const isCount = (value) =>
      (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
      (typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)));
    if (!counts || fields.some((field) => !isCount(counts[field]))) {
      throw new Error("Stock counts are temporarily unavailable.");
    }
    return Object.fromEntries(fields.map((field) => [field, Number(counts[field])]));
  };

  const loadCounts = async () => {

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
          return normalizeCounts(res.data.counts);
        }
      }
    } catch (wpErr) {
      // Fall through to WooCommerce query
    }

    // 2. Fallback: use the same editable product scope as the inventory list.
    try {
      const scope = { ...EDITABLE_PRODUCT_SCOPE, per_page: 1 };
      const [allRes, inStockRes, backorderRes, outOfStockRes, lowStockRes] = await Promise.all([
        api.get("products", scope),
        api.get("products", { ...scope, stock_status: "instock" }),
        api.get("products", { ...scope, stock_status: "onbackorder" }),
        api.get("products", { ...scope, stock_status: "outofstock" }),
        api.get("products", { ...scope, stock_status: "lowstock" }),
      ]);

      const readTotal = (response) => {
        const raw = response?.headers?.["x-wp-total"];
        if ((typeof raw !== "string" && typeof raw !== "number") || !/^\d+$/.test(String(raw))) {
          throw new Error("WooCommerce did not return a valid product total.");
        }
        const total = Number(raw);
        if (!Number.isSafeInteger(total)) throw new Error("WooCommerce returned an invalid product total.");
        return total;
      };

      return normalizeCounts({
        all: readTotal(allRes),
        instock: readTotal(inStockRes),
        onbackorder: readTotal(backorderRes),
        outofstock: readTotal(outOfStockRes),
        lowstock: readTotal(lowStockRes),
      });
    } catch (wcErr) {
      throw wcErr;
    }
  };
  const counts = bypassCache
    ? await loadCounts()
    : await serverCache.getOrFetch(PRODUCT_STOCK_COUNTS_CACHE_KEY, loadCounts, 60000);
  return normalizeCounts(counts);
};

const STOCK_COUNTS_RESPONSE_BUDGET_MS = 1500;

export const settleWithinBudget = (promise, budgetMs = STOCK_COUNTS_RESPONSE_BUDGET_MS) => {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, budgetMs));
  });
  return Promise.race([Promise.resolve(promise).catch(() => null), deadline])
    .finally(() => clearTimeout(timer));
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
    // getOrFetch keeps summary refreshes to once per TTL, including searches,
    // and lets another backend instance reuse the Redis-backed summary.
    const stockCountsPromise = settleWithinBudget(fetchStockCounts());
    if (cachedData) {
      const stockCounts = await stockCountsPromise;
      return res.json({
        ...cachedData,
        counts: stockCounts,
        products: transformMediaUrls(cachedData.products, req),
      });
    }

    const queryParams = {
      // Keep editable unpublished products in the shared employee/admin list.
      ...EDITABLE_PRODUCT_SCOPE,
      page: pageNum,
      per_page: limit,
      orderby: "date",
      order: "desc",
    };

    if (cleanCategory !== "all") {
      const catId = Number(cleanCategory);
      if (Number.isInteger(catId) && catId > 0) {
        try {
          const allCats = await serverCache.getOrFetch(
            "admin:categories:hierarchy",
            () => fetchAllProductCategories({ fields: "id,parent" }),
            300000
          );
          const childIds = (allCats || [])
            .filter((c) => Number(c.parent) === catId)
            .map((c) => c.id);
          queryParams.category = [catId, ...childIds].join(",");
        } catch {
          queryParams.category = String(catId);
        }
      } else {
        queryParams.category = cleanCategory;
      }
    }

    if (cleanStockStatus !== "all") {
      queryParams.stock_status = cleanStockStatus;
    }

    if (cleanSearch) {
      queryParams.search = search.trim();
    }

    // Capture the list cache generation before the WooCommerce read. A stock
    // mutation during this request then fences off this response from cache.
    const listCacheFence = await serverCache.createFence(cacheKey);

    // Counts are independent; their 60-second cache prevents a catalog scan on
    // each search keystroke and a summary failure never fails the product list.
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
      products: formatted,
    };

    // Cache list data separately; catalog-wide counts have their own cache.
    await serverCache.setFenced(cacheKey, resultPayload, 60000, listCacheFence);

    res.json({
      ...resultPayload,
      counts: stockCounts,
      products: transformMediaUrls(formatted, req),
    });
  } catch (error) {
    logError(req, error, "Get admin products error");
    const safeError = sanitizeUpstreamError(error, "Failed to load products.");
    res.status(safeError.status).json({ ...safeError.payload, products: [] });
  }
};

/**
 * Fresh staff-authorized product read used to confirm an ambiguous Quick Adjust timeout.
 * This intentionally bypasses the paginated inventory cache and requests WooCommerce edit context.
 */
export const getAdminProductById = async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid product ID." });
    }

    const response = await api.get(`products/${productId}`, { context: "edit" });
    const product = response.data;
    if (!product || Number(product.id) !== productId) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    return res.json({
      success: true,
      product: {
        id: product.id,
        regular_price: product.regular_price,
        sale_price: product.sale_price,
        stock_quantity: product.stock_quantity,
        stock_status: product.stock_status,
        manage_stock: product.manage_stock,
      },
    });
  } catch (error) {
    logError(req, error, "Get admin product by ID error");
    const safeError = sanitizeUpstreamError(error, "Failed to verify product changes.");
    return res.status(safeError.status).json({ ...safeError.payload, success: false });
  }
};

/**
 * Update Product Price and Stock Quantity
 */
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      regular_price,
      sale_price,
      stock_quantity,
      stock_status,
      name,
      category_ids,
      categories,
      department_id,
      subcategory_id,
    } = req.body;

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
      updatePayload.stock_status = stockNum <= 0 ? "outofstock" : "instock";
    } else if (stock_status !== undefined) {
      updatePayload.stock_status = stock_status;
    }

    const categoryFieldsProvided =
      category_ids !== undefined ||
      categories !== undefined ||
      department_id !== undefined ||
      subcategory_id !== undefined;
    if (categoryFieldsProvided) {
      const assignment = await validateProductCategories({
        category_ids,
        categories,
        department_id,
        subcategory_id,
        required: true,
      });
      if (assignment.error) {
        return res.status(400).json({ success: false, message: assignment.error });
      }
      updatePayload.categories = assignment.ids.map((categoryId) => ({ id: categoryId }));
    }

    const hasStock = Object.hasOwn(updatePayload, "stock_quantity");
    if (hasStock && !Object.hasOwn(req.body, "expected_stock_quantity")) {
      return res.status(409).json({ success: false, message: "Refresh this product before adjusting stock." });
    }
    const response = hasStock
      ? await wp.post("/wp-json/mumbai-auth/v1/staff/products/" + id + "/adjust", { ...updatePayload, expected_stock_quantity: req.body.expected_stock_quantity })
      : await api.put("products/" + encodeURIComponent(id), updatePayload);

    await invalidateInventoryCaches();


    res.json({
      success: true,
      message: `Product #${id} updated successfully.`,
      product: transformMediaUrls(response.data, req),
    });
  } catch (error) {
    logError(req, error, "Update product error");
    const safeError = sanitizeUpstreamError(error, "Failed to update product.");
    const currentStock = error.response?.data?.data?.current_stock ?? error.response?.data?.current_stock;
    if (safeError.status === 409 && currentStock !== undefined) {
      safeError.payload.current_stock = currentStock;
    }
    res.status(safeError.status).json(safeError.payload);
  }
};

/**
 * Move a product to WooCommerce Trash so accidental deletion can be recovered.
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
      force: false,
    });

    await invalidateInventoryCaches();

    res.json({
      success: true,
      message: `Product #${id} moved to WooCommerce Trash.`,
      product: response.data,
    });
  } catch (error) {
    logError(req, error, "Delete product error");
    const safeError = sanitizeUpstreamError(error, "Failed to move product to Trash.");
    res.status(safeError.status).json(safeError.payload);
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
    const safeError = sanitizeUpstreamError(
      error,
      "Failed to upload image to WordPress Media Library."
    );
    res.status(safeError.status).json({
      ...safeError.payload,
      code: safeError.payload.code || "media_upload_error",
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
      department_id,
      subcategory_id,
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

    const categoryAssignment = await validateProductCategories({
      category_ids,
      categories,
      department_id,
      subcategory_id,
      required: true,
    });
    if (categoryAssignment.error) {
      return res.status(400).json({ success: false, message: categoryAssignment.error });
    }

    const imgList = [];
    const rawImages = Array.isArray(images) && images.length > 0
      ? images
      : (image_url ? [image_url] : []);

    for (const img of rawImages) {
      if (typeof img === "number") {
        if (!Number.isInteger(img) || img <= 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid image media ID. Must be a positive integer.",
          });
        }
        imgList.push({ id: img });
      } else if (img && typeof img === "object" && ("id" in img || "mediaId" in img)) {
        const rawId = img.id !== undefined ? img.id : img.mediaId;
        const idVal = Number(rawId);
        if (!Number.isInteger(idVal) || idVal <= 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid image media ID. Must be a positive integer.",
          });
        }
        imgList.push({ id: idVal });
      } else {
        const src = typeof img === "string" ? img : (img?.src || img?.url);
        if (src) {
          const isSafe = await isSafeExternalImageUrl(src);
          if (!isSafe) {
            return res.status(400).json({
              success: false,
              message: "Invalid or restricted image URL. Localhost and private network addresses are blocked.",
            });
          }
          imgList.push({ src });
        }
      }
    }

    const payload = {
      name: name.trim(),
      type: "simple",
      regular_price: String(regular_price),
      sale_price: sale_price ? String(sale_price) : "",
      description: description || "",
      short_description: short_description || "",
      manage_stock: true,
      stock_quantity: finalStock,
      stock_status: finalStock <= 0 ? "outofstock" : "instock",
      categories: categoryAssignment.ids.map((id) => ({ id })),
      images: imgList,
    };

    if (sku && String(sku).trim()) {
      payload.sku = String(sku).trim();
    }

    const response = await api.post("products", payload);

    await invalidateInventoryCaches();

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


    res.status(201).json({
      success: true,
      message: "Product created successfully.",
      product: transformMediaUrls(createdProduct, req),
    });
  } catch (error) {
    logError(req, error, "Create product error");
    const safeError = sanitizeUpstreamError(error, "Failed to create product.");
    res.status(safeError.status).json(safeError.payload);
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
    const safeError = sanitizeUpstreamError(error, "Failed to run orphan media cleanup.");
    res.status(safeError.status).json(safeError.payload);
  }
};
