/**
 * Category Image Resolver
 *
 * Priority:
 * 1. Live WooCommerce uploaded category image (image.src or image string)
 * 2. Legacy local category asset based on slug (toys, stationery, electronics)
 * 3. Neutral generic category placeholder SVG
 *
 * @param {Object} category - Category object from WooCommerce or static data
 * @returns {string} Image source URL
 */
export const getCategoryImageUrl = (category) => {
  if (!category) {
    return "/categories/category-placeholder.svg";
  }

  // 1. Live WooCommerce uploaded image (Top Priority)
  if (typeof category.image === "object" && category.image?.src) {
    return category.image.src;
  }

  if (typeof category.image === "string" && category.image.trim()) {
    return category.image.trim();
  }

  // 2. Legacy local assets matched by category slug
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

  // 3. Neutral generic placeholder for any new/unknown category without an uploaded image
  return "/categories/category-placeholder.svg";
};

export default getCategoryImageUrl;
