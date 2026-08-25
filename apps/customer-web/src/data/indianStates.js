// List of Indian States & Union Territories with ISO Codes accepted by WooCommerce
export const INDIAN_STATES = [
  { code: "MH", name: "Maharashtra" },
  { code: "GJ", name: "Gujarat" },
  { code: "DL", name: "Delhi" },
  { code: "KA", name: "Karnataka" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "WB", name: "West Bengal" },
  { code: "RJ", name: "Rajasthan" },
  { code: "AP", name: "Andhra Pradesh" },
  { code: "TS", name: "Telangana" },
  { code: "KL", name: "Kerala" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "HR", name: "Haryana" },
  { code: "PB", name: "Punjab" },
  { code: "BR", name: "Bihar" },
  { code: "OR", name: "Odisha" },
  { code: "AS", name: "Assam" },
  { code: "JH", name: "Jharkhand" },
  { code: "CT", name: "Chhattisgarh" },
  { code: "UT", name: "Uttarakhand" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "GA", name: "Goa" },
  { code: "JK", name: "Jammu and Kashmir" },
  { code: "LA", name: "Ladakh" },
  { code: "CH", name: "Chandigarh" },
  { code: "PY", name: "Puducherry" },
  { code: "TR", name: "Tripura" },
  { code: "MN", name: "Manipur" },
  { code: "ML", name: "Meghalaya" },
  { code: "NL", name: "Nagaland" },
  { code: "MZ", name: "Mizoram" },
  { code: "AR", name: "Arunachal Pradesh" },
  { code: "SK", name: "Sikkim" },
  { code: "AN", name: "Andaman and Nicobar Islands" },
  { code: "DN", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "LD", name: "Lakshadweep" },
];

// Map any state name, variation, or ISO code to a valid 2-letter WooCommerce ISO code
export const getIndianStateCode = (input) => {
  if (!input || typeof input !== "string") return "MH";

  const normalized = input.trim().toUpperCase();

  // Check if it's already a valid 2-letter code
  const exactCodeMatch = INDIAN_STATES.find((s) => s.code === normalized);
  if (exactCodeMatch) return exactCodeMatch.code;

  // Check against full state names
  const lowerInput = input.trim().toLowerCase();
  const nameMatch = INDIAN_STATES.find(
    (s) => s.name.toLowerCase() === lowerInput || s.name.toLowerCase().includes(lowerInput)
  );

  if (nameMatch) return nameMatch.code;

  // Default to Maharashtra for Vasai/Mumbai store
  return "MH";
};

// Validation helpers
export const isValidIndianPhone = (phone) => {
  const digits = (phone || "").replace(/\D/g, "");
  return /^[6-9]\d{9}$/.test(digits);
};

// Local Store Delivery Regions (Geo-fenced to Vasai & Nallasopara)
export const DELIVERY_REGIONS = [
  "Vasai West",
  "Vasai East",
  "Nallasopara West",
  "Nallasopara East",
];

export const DEFAULT_STORE_STATE = {
  code: "MH",
  name: "Maharashtra",
};

export const isValidDeliveryRegion = (region) => {
  if (!region || typeof region !== "string") return false;
  const clean = region.trim().toLowerCase();
  return DELIVERY_REGIONS.some((r) => r.toLowerCase() === clean);
};

