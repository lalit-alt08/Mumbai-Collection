/**
 * Utility functions for product stock and price adjustments (used in Mobile Quick Adjust)
 */

/**
 * Validates regular price, sale price, and stock quantity input for product adjustments.
 * If initialProduct is provided, only fields that were actually modified by staff are included in updateData.
 * @param {Object} form - { regular_price, sale_price, stock_quantity }
 * @param {Object|null} [initialProduct=null] - Original product object before edits
 * @returns {{ isValid: boolean, error?: string, updateData?: Object, noChanges?: boolean }}
 */
export function validateAdjustInput(form, initialProduct = null) {
  const updateData = {};
  const hasInitial = initialProduct && typeof initialProduct === "object";

  // 1. Regular Price
  const initialRegStr = hasInitial
    ? String(initialProduct.regular_price ?? initialProduct.price ?? "").trim()
    : null;
  const currentRegStr =
    form.regular_price !== undefined ? String(form.regular_price).trim() : "";
  const regChanged = hasInitial
    ? currentRegStr !== initialRegStr
    : form.regular_price !== undefined && form.regular_price !== "";

  if (regChanged) {
    if (currentRegStr !== "") {
      const numPrice = Number(currentRegStr);
      if (isNaN(numPrice) || numPrice < 0) {
        return { isValid: false, error: "Price must be a valid positive number." };
      }
      updateData.regular_price = String(numPrice);
    } else if (hasInitial) {
      return { isValid: false, error: "Regular price cannot be empty." };
    }
  }

  // 2. Sale Price
  const initialSaleStr = hasInitial
    ? String(initialProduct.sale_price ?? "").trim()
    : null;
  const currentSaleStr =
    form.sale_price !== undefined ? String(form.sale_price).trim() : "";
  const saleChanged = hasInitial
    ? currentSaleStr !== initialSaleStr
    : form.sale_price !== undefined;

  if (saleChanged) {
    if (currentSaleStr === "") {
      updateData.sale_price = "";
    } else {
      const numSale = Number(currentSaleStr);
      if (isNaN(numSale) || numSale < 0) {
        return { isValid: false, error: "Sale price must be a valid positive number." };
      }
      const activeRegStr =
        currentRegStr !== "" ? currentRegStr : (initialRegStr || "");
      const regPrice = activeRegStr ? Number(activeRegStr) : undefined;
      if (regPrice !== undefined && numSale >= regPrice) {
        return { isValid: false, error: "Sale price should be less than regular price." };
      }
      updateData.sale_price = String(numSale);
    }
  } else if (regChanged && currentSaleStr !== "") {
    // If regular price changed, ensure existing sale price is still lower than the new regular price
    const numSale = Number(currentSaleStr);
    const numReg = Number(currentRegStr);
    if (!isNaN(numSale) && !isNaN(numReg) && numSale >= numReg) {
      return { isValid: false, error: "Sale price should be less than regular price." };
    }
  }

  // 3. Stock Quantity
  const initialStockStr =
    hasInitial &&
    initialProduct.stock_quantity !== undefined &&
    initialProduct.stock_quantity !== null
      ? String(initialProduct.stock_quantity).trim()
      : "";
  const currentStockStr =
    form.stock_quantity !== undefined &&
    form.stock_quantity !== null &&
    form.stock_quantity !== ""
      ? String(form.stock_quantity).trim()
      : "";
  const stockChanged = hasInitial
    ? currentStockStr !== initialStockStr
    : currentStockStr !== "";

  if (stockChanged) {
    if (currentStockStr !== "") {
      const numStock = Number(currentStockStr);
      if (isNaN(numStock) || numStock < 0 || !Number.isInteger(numStock)) {
        return { isValid: false, error: "Stock must be a non-negative integer." };
      }
      updateData.stock_quantity = numStock;
    }
  }

  if (hasInitial && Object.keys(updateData).length === 0) {
    return { isValid: false, noChanges: true, error: "No changes to save." };
  }

  return { isValid: true, updateData };
}

/** Add stock compare-and-set only when quantity is intentionally part of the update. */
export function buildProductAdjustmentPayload(updates, initialProduct) {
  const payload = { ...updates };
  if (Object.hasOwn(payload, "stock_quantity")) {
    payload.expected_stock_quantity = initialProduct?.stock_quantity ?? null;
  }
  return payload;
}

/**
 * Applies only fields confirmed as submitted by staff to a product object.
 * @param {Object} product
 * @param {Object} updates - Validated, selective updateData from validateAdjustInput
 * @returns {Object} Updated product object
 */
export function applyProductAdjustment(product, updates) {
  const result = { ...product };

  if (Object.hasOwn(updates, "regular_price")) {
    result.regular_price = String(updates.regular_price);
  }
  if (Object.hasOwn(updates, "sale_price")) {
    result.sale_price = String(updates.sale_price);
  }
  if (Object.hasOwn(updates, "stock_quantity")) {
    result.stock_quantity = Number(updates.stock_quantity);
    result.stock_status = result.stock_quantity <= 0 ? "outofstock" : "instock";
  }

  if (Object.hasOwn(updates, "regular_price") || Object.hasOwn(updates, "sale_price")) {
    const regularPrice = result.regular_price ?? product.regular_price ?? product.price;
    const salePrice = result.sale_price ?? product.sale_price ?? "";
    result.price = salePrice !== "" ? salePrice : regularPrice;
  }

  return result;
}

const normalizePriceForComparison = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return raw;
  const [whole, fraction = ""] = raw.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
};

/** Compare every field in a selective adjustment payload against a fresh product read. */
export function matchesProductAdjustment(product, updates) {
  if (!product || typeof product !== "object" || !updates || typeof updates !== "object") return false;

  for (const field of Object.keys(updates)) {
    if (!Object.hasOwn(product, field)) return false;
    if (field === "regular_price" || field === "sale_price") {
      if (normalizePriceForComparison(product[field]) !== normalizePriceForComparison(updates[field])) return false;
    } else if (field === "stock_quantity") {
      const actual = product[field];
      const expected = updates[field];
      if (actual === null || actual === undefined || expected === null || expected === undefined) {
        if (actual !== expected) return false;
      } else if (Number(actual) !== Number(expected)) {
        return false;
      }
    } else if (product[field] !== updates[field]) {
      return false;
    }
  }

  return true;
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
