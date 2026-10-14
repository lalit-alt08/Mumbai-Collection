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

export function getProductStock(product, cartItem = null) {
  const cartItemOutOfStock =
    cartItem?.stock_status === "outofstock" ||
    cartItem?.is_in_stock === false ||
    cartItem?.quantity_limits?.maximum === 0 ||
    Boolean(cartItem?.isOutOfStock);

  const managesStock = product?.manage_stock === true &&
    product.stock_quantity !== null &&
    product.stock_quantity !== undefined &&
    product.stock_quantity !== "";
  const quantity = managesStock ? Number(product.stock_quantity) : null;
  const isOutOfStock =
    cartItemOutOfStock ||
    product?.stock_status === "outofstock" ||
    (managesStock && (!Number.isFinite(quantity) || quantity <= 0));

  const maxLimit = typeof cartItem?.quantity_limits?.maximum === "number"
    ? cartItem.quantity_limits.maximum
    : null;

  let maxStock;
  if (isOutOfStock) {
    maxStock = 0;
  } else if (managesStock && Number.isFinite(quantity)) {
    maxStock = Math.max(0, quantity);
  } else if (maxLimit !== null) {
    maxStock = maxLimit;
  } else {
    maxStock = 99;
  }

  return { maxStock, isOutOfStock };
}

export function getRemainingStock(product, quantityInCart = 0, cartItem = null) {
  const { maxStock, isOutOfStock } = getProductStock(product, cartItem);
  if (isOutOfStock) return 0;
  const currentQuantity = Math.max(0, Number(quantityInCart) || 0);
  return Math.max(0, maxStock - currentQuantity);
}

export function getCartFailureMessage(error) {
  const response = error?.response?.data;
  const code = String(response?.code || "").toLowerCase();
  const message = String(response?.message || "").toLowerCase();
  if (/stock|inventory|quantity|available/.test(`${code} ${message}`)) {
    return "Stock changed while adding this item. Availability has been refreshed.";
  }
  return "Could not update your cart. Please try again.";
}

/**
 * Fisher-Yates (Knuth) unbiased array shuffle.
 * Returns a new shuffled array without mutating the input array.
 *
 * @template T
 * @param {T[]} items
 * @returns {T[]}
 */
export function shuffleProducts(items) {
  if (!Array.isArray(items) || items.length <= 1) return items ? [...items] : [];
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Reshuffles category products dynamically on each page visit/refresh.
 * Prioritizes available in-stock items first (in randomized order) so every product
 * gets equal visibility, while placing out-of-stock items at the tail of the list.
 *
 * @param {Array<Object>} products
 * @returns {Array<Object>}
 */
export function reshuffleCategoryProducts(products) {
  if (!Array.isArray(products) || products.length <= 1) return products ? [...products] : [];

  const inStock = [];
  const outOfStock = [];

  for (const product of products) {
    const { isOutOfStock } = getProductStock(product);
    if (isOutOfStock) {
      outOfStock.push(product);
    } else {
      inStock.push(product);
    }
  }

  return [...shuffleProducts(inStock), ...shuffleProducts(outOfStock)];
}

/**
 * Filters out out-of-stock products and dynamically shuffles the remaining
 * in-stock products for the "You may also like" recommendation section.
 * Out-of-stock items are completely excluded so customers only see products they can purchase.
 *
 * @param {Array<Object>} products
 * @returns {Array<Object>}
 */
export function filterAndShuffleRelatedProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return [];

  const inStockOnly = products.filter((product) => {
    const { isOutOfStock } = getProductStock(product);
    return !isOutOfStock;
  });

  return shuffleProducts(inStockOnly);
}
