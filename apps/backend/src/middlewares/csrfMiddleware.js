/**
 * CSRF Protection Middleware for Cookie-Authenticated State-Changing Requests
 * Validates Origin and same-origin Referer fallback against CORS allowlist.
 * Treats X-Mumbai-Panel as a routing hint, not an authentication secret.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const isDevLocalhost = (origin) => {
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
};

export const verifyCsrf = (allowedOrigins = []) => {
  const allowedSet = new Set(allowedOrigins.filter(Boolean));

  return (req, res, next) => {
    // 1. Safe HTTP methods (GET, HEAD, OPTIONS) do not alter server state
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    // 2. Only protect cookie-authenticated requests
    const hasAuthCookie = Boolean(
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_admin_auth ||
      req.cookies?.mumbai_employee_auth
    );

    if (!hasAuthCookie) {
      // Unauthenticated mutations (e.g. login, register) are handled by auth/rate-limit middleware
      return next();
    }

    // 3. Check Origin header
    const originHeader = req.headers.origin;
    if (originHeader) {
      const isAllowed = allowedSet.has(originHeader) || isDevLocalhost(originHeader);
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          message: "CSRF validation failed: unauthorized origin.",
        });
      }
      return next();
    }

    // 4. Same-origin Referer fallback when Origin is omitted
    const refererHeader = req.headers.referer;
    if (refererHeader) {
      try {
        const refererOrigin = new URL(refererHeader).origin;
        const isAllowed = allowedSet.has(refererOrigin) || isDevLocalhost(refererOrigin);
        if (!isAllowed) {
          return res.status(403).json({
            success: false,
            message: "CSRF validation failed: unauthorized referer.",
          });
        }
        return next();
      } catch {
        return res.status(403).json({
          success: false,
          message: "CSRF validation failed: malformed referer.",
        });
      }
    }

    // 5. Fetch Metadata fallback (modern browsers)
    const secFetchSite = req.headers["sec-fetch-site"];
    if (secFetchSite === "cross-site") {
      return res.status(403).json({
        success: false,
        message: "CSRF validation failed: cross-site request blocked.",
      });
    }

    // In local development or automated testing with non-browser clients (where Origin/Referer may be absent)
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
      return next();
    }

    // In production, reject cookie-authenticated state mutations lacking Origin/Referer
    return res.status(403).json({
      success: false,
      message: "CSRF validation failed: missing origin and referer headers.",
    });
  };
};

export default verifyCsrf;
