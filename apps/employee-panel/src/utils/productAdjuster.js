/**
 * Utility functions for product stock and price adjustments (used in Mobile Quick Adjust)
 */

/**
 * Validates regular price, sale price, and stock quantity input for product adjustments.
 * @param {Object} form - { regular_price, sale_price, stock_quantity }
 * @returns {{ isValid: boolean, error?: string, updateData?: Object }}
 */
export function validateAdjustInput(form) {
  const updateData = {};

  if (form.regular_price !== undefined && form.regular_price !== "") {
    const numPrice = Number(form.regular_price);
    if (isNaN(numPrice) || numPrice < 0) {
      return { isValid: false, error: "Price must be a valid positive number." };
    }
    updateData.regular_price = String(numPrice);
  }

  if (form.sale_price !== undefined) {
    if (form.sale_price === "") {
      updateData.sale_price = "";
    } else {
      const numSale = Number(form.sale_price);
      if (isNaN(numSale) || numSale < 0) {
        return { isValid: false, error: "Sale price must be a valid positive number." };
      }
      const regPrice =
        form.regular_price !== undefined && form.regular_price !== ""
          ? Number(form.regular_price)
          : undefined;
      if (regPrice !== undefined && numSale >= regPrice) {
        return { isValid: false, error: "Sale price should be less than regular price." };
      }
      updateData.sale_price = String(numSale);
    }
  }

  if (form.stock_quantity !== undefined && form.stock_quantity !== "") {
    const numStock = Number(form.stock_quantity);
    if (isNaN(numStock) || numStock < 0 || !Number.isInteger(numStock)) {
      return { isValid: false, error: "Stock must be a non-negative integer." };
    }
    updateData.stock_quantity = numStock;
  }

  return { isValid: true, updateData };
}

/**
 * Applies optimistic adjustment updates to a product object.
 * @param {Object} product
 * @param {Object} form - { regular_price, sale_price, stock_quantity }
 * @returns {Object} Updated product object
 */
export function applyProductAdjustment(product, form) {
  const stockNum =
    form.stock_quantity !== "" && form.stock_quantity !== undefined
      ? Number(form.stock_quantity)
      : product.stock_quantity;

  const regularPriceVal =
    form.regular_price !== "" && form.regular_price !== undefined
      ? String(form.regular_price)
      : product.regular_price || product.price;

  const salePriceVal =
    form.sale_price !== undefined
      ? String(form.sale_price)
      : product.sale_price || "";

  const effectivePrice =
    salePriceVal && Number(salePriceVal) > 0 ? salePriceVal : regularPriceVal;

  return {
    ...product,
    price: effectivePrice !== undefined ? effectivePrice : product.price,
    regular_price: regularPriceVal !== undefined ? regularPriceVal : product.regular_price,
    sale_price: salePriceVal,
    stock_quantity: stockNum,
    stock_status: stockNum > 0 ? "instock" : "outofstock",
  };
}

/**
 * Calculates updated stock with a step or delta, ensuring non-negative integers.
 * @param {number|string} currentStock
 * @param {number} delta
 * @returns {number} Non-negative integer
 */
export function calculateStockStep(currentStock, delta) {
  const base = Number(currentStock) || 0;
  return Math.max(0, Math.round(base + delta));
}
