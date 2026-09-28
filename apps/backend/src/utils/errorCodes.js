/**
 * Canonical Mapping of Semantic Error Codes to HTTP Status Codes
 *
 * Used exclusively by responseHelper.js (sendResult).
 * Contains ZERO aliases. Every code maps strictly to a standard HTTP integer.
 */
export const ERROR_CODE_HTTP_STATUS = Object.freeze({
  // ── 400 Bad Request ────────────────────────────────────────────────────────
  MISSING_PARAMETERS: 400,
  VALIDATION_ERROR: 400,
  EMPTY_CART: 400,
  MIN_ORDER_VALUE: 400,
  ADDRESS_VALIDATION_FAILED: 400,
  INVALID_SIGNATURE: 400,
  ORDER_ID_MISMATCH: 400,
  PAYMENT_NOT_CAPTURED: 400,
  CURRENCY_MISMATCH: 400,
  AMOUNT_MISMATCH: 400,
  INVALID_WEBHOOK_SIGNATURE: 400,
  MISSING_WEBHOOK_SIGNATURE: 400,

  // ── 401 Unauthorized ───────────────────────────────────────────────────────
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,

  // ── 403 Forbidden ──────────────────────────────────────────────────────────
  STORE_CLOSED: 403,
  PHONE_NOT_VERIFIED: 403,
  CUSTOMER_SUSPENDED: 403,
  FORBIDDEN_CUSTOMER_MISMATCH: 403,
  FORBIDDEN_ORDER_ACCESS: 403,

  // ── 404 Not Found ──────────────────────────────────────────────────────────
  ORDER_NOT_FOUND: 404,
  INTENT_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,

  // ── 409 Conflict ───────────────────────────────────────────────────────────
  PAYMENT_IN_PROGRESS: 409,
  CAPTURED_AMOUNT_MISMATCH: 409,

  // ── 422 Unprocessable Entity ───────────────────────────────────────────────
  ITEM_OUT_OF_STOCK: 422,

  // ── 500 Internal Server Error ──────────────────────────────────────────────
  INTERNAL_SERVER_ERROR: 500,

  // ── 502 Bad Gateway ────────────────────────────────────────────────────────
  GATEWAY_COMMUNICATION_FAILED: 502,
  GATEWAY_ORDER_CREATION_FAILED: 502,
  ORDER_REGISTRATION_FAILED: 502,
  UPSTREAM_API_FAILED: 502,
  CART_FETCH_FAILED: 502,
  STORE_GATEWAY_ERROR: 502,

  // ── 503 Service Unavailable ────────────────────────────────────────────────
  STORE_HOURS_UNAVAILABLE: 503,
});
