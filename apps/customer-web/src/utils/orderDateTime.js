/** Format WooCommerce order creation time independently of the device timezone. */
export function formatOrderPlacedDateTime(order) {
  const gmt = order?.date_created_gmt;
  const local = order?.date_created;
  const source = gmt || local;
  if (typeof source !== "string" || !source.trim()) return "";
  const value = source.trim();
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const timestamp = hasOffset ? value : `${value}${gmt ? "Z" : "+05:30"}`;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
