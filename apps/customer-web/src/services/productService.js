import axios from "axios";
import API_URL from "../config/api.js";
import { attachStaleConnectionRetry } from "../utils/resilientAxios.js";
import safeStorage from "../utils/safeStorage.js";

let catalogClient = axios.create({
  baseURL: API_URL,
  timeout: 20000,
});
attachStaleConnectionRetry(catalogClient);

export const _setCatalogClientForTesting = (mock) => {
  catalogClient = mock;
};

const CATEGORY_CACHE_STORAGE_KEY = "catalog_categories_v1";
const CATEGORY_CACHE_STORAGE_TTL_MS = 6 * 60 * 60 * 1000;

const readPersistedCategories = () => {
  const cached = safeStorage.getJSON(CATEGORY_CACHE_STORAGE_KEY, null);
  if (
    !cached ||
    cached.version !== 1 ||
    !Array.isArray(cached.categories) ||
    cached.categories.length === 0 ||
    !Number.isFinite(Number(cached.cachedAt)) ||
    Date.now() - Number(cached.cachedAt) > CATEGORY_CACHE_STORAGE_TTL_MS
  ) {
    safeStorage.removeItem(CATEGORY_CACHE_STORAGE_KEY);
    return null;
  }
  return cached.categories;
};

let latestCategoryRequestId = 0;
let latestCommittedCategoryRequestId = 0;

const storeCategories = (categories, requestId) => {
  if (!Array.isArray(categories) || categories.length === 0) return false;
  if (!Number.isFinite(requestId) || requestId < latestCommittedCategoryRequestId) return false;
  latestCommittedCategoryRequestId = requestId;
  cachedCategories = categories;
  safeStorage.setJSON(CATEGORY_CACHE_STORAGE_KEY, {
    version: 1,
    cachedAt: Date.now(),
    categories,
  });
  return true;
};

let cachedCategories = readPersistedCategories();
let categoriesRequest = null;

export const getCachedCategories = () => cachedCategories;

export const _setCachedCategoriesForTesting = (cats) => {
  cachedCategories = cats;
};

export const _resetCategoryCacheForTesting = () => {
  cachedCategories = readPersistedCategories();
  categoriesRequest = null;
  latestCategoryRequestId = 0;
  latestCommittedCategoryRequestId = 0;
};

export const getProducts = async (params = {}, options = {}) => {
  const response = await catalogClient.get("/products", { ...options, params });
  return response.data;
};

export const getProductById = async (id, { signal } = {}) => {
  const response = await catalogClient.get(`/products/${id}`, {
    signal,
  });
  return response.data;
};

export const getProductsByIds = async (ids = [], { signal, details } = {}) => {
  const productIds = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (productIds.length === 0) return [];

  const batches = [];
  for (let index = 0; index < productIds.length; index += 12) {
    batches.push(productIds.slice(index, index + 12));
  }

  const results = new Array(batches.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < batches.length) {
      const index = nextIndex++;
      const response = await catalogClient.get("/products/by-ids", {
        params: {
          ids: batches[index].join(","),
          ...(details ? { details } : {}),
        },
        signal,
      });
      results[index] = Array.isArray(response.data) ? response.data : [];
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(2, batches.length) }, () => worker())
  );

  const products = results.flat();
  const order = new Map(productIds.map((id, index) => [id, index]));
  return products.sort(
    (a, b) => (order.get(Number(a.id)) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(Number(b.id)) ?? Number.MAX_SAFE_INTEGER)
  );
};

export const getLiveProductStockByIds = async (ids = [], { signal } = {}) => {
  const productIds = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (productIds.length === 0) return [];
  const batches = [];
  for (let index = 0; index < productIds.length; index += 100) {
    batches.push(productIds.slice(index, index + 100));
  }
  const responses = new Array(batches.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < batches.length) {
      const index = nextIndex++;
      responses[index] = await catalogClient.get("/products/stock", {
        params: { ids: batches[index].join(",") },
        signal,
        // Stock polling is background UX data. If WooCommerce is slow, let the
        // next scheduled refresh try again instead of immediately doubling load.
        skipTimeoutRetry: true,
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(2, batches.length) }, () => worker())
  );
  return responses.flatMap((response) => Array.isArray(response?.data) ? response.data : []);
};

export const getRelatedProducts = async (
  categoryId,
  currentProductId,
  options = {}
) => {
  const response = await catalogClient.get(
    "/products/related",
    {
      ...options,
      params: {
        categoryId,
        currentProductId,
      },
    }
  );

  return response.data;
};

export const searchProducts = async (query, options = {}) => {
  const response = await catalogClient.get("/products/search", {
    params: {
      q: query,
      page: options.page || 1,
      per_page: options.perPage || 20,
    },
    signal: options.signal,
  });

  return response.data;
};

export const getProductsByCategory = async (categoryId, params = {}, options = {}) => {
  const { page, per_page, limit, sort, price_range, in_stock } = params;
  const query = { ...(page && { page }), ...((per_page || limit) && { per_page: per_page || limit }),
    ...(sort && sort !== "default" && { sort }), ...(price_range && price_range !== "all" && { price_range }),
    ...((in_stock === true || in_stock === "1") && { in_stock: "1" }) };
  const response = await catalogClient.get(
    `/products/category/${categoryId}`,
    { ...options, params: query }
  );

  return response.data;
};

export const getCategories = async (options = {}) => {
  const { bypassDedup = false, forceFresh = false, ...clientOptions } = options;
  const shouldBypass = Boolean(bypassDedup || forceFresh);
  if (!shouldBypass && !clientOptions.signal && categoriesRequest) return categoriesRequest;

  const requestId = ++latestCategoryRequestId;

  const request = catalogClient.get("/products/categories", { timeout: 25000, ...clientOptions })
    .then((response) => {
      storeCategories(response.data, requestId);
      return response.data;
    });

  if (clientOptions.signal) return request;

  const trackedRequest = request.finally(() => {
    if (categoriesRequest === trackedRequest) categoriesRequest = null;
  });
  categoriesRequest = trackedRequest;
  return trackedRequest;
};

/**
 * Explicit Stale-While-Revalidate (SWR) category accessor.
 * 1. Synchronously returns cached categories from in-memory cache / localStorage.
 * 2. Asynchronously launches a background revalidation network request via getCategories().
 * 3. Invokes onFreshData(freshCategories) if provided once background network request succeeds,
 *    guarded against out-of-order race conditions so only committed data is passed to UI.
 *
 * @param {Function} [onFreshData] - Optional callback invoked when background revalidation succeeds
 * @param {Object} [options] - Options passed to getCategories() (e.g. { signal, bypassDedup, forceFresh })
 * @returns {Array|null} Immediately available cached categories or null
 */
export const getCategoriesSWR = (onFreshData, options = {}) => {
  const cached = getCachedCategories();
  void getCategories(options)
    .then((fresh) => {
      if (
        typeof onFreshData === "function" &&
        Array.isArray(fresh) &&
        fresh.length > 0 &&
        cachedCategories === fresh
      ) {
        onFreshData(fresh);
      }
    })
    .catch((err) => {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[productService] Background category SWR revalidation failed:", err?.message);
      }
    });
  return cached;
};

export const getHomeShelves = async ({ page = 1, offset, ...options } = {}) => {
  const hasOffset = Number.isInteger(Number(offset)) && Number(offset) >= 0;
  const response = await catalogClient.get("/products/home-shelves", {
    timeout: 25000,
    skipTimeoutRetry: true,
    ...options,
    // Keep page 1 backward-compatible with older deployed API versions that
    // accepted no query parameters on this endpoint.
    ...(page > 1 || hasOffset
      ? {
          params: {
            ...(options.params || {}),
            ...(page > 1 ? { page } : {}),
            ...(hasOffset ? { offset: Number(offset) } : {}),
          },
        }
      : {}),
  });
  return response.data;
};

let bannersInFlight = null;
let bannersCachedData = null;
let bannersCachedTimestamp = 0;
let latestRequestSeq = 0;
let latestCompletedSeq = 0;
const BANNERS_CACHE_TTL_MS = 60_000;

export const getBanners = async (options = {}) => {
  const force = options?.force === true;
  if (!force && bannersCachedData && (Date.now() - bannersCachedTimestamp < BANNERS_CACHE_TTL_MS)) {
    return bannersCachedData;
  }

  // Coalesce all concurrent calls (including concurrent forced refreshes) into one single in-flight Promise
  if (bannersInFlight) {
    return bannersInFlight;
  }

  const reqSeq = ++latestRequestSeq;
  const reqOptions = force
    ? {
        ...options,
        params: {
          ...(options?.params || {}),
          _t: Date.now(),
          force: "true",
        },
      }
    : options;

  bannersInFlight = catalogClient
    .get("/banners", reqOptions)
    .then((response) => {
      // Sequence guard: prevent a delayed older response from overwriting a newer completed response
      if (reqSeq >= latestCompletedSeq) {
        latestCompletedSeq = reqSeq;
        const hasBanners = Array.isArray(response.data?.banners) && response.data.banners.length > 0;
        const hasThin = Boolean(response.data?.thin_banner);
        // Full TTL for populated banner data; 5s TTL for empty/degraded responses to allow fast recovery
        bannersCachedData = response.data;
        bannersCachedTimestamp = (hasBanners || hasThin)
          ? Date.now()
          : (Date.now() - BANNERS_CACHE_TTL_MS + 5000);
      }
      return response.data;
    })
    .finally(() => {
      bannersInFlight = null;
    });

  return bannersInFlight;
};
