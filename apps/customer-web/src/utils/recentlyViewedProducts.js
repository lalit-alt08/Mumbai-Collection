import safeStorage from "./safeStorage.js";

const STORAGE_KEY = "mumbai_recently_viewed_product_ids";
const MAX_STORED_PRODUCTS = 30;

export function getRecentlyViewedProductIds() {
  const value = safeStorage.getJSON(STORAGE_KEY, []);
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
    .slice(0, MAX_STORED_PRODUCTS);
}

export function recordRecentlyViewedProduct(productId) {
  const id = Number(productId);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const ids = getRecentlyViewedProductIds().filter((existingId) => existingId !== id);
  safeStorage.setJSON(STORAGE_KEY, [id, ...ids].slice(0, MAX_STORED_PRODUCTS));
}
