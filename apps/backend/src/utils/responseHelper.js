import { ERROR_CODE_HTTP_STATUS } from "./errorCodes.js";

/**
 * Standardized HTTP response dispatcher for application controllers.
 * Guarantees that res.status() is invoked exactly once with a valid integer status code,
 * eliminating any collision between business-status strings and HTTP status codes.
 *
 * @param {import('express').Response} res - Express response object
 * @param {Object} result - Service or controller result shape
 * @param {boolean} result.success - Operation success flag
 * @param {string} [result.errorCode] - Strict semantic error code (mapped via ERROR_CODE_HTTP_STATUS)
 * @param {string} [result.orderStatus] - WooCommerce business status ("processing", etc.)
 * @param {string} [result.message] - Human-readable message
 * @param {Object} [result.data] - Main payload data to spread on success
 * @returns {import('express').Response}
 */
export const sendResult = (res, result) => {
  if (!result || typeof result !== "object") {
    return res.status(500).json({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Malformed server response.",
    });
  }

  const { success, errorCode, orderStatus, message, data, ...extra } = result;

  // ── 1. SUCCESS PATH (Always HTTP 200) ──────────────────────────────────────
  if (success) {
    const payload = {
      success: true,
      message: message || "Operation completed successfully.",
      ...(data && typeof data === "object" ? data : {}),
      ...extra,
    };

    if (orderStatus) {
      payload.orderStatus = orderStatus;
    }

    return res.status(200).json(payload);
  }

  // ── 2. ERROR PATH (Strict Explicit Lookup, Fail-Closed to 500) ─────────────
  const resolvedCode = errorCode || "INTERNAL_SERVER_ERROR";
  const httpStatus = ERROR_CODE_HTTP_STATUS[resolvedCode] ?? 500;

  return res.status(httpStatus).json({
    success: false,
    code: resolvedCode,
    message: message || "An error occurred during request processing.",
    ...extra,
  });
};
