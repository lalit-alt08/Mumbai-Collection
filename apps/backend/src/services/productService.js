import api from "../config/woocommerce.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";

const CATALOG_PRODUCT_FIELDS =
  "id,name,slug,price,regular_price,sale_price,on_sale,images,categories,stock_status,stock_quantity,manage_stock,backorders_allowed,average_rating,rating_count";

const SEARCH_STOP_WORDS = new Set(["a", "an", "and", "for", "in", "of", "the", "to", "with"]);

const normalizeSearchText = (value = "") => String(value)
  .replace(/<[^>]*>/g, " ")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const getSearchTerms = (query) => [...new Set(normalizeSearchText(query)
  .split(" ")
  .filter((term) => term.length > 1 && !SEARCH_STOP_WORDS.has(term)))].slice(0, 4);

const scoreSearchProduct = (product, query, terms) => {
  const name = normalizeSearchText(product?.name);
  const sku = normalizeSearchText(product?.sku);
  const categories = normalizeSearchText((product?.categories || []).map((category) => category?.name).join(" "));
  const nameWords = new Set(name.split(" "));
  const skuWords = new Set(sku.split(" "));
  const categoryWords = new Set(categories.split(" "));
  const nameMatches = terms.filter((term) => nameWords.has(term)).length;
  const skuMatches = terms.filter((term) => skuWords.has(term)).length;
  const categoryMatches = terms.filter((term) => categoryWords.has(term)).length;
  const normalizedQuery = normalizeSearchText(query);
  const exactPhrase = normalizedQuery.length > 0 && name.includes(normalizedQuery);
  const primaryMatches = terms.filter((term) => nameWords.has(term) || skuWords.has(term)).length;

  if (terms.length === 0 || primaryMatches === 0) return { score: 0, strong: false };

  const score = (exactPhrase ? 1000 : 0) +
    (nameMatches / terms.length) * 100 +
    (skuMatches / terms.length) * 70 +
    (categoryMatches / terms.length) * 15;

  return {
    score,
    strong: exactPhrase || primaryMatches === terms.length,
  };
};

const withoutSearchOnlyFields = (product) => {
  const { sku, ...publicProduct } = product;
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

  const response = await api.get("products", queryParams);

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce related products response");
  }

  return response.data;
};

export const searchProducts = async (search, { page = 1, per_page = 20 } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const perPageNum = Math.min(100, Math.max(1, Number(per_page) || 20));
  const terms = getSearchTerms(search);
  const response = await api.get("products", {
    status: "publish",
    search,
    page: pageNum,
    per_page: perPageNum,
    _fields: `${CATALOG_PRODUCT_FIELDS},sku`,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce search response");
  }
  const ranked = response.data
    .map((product) => ({ product, ...scoreSearchProduct(product, search, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.product.id) - Number(b.product.id));

  // WooCommerce searches titles, descriptions and other fields without a useful
  // storefront relevance order. If it found no strong name/SKU match, expand
  // only over the query's meaningful words and discard unrelated matches.
  let relevant = ranked;
  if (terms.length > 1 && !ranked.some((item) => item.strong)) {
    const normalizedQuery = normalizeSearchText(search);
    const fallbackCandidates = await serverCache.getOrFetch(
      `catalog:search:fallback:${normalizedQuery}`,
      async () => {
        const tokenResponses = await Promise.allSettled(terms.map((term) => api.get("products", {
          status: "publish",
          search: term,
          page: 1,
          per_page: 100,
          _fields: `${CATALOG_PRODUCT_FIELDS},sku`,
        })));
        const candidates = new Map(ranked.map((item) => [Number(item.product.id), item.product]));
        for (const tokenResponse of tokenResponses) {
          if (tokenResponse.status !== "fulfilled" || !Array.isArray(tokenResponse.value.data)) continue;
          for (const product of tokenResponse.value.data) {
            if (product?.id) candidates.set(Number(product.id), product);
          }
        }
        return [...candidates.values()];
      },
      120000
    );
    relevant = fallbackCandidates
      .map((product) => ({ product, ...scoreSearchProduct(product, search, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.product.id) - Number(b.product.id));
  }

  const total = Number.parseInt(response.headers?.["x-wp-total"], 10);
  const totalPages = Number.parseInt(response.headers?.["x-wp-totalpages"], 10);
  const usesExpandedCandidates = relevant !== ranked;
  const products = usesExpandedCandidates
    ? relevant.slice((pageNum - 1) * perPageNum, pageNum * perPageNum)
    : relevant.map((item) => item.product);
  const resultTotal = usesExpandedCandidates
    ? relevant.length
    : Number.isFinite(total) ? total : response.data.length;
  const resultTotalPages = usesExpandedCandidates
    ? Math.ceil(relevant.length / perPageNum)
    : Number.isFinite(totalPages)
      ? totalPages
      : (response.data.length === perPageNum ? pageNum + 1 : pageNum);

  return {
    products: products.map(withoutSearchOnlyFields),
    total: resultTotal,
    totalPages: resultTotalPages,
    page: pageNum,
    per_page: perPageNum,
  };
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

export const fetchAllProductCategories = async ({ fields } = {}) => {
  const allCategories = [];
  let page = 1;
  let totalPages = null;
  const perPage = 100;

  while (page <= (totalPages ?? Number.MAX_SAFE_INTEGER)) {
    if (page > 1000) {
      throw new Error("WooCommerce category pagination exceeded the safety limit");
    }

    const response = await api.get("products/categories", {
      page,
      per_page: perPage,
      hide_empty: false,
      ...(fields ? { _fields: fields } : {}),
    });

    if (!Array.isArray(response.data)) {
      throw new Error("Invalid WooCommerce categories response");
    }

    allCategories.push(...response.data);
    const reportedPages = Number.parseInt(response.headers?.["x-wp-totalpages"], 10);
    totalPages = Number.isFinite(reportedPages) && reportedPages > 0
      ? reportedPages
      : (response.data.length < perPage ? page : page + 1);

    if (response.data.length === 0) break;
    page += 1;
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
    name: c.name,
    slug: c.slug,
    parent: typeof c.parent === "number" ? c.parent : 0,
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
