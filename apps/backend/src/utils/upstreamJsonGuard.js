import { getCurrentRequestId } from "./requestContext.js";
import { logger } from "./logger.js";
import { alertStaffAnomaly } from "../services/alertService.js";

const ALERT_THROTTLE_MS = 5 * 60 * 1000;
const SKIP_RESPONSE_TYPES = new Set(["arraybuffer", "blob", "stream", "text"]);
const NON_JSON_CONTENT_PREFIXES = ["text/html", "text/plain", "application/xml", "text/xml"];

export const normalizeUpstreamEndpoint = (rawUrl = "") => {
  const input = String(rawUrl || "").trim();
  if (!input) return "unknown";
  let pathname = input;
  try {
    if (/^https?:\/\//i.test(input)) {
      pathname = new URL(input).pathname;
    } else {
      pathname = input.split("?")[0];
    }
  } catch {
    pathname = input.split("?")[0];
  }
  return pathname.replace(/\/\d+(?=\/|$)/g, "/:id") || "/";
};

/**
 * Validates that an upstream WordPress / WooCommerce response expected to be JSON
 * actually parsed into a valid JSON object/array (rejecting PHP warning/HTML leaks
 * even when upstream returned HTTP 200).
 */
export const validateUpstreamJsonResponse = (response, source = "wordpress") => {
  if (!response) return response;

  const responseType = String(response.config?.responseType || "").toLowerCase();
  if (SKIP_RESPONSE_TYPES.has(responseType)) return response;
  if (response.status === 204 || response.status === 304) return response;

  const contentType = String(
    response.headers?.["content-type"] || response.headers?.["Content-Type"] || ""
  )
    .split(";")[0]
    .trim()
    .toLowerCase();

  const data = response.data;
  const isMalformedString = typeof data === "string";
  const isUnexpectedScalar = data === null || (typeof data !== "object" && !isMalformedString);
  const isNonJsonContentType =
    Boolean(contentType) &&
    NON_JSON_CONTENT_PREFIXES.some((prefix) => contentType.startsWith(prefix)) &&
    (isMalformedString || isUnexpectedScalar);

  if (!isMalformedString && !isUnexpectedScalar && !isNonJsonContentType) {
    return response;
  }

  const endpoint = normalizeUpstreamEndpoint(response.config?.url);
  const upstreamStatus = Number(response.status) || 200;
  const requestId =
    getCurrentRequestId() ||
    response.config?.headers?.["X-Request-ID"] ||
    response.config?.headers?.["x-request-id"] ||
    null;

  logger.error(
    {
      source,
      endpoint,
      upstreamStatus,
      contentType: contentType || "unknown",
      bodyType: typeof data,
      requestId,
    },
    "[Upstream JSON Guard] Rejected malformed or non-JSON upstream response"
  );

  // Throttled, PII-free staff alert: never include raw upstream response bodies.
  void alertStaffAnomaly({
    type: "UPSTREAM_INVALID_JSON",
    severity: "critical",
    dedupKey: `upstream-invalid-json:${source}:${endpoint}`,
    dedupMs: ALERT_THROTTLE_MS,
    message: `Upstream ${source} returned a non-JSON or corrupted response on ${endpoint}. Check WordPress PHP logs and active plugins.`,
    details: {
      source,
      endpoint,
      upstreamStatus,
      contentType: contentType || "unknown",
      requestId,
    },
  }).catch(() => {});

  const error = new Error("Store service is temporarily unavailable. Please try again in a moment.");
  error.code = "UPSTREAM_INVALID_JSON";
  error.status = 503;
  error.statusCode = 503;
  error.isUpstreamMalformed = true;
  error.config = response.config;
  // Attach only a sanitized 503 response shape (never the raw upstream body).
  error.response = {
    status: 503,
    headers: {},
    data: {
      success: false,
      code: "UPSTREAM_INVALID_JSON",
      message: "Store service is temporarily unavailable. Please try again in a moment.",
    },
  };
  throw error;
};

/**
 * Sanitizes upstream HTTP error responses (e.g. WordPress fatal HTML 500 or
 * proxy HTML 502) while preserving valid JSON error responses (e.g. 401 invalid
 * credentials or 409 conflicts) untouched.
 */
export const sanitizeUpstreamErrorResponse = (error, source = "wordpress") => {
  if (!error?.response || error.isUpstreamMalformed) return error;

  const responseType = String(error.config?.responseType || "").toLowerCase();
  if (SKIP_RESPONSE_TYPES.has(responseType)) return error;

  const data = error.response.data;
  // Preserve legitimate structured JSON errors (400/401/403/404/409/etc.)
  if (data !== null && typeof data === "object") {
    return error;
  }

  const contentType = String(
    error.response.headers?.["content-type"] || error.response.headers?.["Content-Type"] || ""
  )
    .split(";")[0]
    .trim()
    .toLowerCase();
  const endpoint = normalizeUpstreamEndpoint(error.config?.url);
  const upstreamStatus = Number(error.response.status) || 500;
  const requestId =
    getCurrentRequestId() ||
    error.config?.headers?.["X-Request-ID"] ||
    error.config?.headers?.["x-request-id"] ||
    null;

  logger.error(
    {
      source,
      endpoint,
      upstreamStatus,
      contentType: contentType || "unknown",
      bodyType: typeof data,
      requestId,
    },
    "[Upstream JSON Guard] Sanitized non-JSON upstream error response"
  );

  // Throttled, PII-free staff alert: never include raw HTML/PHP error bodies.
  void alertStaffAnomaly({
    type: "UPSTREAM_INVALID_JSON",
    severity: "critical",
    dedupKey: `upstream-invalid-json:${source}:${endpoint}:${upstreamStatus}`,
    dedupMs: ALERT_THROTTLE_MS,
    message: `Upstream ${source} returned a non-JSON HTTP ${upstreamStatus} error on ${endpoint}. Check WordPress PHP logs and proxy health.`,
    details: {
      source,
      endpoint,
      upstreamStatus,
      contentType: contentType || "unknown",
      requestId,
    },
  }).catch(() => {});

  const sanitizedError = new Error("Store service is temporarily unavailable. Please try again in a moment.");
  sanitizedError.code = "UPSTREAM_INVALID_JSON";
  sanitizedError.status = 503;
  sanitizedError.statusCode = 503;
  sanitizedError.isUpstreamMalformed = true;
  sanitizedError.config = error.config;
  sanitizedError.response = {
    status: 503,
    headers: {},
    data: {
      success: false,
      code: "UPSTREAM_INVALID_JSON",
      message: "Store service is temporarily unavailable. Please try again in a moment.",
    },
  };
  return sanitizedError;
};
