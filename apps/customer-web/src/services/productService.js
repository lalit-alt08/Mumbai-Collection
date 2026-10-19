import axios from "axios";
import API_URL from "../config/api.js";
import { attachStaleConnectionRetry } from "../utils/resilientAxios.js";

const catalogClient = axios.create({
  baseURL: API_URL,
  timeout: 12000,
});
attachStaleConnectionRetry(catalogClient);

export const getProducts = async (params = {}) => {
  const response = await catalogClient.get("/products", { params });
  return response.data;
};

export const getProductById = async (id, { refresh = false } = {}) => {
  const response = await catalogClient.get(`/products/${id}`, {
    params: refresh ? { refresh: "1" } : undefined,
  });
  return response.data;
};

export const getProductsByIds = async (ids = []) => {
  const productIds = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 12);
  if (productIds.length === 0) return [];

  const response = await catalogClient.get("/products/by-ids", {
    params: { ids: productIds.join(",") },
  });
  return Array.isArray(response.data) ? response.data : [];
};

export const getRelatedProducts = async (
  categoryId,
  currentProductId
) => {
  const response = await catalogClient.get(
    "/products/related",
    {
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

export const getProductsByCategory = async (categoryId, params = {}) => {
  const response = await catalogClient.get(
    `/products/category/${categoryId}`,
    { params }
  );

  return response.data;
};

export const getCategories = async () => {
  const response = await catalogClient.get("/products/categories");
  return response.data;
};

export const getBanners = async () => {
  const response = await catalogClient.get("/banners");
  return response.data;
};
