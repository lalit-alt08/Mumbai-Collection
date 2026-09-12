/**
 * Resolves the tab ID corresponding to an incoming status query parameter.
 * Maps 'processing' or 'active' -> 'active' ("To Pack & Deliver" queue).
 * Preserves known tabs ('packed', 'out-for-delivery', 'completed', 'cancelled', 'all').
 * Defaults to 'active' if no param is present.
 */
export function resolveTabFromStatusParam(param) {
  if (!param) return "active";
  if (param === "processing" || param === "active") return "active";
  if (["packed", "out-for-delivery", "completed", "cancelled", "all"].includes(param)) {
    return param;
  }
  return "active";
}

/**
 * Resolves the order creation date as a YYYY-MM-DD string in the Asia/Kolkata timezone.
 * Handles WooCommerce UTC dates (e.g. "2026-09-06T18:48:32" or "2026-09-06T18:48:32Z").
 */
export function getOrderDateIST(order) {
  if (!order) return null;
  const raw = order.date_created_gmt || order.date_created;
  if (!raw) return null;
  const iso = raw.endsWith("Z") || raw.includes("+") ? raw : `${raw}Z`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

/**
 * Parses order creation date into a Date object assuming UTC if no timezone offset is present.
 */
export function getOrderTimestampDate(order) {
  if (!order) return null;
  const raw = order.date_created_gmt || order.date_created;
  if (!raw) return null;
  const iso = raw.endsWith("Z") || raw.includes("+") ? raw : `${raw}Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Deduplicates customer display names (e.g. historical "lalit lalit" -> "lalit").
 * If first and last name match (case-insensitive), returns a single copy.
 * Otherwise returns the combined full name or fallback.
 */
export function getCleanCustomerName(customerName, first, last, fallback = "Customer") {
  const f = (first || "").trim();
  const l = (last || "").trim();
  if (f || l) {
    if (f && l && f.toLowerCase() === l.toLowerCase()) return f;
    if (f && l) return `${f} ${l}`;
    return f || l || fallback;
  }
  if (customerName) {
    const parts = customerName.trim().split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
      return parts[0];
    }
    return customerName.trim();
  }
  return fallback;
}
