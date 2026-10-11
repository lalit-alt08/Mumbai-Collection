/**
 * Utility functions for product data presentation across customer-web
 */

/**
 * Strips marketplace scraper artifacts and noisy SEO keywords from product titles.
 * E.g. "Click to see full view 2 VIDEOS DOMS 14 Shades Brush Pen Box Pack | Super Soft Tip..."
 * becomes "DOMS 14 Shades Brush Pen Box Pack".
 *
 * @param {string} rawTitle
 * @returns {string}
 */
export function cleanProductTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== "string") return "";

  let clean = rawTitle.trim();

  // Strip prefix garbage such as "Click to see full view", "2 VIDEOS", "5 IMAGES"
  clean = clean
    .replace(/^(?:click\s+to\s+see\s+full\s+view\s*)?(?:\d+\s*(?:videos?|images?)\s*)?/i, "")
    .trim();

  // If title has pipe-delimited SEO keywords, take the primary product name segment
  if (clean.includes("|")) {
    const parts = clean
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts[0] && parts[0].length >= 5) {
      clean = parts[0];
    }
  }

  return clean || rawTitle.trim();
}
