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
    category: categoryId,
    exclude: currentProductId,
    per_page: 4,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce related products response");
  }

  return response.data;
};

export const searchProducts = async (search) => {
  const response = await api.get("products", {
    search,
    per_page: 20,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce search response");
  }
  return response.data;
};

export const fetchProductsByCategory = async (categoryId) => {
  let targetCategory = categoryId;

  // If a slug was passed (e.g. "art", "toys", "playstation"), resolve its numeric category ID
  if (isNaN(Number(categoryId))) {
    try {
      const catRes = await api.get("products/categories", {
        slug: categoryId,
      });
      if (Array.isArray(catRes.data) && catRes.data.length > 0) {
        targetCategory = catRes.data[0].id;
      }
    } catch (err) {
      console.warn(`Category slug resolution failed for ${categoryId}:`, err.message);
    }
  }

  const response = await api.get("products", {
    category: targetCategory,
    per_page: 50,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce category products response");
  }

  return response.data;
};

export const fetchCategories = async () => {
  const response = await api.get("products/categories", {
    per_page: 100,
    hide_empty: false,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid WooCommerce categories response");
  }

  // Sort by menu_order ascending (new categories with menu_order 0 or unassigned appear at the end)
  const sorted = [...response.data].sort((a, b) => {
    const orderA = typeof a.menu_order === "number" && a.menu_order > 0 ? a.menu_order : 9999;
    const orderB = typeof b.menu_order === "number" && b.menu_order > 0 ? b.menu_order : 9999;
    if (orderA !== orderB) return orderA - orderB;
    return a.id - b.id;
  });

  return sorted.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
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