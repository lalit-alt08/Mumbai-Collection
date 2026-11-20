/**
 * CSRF Protection Middleware for Cookie-Authenticated State-Changing Requests
 * Validates Origin and same-origin Referer fallback against CORS allowlist.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const isOriginAllowed = (origin, allowedOrigins = []) => {
  if (!origin || typeof origin !== "string") return false;

  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    const isProduction = process.env.NODE_ENV === "production";

    const envAllowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const configuredOrigins = [
      ...String(process.env.CUSTOMER_ORIGIN || "").split(","),
      ...String(process.env.ADMIN_ORIGIN || "").split(","),
      ...String(process.env.EMPLOYEE_ORIGIN || "").split(","),
      ...String(process.env.CLIENT_ORIGIN || "").split(","),
      ...String(process.env.FRONTEND_URL || "").split(","),
      ...envAllowed,
      ...(Array.isArray(allowedOrigins) ? allowedOrigins : []),
    ]
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);

    const expandedOrigins = new Set(configuredOrigins);
    for (const originStr of configuredOrigins) {
      try {
        const u = new URL(originStr);
        if (u.hostname.startsWith("www.")) {
          u.hostname = u.hostname.slice(4);
          expandedOrigins.add(u.origin);
        } else if (
          !u.hostname.startsWith("admin.") &&
          !u.hostname.startsWith("employee.") &&
          u.hostname.includes(".") &&
          !["localhost", "127.0.0.1"].includes(u.hostname)
        ) {
          u.hostname = `www.${u.hostname}`;
          expandedOrigins.add(u.origin);
        }
      } catch (_) {}
    }

    if (isProduction) {
      return [...expandedOrigins].some((a) => typeof a === "string" && a === parsed.origin);
    }

    if (
      (!isProduction || process.env.ALLOW_LOCAL_ORIGINS === "true") &&
      ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1", "::1"].includes(host)
    ) {
      return true;
    }

    const normalizedOrigin = origin.trim().replace(/\/$/, "");
    if (allowedOrigins.some((a) => typeof a === "string" && a.trim().replace(/\/$/, "") === normalizedOrigin)) {
      return true;
    }

    if (
      parsed.protocol === "https:" &&
      (host === "vercel.app" || host.endsWith(".vercel.app") || host === "trycloudflare.com" || host.endsWith(".trycloudflare.com"))
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
  const fail = (res, msg) => res.status(403).json({ success: false, message: `CSRF validation failed: ${msg}` });

  return (req, res, next) => {
    const url = req.originalUrl || req.path || "";
    if (url.startsWith("/api/payments/webhook") || url.startsWith("/api/payments/callback")) return next();
    if (SAFE_METHODS.has(req.method)) return next();

    const originHeader = req.headers.origin;
    if (originHeader) {
      return isOriginAllowed(originHeader, allowedList) ? next() : fail(res, "unauthorized origin.");
    }

    const refererHeader = req.headers.referer;
    if (refererHeader) {
      try {
        const refererOrigin = new URL(refererHeader).origin;
        return isOriginAllowed(refererOrigin, allowedList) ? next() : fail(res, "unauthorized referer.");
      } catch {
        return fail(res, "malformed referer.");
      }
    }

    if (req.headers["sec-fetch-site"] === "cross-site") {
      return fail(res, "cross-site request blocked.");
    }

    const hasAuthCookie = Boolean(
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_admin_auth ||
      req.cookies?.mumbai_employee_auth ||
      req.cookies?.mumbai_wp_auth
    );

    if (!hasAuthCookie || process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
      return next();
    }

    return fail(res, "missing origin and referer headers.");
  };
};

export default verifyCsrf;
