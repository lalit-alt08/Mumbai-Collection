let resolvedApiUrl = import.meta.env?.VITE_API_URL;

if (typeof window !== "undefined" && window.location) {
  const hostname = window.location.hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  if (!isLocal) {
    if (!resolvedApiUrl || resolvedApiUrl.includes("localhost") || resolvedApiUrl.includes("127.0.0.1")) {
      resolvedApiUrl = "/api";
    }
  } else if (!resolvedApiUrl) {
    // Match browser's active host (localhost or 127.0.0.1) to avoid IPv6/IPv4 mismatch
    resolvedApiUrl = `http://${hostname}:5000/api`;
  }
}

if (!resolvedApiUrl) {
  resolvedApiUrl = import.meta.env?.PROD ? "/api" : "http://localhost:5000/api";
}

const API_URL = resolvedApiUrl;

export default API_URL;