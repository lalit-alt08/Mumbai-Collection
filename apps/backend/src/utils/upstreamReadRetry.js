export const shouldRetryUpstreamRead = (error) => {
  const config = error?.config;
  const method = String(config?.method || "get").toLowerCase();
  if (!config || config._retry || !["get", "head"].includes(method)) return false;

  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ECONNABORTED"].includes(code) ||
    message.includes("socket hang up");
};
