/**
 * Cart Share Utilities (Stateless)
 * Encodes cart items into shareable URL parameters and safely parses incoming shared parameters.
 * Supports both WooCommerce simple products and variable products with attributes & variation IDs.
 * Security: Prices, product names, totals, and stock are NEVER serialized or trusted from URLs.
 */

/**
 * Serializes cart items into a compact string format:
 * - Simple product: "id:qty"
 * - Variable product: "id:qty:variationId:attr1=val1;attr2=val2"
 *
 * @param {Array} cartItems - Array of items from cart.items
 * @returns {string} Serialized query parameter value
 */
export function serializeCartItems(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return "";

  const segments = [];
  for (const item of cartItems) {
    const rawId = item?.id;
    const id = parseInt(rawId, 10);
    const rawQty = item?.quantity;
    const qty = parseInt(rawQty, 10);

    if (id > 0 && id <= 2147483647) {
      const safeQty = isNaN(qty) || qty <= 0 ? 1 : Math.min(qty, 99);
      const rawVarId = item?.variation_id;
      const variationId = parseInt(rawVarId, 10);
      const safeVarId = variationId > 0 && variationId <= 2147483647 ? variationId : 0;

      // Extract and safely encode variation attributes if available
      const attrs = Array.isArray(item?.variation)
        ? item.variation
            .filter((v) => v && typeof v.attribute === "string" && typeof v.value === "string")
            .map(
              (v) =>
                encodeURIComponent(v.attribute.trim()) +
                "=" +
                encodeURIComponent(v.value.trim())
            )
            .join(";")
        : "";

      if (safeVarId > 0 || attrs) {
        segments.push(`${id}:${safeQty}:${safeVarId}:${attrs}`);
      } else {
        segments.push(`${id}:${safeQty}`);
      }
    }
  }

  return segments.join(",");
}

/**
 * Builds a complete shareable Cart URL for the current cart items.
 *
 * @param {Array} cartItems - Array of items from cart.items
 * @param {string} [origin] - Optional base origin (defaults to window.location.origin)
 * @returns {string} Full URL to share
 */
export function buildCartShareUrl(cartItems, origin = "") {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  const serialized = serializeCartItems(cartItems);
  if (!serialized) {
    return `${base}/cart`;
  }
  return `${base}/cart?items=${encodeURIComponent(serialized)}`;
}

/**
 * Parses and validates shared cart items from a URL search query string.
 * Deduplicates multiple entries of the same item/variation while capping total quantity at 99.
 * Strictly ignores prices, malicious strings, negative numbers, or invalid IDs.
 *
 * @param {string} searchString - e.g. location.search or "?items=101:2,205:1:208:size=xl"
 * @returns {Array<{ id: number, quantity: number, variationId: number|null, variation: Array<{ attribute: string, value: string }> }>} Safe, validated items array
 */
export function parseSharedCartItems(searchString) {
  if (!searchString || typeof searchString !== "string") return [];

  try {
    const params = new URLSearchParams(searchString);
    const rawItems = params.get("items");
    if (!rawItems || typeof rawItems !== "string") return [];

    // Limit maximum items to prevent denial-of-service / URL payload bombing
    const rawSegments = rawItems.split(",").slice(0, 50);
    const itemMap = new Map();

    for (const segment of rawSegments) {
      const trimmed = segment.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(":");
      const id = parseInt(parts[0], 10);
      const qty = parseInt(parts[1], 10);

      // Validate ID is positive integer within safe range
      if (isNaN(id) || id <= 0 || id > 2147483647) continue;

      const quantity = isNaN(qty) || qty <= 0 ? 1 : Math.min(qty, 99);

      // Parse optional variation ID and attribute list
      const rawVarId = parts[2] ? parseInt(parts[2], 10) : 0;
      const variationId = !isNaN(rawVarId) && rawVarId > 0 && rawVarId <= 2147483647 ? rawVarId : null;
      const rawAttrs = parts[3] || "";

      const variation = [];
      if (rawAttrs) {
        const pairs = rawAttrs.split(";").slice(0, 10); // max 10 attributes per item
        for (const pair of pairs) {
          const [rawAttr, rawVal] = pair.split("=");
          if (rawAttr && rawVal) {
            try {
              const attribute = decodeURIComponent(rawAttr.trim());
              const value = decodeURIComponent(rawVal.trim());
              if (attribute && value) {
                variation.push({ attribute, value });
              }
            } catch {
              // Ignore malformed URI component
            }
          }
        }
      }

      // Generate a deduplication key using id + variationId + sorted attributes
      const attrKey = variation
        .map((v) => `${v.attribute}:${v.value}`)
        .sort()
        .join("|");
      const itemKey = `${id}:${variationId || 0}:${attrKey}`;

      if (itemMap.has(itemKey)) {
        const existing = itemMap.get(itemKey);
        existing.quantity = Math.min(99, existing.quantity + quantity);
      } else {
        itemMap.set(itemKey, {
          id,
          quantity,
          variationId,
          variation,
        });
      }
    }

    return Array.from(itemMap.values());
  } catch {
    return [];
  }
}
