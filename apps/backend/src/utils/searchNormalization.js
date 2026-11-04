/**
 * Search normalization, connector expansion, synonym handling, and tokenization.
 * Supports Unicode (Devanagari, Latin, accented characters) and prevents
 * inappropriate typo corruption on ages, numbers, and short tokens.
 */

export const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "the",
  "to",
  "with",
]);

/**
 * Normalizes text while strictly preserving Unicode letters and numbers.
 * Cleans HTML tags, normalizes whitespace, and folds case.
 *
 * @param {string} value
 * @returns {string}
 */
export const normalizeUnicodeText = (value = "") => {
  if (!value) return "";
  return String(value)
    .replace(/<[^>]*>/g, " ") // strip HTML tags
    .normalize("NFC") // compose characters
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ") // preserve all Unicode letters, marks & numbers
    .trim()
    .replace(/\s+/g, " ");
};

/**
 * Standardizes connector terms like Type-C, USB-C, C-Type so that all variations
 * index and match identically without altering merchant titles.
 *
 * @param {string} text
 * @returns {string}
 */
export const normalizeConnectors = (text = "") => {
  if (!text) return "";
  return text
    .replace(/\b(?:usb\s+)?type\s*[-_]?\s*c\b/gi, "typec")
    .replace(/\busb\s*[-_]?\s*c\b/gi, "typec")
    .replace(/\bc\s*[-_]?\s*type\b/gi, "typec");
};

/**
 * Centralized synonyms dictionary.
 * Bi-directional mappings for common terms in the Mumbai Collection catalog.
 */
export const SYNONYM_MAP = new Map([
  ["rc", ["remote", "control"]],
  ["remote", ["rc"]],
  ["control", ["rc"]],
  ["pendrive", ["flash", "drive", "usb"]],
  ["pen drive", ["pendrive", "flash drive"]],
]);

/**
 * Extracts protected entities (ages, SKU model codes, numeric constraints)
 * BEFORE stripping punctuation.
 *
 * @param {string} query
 * @returns {{ requiredAges: string[], requiredSkus: string[], numericTokens: string[] }}
 */
// Set of common descriptive, unit, pack, and connector words that appear in hyphenated expressions
// e.g. "3-in-1", "2-pack", "4-wheel", "10-piece", "100-percent", "type-c", "wi-fi", "non-toxic"
const DESCRIPTIVE_HYPHEN_WORDS = new Set([
  "in", "one", "pack", "packs", "wheel", "wheels", "piece", "pieces", "pc", "pcs",
  "ply", "port", "ports", "pin", "pins", "way", "ways", "tier", "tiers",
  "blade", "blades", "speed", "speeds", "step", "steps", "seat", "seats",
  "cup", "cups", "core", "cores", "watt", "watts", "volt", "volts", "amp",
  "amps", "gauge", "meter", "meters", "metre", "metres", "inch", "inches",
  "cm", "mm", "year", "years", "yr", "yrs", "month", "months", "day", "days",
  "hour", "hours", "oz", "ml", "gb", "tb", "ton", "tons", "color", "colors",
  "colour", "colours", "part", "parts", "layer", "layers", "point", "points",
  "leg", "legs", "stroke", "strokes", "channel", "channels", "button", "buttons",
  "type", "usb", "wifi", "toxic", "fast", "slow", "high", "low", "light", "heavy",
  "mini", "max", "pro", "plus", "extra", "auto", "manual", "hand", "remote",
  "control", "oil", "pastel", "pastels", "water", "proof", "resistant", "free"
]);

/**
 * Extracts protected entities (ages, SKU model codes, numeric constraints)
 * BEFORE stripping punctuation.
 *
 * @param {string} query
 * @param {Set<string>|string[]} [knownSkus=null] - Collection of actual indexed catalog SKUs
 * @returns {{ requiredAges: string[], requiredSkus: string[], numericTokens: string[] }}
 */
export const extractQueryEntities = (query = "", knownSkus = null) => {
  const str = String(query || "");
  const requiredAges = [];
  const ageRegex = /\b(\d+)\s*(?:\+|plus|yr|yrs|year|years)\b|\b(\d+)\+/gi;
  let match;
  while ((match = ageRegex.exec(str)) !== null) {
    const num = match[1] || match[2];
    requiredAges.push(`${num}+`);
  }

  // Check if a candidate matches known indexed catalog SKUs
  const matchesKnownSku = (candidate) => {
    if (!knownSkus) return false;
    const clean = candidate.toLowerCase();
    const norm = clean.replace(/[^a-z0-9]/g, "");
    if (knownSkus instanceof Set) {
      return knownSkus.has(clean) || knownSkus.has(norm);
    }
    if (Array.isArray(knownSkus)) {
      return knownSkus.includes(clean) || knownSkus.includes(norm);
    }
    return false;
  };

  const requiredSkus = [];
  const skuRegex = /\b([A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})+)\b/g;

  while ((match = skuRegex.exec(str)) !== null) {
    const candidate = match[1];
    const lowerCandidate = candidate.toLowerCase();

    // 1. Direct match against actual indexed SKU values
    if (matchesKnownSku(candidate)) {
      requiredSkus.push(lowerCandidate);
      continue;
    }

    // 2. Reject ambiguous numbered phrases or common descriptive words
    // e.g. "3-in-1", "2-pack", "4-wheel", "oil-pastels", "remote-control", "non-toxic"
    const segments = lowerCandidate.split("-");
    const hasDescriptiveWord = segments.some((s) => DESCRIPTIVE_HYPHEN_WORDS.has(s));
    if (hasDescriptiveWord) {
      // Treat ambiguous numbered phrase as ordinary search text
      continue;
    }

    // 3. For unknown candidates, only treat as required SKU if there is reliable SKU intent
    // (i.e. uppercase product abbreviation code + model digits, e.g. CBL-TC-01, JH-RC-02)
    // and no indexed SKUs list was provided to refute it.
    const hasIndexedSkus = (knownSkus instanceof Set && knownSkus.size > 0) || (Array.isArray(knownSkus) && knownSkus.length > 0);
    if (!hasIndexedSkus) {
      const origSegments = candidate.split("-");
      const hasDigitSegment = origSegments.some((s) => /^\d+$/.test(s));
      const hasCodeSegment = origSegments.some((s) => /^[A-Z]{2,4}$/.test(s));
      if (hasDigitSegment && hasCodeSegment) {
        requiredSkus.push(lowerCandidate);
      }
    }
  }

  const numericTokens = [];
  const numRegex = /\b(\d+)\b/g;
  while ((match = numRegex.exec(str)) !== null) {
    numericTokens.push(match[1]);
  }

  return {
    requiredAges: [...new Set(requiredAges)],
    requiredSkus: [...new Set(requiredSkus)],
    numericTokens: [...new Set(numericTokens)],
  };
};

/**
 * Checks if a token represents an age constraint (e.g., "3+", "4+", "5") or pure number.
 * Fuzziness must be disabled for these to avoid treating "3+" and "4+" as typos of each other.
 *
 * @param {string} token
 * @returns {boolean}
 */
export const isNumericOrAgeToken = (token = "") => {
  if (!token) return false;
  return /^\d+(\+|(?:plus|yr|yrs|year|years))?$/i.test(token.trim());
};

/**
 * Checks if a token is short (<= 3 characters) or an SKU/model code.
 *
 * @param {string} token
 * @param {string[]} [knownSkus=[]]
 * @returns {boolean}
 */
export const isShortOrSkuToken = (token = "", knownSkus = []) => {
  if (!token) return false;
  const clean = token.trim().toLowerCase();
  if (clean.length <= 3) return true;
  if (/^[a-z0-9]+-[a-z0-9-]+$/i.test(clean)) return true;
  for (const sku of knownSkus) {
    if (sku.toLowerCase().split("-").includes(clean)) return true;
  }
  return false;
};

/**
 * Tokenizes text for indexing or querying.
 *
 * @param {string} text
 * @returns {string[]}
 */
export const tokenizeSearchText = (text = "") => {
  if (!text) return [];
  const normalized = normalizeConnectors(normalizeUnicodeText(text));
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens;
};

/**
 * Extracts meaningful search tokens from a user query, expanding synonyms
 * while strictly preserving protected ages and SKU identities.
 *
 * @param {string} query
 * @returns {{
 *   terms: string[],
 *   originalQuery: string,
 *   normalizedQuery: string,
 *   hasConnectors: boolean,
 *   requiredAges: string[],
 *   requiredSkus: string[],
 *   numericTokens: string[]
 * }}
 */
export const parseSearchQuery = (query = "", knownSkus = null) => {
  const original = String(query || "").trim();
  const entities = extractQueryEntities(original, knownSkus);

  const normalized = normalizeConnectors(normalizeUnicodeText(original));
  const rawTokens = normalized.split(" ").filter(Boolean);

  // Preserve single-character numbers if they represent ages/numeric constraints
  const meaningfulTokens = rawTokens.filter(
    (t) => (t.length > 1 || /\d/.test(t)) && !SEARCH_STOP_WORDS.has(t)
  );
  const terms = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;

  // Expand synonyms (e.g., "rc car" -> also include "remote", "control")
  const expandedTerms = new Set(terms);
  for (const term of terms) {
    const synonyms = SYNONYM_MAP.get(term);
    if (synonyms) {
      for (const syn of synonyms) {
        expandedTerms.add(syn);
      }
    }
  }

  // Check phrase synonyms: e.g. "remote control" -> "rc"
  if (normalized.includes("remote control")) {
    expandedTerms.add("rc");
  }

  return {
    originalQuery: original,
    normalizedQuery: normalized,
    terms: [...expandedTerms],
    hasConnectors: normalized.includes("typec"),
    requiredAges: entities.requiredAges,
    requiredSkus: entities.requiredSkus,
    numericTokens: entities.numericTokens,
  };
};

/**
 * Determines fuzziness for a term in MiniSearch.
 * - Age numbers / digits: 0 (fuzziness disabled)
 * - Tokens <= 3 chars or SKUs: 0 (fuzziness disabled)
 * - Tokens 4-6 chars: max 1 edit (conservative: 0.2)
 * - Tokens >= 7 chars: max 1-2 edits (conservative: 0.2)
 *
 * @param {string} term
 * @param {string[]} [knownSkus=[]]
 * @returns {number|false}
 */
export const getTermFuzziness = (term = "", knownSkus = []) => {
  if (!term || typeof term !== "string") return false;
  const clean = term.trim().toLowerCase();

  // Disable fuzziness on numbers, ages, SKUs, and short words
  if (isNumericOrAgeToken(clean) || isShortOrSkuToken(clean, knownSkus)) {
    return false;
  }

  // For words with length >= 4, allow conservative typo tolerance
  return 0.2;
};

/**
 * Determines prefix matching for a term in MiniSearch.
 * Only enables prefix matching on the last token of a query, provided it has length >= 3
 * and is not an age number, digit, or SKU.
 *
 * @param {string} term
 * @param {number} index
 * @param {string[]} terms
 * @returns {boolean}
 */
export const getTermPrefix = (term = "", index = 0, terms = [], knownSkus = []) => {
  if (!term || typeof term !== "string") return false;
  const isLast = Array.isArray(terms) && index === terms.length - 1;
  if (!isLast) return false;
  const clean = term.trim().toLowerCase();
  if (clean.length < 3 || isNumericOrAgeToken(clean) || isShortOrSkuToken(clean, knownSkus)) {
    return false;
  }
  return true;
};
