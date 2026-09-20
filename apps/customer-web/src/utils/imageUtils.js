/**
 * Image Utilities for Responsive Customer-Web Delivery
 *
 * Provides safe helpers to select appropriate WooCommerce image resolutions:
 * - getCatalogImageUrl: Prefers WooCommerce 300x300 catalog thumbnail, falls back to full-res src
 * - getFullImageUrl: Returns full-resolution source image for hero/detail/zoom views
 */

export const PRODUCT_PLACEHOLDER_URL = "/product-placeholder.svg";

/**
 * Extract catalog / card thumbnail URL from a product image object.
 * Prefers WooCommerce's generated thumbnail size (typically 300x300),
 * falling back to the primary source URL if thumbnail is not generated.
 * Returns the local placeholder if no valid image source is present.
 *
 * @param {Object|string} image - WooCommerce image object or URL string
 * @param {string} [fallback] - Fallback URL if no valid image is found
 * @returns {string}
 */
export const getCatalogImageUrl = (image, fallback = PRODUCT_PLACEHOLDER_URL) => {
  if (!image) return fallback;
  if (typeof image === "string") return resolveMediaUrl(image.trim()) || fallback;

  // Safely resolve nested image if a product/cart item or array was provided
  let target = image;
  if (Array.isArray(target?.images)) {
    target = target.images[0];
  } else if (Array.isArray(target)) {
    target = target[0];
  } else if (target?.image) {
    target = target.image;
  }

  if (!target) return fallback;
  if (typeof target === "string") return resolveMediaUrl(target.trim()) || fallback;

  // WooCommerce REST API returns `thumbnail` for catalog/sub-sizes
  const url = target.thumbnail || target.src || "";
  return (typeof url === "string" && url.trim()) ? resolveMediaUrl(url.trim()) : fallback;
};

/**
 * Extract full-resolution image URL from a product image object.
 * Intended for the primary hero view, product detail page, and high-DPI displays.
 * Returns the local placeholder if no valid image source exists.
 *
 * @param {Object|string} image - WooCommerce image object or URL string
 * @param {string} [fallback] - Fallback URL if no valid image is found
 * @returns {string}
 */
export const getFullImageUrl = (image, fallback = PRODUCT_PLACEHOLDER_URL) => {
  if (!image) return fallback;
  if (typeof image === "string") return resolveMediaUrl(image.trim()) || fallback;

  let target = image;
  if (Array.isArray(target?.images)) {
    target = target.images[0];
  } else if (Array.isArray(target)) {
    target = target[0];
  } else if (target?.image) {
    target = target.image;
  }

  if (!target) return fallback;
  if (typeof target === "string") return resolveMediaUrl(target.trim()) || fallback;

  // Primary full-resolution image
  const url = target.src || target.thumbnail || "";
  return (typeof url === "string" && url.trim()) ? resolveMediaUrl(url.trim()) : fallback;
};

/**
 * Resolves an image or banner URL across local and hosted environments.
 * If an image points to localhost:5000 in a hosted/production browser environment (e.g. Vercel),
 * it converts it to a relative /api/media/... path so Vercel's rewrite rule proxies it cleanly over HTTPS.
 *
 * @param {string} url
 * @returns {string}
 */
export const resolveMediaUrl = (url) => {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";

  if (typeof window !== "undefined" && window.location) {
    const hostname = window.location.hostname;
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";

    if (!isLocal) {
      const localhostMatch = trimmed.match(/^https?:\/\/(localhost|127\.0\.0\.1):5000(\/api\/.*)$/i);
      if (localhostMatch) {
        return localhostMatch[2];
      }

      if (window.location.protocol === "https:" && trimmed.startsWith("http://")) {
        return trimmed.replace(/^http:\/\//i, "https://");
      }
    }
  }

  return trimmed;
};

export default {
  PRODUCT_PLACEHOLDER_URL,
  getCatalogImageUrl,
  getFullImageUrl,
  resolveMediaUrl,
};
