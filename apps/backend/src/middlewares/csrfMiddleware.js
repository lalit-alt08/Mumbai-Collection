/**
 * CSRF Protection Middleware for Cookie-Authenticated State-Changing Requests
 * Validates Origin and same-origin Referer fallback against CORS allowlist.
 * Treats X-Mumbai-Panel as a routing hint, not an authentication secret.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const isOriginAllowed = (origin, allowedOrigins = []) => {
  if (!origin || typeof origin !== "string") return false;

  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();

    // 1. Localhost / Local IP development (any port, HTTP & HTTPS)
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (host === "localhost" || host === "127.0.0.1" || host === "::1")
    ) {
      return true;
    }

    // 2. Explicitly configured origins from .env (with or without trailing slash)
    const normalizedOrigin = origin.trim().replace(/\/$/, "");
    for (const allowed of allowedOrigins) {
      if (allowed && typeof allowed === "string") {
        if (allowed.trim().replace(/\/$/, "") === normalizedOrigin) {
          return true;
        }
      }
    }

    // 3. Vercel deployments (development/testing and preview builds)
    // In production, wildcards are disabled by default to prevent arbitrary multi-tenant subdomains from accessing production APIs.
    // Set ALLOW_PREVIEW_ORIGINS="true" in .env only if preview/testing wildcards are needed in production.
    const isProduction = process.env.NODE_ENV === "production";
    const allowPreviewOrigins = !isProduction || process.env.ALLOW_PREVIEW_ORIGINS === "true";

    if (
      allowPreviewOrigins &&
      parsed.protocol === "https:" &&
      (host === "vercel.app" || host.endsWith(".vercel.app"))
    ) {
      return true;
    }

    // 4. Production custom domains (mumbaicollection.in and all subdomains)
    if (
      parsed.protocol === "https:" &&
      (host === "mumbaicollection.in" || host.endsWith(".mumbaicollection.in"))
    ) {
      return true;
    }

    // 5. Cloudflare tunnels (development/testing)
    if (
      allowPreviewOrigins &&
      parsed.protocol === "https:" &&
      (host === "trycloudflare.com" || host.endsWith(".trycloudflare.com"))
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

export const verifyCsrf = (allowedOrigins = []) => {
  const allowedList = Array.isArray(allowedOrigins) ? allowedOrigins : [];

  return (req, res, next) => {
    // 0. Exempt machine-to-machine payment webhooks from browser CSRF validation
    if (
      req.path === "/api/payments/webhook" ||
      req.originalUrl?.startsWith("/api/payments/webhook")
    ) {
      return next();
    }

    // 1. Safe HTTP methods (GET, HEAD, OPTIONS) do not alter server state
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    // 2. Check Origin header (protects both authenticated and unauthenticated browser requests)
    const originHeader = req.headers.origin;
    if (originHeader) {
      const isAllowed = isOriginAllowed(originHeader, allowedList);
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          message: "CSRF validation failed: unauthorized origin.",
        });
      }
      return next();
    }

    // 3. Same-origin Referer fallback when Origin is omitted
    const refererHeader = req.headers.referer;
    if (refererHeader) {
      try {
        const refererOrigin = new URL(refererHeader).origin;
        const isAllowed = isOriginAllowed(refererOrigin, allowedList);
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

    // 4. Fetch Metadata fallback (modern browsers)
    const secFetchSite = req.headers["sec-fetch-site"];
    if (secFetchSite === "cross-site") {
      return res.status(403).json({
        success: false,
        message: "CSRF validation failed: cross-site request blocked.",
      });
    }

    // 5. Unauthenticated requests without browser Origin/Referer (e.g. non-browser API clients, curl, testing)
    const hasAuthCookie = Boolean(
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_admin_auth ||
      req.cookies?.mumbai_employee_auth ||
      req.cookies?.mumbai_wp_auth
    );

    if (!hasAuthCookie) {
      return next();
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
