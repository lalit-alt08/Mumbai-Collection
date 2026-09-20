import safeStorage from "./safeStorage.js";

export const CHECKOUT_IDEMP_STORAGE_KEY = "mumbai_checkout_idemp";
export const PENDING_PAYMENT_STORAGE_KEY = "mumbai_pending_payment";

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
 *
 * Uses localStorage (via safeStorage) instead of sessionStorage so the key survives
 * Razorpay redirect-based payment flows (netbanking, UPI) that cause full page navigations.
 * The key resets whenever the cart fingerprint changes or the order completes successfully.
 */
export function getOrCreateCheckoutIdempotencyKey(cart) {
  const fingerprint = computeCartFingerprint(cart);
  const stored = safeStorage.getJSON(CHECKOUT_IDEMP_STORAGE_KEY, null);
  if (stored && stored.fingerprint === fingerprint && stored.key) {
    return stored.key;
  }
  const newKey = generateUUID();
  safeStorage.setJSON(CHECKOUT_IDEMP_STORAGE_KEY, { fingerprint, key: newKey });
  return newKey;
}

/**
 * Clears the persisted idempotency key upon successful order completion.
 */
export function clearCheckoutIdempotencyKey() {
  safeStorage.removeItem(CHECKOUT_IDEMP_STORAGE_KEY);
}

export function getPendingPayment() {
  return safeStorage.getJSON(PENDING_PAYMENT_STORAGE_KEY, null);
}

export function setPendingPayment(data) {
  safeStorage.setJSON(PENDING_PAYMENT_STORAGE_KEY, data);
}

export function clearPendingPayment() {
  safeStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
}

