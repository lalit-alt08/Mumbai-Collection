const norm = (value) => String(value || "").trim().toLowerCase();

/**
 * Verifies that cart.totals.total_price is a valid positive integer in paise.
 */
export function isUsableCartTotal(cart) {
  const raw = cart?.totals?.total_price;
  if (raw === undefined || raw === null || raw === "") return false;
  const paise = Number(raw);
  return Number.isSafeInteger(paise) && paise > 0;
}

/**
 * Verifies that WooCommerce has calculated and selected a shipping rate for every
 * shipping package when the cart requires shipping.
 */
export function hasSelectedShippingRate(cart) {
  if (!cart?.needs_shipping) return true;
  if (!Array.isArray(cart?.shipping_rates) || cart.shipping_rates.length === 0) {
    return false;
  }
  return cart.shipping_rates.every(
    (pkg) =>
      Array.isArray(pkg?.shipping_rates) &&
      pkg.shipping_rates.some((rate) => rate?.selected === true)
  );
}

/**
 * Produces a stable key identifying the customer + delivery address tuple used
 * to calculate WooCommerce cart shipping and totals.
 */
export function buildAddressPricingSyncKey(userId, selectedAddress, shippingAddress) {
  return [
    userId || "",
    selectedAddress?.id || "",
    norm(shippingAddress?.address_1),
    norm(shippingAddress?.city),
    norm(shippingAddress?.state),
    norm(shippingAddress?.postcode),
    norm(shippingAddress?.country),
  ].join("|");
}

/**
 * Returns true only when the cart's total_price is usable, the shipping address
 * matches the target delivery address, and every shipping package has a selected rate.
 */
export function isCartAddressPriced(cart, shippingAddress) {
  if (!isUsableCartTotal(cart) || !cart?.shipping_address || !shippingAddress) return false;
  if (!hasSelectedShippingRate(cart)) return false;

  const cur = cart.shipping_address;
  return (
    norm(cur.address_1) === norm(shippingAddress.address_1) &&
    norm(cur.city) === norm(shippingAddress.city) &&
    norm(cur.state) === norm(shippingAddress.state) &&
    norm(cur.postcode) === norm(shippingAddress.postcode) &&
    norm(cur.country) === norm(shippingAddress.country)
  );
}

/**
 * Syncs the selected delivery address to WooCommerce Store API and returns a
 * structured result. Callers must only mark an address as priced when
 * `status === "priced"` (returned cart has a usable total_price, matching
 * shipping_address, and selected shipping rates).
 */
export async function syncCartAddressPricing({
  cart,
  billingAddress,
  shippingAddress,
  updateCartCustomerFn,
  updateCartFn,
  isStillCurrent = () => true,
}) {
  if (isCartAddressPriced(cart, shippingAddress)) {
    const currentPaise = Number(cart.totals.total_price);
    return {
      status: "priced",
      cart,
      changedTotal: false,
      previousTotalPaise: currentPaise,
      actualTotalPaise: currentPaise,
    };
  }

  const prevPaise = isUsableCartTotal(cart) ? Number(cart.totals.total_price) : 0;
  const updatedCart = await updateCartCustomerFn(billingAddress, shippingAddress);

  if (!isStillCurrent()) {
    return { status: "cancelled", cart: null, changedTotal: false };
  }

  if (!isCartAddressPriced(updatedCart, shippingAddress)) {
    return { status: "unpriced", cart: updatedCart || null, changedTotal: false };
  }

  if (typeof updateCartFn === "function") {
    updateCartFn(updatedCart);
  }

  const nextPaise = Number(updatedCart.totals.total_price);
  return {
    status: "priced",
    cart: updatedCart,
    changedTotal: prevPaise > 0 && nextPaise !== prevPaise,
    previousTotalPaise: prevPaise,
    actualTotalPaise: nextPaise,
  };
}
