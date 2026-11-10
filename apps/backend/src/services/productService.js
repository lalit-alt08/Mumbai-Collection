import api from "../config/woocommerce.js";
import wp from "./wordpress.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import { decodeHtmlEntities } from "../utils/textUtils.js";
import { searchIndexService } from "./searchIndexService.js";

const CATALOG_PRODUCT_FIELDS =
  "id,name,slug,price,regular_price,sale_price,on_sale,images,categories,stock_status,stock_quantity,manage_stock,backorders_allowed,average_rating,rating_count";
const CROSS_SELL_PRODUCT_FIELDS = `${CATALOG_PRODUCT_FIELDS},cross_sell_ids`;
const SELECTED_PRODUCT_FIELDS =
  `${CATALOG_PRODUCT_FIELDS},type,attributes,variations,cross_sell_ids`;

const SEARCH_STOP_WORDS = new Set(["a", "an", "and", "for", "in", "of", "the", "to", "with"]);

const normalizeSearchText = (value = "") => String(value)
  .replace(/<[^>]*>/g, " ")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

// Treat the common connector spellings as one concept without requiring
// merchants to add search keywords to individual products.
const normalizeSearchField = (value = "") => normalizeSearchText(value)
  .replace(/\b(?:usb )?type c\b/g, "typec")
  .replace(/\busb c\b/g, "typec");

const getSearchTerms = (query) => [...new Set(normalizeSearchField(query)
  .split(" ")
  .filter((term) => term.length > 1 && !SEARCH_STOP_WORDS.has(term)))].slice(0, 4);

// WooCommerce candidate retrieval still uses its own text search. Keep a
// separate, non-canonical token list for that query so "type-c" can expand to
// the useful candidate terms "type" and "cable" while ranking uses "typec".
const getCandidateSearchTerms = (query) => [...new Set(normalizeSearchText(query)
  .split(" ")
  .filter((term) => term.length > 1 && !SEARCH_STOP_WORDS.has(term)))].slice(0, 4);

const getProductAttributeText = (attributes = []) => (Array.isArray(attributes) ? attributes : [])
  .map((attribute) => [attribute?.name, ...(Array.isArray(attribute?.options) ? attribute.options : [])]
    .filter(Boolean)
    .join(" "))
  .join(" ");

const matchesSearchTerm = (term, words, allowPrefix) => words.some((word) =>
  word === term ||
  (term.length > 3 && word === `${term}s`) ||
  (term.length > 3 && word.endsWith("ies") && `${word.slice(0, -3)}y` === term) ||
  (allowPrefix && term.length >= 3 && word.startsWith(term))
);

const scoreSearchProduct = (product, query, terms) => {
  const name = normalizeSearchField(product?.name);
  const sku = normalizeSearchField(product?.sku);
  const categories = normalizeSearchField((product?.categories || [])
    .map((category) => category?.name)
    .join(" "));
  const attributes = normalizeSearchField(getProductAttributeText(product?.attributes));
  const shortDescription = normalizeSearchField(product?.short_description);
  const nameWords = name.split(" ").filter(Boolean);
  const skuWords = sku.split(" ").filter(Boolean);
  const categoryWords = categories.split(" ").filter(Boolean);
  const attributeWords = attributes.split(" ").filter(Boolean);
  const descriptionWords = shortDescription.split(" ").filter(Boolean);
  const lastTermIndex = terms.length - 1;
  const matchingTerms = (words) => terms.filter((term, index) =>
    matchesSearchTerm(term, words, index === lastTermIndex)
  );
  const nameMatches = matchingTerms(nameWords);
  const skuMatches = matchingTerms(skuWords);
  const categoryMatches = matchingTerms(categoryWords);
  const attributeMatches = matchingTerms(attributeWords);
  const descriptionMatches = matchingTerms(descriptionWords);
  const primaryMatches = new Set([...nameMatches, ...skuMatches, ...attributeMatches]);
  const allMatchedTerms = new Set([
    ...primaryMatches,
    ...categoryMatches,
    ...descriptionMatches,
  ]);
  const normalizedQuery = normalizeSearchField(query);
  const exactPhrase = normalizedQuery.length > 0 && name.includes(normalizedQuery);
  const startsWithQuery = exactPhrase && name.startsWith(normalizedQuery);

  if (terms.length === 0) return { score: 0, strong: false };

  // Avoid returning a product because it happens to contain one generic word
  // from a multi-word query. A category can be a valid match for a single-word
  // search (for example, "cables"), and can complete a multi-word title match.
  const minimumCoverage = terms.length === 1 ? 1 : Math.ceil(terms.length * 0.6);
  const hasPrimaryMatch = primaryMatches.size > 0;
  const hasSingleTermCategoryMatch = terms.length === 1 && categoryMatches.length > 0;
  if (
    allMatchedTerms.size < minimumCoverage ||
    (!hasPrimaryMatch && !hasSingleTermCategoryMatch)
  ) {
    return { score: 0, strong: false };
  }

  const titleCoverage = nameMatches.length / terms.length;
  const skuCoverage = skuMatches.length / terms.length;
  const attributeCoverage = attributeMatches.length / terms.length;
  const categoryCoverage = categoryMatches.length / terms.length;
  const descriptionCoverage = descriptionMatches.length / terms.length;
  const allPrimaryTermsMatch = terms.every((term) => primaryMatches.has(term));

  // Product title is the main relevance signal. SKU and attributes help when
  // they describe the requested item; category is a smaller tie-breaker.
  const score = (exactPhrase ? 1000 : 0) +
    (startsWithQuery ? 120 : 0) +
    titleCoverage * 240 +
    skuCoverage * 170 +
    attributeCoverage * 100 +
    categoryCoverage * 35 +
    descriptionCoverage * 20;

  return {
    score,
    strong: exactPhrase || allPrimaryTermsMatch,
  };
};

const withoutSearchOnlyFields = (product) => {
  const { sku, attributes, short_description, ...publicProduct } = product;
  return publicProduct;
};

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

export const fetchProductsByIds = async (rawIds = [], detailMode = "catalog") => {
  const ids = [...new Set(rawIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 12);
  if (ids.length === 0) return [];

  const fields = detailMode === "selection"
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
  let targetCategory = categoryId;
  if (targetCategory && isNaN(Number(targetCategory))) {
    const slugKey = `category:slug_to_id:${String(targetCategory).trim().toLowerCase()}`;
    const cachedId = serverCache.get(slugKey);
    if (cachedId) {
      targetCategory = cachedId;
    } else {
      try {
        const catRes = await api.get("products/categories", {
          slug: targetCategory,
          _fields: "id,slug",
        });
        if (Array.isArray(catRes.data) && catRes.data.length > 0 && catRes.data[0].id) {
          targetCategory = catRes.data[0].id;
          serverCache.set(slugKey, targetCategory, 86400000);
        }
      } catch (err) {
        logger.warn({ categoryId: targetCategory, err: err.message }, "Category slug resolution failed for related products");
      }
    }
  }

  const queryParams = {
    status: "publish",
    per_page: 10,
    _fields: CATALOG_PRODUCT_FIELDS,
  };
  if (targetCategory) queryParams.category = targetCategory;
  if (currentProductId) queryParams.exclude = currentProductId;

  let related = [];
  try {
    const response = await api.get("products", queryParams);
    if (Array.isArray(response.data)) {
      related = response.data;
    }
  } catch (err) {
    logger.warn({ err: err.message }, "Primary related products query failed");
  }

  // If the category returned fewer than 6 items (e.g. solitary product or low catalog depth),
  // supplement with other published store products so recommendations are never empty.
  if (related.length < 6) {
    try {
      const fallbackParams = {
        status: "publish",
        per_page: 12,
        _fields: CATALOG_PRODUCT_FIELDS,
      };
      if (currentProductId) fallbackParams.exclude = currentProductId;
      const fallbackRes = await api.get("products", fallbackParams);
      if (Array.isArray(fallbackRes.data)) {
        const existingIds = new Set(related.map((p) => Number(p.id)));
        for (const item of fallbackRes.data) {
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
    const result = await searchIndexService.search(search, {
      page: pageNum,
      per_page: perPageNum,
    });
    return {
      products: result.products.map(withoutSearchOnlyFields),
      total: result.total,
      totalPages: result.totalPages,
      page: result.page,
      per_page: result.per_page,
    };
  } catch (indexError) {
    // SEARCH_PAGE_RECONCILING is a structured 503: do not swallow it into the PHP fallback
    if (indexError?.code === "SEARCH_PAGE_RECONCILING") {
      throw indexError;
    }

    logger.warn(
      { err: indexError?.message, search },
      "[productService] Authoritative searchIndexService unavailable; using fallback"
    );

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
        products.sort((a, b) =>
          (order.get(Number(a.id)) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(Number(b.id)) ?? Number.MAX_SAFE_INTEGER)
        );
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
  { page = 1, per_page = 20, sort = "default", price_range = "all", in_stock = "0", suggestions = false } = {}
) => {
  let targetCategory = categoryId;

  // If a slug was passed (e.g. "art", "toys", "playstation"), resolve its numeric category ID
  if (isNaN(Number(categoryId))) {
    const slugKey = `category:slug_to_id:${String(categoryId).trim().toLowerCase()}`;
    const cachedId = serverCache.get(slugKey);
    if (cachedId) {
      targetCategory = cachedId;
    } else {
      const catRes = await api.get("products/categories", {
        slug: String(categoryId).trim(),
        _fields: "id,slug",
      });
      if (!Array.isArray(catRes.data)) {
        throw new Error("Invalid WooCommerce category slug response");
      }
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

  const sortOptions = {
    "price-asc": { orderby: "price", order: "asc" },
    "price-desc": { orderby: "price", order: "desc" },
    rating: { orderby: "rating", order: "desc" },
    newest: { orderby: "date", order: "desc" },
  };
  const priceOptions = {
    "under-500": { max_price: "499.99" },
    "500-1000": { min_price: "500", max_price: "1000" },
    "1000-2000": { min_price: "1000", max_price: "2000" },
    "above-2000": { min_price: "2000.01" },
  };
  const response = await api.get("products", {
    status: "publish",
    mumbai_catalog_only: "1",
    category: targetCategory,
    page: Number(page) || 1,
    per_page: Number(per_page) || 20,
    _fields: suggestions ? `${CATALOG_PRODUCT_FIELDS},catalog_visibility` : CATALOG_PRODUCT_FIELDS,
    ...(sortOptions[sort] || {}),
    ...(priceOptions[price_range] || {}),
    ...(in_stock === "1" ? { stock_status: "instock" } : {}),
  }, suggestions ? { timeout: 5000 } : {});

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce category products response");
  }

  const rawTotal = response.headers?.["x-wp-total"];
  const totalConfirmed = rawTotal !== undefined && /^\d+$/.test(String(rawTotal));
  if (!totalConfirmed && (price_range !== "all" || in_stock === "1" || sort !== "default")) {
    throw new Error("WooCommerce did not return a valid filtered product count");
  }
  const total = totalConfirmed ? Number(rawTotal) : response.data.length;
  const totalPages =
    parseInt(response.headers?.["x-wp-totalpages"], 10) ||
    (response.data.length > 0 ? 1 : 0);

  return {
    products: suggestions ? response.data.filter((product) => ["visible", "catalog"].includes(product.catalog_visibility)) : response.data,
    total,
    totalPages,
    page: Number(page) || 1,
    per_page: Number(per_page) || 20,
    category_id: targetCategory,
    total_confirmed: totalConfirmed,
  };
};

export const fetchAllProductCategories = async ({ fields } = {}) => {
  const perPage = 100;
  // Keep category pagination below the shared WooCommerce agent socket ceiling,
  // even when other catalog and checkout traffic is active.
  const BATCH_CONCURRENCY = 3;
  const MAX_PAGE_SAFETY_LIMIT = 100; // safety ceiling: max 10,000 categories

  // 1. Fetch first page to inspect total pages header
  const firstResponse = await api.get("products/categories", {
    page: 1,
    per_page: perPage,
    hide_empty: false,
    ...(fields ? { _fields: fields } : {}),
  });

  if (!Array.isArray(firstResponse.data)) {
    throw new Error("Invalid WooCommerce categories response");
  }

  const allCategories = [...firstResponse.data];

  // If first page returned fewer than perPage items, catalog pagination is complete
  if (firstResponse.data.length < perPage) {
    return allCategories;
  }

  const reportedPages = Number.parseInt(firstResponse.headers?.["x-wp-totalpages"], 10);

  // 2. Fetch remaining pages concurrently
  if (Number.isFinite(reportedPages) && reportedPages > 1) {
    // Mode A: Total pages header present from WooCommerce
    const remainingPages = [];
    for (let p = 2; p <= Math.min(reportedPages, MAX_PAGE_SAFETY_LIMIT); p++) {
      remainingPages.push(p);
    }

    for (let i = 0; i < remainingPages.length; i += BATCH_CONCURRENCY) {
      const pageBatch = remainingPages.slice(i, i + BATCH_CONCURRENCY);
      const responses = await Promise.all(
        pageBatch.map((p) =>
          api.get("products/categories", {
            page: p,
            per_page: perPage,
            hide_empty: false,
            ...(fields ? { _fields: fields } : {}),
          })
        )
      );

      for (const res of responses) {
        if (Array.isArray(res.data)) {
          allCategories.push(...res.data);
        }
      }
    }
  } else {
    // Mode B: Reverse proxy/CDN stripped x-wp-totalpages.
    // Fetch in bounded concurrent batches until a page returns fewer than perPage items.
    let currentPage = 2;
    let hasMore = true;

    while (hasMore && currentPage <= MAX_PAGE_SAFETY_LIMIT) {
      const pageBatch = [];
      for (let i = 0; i < BATCH_CONCURRENCY && (currentPage + i) <= MAX_PAGE_SAFETY_LIMIT; i++) {
        pageBatch.push(currentPage + i);
      }

      const settledResults = await Promise.allSettled(
        pageBatch.map((p) =>
          api.get("products/categories", {
            page: p,
            per_page: perPage,
            hide_empty: false,
            ...(fields ? { _fields: fields } : {}),
          })
        )
      );

      for (let i = 0; i < settledResults.length; i++) {
        const res = settledResults[i];
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

          // WooCommerce returns 400 (rest_post_invalid_page_number) when requested page exceeds total available pages
          const isInvalidPage =
            status === 400 &&
            (errorCode === "rest_post_invalid_page_number" ||
              /invalid page number|larger than the maximum/i.test(errorMsg));

          if (isInvalidPage) {
            hasMore = false;
            break;
          }

          // Legitimate network/server errors must propagate
          throw error;
        }
      }

      currentPage += pageBatch.length;
    }
  }

  return allCategories;
};

export const fetchCategories = async () => {
  const categories = await fetchAllProductCategories({
    fields: "id,name,slug,parent,count,menu_order,image",
  });

  // Sort by menu_order ascending (new categories with menu_order 0 or unassigned appear at the end)
  const sorted = [...categories].sort((a, b) => {
    const orderA = typeof a.menu_order === "number" && a.menu_order > 0 ? a.menu_order : 9999;
    const orderB = typeof b.menu_order === "number" && b.menu_order > 0 ? b.menu_order : 9999;
    if (orderA !== orderB) return orderA - orderB;
    return a.id - b.id;
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
