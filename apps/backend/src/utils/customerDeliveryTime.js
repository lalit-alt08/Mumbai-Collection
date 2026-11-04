// Return only timestamps whose timezone is explicit or known to be UTC.
export function customerDeliveryTime(order) {
  const meta = Array.isArray(order?.meta_data) ? order.meta_data : [];
  const candidates = [
    meta.find((entry) => entry?.key === "_delivery_completed_at")?.value,
    meta.find((entry) => entry?.key === "_delivered_at")?.value,
  ];
  for (const value of candidates) {
    if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) continue;
    const time = Date.parse(value);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  if (typeof order?.date_completed_gmt === "string") {
    const value = order.date_completed_gmt;
    const time = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  // Local WooCommerce timestamps without an offset depend on the store setting.
  const local = order?.date_completed;
  if (typeof local === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(local)) {
    const time = Date.parse(local);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return null;
}
