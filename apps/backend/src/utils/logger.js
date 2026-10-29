import pino from "pino";

const REDACT_KEYS = ["password", "otp", "token", "secret", "cookie", "authorization", "idempotency", "api_key", "apikey"];

export const sanitizeLogValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return String(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeLogValue);
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, child]) => [
    key,
    REDACT_KEYS.some((term) => key.toLowerCase().includes(term)) ? "[REDACTED]" : sanitizeLogValue(child),
  ]));
};

export const getErrorMessage = (error) => {
  let message = String(error?.error?.description || error?.response?.data?.error?.description || error?.message || "Unknown error");
  for (const key of ["RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "TELEGRAM_BOT_TOKEN", "MUMBAI_INTERNAL_API_KEY", "REDIS_PASSWORD"]) {
    if (process.env[key]) message = message.split(process.env[key]).join("[REDACTED]");
  }
  return message.replace(/rediss?:\/\/[^\s]+/gi, "[REDACTED_REDIS_URL]").slice(0, 500);
};

export const sanitizeError = (error) => ({
  name: error?.name,
  message: getErrorMessage(error),
  code: error?.error?.code || error?.code,
  status: error?.statusCode || error?.response?.status,
  stack: process.env.NODE_ENV === "production" ? undefined : String(error?.stack || "").slice(0, 2000),
  upstream: sanitizeLogValue(error?.response?.data),
});

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", "*.password", "*.otp", "*.token", "*.secret", "*.idempotencyKey"],
    censor: "[REDACTED]",
  },
});

export const logError = (req, error, message) => {
  const target = req?.log || logger;
  target.error({ err: sanitizeError(error), requestId: req?.id }, message);
  if ((Number(error?.response?.status) || 500) >= 500) {
    void import("../services/alertService.js").then(({ alertStaffAnomaly }) => alertStaffAnomaly({
      type: "CONTROLLER_FAILURE", severity: "critical",
      message: "A backend operation failed. Inspect the server logs using its request ID.",
      details: { requestId: req?.id, source: `${req?.method || "unknown"}:${(req?.originalUrl || req?.url || "unmatched").split("?")[0].replace(/\/\d+(?=\/|$)/g, "/:id")}:${error?.code || error?.response?.status || "failure"}` },
    })).catch(() => {});
  }
};
