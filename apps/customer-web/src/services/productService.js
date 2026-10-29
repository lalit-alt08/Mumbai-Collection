import axios from "axios";
import API_URL from "../config/api.js";
import { attachStaleConnectionRetry } from "../utils/resilientAxios.js";

const catalogClient = axios.create({
  baseURL: API_URL,
  timeout: 12000,
});
attachStaleConnectionRetry(catalogClient);

let cachedCategories = null;
let categoriesRequest = null;

export const getCachedCategories = () => cachedCategories;

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
  const response = await catalogClient.get(
    `/products/category/${categoryId}`,
    { ...options, params }
  );

  return response.data;
};

export const getCategories = async (options = {}) => {
  if (!options.signal && categoriesRequest) return categoriesRequest;

  const request = catalogClient.get("/products/categories", options)
    .then((response) => {
      if (Array.isArray(response.data)) cachedCategories = response.data;
      return response.data;
    });

  if (options.signal) return request;

  const trackedRequest = request.finally(() => {
    if (categoriesRequest === trackedRequest) categoriesRequest = null;
  });
  categoriesRequest = trackedRequest;
  return trackedRequest;
};

export const getHomeShelves = async ({ page = 1, ...options } = {}) => {
  const response = await catalogClient.get("/products/home-shelves", {
    timeout: 25000,
    skipTimeoutRetry: true,
    ...options,
    // Keep page 1 backward-compatible with older deployed API versions that
    // accepted no query parameters on this endpoint.
    ...(page > 1 ? { params: { ...(options.params || {}), page } } : {}),
  });
  if (Array.isArray(response.data?.categories) && response.data.categories.length > 0) {
    cachedCategories = response.data.categories;
  }
  return response.data;
};

export const getBanners = async (options = {}) => {
  const response = await catalogClient.get("/banners", options);
  return response.data;
};
