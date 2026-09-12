/**
 * Image Utilities for Responsive Customer-Web Delivery
 *
 * Provides safe helpers to select appropriate WooCommerce image resolutions:
 * - getCatalogImageUrl: Prefers WooCommerce 300x300 catalog thumbnail, falls back to full-res src
 * - getFullImageUrl: Returns full-resolution source image for hero/detail/zoom views
 */

/**
 * Extract catalog / card thumbnail URL from a product image object.
 * Prefers WooCommerce's generated thumbnail size (typically 300x300),
 * falling back to the primary source URL if thumbnail is not generated.
 *
 * @param {Object|string} image - WooCommerce image object or URL string
 * @returns {string}
 */
export const getCatalogImageUrl = (image) => {
  if (!image) return "";
  if (typeof image === "string") return image;

  // Safely resolve nested image if a product/cart item or array was provided
  let target = image;
  if (Array.isArray(target?.images)) {
    target = target.images[0];
  } else if (Array.isArray(target)) {
    target = target[0];
  } else if (target?.image) {
    target = target.image;
  }

  if (!target) return "";
  if (typeof target === "string") return target;

  // WooCommerce REST API returns `thumbnail` for catalog/sub-sizes
  return target.thumbnail || target.src || "";
};

/**
 * Extract full-resolution image URL from a product image object.
 * Intended for the primary hero view, product detail page, and high-DPI displays.
 *
 * @param {Object|string} image - WooCommerce image object or URL string
 * @returns {string}
 */
export const getFullImageUrl = (image) => {
  if (!image) return "";
  if (typeof image === "string") return image;

  // Primary full-resolution image
  return image.src || image.thumbnail || "";
};

export default {
  getCatalogImageUrl,
  getFullImageUrl,
};
