/**
 * Sanitizes upstream WordPress auth errors to prevent information disclosure (paths, SQL, WP internals).
 * Strips HTML tags and preserves clean user-facing error messages for legitimate client feedback.
 */
export const sanitizeAuthError = (error, defaultMessage = "Authentication request failed", fallbackStatus = 500) => {
  const status = error.response?.status || error.status || fallbackStatus;
  const upstreamData = error.response?.data;
  let message = defaultMessage;

  if (typeof upstreamData?.message === "string" && upstreamData.message.trim().length > 0) {
    const cleanMsg = upstreamData.message.replace(/<[^>]*>/g, "").trim();
    if (!/database error|sql|wpdb|syntax error|stack trace|fatal error|wp-content/i.test(cleanMsg)) {
      message = cleanMsg;
    }
  }

  const payload = {
    success: false,
    message,
  };

  if (typeof upstreamData?.code === "string") {
    payload.code = upstreamData.code;
  }

  return { status, payload };
};
