const isManaged = (value) => value === true || value === 1 || value === "yes";

/** Shared stock wording and badge state for mobile cards and desktop rows. */
export const getProductStockDisplay = (product = {}) => {
  const status = String(product.stock_status || "").toLowerCase();
  const managed = isManaged(product.manage_stock);
  const quantity = product.stock_quantity;
  const hasQuantity = quantity !== null && quantity !== undefined && quantity !== "" && Number.isFinite(Number(quantity));
  const numericQuantity = hasQuantity ? Number(quantity) : null;
  const isLowStock =
    status === "instock" && managed && numericQuantity !== null && numericQuantity >= 1 && numericQuantity <= 5;

  let statusLabel = "Stock status unavailable";
  let tone = "gray";
  if (status === "outofstock") {
    statusLabel = "Out of Stock";
    tone = "rose";
  } else if (status === "onbackorder") {
    statusLabel = "On Backorder";
    tone = "blue";
  } else if (status === "instock") {
    statusLabel = isLowStock ? "Low Stock" : "In Stock";
    tone = isLowStock ? "amber" : "emerald";
  }

  return {
    statusLabel,
    tone,
    isLowStock,
    quantityLabel: !managed
      ? "Stock not tracked"
      : hasQuantity
        ? `${numericQuantity} ${numericQuantity === 1 ? "unit" : "units"}`
        : "Quantity unavailable",
  };
};
