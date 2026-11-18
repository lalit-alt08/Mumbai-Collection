import api from "../config/woocommerce.js";
import wp from "./wordpress.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import { decodeHtmlEntities } from "../utils/textUtils.js";
import { searchIndexService } from "./searchIndexService.js";

const CATALOG_PRODUCT_FIELDS =
  "id,name,slug,type,price,regular_price,sale_price,on_sale,images,categories,stock_status,stock_quantity,manage_stock,backorders_allowed,average_rating,rating_count,catalog_visibility";
const CROSS_SELL_PRODUCT_FIELDS = `${CATALOG_PRODUCT_FIELDS},cross_sell_ids`;
const SELECTED_PRODUCT_FIELDS = `${CATALOG_PRODUCT_FIELDS},attributes,variations,cross_sell_ids`;

const isPubliclyVisibleProduct = (product) =>
  Boolean(
    product &&
      (!product.status || product.status === "publish") &&
      product.catalog_visibility !== "hidden"
  );

const isCatalogVisibleProduct = (product) =>
  isPubliclyVisibleProduct(product) &&
  (!product.catalog_visibility || ["visible", "catalog"].includes(product.catalog_visibility));

const SORT_OPTIONS = {
  "price-asc": { orderby: "price", order: "asc" },
  "price-desc": { orderby: "price", order: "desc" },
  rating: { orderby: "rating", order: "desc" },
  newest: { orderby: "date", order: "desc" },
};

const PRICE_OPTIONS = {
  "under-500": { max_price: "499.99" },
  "500-1000": { min_price: "500", max_price: "1000" },
  "1000-2000": { min_price: "1000", max_price: "2000" },
  "above-2000": { min_price: "2000.01" },
};

const withoutSearchOnlyFields = ({ sku, attributes, short_description, ...publicProduct }) => publicProduct;

const readNonNegativeIntegerHeader = (headers, name) => {
  const value = headers?.[name];
  if (!/^(0|[1-9]\d*)$/.test(String(value ?? ""))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const assertSafeCatalogPage = (products, removedCount, total) => {
  if (removedCount > 0) {
    throw new Error("WooCommerce returned products outside the requested catalog visibility filter");
  }
  if (total !== null && total < products.length) {
    throw new Error("WooCommerce returned an invalid catalog product total");
  }
};

export const fetchProducts = async (page = 1, per_page = 50) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const perPageNum = Math.min(100, Math.max(1, Number(per_page) || 50));
  const response = await api.get("products", {
    status: "publish",
    mumbai_catalog_only: "1",
    page: pageNum,
    per_page: perPageNum,
    _fields: CATALOG_PRODUCT_FIELDS,
  });

  if (!Array.isArray(response.data)) {
    logger.error("Unexpected WooCommerce products response structure");
    throw new Error("Invalid WooCommerce products response");
  }

  const visibleProducts = response.data.filter(isCatalogVisibleProduct);
  const removedCount = response.data.length - visibleProducts.length;
  const total = readNonNegativeIntegerHeader(response.headers, "x-wp-total");
  assertSafeCatalogPage(response.data, removedCount, total);
  // WooCommerce applies catalog visibility before counting/paging. If that
  // contract is broken, assertSafeCatalogPage fails instead of deriving a
  // misleading store-wide total from the current page.
  const totalPages = total === null
    ? (visibleProducts.length > 0 ? 1 : 0)
    : Math.ceil(total / perPageNum);

  return {
    products: visibleProducts,
    total: total ?? visibleProducts.length,
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
  if ((product.status && product.status !== "publish") || product.catalog_visibility === "hidden") {
    const error = new Error("Product not found");
    error.status = 404;
    error.code = "PRODUCT_NOT_FOUND";
    throw error;
  }
  return product;
};

export const fetchProductsByIds = async (rawIds = [], detailMode = "catalog") => {
  const ids = [...new Set(rawIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 12);
  if (ids.length === 0) return [];

  const fields =
    detailMode === "selection"
      ? SELECTED_PRODUCT_FIELDS
      : detailMode === "cross-sells"
      ? CROSS_SELL_PRODUCT_FIELDS
      : CATALOG_PRODUCT_FIELDS;

  const response = await api.get("products", {
    status: "publish",
    include: ids.join(","),
    orderby: "include",
    per_page: ids.length,
    _fields: fields,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce selected-products response");
  }

  return response.data.filter(
    (product) => product && (!product.status || product.status === "publish") && product.catalog_visibility !== "hidden"
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

export const fetchRelatedProducts = async (categoryId, currentProductId) => {
  let targetCategory = categoryId;
  if (targetCategory && isNaN(Number(targetCategory))) {
    const slugKey = `category:slug_to_id:${String(targetCategory).trim().toLowerCase()}`;
    const cachedId = serverCache.get(slugKey);
    if (cachedId) {
      targetCategory = cachedId;
    } else {
      try {
        const catRes = await api.get("products/categories", { slug: targetCategory, _fields: "id,slug" });
        if (Array.isArray(catRes.data) && catRes.data[0]?.id) {
          targetCategory = catRes.data[0].id;
          serverCache.set(slugKey, targetCategory, 86400000);
        }
      } catch (err) {
        logger.warn({ categoryId: targetCategory, err: err.message }, "Category slug resolution failed for related products");
      }
    }
  }

  const queryParams = { status: "publish", mumbai_catalog_only: "1", per_page: 10, _fields: CATALOG_PRODUCT_FIELDS };
  if (targetCategory) queryParams.category = targetCategory;
  if (currentProductId) queryParams.exclude = currentProductId;

  let related = [];
  try {
    const response = await api.get("products", queryParams);
    if (Array.isArray(response.data)) related = response.data.filter(isCatalogVisibleProduct);
  } catch (err) {
    logger.warn({ err: err.message }, "Primary related products query failed");
  }

  if (related.length < 6) {
    try {
      const fallbackParams = { status: "publish", mumbai_catalog_only: "1", per_page: 12, _fields: CATALOG_PRODUCT_FIELDS };
      if (currentProductId) fallbackParams.exclude = currentProductId;
      const fallbackRes = await api.get("products", fallbackParams);
      if (Array.isArray(fallbackRes.data)) {
        const existingIds = new Set(related.map((p) => Number(p.id)));
        for (const item of fallbackRes.data.filter(isCatalogVisibleProduct)) {
          if (!existingIds.has(Number(item.id)) && Number(item.id) !== Number(currentProductId)) {
            related.push(item);
            existingIds.add(Number(item.id));
            if (related.length >= 10) break;
          }
        }
      }
    } catch (fallbackErr) {
      logger.warn({ err: fallbackErr.message }, "Fallback related products query failed");
    }
  }

  return related;
};

export const searchProducts = async (search, { page = 1, per_page = 20 } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const perPageNum = Math.min(100, Math.max(1, Number(per_page) || 20));

  try {
    const result = await searchIndexService.search(search, { page: pageNum, per_page: perPageNum });
    return {
      products: result.products.map(withoutSearchOnlyFields),
      total: result.total,
      totalPages: result.totalPages,
      page: result.page,
      per_page: result.per_page,
    };
  } catch (indexError) {
    if (indexError?.code === "SEARCH_PAGE_RECONCILING") throw indexError;

    logger.warn({ err: indexError?.message, search }, "[productService] Authoritative searchIndexService unavailable; using fallback");

    try {
      const rankedResponse = await wp.get("/wp-json/mumbai-auth/v1/catalog/search", {
        params: { q: search, page: pageNum, per_page: perPageNum },
      });
      const rankedData = rankedResponse?.data || {};
      const rankedIds = Array.isArray(rankedData.ids)
        ? rankedData.ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
        : [];
      if (rankedData.success === true) {
        if (rankedIds.length === 0) {
          return {
            products: [],
            total: Number(rankedData.total) || 0,
            totalPages: Number(rankedData.totalPages) || 0,
            page: pageNum,
            per_page: perPageNum,
          };
        }
        const hydrated = await api.get("products", {
          status: "publish",
          include: rankedIds.join(","),
          orderby: "include",
          per_page: rankedIds.length,
          _fields: CATALOG_PRODUCT_FIELDS,
        });
        const products = Array.isArray(hydrated.data) ? hydrated.data : [];
        const order = new Map(rankedIds.map((id, index) => [id, index]));
        products.sort((a, b) => (order.get(Number(a.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(Number(b.id)) ?? Number.MAX_SAFE_INTEGER));
        return {
          products: products.map(withoutSearchOnlyFields),
          total: Number(rankedData.total) || products.length,
          totalPages: Number(rankedData.totalPages) || (products.length > 0 ? 1 : 0),
          page: pageNum,
          per_page: perPageNum,
        };
      }
    } catch (wpError) {
      logger.warn({ err: wpError?.message }, "Fallback catalog search also failed");
    }

    throw indexError;
  }
};

export const fetchProductsByCategory = async (
  categoryId,
  { page = 1, per_page = 20, sort = "default", price_range = "all", in_stock = "0", suggestions = false, verifiedCategory = false, timeout } = {}
) => {
  let targetCategory = categoryId;

  if (isNaN(Number(categoryId))) {
    const slugKey = `category:slug_to_id:${String(categoryId).trim().toLowerCase()}`;
    const cachedId = serverCache.get(slugKey);
    if (cachedId) {
      targetCategory = cachedId;
    } else {
      const catRes = await api.get("products/categories", { slug: String(categoryId).trim(), _fields: "id,slug" });
      if (!Array.isArray(catRes.data)) throw new Error("Invalid WooCommerce category slug response");
      if (!catRes.data[0]?.id) {
        const error = new Error("Category not found");
        error.status = 404;
        error.code = "CATEGORY_NOT_FOUND";
        throw error;
      }
      targetCategory = catRes.data[0].id;
      serverCache.set(slugKey, targetCategory, 5 * 60 * 1000);
      serverCache.set(`category:verified_id:${targetCategory}`, true, 5 * 60 * 1000);
    }
  }

  const verifiedKey = `category:verified_id:${targetCategory}`;
  if (!verifiedCategory) {
    await serverCache.getOrFetch(verifiedKey, async () => {
      let category;
      try {
        category = await api.get(`products/categories/${targetCategory}`, { _fields: "id" });
      } catch (error) {
        if (error.response?.status === 404) error.status = 404;
        throw error;
      }
      if (String(category.data?.id) !== String(targetCategory)) {
        throw new Error("Invalid WooCommerce category response");
      }
      return true;
    }, 5 * 60 * 1000);
  }

  const response = await api.get("products", {
    status: "publish",
    mumbai_catalog_only: "1",
    category: targetCategory,
    page: Number(page) || 1,
    per_page: Number(per_page) || 20,
    _fields: CATALOG_PRODUCT_FIELDS,
    ...(SORT_OPTIONS[sort] || {}),
    ...(PRICE_OPTIONS[price_range] || {}),
    ...(in_stock === "1" ? { stock_status: "instock" } : {}),
  }, timeout ? { timeout } : suggestions ? { timeout: 5000 } : {});

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce category products response");
  }

  const rawTotal = readNonNegativeIntegerHeader(response.headers, "x-wp-total");
  const totalConfirmed = rawTotal !== null;
  if (!totalConfirmed && (price_range !== "all" || in_stock === "1" || sort !== "default")) {
    throw new Error("WooCommerce did not return a valid filtered product count");
  }

  const visibleProducts = response.data.filter((p) =>
    suggestions ? isPubliclyVisibleProduct(p) && ["visible", "catalog"].includes(p.catalog_visibility) : isCatalogVisibleProduct(p)
  );
  const removedCount = response.data.length - visibleProducts.length;
  const pageSize = Number(per_page) || 20;
  assertSafeCatalogPage(response.data, removedCount, rawTotal);
  const total = totalConfirmed ? rawTotal : visibleProducts.length;
  const totalPages = totalConfirmed
    ? Math.ceil(total / pageSize)
    : (visibleProducts.length > 0 ? 1 : 0);

  return {
    products: visibleProducts,
    total,
    totalPages,
    page: Number(page) || 1,
    per_page: pageSize,
    category_id: targetCategory,
    total_confirmed: totalConfirmed,
  };
};

export const fetchAllProductCategories = async ({ fields } = {}) => {
  const perPage = 100;
  const BATCH_CONCURRENCY = 3;
  const MAX_PAGE_SAFETY_LIMIT = 100;

  const fetchCatPage = (p) =>
    api.get("products/categories", {
      page: p,
      per_page: perPage,
      hide_empty: false,
      ...(fields ? { _fields: fields } : {}),
    });

  const firstResponse = await fetchCatPage(1);
  if (!Array.isArray(firstResponse.data)) {
    throw new Error("Invalid WooCommerce categories response");
  }

  const allCategories = [...firstResponse.data];
  if (firstResponse.data.length < perPage) return allCategories;

  const reportedPages = Number.parseInt(firstResponse.headers?.["x-wp-totalpages"], 10);

  if (Number.isFinite(reportedPages) && reportedPages > 1) {
    const remainingPages = [];
    for (let p = 2; p <= Math.min(reportedPages, MAX_PAGE_SAFETY_LIMIT); p++) remainingPages.push(p);

    for (let i = 0; i < remainingPages.length; i += BATCH_CONCURRENCY) {
      const responses = await Promise.all(remainingPages.slice(i, i + BATCH_CONCURRENCY).map(fetchCatPage));
      for (const res of responses) {
        if (Array.isArray(res.data)) allCategories.push(...res.data);
      }
    }
  } else {
    let currentPage = 2;
    let hasMore = true;

    while (hasMore && currentPage <= MAX_PAGE_SAFETY_LIMIT) {
      const pageBatch = [];
      for (let i = 0; i < BATCH_CONCURRENCY && (currentPage + i) <= MAX_PAGE_SAFETY_LIMIT; i++) {
        pageBatch.push(currentPage + i);
      }

      const settledResults = await Promise.allSettled(pageBatch.map(fetchCatPage));
      for (const res of settledResults) {
        if (res.status === "fulfilled") {
          const batchData = Array.isArray(res.value?.data) ? res.value.data : [];
          allCategories.push(...batchData);
          if (batchData.length < perPage) {
            hasMore = false;
            break;
          }
        } else {
          const error = res.reason;
          const status = error?.response?.status;
          const errorCode = error?.response?.data?.code;
          const errorMsg = String(error?.response?.data?.message || "");

          if (status === 400 && (errorCode === "rest_post_invalid_page_number" || /invalid page number|larger than the maximum/i.test(errorMsg))) {
            hasMore = false;
            break;
          }
          throw error;
        }
      }
      currentPage += pageBatch.length;
    }
  }

  return allCategories;
};

export const fetchCategories = async () => {
  const categories = await fetchAllProductCategories({ fields: "id,name,slug,parent,count,menu_order,image" });

  const sorted = [...categories].sort((a, b) => {
    const orderA = typeof a.menu_order === "number" && a.menu_order > 0 ? a.menu_order : 9999;
    const orderB = typeof b.menu_order === "number" && b.menu_order > 0 ? b.menu_order : 9999;
    return orderA !== orderB ? orderA - orderB : a.id - b.id;
  });

  return sorted.map((c) => ({
    id: c.id,
    name: decodeHtmlEntities(c.name),
    slug: c.slug,
    parent: typeof c.parent === "number" ? c.parent : 0,
    count: c.count,
    menu_order: c.menu_order || 0,
    image: c.image
      ? {
          id: c.image.id,
          src: c.image.src,
          name: decodeHtmlEntities(c.image.name),
          alt: decodeHtmlEntities(c.image.alt),
        }
      : null,
  }));
};
