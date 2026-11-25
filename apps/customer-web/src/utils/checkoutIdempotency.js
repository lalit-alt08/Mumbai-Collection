import safeStorage, { safeSessionStorage } from "./safeStorage.js";

export const CHECKOUT_IDEMP_STORAGE_KEY = "mumbai_checkout_idemp";
export const PENDING_PAYMENT_STORAGE_KEY = "mumbai_pending_payment";
export const CHECKOUT_CELEBRATION_STORAGE_KEY = "mumbai_pending_checkout_celebration";
const CHECKOUT_CELEBRATION_TTL_MS = 30 * 60 * 1000;

export function computeCartItemsFingerprint(cart) {
  if (!cart) return "empty";
  const items = Array.isArray(cart.items) ? cart.items : [];
  return items
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
}

/**
 * Computes a stable cart fingerprint based on sorted items, variation, quantities, and totals.
 * Changing quantities or items produces a different fingerprint.
 */
export function computeCartFingerprint(cart) {
  if (!cart) return "empty";
  const itemsKey = computeCartItemsFingerprint(cart);

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

const idempStorageKey = (userId) => (userId ? `${CHECKOUT_IDEMP_STORAGE_KEY}_${String(userId)}` : CHECKOUT_IDEMP_STORAGE_KEY);

/**
 * Returns the existing persisted idempotency key if the cart fingerprint matches.
 * If the cart has changed, or no key exists, generates and persists a new one.
 *
 * Uses localStorage (via safeStorage) instead of sessionStorage so the key survives
 * Razorpay redirect-based payment flows (netbanking, UPI) that cause full page navigations.
 * The key resets whenever the cart fingerprint changes or the order completes successfully.
 */
export function getOrCreateCheckoutIdempotencyKey(cart, userId = null) {
  const fingerprint = computeCartFingerprint(cart);
  const keyName = idempStorageKey(userId);
  const stored = safeStorage.getJSON(keyName, null);
  if (stored && stored.fingerprint === fingerprint && stored.key) {
    return stored.key;
  }
  const newKey = generateUUID();
  safeStorage.setJSON(keyName, { fingerprint, key: newKey });
  return newKey;
}

/**
 * Retires the current checkout idempotency key upon confirmed cancellation or quote change.
 * Ensures any subsequent attempt begins under a fresh idempotency key.
 */
export function retireCheckoutIdempotencyKey(userId = null) {
  if (userId) {
    safeStorage.removeItem(idempStorageKey(userId));
  }
  safeStorage.removeItem(CHECKOUT_IDEMP_STORAGE_KEY);
  return generateUUID();
}

/**
 * Clears the persisted idempotency key upon successful order completion.
 */
export function clearCheckoutIdempotencyKey(userId = null) {
  if (userId) {
    safeStorage.removeItem(idempStorageKey(userId));
  }
  safeStorage.removeItem(CHECKOUT_IDEMP_STORAGE_KEY);
}

const pendingKey = (userId) => userId ? `${PENDING_PAYMENT_STORAGE_KEY}_${String(userId)}` : PENDING_PAYMENT_STORAGE_KEY;

export function getPendingPayment(userId) {
  return safeStorage.getJSON(pendingKey(userId), null);
}

export function setPendingPayment(data, userId) {
  safeStorage.setJSON(pendingKey(userId), data);
}

export function clearPendingPayment(userId) {
  safeStorage.removeItem(pendingKey(userId));
}

/**
 * Determines whether a given cart item is part of the shopper's active, unconfirmed checkout hold.
 * While an attempt is pending, held items should not be treated as out of stock or purged.
 */
export function getHeldQuantityForPendingCheckout(item, pendingPayment) {
  if (!item || !pendingPayment || !pendingPayment.razorpay_order_id) return 0;
  if (pendingPayment.terminal || pendingPayment.cancelled || pendingPayment.refunded) return 0;

  const itemId = Number(item.id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return 0;

  if (Array.isArray(pendingPayment.heldItems) && pendingPayment.heldItems.length > 0) {
    const held = pendingPayment.heldItems.find((entry) => Number(entry.id) === itemId && (entry.key ? entry.key === item.key : !item.key));
    return Math.max(0, Number(held?.quantity) || 0);
  }

  if (typeof pendingPayment.itemsFingerprint === "string") {
    const variation = item.variation_id ?? (Array.isArray(item.variation) ? item.variation.map((v) => `${v.attribute}:${v.value}`).join(";") : "");
    const prefix = `${itemId}:${variation}:`;
    const entry = pendingPayment.itemsFingerprint.split("|").find((part) => part.startsWith(prefix));
    return Math.max(0, Number(entry?.slice(prefix.length)) || 0);
  }

  return 0;
}

export function isItemHeldForPendingCheckout(item, pendingPayment) {
  return getHeldQuantityForPendingCheckout(item, pendingPayment) > 0;
}

function readValidCelebrationEntry() {
  const entry = safeSessionStorage.getJSON(CHECKOUT_CELEBRATION_STORAGE_KEY, null);
  if (!entry || typeof entry !== "object") return null;
  if (!entry.createdAt || Date.now() - Number(entry.createdAt) > CHECKOUT_CELEBRATION_TTL_MS) {
    safeSessionStorage.removeItem(CHECKOUT_CELEBRATION_STORAGE_KEY);
    return null;
  }
  return entry;
}

/**
 * Records a session-scoped marker for an active or newly confirmed checkout so
 * OrderSuccess plays its celebratory feedback once across both SPA redirects and
 * server-confirmed 303 payment callbacks without relying on document reload state.
 */
export function markPendingCheckoutCelebration({
  userId = null,
  razorpayOrderId = null,
  orderId = null,
} = {}) {
  const token = generateUUID();
  safeSessionStorage.setJSON(CHECKOUT_CELEBRATION_STORAGE_KEY, {
    userId: userId ? String(userId) : null,
    razorpayOrderId: razorpayOrderId ? String(razorpayOrderId) : null,
    orderId: orderId ? String(orderId) : null,
    token,
    createdAt: Date.now(),
  });
  return token;
}

export function clearPendingCheckoutCelebration() {
  safeSessionStorage.removeItem(CHECKOUT_CELEBRATION_STORAGE_KEY);
}

export function consumePendingCheckoutCelebration() {
  safeSessionStorage.removeItem(CHECKOUT_CELEBRATION_STORAGE_KEY);
}

export function hasMatchingDirectCheckoutCelebration({
  userId = null,
  orderId = null,
  token = null,
} = {}) {
  const entry = readValidCelebrationEntry();
  if (!entry) return false;
  if (userId && entry.userId && String(entry.userId) !== String(userId)) {
    return false;
  }
  if (!token || !entry.token || String(entry.token) !== String(token)) {
    return false;
  }
  if (orderId && entry.orderId && String(entry.orderId) !== String(orderId)) {
    return false;
  }
  return true;
}

export function matchesServerConfirmedCheckoutCelebration({
  userId = null,
  order = null,
} = {}) {
  const entry = readValidCelebrationEntry();
  if (!entry || !order) return false;
  if (userId && entry.userId && String(entry.userId) !== String(userId)) {
    return false;
  }
  if (
    entry.razorpayOrderId &&
    order.razorpay_order_id &&
    String(entry.razorpayOrderId) === String(order.razorpay_order_id)
  ) {
    return true;
  }
  if (entry.orderId && order.id && String(entry.orderId) === String(order.id)) {
    return true;
  }
  return false;
}

export function buildOrderSuccessNavigationState({
  userId,
  orderId,
  paymentMethod = "Online Payment",
  status = "Processing",
}) {
  const confirmationToken = markPendingCheckoutCelebration({ userId, orderId });
  return {
    paymentMethod,
    status,
    confirmedUserId: userId,
    confirmationToken,
  };
}

