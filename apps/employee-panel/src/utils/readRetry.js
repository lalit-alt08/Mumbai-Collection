export const shouldRetryRead = (error, config = error?.config) => {
  const method = String(config?.method || "get").toLowerCase();
  if (!config || !["get", "head"].includes(method)) return false;

  if (error?.response) {
    return [502, 503, 504].includes(error.response.status);
  }

  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return ["ERR_NETWORK", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ECONNABORTED"].includes(code) ||
    message.includes("network error") ||
    message.includes("err_connection_refused") ||
    message.includes("err_connection_reset") ||
    message.includes("timeout");
};

export const readRetryDelayMs = (error) => {
  const headers = error?.response?.headers;
  const retryAfter = typeof headers?.get === "function"
    ? headers.get("retry-after")
    : headers?.["retry-after"] || headers?.["Retry-After"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay)) return delay > 5000 ? null : Math.max(0, delay);
  }
  return error?.response ? 400 : 150;
};
