import axios from "axios";
import API_URL from "../config/api.js";
import { attachStaleConnectionRetry } from "../utils/resilientAxios.js";

const catalogClient = axios.create({
  baseURL: API_URL,
  timeout: 12000,
});
attachStaleConnectionRetry(catalogClient);

export const getProducts = async (params = {}, options = {}) => {
  const response = await catalogClient.get("/products", { ...options, params });
  return response.data;
};

export const getProductById = async (id, { refresh = false, signal } = {}) => {
  const response = await catalogClient.get(`/products/${id}`, {
    params: refresh ? { refresh: "1" } : undefined,
    signal,
  });
  return response.data;
};

export const getProductsByIds = async (ids = [], { freshStock = false, signal } = {}) => {
  const productIds = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 12);
  if (productIds.length === 0) return [];

  const response = await catalogClient.get("/products/by-ids", {
    params: { ids: productIds.join(","), ...(freshStock ? { fresh: "1" } : {}) },
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
  const response = await catalogClient.get("/products/categories", options);
  return response.data;
};

export const getBanners = async (options = {}) => {
  const response = await catalogClient.get("/banners", options);
  return response.data;
};
