/**
 * Delivery Location helpers & options for Employee Panel
 */

export const LOCATION_OPTIONS = [
  { id: "all", label: "All Locations", shortLabel: "All Locations", dot: "bg-gray-400" },
  { id: "vasai-east", label: "Vasai East", shortLabel: "Vasai (E)", dot: "bg-blue-500" },
  { id: "vasai-west", label: "Vasai West", shortLabel: "Vasai (W)", dot: "bg-indigo-500" },
  { id: "nalasopara-east", label: "Nalasopara East", shortLabel: "Nalasopara (E)", dot: "bg-purple-500" },
  { id: "nalasopara-west", label: "Nalasopara West", shortLabel: "Nalasopara (W)", dot: "bg-teal-500" },
  { id: "unassigned", label: "Unassigned", shortLabel: "Unassigned", dot: "bg-amber-500" },
];

/**
 * Resolves the location info object for an order.
 * Uses backend-provided delivery_location / delivery_location_key if present,
 * or derives it deterministically from address fields.
 */
export function getOrderLocationInfo(order) {
  if (!order) {
    return { location: "Unassigned", location_key: "unassigned" };
  }

  if (order.delivery_location && order.delivery_location_key) {
    return {
      location: order.delivery_location,
      location_key: order.delivery_location_key,
    };
  }

  const shipping = order.shipping || {};
  const billing = order.billing || {};

  // Direct city match
  const rawCity = (shipping.city || billing.city || "").trim().toLowerCase();
  if (rawCity) {
    if (rawCity.includes("vasai")) {
      if (rawCity.includes("east") || rawCity.includes("(east)") || rawCity.includes("(e)") || rawCity.includes("-east")) {
        return { location: "Vasai East", location_key: "vasai-east" };
      }
      if (rawCity.includes("west") || rawCity.includes("(west)") || rawCity.includes("(w)") || rawCity.includes("-west")) {
        return { location: "Vasai West", location_key: "vasai-west" };
      }
    }
    if (rawCity.includes("nalasopara") || rawCity.includes("nallasopara") || rawCity.includes("sopara")) {
      if (rawCity.includes("east") || rawCity.includes("(east)") || rawCity.includes("(e)") || rawCity.includes("-east")) {
        return { location: "Nalasopara East", location_key: "nalasopara-east" };
      }
      if (rawCity.includes("west") || rawCity.includes("(west)") || rawCity.includes("(w)") || rawCity.includes("-west")) {
        return { location: "Nalasopara West", location_key: "nalasopara-west" };
      }
    }
  }

  // Postcode match
  const rawPostcode = (shipping.postcode || billing.postcode || "").toString().replace(/\D/g, "").trim();
  if (rawPostcode) {
    if (rawPostcode === "401201") return { location: "Vasai West", location_key: "vasai-west" };
    if (rawPostcode === "401202" || rawPostcode === "401208") return { location: "Vasai East", location_key: "vasai-east" };
    if (rawPostcode === "401203") return { location: "Nalasopara West", location_key: "nalasopara-west" };
    if (rawPostcode === "401209") return { location: "Nalasopara East", location_key: "nalasopara-east" };
  }

  // Address keyword match
  const combined = [
    shipping.address_1,
    shipping.address_2,
    billing.address_1,
    billing.address_2,
  ].filter(Boolean).join(" ").toLowerCase();

  if (combined) {
    if (combined.includes("evershine") || combined.includes("navghar")) {
      return { location: "Vasai East", location_key: "vasai-east" };
    }
    if (combined.includes("chulna") || combined.includes("babola") || combined.includes("ambadi") || combined.includes("vasai station west") || combined.includes("vasai west")) {
      return { location: "Vasai West", location_key: "vasai-west" };
    }
    if (combined.includes("achole") || combined.includes("moregaon") || combined.includes("central park nalasopara") || combined.includes("nalasopara east") || combined.includes("nallasopara east")) {
      return { location: "Nalasopara East", location_key: "nalasopara-east" };
    }
    if (combined.includes("patankar park") || combined.includes("sopara west") || combined.includes("nalasopara west") || combined.includes("nallasopara west")) {
      return { location: "Nalasopara West", location_key: "nalasopara-west" };
    }
  }

  return { location: "Unassigned", location_key: "unassigned" };
}

/**
 * Returns clean styling for location badge.
 */
export function getLocationBadgeClass(locationKey) {
  switch (locationKey) {
    case "vasai-east":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "vasai-west":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "nalasopara-east":
      return "bg-purple-50 text-purple-700 border-purple-200";
    case "nalasopara-west":
      return "bg-teal-50 text-teal-700 border-teal-200";
    case "unassigned":
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}
