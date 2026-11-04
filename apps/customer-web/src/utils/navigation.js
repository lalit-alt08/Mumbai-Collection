/**
 * Navigation and Internal Path Sanitation Utilities
 */

/**
 * Validates and sanitizes an internal navigation destination.
 * Rejects external URLs (javascript:, data:, https:, //evil.com, /\\evil.com),
 * and prevents authentication redirect loops (e.g., returning to /login or /register).
 *
 * @param {unknown} target - The intended destination path
 * @param {string} [fallback="/"] - Safe fallback if target is invalid or insecure
 * @returns {string} Safe relative internal path
 */
export function getSafeInternalPath(target, fallback = "/") {
  if (typeof target !== "string" || !target.trim()) {
    return fallback;
  }

  const clean = target.trim();

  // Must begin with a single slash; reject protocol-relative (//) or Windows UNC (/\\)
  if (!clean.startsWith("/") || clean.startsWith("//") || clean.startsWith("/\\")) {
    return fallback;
  }

  // Reject CR/LF characters that could manipulate headers or logging
  if (/[\r\n]/.test(clean)) {
    return fallback;
  }

  // Strip query string and hash for path-level loop detection
  const pathPart = clean.split("?")[0].split("#")[0].toLowerCase().replace(/\/+$/, "");

  // Authentication loop paths that an authenticated user should not be sent back to
  const authLoopPaths = [
    "",
    "/login",
    "/register",
    "/profile-setup",
    "/forgot-password",
    "/reset-password",
    "/otp",
  ];

  if (authLoopPaths.includes(pathPart)) {
    return fallback;
  }

  return clean;
}
