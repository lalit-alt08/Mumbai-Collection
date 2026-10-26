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

export const getProductsByIds = async (ids = [], { signal } = {}) => {
  const productIds = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 12);
  if (productIds.length === 0) return [];

  const response = await catalogClient.get("/products/by-ids", {
    params: { ids: productIds.join(",") },
    signal,
  });
  return Array.isArray(response.data) ? response.data : [];
};

export const getLiveProductStockByIds = async (ids = []) => {
  const productIds = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (productIds.length === 0) return [];
  const batches = [];
  for (let index = 0; index < productIds.length; index += 100) {
    batches.push(productIds.slice(index, index + 100));
  }
  const responses = await Promise.all(batches.map((batch) => catalogClient.get("/products/stock", {
    params: { ids: batch.join(",") },
  })));
  return responses.flatMap((response) => Array.isArray(response.data) ? response.data : []);
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

export const getHomeShelves = async (options = {}) => {
  const response = await catalogClient.get("/products/home-shelves", {
    timeout: 25000,
    skipTimeoutRetry: true,
    ...options,
  });
  if (Array.isArray(response.data?.categories)) cachedCategories = response.data.categories;
  return response.data;
};

export const getBanners = async (options = {}) => {
  const response = await catalogClient.get("/banners", options);
  return response.data;
};
