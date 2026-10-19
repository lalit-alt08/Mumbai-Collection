/** Retry policy for read-only requests. A network error does not prove a mutation
 * was not applied, so writes are never replayed automatically by this helper.
 */

export const isTransientConnectionError = (error) => {
  if (!error) return false;
  // If the server responded with any HTTP status (200, 400, 401, 500), it's not a dead socket
  if (error.response) {
    const status = error.response.status;
    return status === 502 || status === 503 || status === 504;
  }

  const code = String(error.code || "").toUpperCase();
  const msg = String(error.message || "").toLowerCase();

  return (
    code === "ERR_NETWORK" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    msg.includes("network error") ||
    msg.includes("err_connection_refused") ||
    msg.includes("err_connection_reset") ||
    msg.includes("timeout")
  );
};

export const isSafeReadRequest = (config) =>
  ["get", "head"].includes(String(config?.method || "get").toLowerCase());

export const shouldRetryReadRequest = (error, config = error?.config) =>
  Boolean(config) && isSafeReadRequest(config) && isTransientConnectionError(error);

export const getReadRetryDelayMs = (error) => {
  const headers = error?.response?.headers;
  const retryAfter = typeof headers?.get === "function"
    ? headers.get("retry-after")
    : headers?.["retry-after"] || headers?.["Retry-After"];

  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(retryAt)) return retryAt > 5000 ? null : Math.max(0, retryAt);
  }

  return error?.response ? 400 : 150;
};

export const attachStaleConnectionRetry = (axiosInstance) => {
  if (!axiosInstance?.interceptors?.response) return axiosInstance;

  axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error?.config;
      if (!config) return Promise.reject(error);

      // Only retry idempotent reads, once. The server may have processed a write
      // even when the browser received no response.
      if (!config._networkRetryCount && shouldRetryReadRequest(error, config)) {
        const delayMs = getReadRetryDelayMs(error);
        if (delayMs === null) return Promise.reject(error);
        config._networkRetryCount = 1;
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        return axiosInstance(config);
      }

      return Promise.reject(error);
    }
  );

  return axiosInstance;
};
