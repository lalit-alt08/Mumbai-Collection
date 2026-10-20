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

  // Decode common HTML entities from marketplace/WooCommerce scrapes
  clean = clean
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

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
  const backordersAllowed = product?.backorders_allowed === true || cartItem?.backorders_allowed === true;
  const managesStock = product?.manage_stock === true &&
    product.stock_quantity !== null &&
    product.stock_quantity !== undefined &&
    product.stock_quantity !== "";
  const quantity = managesStock ? Number(product.stock_quantity) : null;

  const cartItemOutOfStock =
    cartItem?.quantity_limits?.maximum === 0 ||
    ((cartItem?.stock_status === "outofstock" || cartItem?.is_in_stock === false || Boolean(cartItem?.isOutOfStock)) &&
      (!managesStock || !Number.isFinite(quantity) || quantity <= 0));

  const isOutOfStock = !backordersAllowed && (
    cartItemOutOfStock ||
    product?.stock_status === "outofstock" ||
    (managesStock && (!Number.isFinite(quantity) || quantity <= 0))
  );

  const maxLimit = typeof cartItem?.quantity_limits?.maximum === "number"
    ? cartItem.quantity_limits.maximum
    : null;

  let maxStock;
  if (isOutOfStock) {
    maxStock = 0;
  } else if (backordersAllowed) {
    maxStock = 99;
  } else if (managesStock && Number.isFinite(quantity)) {
    maxStock = Math.max(0, quantity);
  } else if (maxLimit !== null) {
    maxStock = maxLimit;
  } else {
    maxStock = 99;
  }

  return { maxStock, isOutOfStock, availableStock: backordersAllowed ? null : maxStock, backordersAllowed };
}

export function getRemainingStock(product, quantityInCart = 0, cartItem = null) {
  const { maxStock, isOutOfStock } = getProductStock(product, cartItem);
  if (isOutOfStock) return 0;
  const currentQuantity = Math.max(0, Number(quantityInCart) || 0);
  return Math.max(0, maxStock - currentQuantity);
}

/**
 * Parses WooCommerce Store API error response to extract stock availability.
 * E.g. "You cannot add that amount of \"Keychain watch\" to the cart because there is not enough stock (0 remaining)."
 *
 * @param {any} error
 * @returns {{ isStockError: boolean, remaining: number|null, isOutOfStock: boolean }}
 */
export function parseCartStockError(error) {
  const response = error?.response?.data;
  const code = String(response?.code || "").toLowerCase();
  const rawMsg = String(response?.message || "");

  // Match e.g. "(0 remaining)" or "(2 remaining)"
  const match = rawMsg.match(/\((\d+)\s+remaining\)/i);
  if (match) {
    const remaining = parseInt(match[1], 10);
    return {
      isStockError: true,
      remaining,
      isOutOfStock: remaining <= 0,
    };
  }

  if (
    code.includes("out_of_stock") ||
    code.includes("partially_out_of_stock") ||
    /out of stock|not enough stock|insufficient stock/i.test(rawMsg)
  ) {
    return {
      isStockError: true,
      remaining: 0,
      isOutOfStock: true,
    };
  }

  if (/stock|inventory|quantity|available/i.test(`${code} ${rawMsg}`)) {
    return {
      isStockError: true,
      remaining: 0,
      isOutOfStock: true,
    };
  }

  return {
    isStockError: false,
    remaining: null,
    isOutOfStock: false,
  };
}

export function getCartFailureMessage(error) {
  const stockInfo = parseCartStockError(error);
  if (stockInfo.isStockError) {
    if (stockInfo.remaining === 0 || stockInfo.isOutOfStock) {
      return "This item is now out of stock.";
    }
    if (typeof stockInfo.remaining === "number" && stockInfo.remaining > 0) {
      return `Only ${stockInfo.remaining} item${stockInfo.remaining > 1 ? "s" : ""} left in stock.`;
    }
    return "Stock changed while adding this item. Availability has been refreshed.";
  }
  return "Unable to update cart. Please try again.";
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

/** Interleave catalog items by primary category while retaining each category's order. */
export function mixProductsByCategory(products) {
  if (!Array.isArray(products) || products.length === 0) return [];
  const pools = new Map();
  const seen = new Set();

  for (const product of products) {
    if (product?.id == null || seen.has(String(product.id))) continue;
    seen.add(String(product.id));
    const category = Array.isArray(product.categories)
      ? product.categories.find((item) => item?.id != null)
      : null;
    const key = category ? String(category.id) : "uncategorized";
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(product);
  }

  const queues = [...pools.values()];
  const mixed = [];
  while (queues.length) {
    for (let index = queues.length - 1; index >= 0; index -= 1) {
      const product = queues[index].shift();
      if (product) mixed.push(product);
      if (queues[index].length === 0) queues.splice(index, 1);
    }
  }
  return mixed;
}

