import axios from "axios";

import API_URL from "../config/api.js";

const API = API_URL;
export const getProducts = async () => {
  const response = await axios.get(`${API}/products`);
  return response.data;
};

export const getProductById = async (id) => {
  const response = await axios.get(`${API}/products/${id}`);
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

export const searchProducts = async (query) => {
  const response = await axios.get(`${API}/products/search`, {
    params: {
      q: query,
    },
  });

  return response.data;
};

export const getProductsByCategory = async (categoryId) => {
  const response = await axios.get(
    `${API}/products/category/${categoryId}`
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