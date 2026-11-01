const SAFE_CLIENT_STATUSES = new Set([400, 401, 403, 404, 409, 413, 415, 422, 429]);

const SENSITIVE_ERROR_PATTERN =
  /(sql|wpdb|database error|query failed|syntax error|stack trace|fatal error|uncaught|wp-content|wp-includes|node_modules|[a-z]:\\|\/var\/www|\/home\/)/i;

const getUpstreamMessage = (error) => {
  const candidate = error?.response?.data?.message;
  return typeof candidate === "string" ? candidate.trim() : "";
};

/**
 * Convert an upstream WooCommerce/WordPress failure into a client-safe error.
 * Expected validation/auth errors may retain their public message; server and
 * infrastructure failures always receive the controller's generic fallback.
 */
export const sanitizeUpstreamError = (
  error,
  fallbackMessage = "The requested operation could not be completed.",
  fallbackStatus = 500
) => {
  const upstreamStatus = Number(error?.response?.status || error?.status);
  const status =
    Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
      ? upstreamStatus
      : fallbackStatus;
  const upstreamMessage = getUpstreamMessage(error);
  const canExposeMessage =
    SAFE_CLIENT_STATUSES.has(status) &&
    upstreamMessage.length > 0 &&
    upstreamMessage.length <= 300 &&
    !SENSITIVE_ERROR_PATTERN.test(upstreamMessage);

  const payload = {
    success: false,
    message: canExposeMessage ? upstreamMessage : fallbackMessage,
  };

  const upstreamCode = error?.response?.data?.code;
  if (
    SAFE_CLIENT_STATUSES.has(status) &&
    typeof upstreamCode === "string" &&
    /^[a-z0-9_.-]{1,80}$/i.test(upstreamCode)
  ) {
    payload.code = upstreamCode;
  }

  return { status, payload };
};

