/**
 * Cart Merge Utilities
 *
 * Provides composite item identity matching, guest-to-customer cart diffing,
 * and resilient merge orchestration with session-epoch validation and failure tracking.
 */

/**
 * Returns a stable composite identity string for a WooCommerce Store API cart item.
 * Preserves product ID and any variation attributes or variation IDs.
 */
export function getCartItemIdentity(item) {
  if (!item || (!item.id && item.id !== 0)) return "";
  const productId = String(item.id);
  let variationSignature = "";

  if (Array.isArray(item.variation) && item.variation.length > 0) {
    const sorted = [...item.variation].sort((a, b) => {
      const keyA = String(a.attribute || a.name || "");
      const keyB = String(b.attribute || b.name || "");
      return keyA.localeCompare(keyB);
    });
    variationSignature = JSON.stringify(sorted);
  } else if (item.variation_id) {
    variationSignature = String(item.variation_id);
  }

  return `${productId}::${variationSignature}`;
}

/**
 * Compares guest items against server items to determine required mutations.
 * Handles:
 * - Missing items (not present on server cart)
 * - Under-quantitied items (server cart has fewer items than guest intended)
 */
export function diffGuestItemsForMerge(guestItems = [], serverItems = []) {
  if (!Array.isArray(guestItems) || guestItems.length === 0) {
    return [];
  }

  const serverMap = new Map();
  for (const sItem of serverItems || []) {
    const sId = getCartItemIdentity(sItem);
    if (sId) {
      serverMap.set(sId, sItem);
    }
  }

  const actions = [];
  for (const gItem of guestItems) {
    const gId = getCartItemIdentity(gItem);
    if (!gId) continue;

    const matchedServerItem = serverMap.get(gId);
    if (!matchedServerItem) {
      // Missing completely on server
      actions.push({
        type: "add",
        item: gItem,
        quantity: Math.max(1, Number(gItem.quantity) || 1),
      });
    } else {
      // Present, verify if guest had higher quantity intended
      const serverQty = Number(matchedServerItem.quantity) || 0;
      const guestQty = Number(gItem.quantity) || 0;
      if (guestQty > serverQty && matchedServerItem.key) {
        actions.push({
          type: "update",
          item: gItem,
          key: matchedServerItem.key,
          quantity: guestQty,
        });
      }
    }
  }

  return actions;
}

/**
 * Orchestrates an asynchronous guest-to-customer cart merge.
 * Validates session epoch before and after each async network call to prevent
 * cross-account leakage or applying stale merges after logout.
 *
 * @param {Object} params
 * @param {Array} params.guestItems - Captured items from the guest session
 * @param {Object} params.api - API handlers { refreshCart, addToCart, updateCartItem }
 * @param {Function} params.isSessionValid - Function returning boolean; returns false if session/user changed
 */
export async function orchestrateCartMerge({
  guestItems = [],
  api,
  isSessionValid,
  initialCart = null,
}) {
  if (typeof isSessionValid !== "function") {
    throw new Error("isSessionValid check is required for cart merge");
  }

  if (!isSessionValid()) {
    return { cancelled: true, failedItems: [], serverCart: null };
  }

  // 1. Refresh server cart for authenticated customer if not already provided
  let serverCart = initialCart;
  try {
    while (isSessionValid() && !serverCart) {
      serverCart = await api.refreshCart();
      if (!serverCart && isSessionValid()) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  } catch (err) {
    if (!isSessionValid()) {
      return { cancelled: true, failedItems: [], serverCart: null };
    }
    // If refreshCart failed, bubble error so caller can handle
    throw err;
  }

  if (!isSessionValid()) {
    return { cancelled: true, failedItems: [], serverCart: null };
  }

  if (!Array.isArray(guestItems) || guestItems.length === 0) {
    return { cancelled: false, failedItems: [], serverCart };
  }

  // 2. Diff guest items against current server items
  const actions = diffGuestItemsForMerge(guestItems, serverCart?.items || []);
  const failedItems = [];

  for (const action of actions) {
    if (!isSessionValid()) {
      return { cancelled: true, failedItems: [], serverCart: null };
    }

    try {
      if (action.type === "add") {
        serverCart = await api.addToCart(
          action.item.id,
          action.quantity,
          action.item.variation
        );
      } else if (action.type === "update") {
        serverCart = await api.updateCartItem(action.key, action.quantity);
      }
    } catch (err) {
      if (!isSessionValid()) {
        return { cancelled: true, failedItems: [], serverCart: null };
      }
      failedItems.push({
        id: action.item.id,
        name: action.item.name || `Product #${action.item.id}`,
        requestedQuantity: action.quantity,
        error:
          err.response?.data?.message ||
          err.message ||
          "Could not restore item to cart",
      });
    }
  }

  if (!isSessionValid()) {
    return { cancelled: true, failedItems: [], serverCart: null };
  }

  return {
    cancelled: false,
    failedItems,
    serverCart,
  };
}
