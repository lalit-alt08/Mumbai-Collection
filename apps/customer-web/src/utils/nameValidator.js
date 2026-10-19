/**
 * Normalizes extra whitespace in person names (collapses multiple whitespace characters to a single space and trims).
 * Preserves original letter casing (does not force capitalization).
 *
 * @param {string} name
 * @returns {string}
 */
export const normalizePersonName = (name) => {
  if (typeof name !== "string") return "";
  return name.trim().replace(/\s+/g, " ");
};

/**
 * Validates that a person's name:
 * 1. Has non-empty content (1 to 100 characters).
 * 2. Starts with a Unicode letter or combining mark.
 * 3. Contains only Unicode letters, marks (supporting Indian scripts like Devanagari, Gujarati, Tamil, etc.),
 *    single spaces, hyphens, apostrophes, and periods for initials.
 * 4. Rejects punctuation/symbols such as semicolons (;), colons, brackets, @, $, digits, etc.
 * 5. Contains at least one letter.
 *
 * @param {string} name
 * @returns {boolean}
 */
export const isValidPersonName = (name) => {
  const normalized = normalizePersonName(name);
  if (!normalized || normalized.length < 1 || normalized.length > 100) {
    return false;
  }
  // Must start with a Unicode letter or mark, allow letters, marks, spaces, hyphens, apostrophes, and periods
  const namePattern = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u;
  if (!namePattern.test(normalized)) {
    return false;
  }
  // Must contain at least one Unicode letter or combining mark
  return /[\p{L}\p{M}]/u.test(normalized);
};
