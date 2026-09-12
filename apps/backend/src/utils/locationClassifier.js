/**
 * Deterministic Delivery Location Classifier for Mumbai Collection.
 * 
 * Order evaluation cascade:
 * 1. Direct City Normalization (shipping.city -> billing.city)
 * 2. Postcode Mapping (shipping.postcode -> billing.postcode)
 * 3. Unambiguous Address Keywords (address_1 + address_2)
 * 4. Fallback: Unassigned (safe, explicit non-guessing)
 */

export const DELIVERY_LOCATIONS = {
  VASAI_EAST: {
    location: "Vasai East",
    location_key: "vasai-east",
  },
  VASAI_WEST: {
    location: "Vasai West",
    location_key: "vasai-west",
  },
  NALASOPARA_EAST: {
    location: "Nalasopara East",
    location_key: "nalasopara-east",
  },
  NALASOPARA_WEST: {
    location: "Nalasopara West",
    location_key: "nalasopara-west",
  },
  UNASSIGNED: {
    location: "Unassigned",
    location_key: "unassigned",
  },
};

/**
 * Classifies an order into one of the 4 delivery zones or 'Unassigned'.
 * @param {Object} order - WooCommerce order object (with shipping and billing properties)
 * @returns {{ location: string, location_key: string }}
 */
export function classifyDeliveryLocation(order) {
  if (!order || typeof order !== "object") {
    return { ...DELIVERY_LOCATIONS.UNASSIGNED };
  }

  const shipping = order.shipping || {};
  const billing = order.billing || {};

  // 1. Direct City Normalization
  const rawCity = (shipping.city || billing.city || "").trim().toLowerCase();
  if (rawCity) {
    if (rawCity.includes("vasai")) {
      if (rawCity.includes("east") || rawCity.includes("(east)") || rawCity.includes("(e)") || rawCity.includes("-east")) {
        return { ...DELIVERY_LOCATIONS.VASAI_EAST };
      }
      if (rawCity.includes("west") || rawCity.includes("(west)") || rawCity.includes("(w)") || rawCity.includes("-west")) {
        return { ...DELIVERY_LOCATIONS.VASAI_WEST };
      }
    }

    if (rawCity.includes("nalasopara") || rawCity.includes("nallasopara") || rawCity.includes("sopara")) {
      if (rawCity.includes("east") || rawCity.includes("(east)") || rawCity.includes("(e)") || rawCity.includes("-east")) {
        return { ...DELIVERY_LOCATIONS.NALASOPARA_EAST };
      }
      if (rawCity.includes("west") || rawCity.includes("(west)") || rawCity.includes("(w)") || rawCity.includes("-west")) {
        return { ...DELIVERY_LOCATIONS.NALASOPARA_WEST };
      }
    }
  }

  // 2. Postcode Mapping
  const rawPostcode = (shipping.postcode || billing.postcode || "").toString().replace(/\D/g, "").trim();
  if (rawPostcode) {
    if (rawPostcode === "401201") {
      return { ...DELIVERY_LOCATIONS.VASAI_WEST };
    }
    if (rawPostcode === "401202" || rawPostcode === "401208") {
      return { ...DELIVERY_LOCATIONS.VASAI_EAST };
    }
    if (rawPostcode === "401203") {
      return { ...DELIVERY_LOCATIONS.NALASOPARA_WEST };
    }
    if (rawPostcode === "401209") {
      return { ...DELIVERY_LOCATIONS.NALASOPARA_EAST };
    }
  }

  // 3. Unambiguous Address Keywords
  const combinedAddress = [
    shipping.address_1,
    shipping.address_2,
    billing.address_1,
    billing.address_2,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (combinedAddress) {
    // Vasai East landmarks
    if (combinedAddress.includes("evershine") || combinedAddress.includes("navghar")) {
      return { ...DELIVERY_LOCATIONS.VASAI_EAST };
    }

    // Vasai West landmarks
    if (
      combinedAddress.includes("chulna") ||
      combinedAddress.includes("babola") ||
      combinedAddress.includes("ambadi") ||
      combinedAddress.includes("vasai station west") ||
      combinedAddress.includes("vasai (w)") ||
      combinedAddress.includes("vasai west")
    ) {
      return { ...DELIVERY_LOCATIONS.VASAI_WEST };
    }

    // Nalasopara East landmarks
    if (
      combinedAddress.includes("achole") ||
      combinedAddress.includes("moregaon") ||
      combinedAddress.includes("central park nalasopara") ||
      combinedAddress.includes("nalasopara (e)") ||
      combinedAddress.includes("nallasopara (e)") ||
      combinedAddress.includes("nalasopara east") ||
      combinedAddress.includes("nallasopara east")
    ) {
      return { ...DELIVERY_LOCATIONS.NALASOPARA_EAST };
    }

    // Nalasopara West landmarks
    if (
      combinedAddress.includes("patankar park") ||
      combinedAddress.includes("sopara west") ||
      combinedAddress.includes("nalasopara (w)") ||
      combinedAddress.includes("nallasopara (w)") ||
      combinedAddress.includes("nalasopara west") ||
      combinedAddress.includes("nallasopara west")
    ) {
      return { ...DELIVERY_LOCATIONS.NALASOPARA_WEST };
    }
  }

  // 4. Fallback to Unassigned
  return { ...DELIVERY_LOCATIONS.UNASSIGNED };
}
