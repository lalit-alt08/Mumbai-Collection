import pino from "pino";

const REDACT_KEYS = ["password", "otp", "token", "secret", "cookie", "authorization", "idempotency", "api_key", "apikey"];

export const sanitizeLogValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return String(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeLogValue);
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, child]) => [
    key,
    REDACT_KEYS.some((term) => key.toLowerCase().includes(term)) ? "[REDACTED]" : sanitizeLogValue(child),
  ]));
};

export const sanitizeError = (error) => ({
  name: error?.name,
  message: String(error?.message || "Unknown error").slice(0, 500),
  code: error?.code,
  status: error?.response?.status,
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
};
