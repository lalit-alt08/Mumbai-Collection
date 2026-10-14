import axios from "axios";

import API_URL from "../config/api.js";

const API = API_URL;
export const getProducts = async (params = {}) => {
  const response = await axios.get(`${API}/products`, { params });
  return response.data;
};

export const getProductById = async (id, { refresh = false } = {}) => {
  const response = await axios.get(`${API}/products/${id}`, {
    params: refresh ? { refresh: "1" } : undefined,
  });
  return response.data;
};

export const getRelatedProducts = async (
  categoryId,
  currentProductId
) => {
  const response = await axios.get(
    `${API}/products/related`,
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
  const response = await axios.get(`${API}/products/search`, {
    params: {
      q: query,
    },
    signal: options.signal,
  });

  return response.data;
};

export const getProductsByCategory = async (categoryId, params = {}) => {
  const response = await axios.get(
    `${API}/products/category/${categoryId}`,
    { params }
  );

  return response.data;
};

export const getCategories = async () => {
  const response = await axios.get(`${API}/products/categories`);
  return response.data;
};

export const getBanners = async () => {
  const response = await axios.get(`${API}/banners`);
  return response.data;
};
