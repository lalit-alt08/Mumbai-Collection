import api from "../config/woocommerce.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";

const CATALOG_PRODUCT_FIELDS =
  "id,name,slug,price,regular_price,sale_price,on_sale,images,categories,stock_status,stock_quantity,manage_stock,backorders_allowed,average_rating,rating_count";

export const fetchProducts = async (page = 1, per_page = 50) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const perPageNum = Math.min(100, Math.max(1, Number(per_page) || 50));
  const response = await api.get("products", {
    status: "publish",
    page: pageNum,
    per_page: perPageNum,
    _fields: CATALOG_PRODUCT_FIELDS,
  });

  if (!Array.isArray(response.data)) {
    logger.error("Unexpected WooCommerce products response structure");

    throw new Error("Invalid WooCommerce products response");
  }

  const total = parseInt(response.headers?.["x-wp-total"], 10) || response.data.length;
  const totalPages =
    parseInt(response.headers?.["x-wp-totalpages"], 10) ||
    (response.data.length > 0 ? 1 : 0);

  return {
    products: response.data,
    total,
    totalPages,
    page: pageNum,
    per_page: perPageNum,
  };
};

export const fetchProductById = async (id) => {
  const response = await api.get(`products/${id}`);

  if (!response.data || typeof response.data !== "object") {
    throw new Error("Invalid WooCommerce product response");
  }

  const product = response.data;
  if (
    (product.status && product.status !== "publish") ||
    product.catalog_visibility === "hidden"
  ) {
    const error = new Error("Product not found");
    error.status = 404;
    error.code = "PRODUCT_NOT_FOUND";
    throw error;
  }

  return product;
};

export const fetchProductsByIds = async (rawIds = []) => {
  const ids = [...new Set(rawIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 12);
  if (ids.length === 0) return [];

  const response = await api.get("products", {
    status: "publish",
    include: ids.join(","),
    orderby: "include",
    per_page: ids.length,
    _fields: CATALOG_PRODUCT_FIELDS,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce selected-products response");
  }

  return response.data.filter((product) =>
    product &&
    (!product.status || product.status === "publish") &&
    product.catalog_visibility !== "hidden"
  );
};

export const fetchProductStockByIds = async (rawIds = []) => {
  const ids = [...new Set(rawIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 100);
  if (ids.length === 0) return [];

  const response = await api.get("products", {
    status: "publish",
    include: ids.join(","),
    orderby: "include",
    per_page: ids.length,
    _fields: "id,manage_stock,stock_quantity,stock_status,backorders_allowed",
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce product stock response");
  }

  return response.data;
};

export const fetchRelatedProducts = async (
  categoryId,
  currentProductId
) => {
  const response = await api.get("products", {
    status: "publish",
    category: categoryId,
    exclude: currentProductId,
    per_page: 10,
    _fields: CATALOG_PRODUCT_FIELDS,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce related products response");
  }

  return response.data;
};

export const searchProducts = async (search) => {
  const response = await api.get("products", {
    status: "publish",
    search,
    per_page: 20,
    _fields: CATALOG_PRODUCT_FIELDS,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce search response");
  }
  return response.data;
};

export const fetchProductsByCategory = async (
  categoryId,
  { page = 1, per_page = 20 } = {}
) => {
  let targetCategory = categoryId;

  // If a slug was passed (e.g. "art", "toys", "playstation"), resolve its numeric category ID
  if (isNaN(Number(categoryId))) {
    const slugKey = `category:slug_to_id:${String(categoryId).trim().toLowerCase()}`;
    const cachedId = serverCache.get(slugKey);
    if (cachedId) {
      targetCategory = cachedId;
    } else {
      try {
        const catRes = await api.get("products/categories", {
          slug: categoryId,
          _fields: "id,slug",
        });
        if (Array.isArray(catRes.data) && catRes.data.length > 0 && catRes.data[0].id) {
          targetCategory = catRes.data[0].id;
          serverCache.set(slugKey, targetCategory, 86400000); // 24 hours TTL
        }
      } catch (err) {
        logger.warn({ categoryId, err: err.message }, "Category slug resolution failed");
      }
    }
  }

  const response = await api.get("products", {
    status: "publish",
    category: targetCategory,
    page: Number(page) || 1,
    per_page: Number(per_page) || 20,
    _fields: CATALOG_PRODUCT_FIELDS,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce category products response");
  }

  const total = parseInt(response.headers?.["x-wp-total"], 10) || response.data.length;
  const totalPages =
    parseInt(response.headers?.["x-wp-totalpages"], 10) ||
    (response.data.length > 0 ? 1 : 0);

  return {
    products: response.data,
    total,
    totalPages,
    page: Number(page) || 1,
    per_page: Number(per_page) || 20,
  };
};

export const fetchCategories = async () => {
  const response = await api.get("products/categories", {
    per_page: 100,
    hide_empty: false,
    _fields: "id,name,slug,count,menu_order,image",
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce categories response");
  }

  // Sort by menu_order ascending (new categories with menu_order 0 or unassigned appear at the end)
  const sorted = [...response.data].sort((a, b) => {
    const orderA = typeof a.menu_order === "number" && a.menu_order > 0 ? a.menu_order : 9999;
    const orderB = typeof b.menu_order === "number" && b.menu_order > 0 ? b.menu_order : 9999;
    if (orderA !== orderB) return orderA - orderB;
    return a.id - b.id;
  });

  return sorted.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
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
};
