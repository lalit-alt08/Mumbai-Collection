/**
 * Category Image Resolver for Employee Panel
 *
 * Priority:
 * 1. Live WooCommerce category image (image.src or string)
 * 2. Known local legacy asset based on slug (toys, stationery, electronics)
 * 3. Neutral SVG placeholder
 */
export const getCategoryImageUrl = (category) => {
  if (!category) {
    return "/favicon.svg";
  }

  // 1. Live WooCommerce uploaded image (Top Priority)
  if (typeof category.image === "object" && category.image?.src) {
    return category.image.src;
  }

  if (typeof category.image === "string" && category.image.trim()) {
    return category.image.trim();
  }

  // 2. Known local slug fallbacks
  const slug = String(category.slug || "").trim().toLowerCase();

  if (slug === "toys") {
    return "/categories/toys.webp";
  }

  if (slug === "stationery") {
    return "/categories/stationery.webp";
  }

  if (slug === "electronics") {
    return "/categories/electronics.webp";
  }

  // 3. Fallback placeholder
  return null;
};

export default getCategoryImageUrl;
