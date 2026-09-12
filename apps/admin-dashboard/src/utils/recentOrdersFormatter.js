/**
 * Recent Customer Orders Formatting Helpers
 */

/**
 * Formats order date and time in Asia/Kolkata timezone.
 * Handles naive ISO strings by ensuring UTC parsing and then formatting in IST.
 * Output example: "08 Sep, 06:35 pm"
 */
export function formatOrderDateTimeIST(dateStr) {
  if (!dateStr) return "";
  const iso = dateStr.endsWith("Z") || dateStr.includes("+") ? dateStr : `${dateStr}Z`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";

  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
  }).format(d);

  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    month: "short",
  }).format(d);

  const timePart = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d).toLowerCase();

  return `${day} ${month}, ${timePart}`;
}

/**
 * Resolves Tailwind styling badge for order status
 */
export function getStatusBadgeClass(status) {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    case "processing":
      return "bg-blue-50 text-blue-700 border border-blue-200";
    case "packed":
      return "bg-purple-50 text-purple-700 border border-purple-200";
    case "out-for-delivery":
    case "dispatched":
      return "bg-orange-50 text-[#FF8A00] border border-orange-200";
    case "cancelled":
    case "failed":
      return "bg-rose-50 text-rose-700 border border-rose-200";
    default:
      return "bg-gray-100 text-gray-700 border border-gray-200";
  }
}
