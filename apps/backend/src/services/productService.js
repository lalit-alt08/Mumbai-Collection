import api from "../config/woocommerce.js";

export const fetchProducts = async () => {
  const response = await api.get("products");
  return response.data;
};

export const fetchProductById = async (id) => {
  const response = await api.get(`products/${id}`);
  return response.data;
};

export const fetchRelatedProducts = async (categoryId, currentProductId) => {
  const response = await api.get("products", {
    category: categoryId,
    exclude: currentProductId,
    per_page: 4,
  });

  return response.data;
};

export const searchProducts = async (search) => {
  const response = await api.get("products", {
    search,
    per_page: 20,
  });

  return response.data;
};

export const fetchProductsByCategory = async (categoryId) => {
  const response = await api.get("products", {
    category: categoryId,
    per_page: 20,
  });

  return response.data;
};