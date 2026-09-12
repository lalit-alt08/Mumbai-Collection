export const CHECKOUT_IDEMP_STORAGE_KEY = "mumbai_checkout_idemp";

/**
 * Computes a stable cart fingerprint based on sorted items, variation, quantities, and totals.
 * Changing quantities or items produces a different fingerprint.
 */
export function computeCartFingerprint(cart) {
  if (!cart) return "empty";
  const items = Array.isArray(cart.items) ? cart.items : [];
  const itemsKey = items
    .map((item) => {
      const id = item.id ?? item.product_id ?? "";
      const variationId =
        item.variation_id ??
        (Array.isArray(item.variation)
          ? item.variation.map((v) => `${v.attribute}:${v.value}`).join(";")
          : "");
      const qty = item.quantity ?? 1;
      return `${id}:${variationId}:${qty}`;
    })
    .sort()
    .join("|");

  const total =
    cart.totals?.total_price ??
    cart.totals?.total_items ??
    cart.total_price ??
    "";

  return `items:[${itemsKey}]_total:${total}`;
}

/**
 * Generates a crypto UUID or timestamp-random fallback.
 */
export function generateUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ord_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Returns the existing persisted idempotency key if the cart fingerprint matches.
 * If the cart has changed, or no key exists, generates and persists a new one.
 */
export function getOrCreateCheckoutIdempotencyKey(cart) {
  const fingerprint = computeCartFingerprint(cart);
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(CHECKOUT_IDEMP_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored && stored.fingerprint === fingerprint && stored.key) {
          return stored.key;
        }
      }
      const newKey = generateUUID();
      window.sessionStorage.setItem(
        CHECKOUT_IDEMP_STORAGE_KEY,
        JSON.stringify({ fingerprint, key: newKey })
      );
      return newKey;
    }
  } catch (e) {
    // Gracefully fall back if sessionStorage is disabled, full, or in private mode
  }
  return generateUUID();
}

/**
 * Clears the persisted idempotency key upon successful order completion.
 */
export function clearCheckoutIdempotencyKey() {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(CHECKOUT_IDEMP_STORAGE_KEY);
    }
  } catch (e) {
    // Ignore storage clearing error
  }
}
