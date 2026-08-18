import api from "../config/woocommerce.js";

export const fetchProducts = async () => {
  const response = await api.get("products");

  if (!Array.isArray(response.data)) {
    console.error("Unexpected WooCommerce products response:");
    console.error(response.data);

    throw new Error("Invalid WooCommerce products response");
  }

  return response.data;
};

export const fetchProductById = async (id) => {
  const response = await api.get(`products/${id}`);

  if (!response.data || typeof response.data !== "object") {
    throw new Error("Invalid WooCommerce product response");
  }

  return response.data;
};

export const fetchRelatedProducts = async (
  categoryId,
  currentProductId
) => {
  const response = await api.get("products", {
    params: {
      category: categoryId,
      exclude: currentProductId,
      per_page: 4,
    },
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce related products response");
  }

  return response.data;
};

export const searchProducts = async (search) => {
  const response = await api.get("products", {
    params: {
      search,
      per_page: 20,
    },
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce search response");
  }
  return response.data;
};

export const fetchProductsByCategory = async (categoryId) => {
  const response = await api.get("products", {
    params: {
      category: categoryId,
      per_page: 20,
    },
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce category products response");
  }

  return response.data;
};