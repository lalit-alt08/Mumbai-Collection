import https from "https";
import http from "http";

const isProd = process.env.NODE_ENV === "production";
const allowInsecureLocalTls =
  process.env.NODE_ENV === "development" && process.env.ALLOW_INSECURE_LOCAL_TLS === "true";

// Parse MEDIA_MAX_SOCKETS with conservative default (30)
const parsedMediaSockets = parseInt(process.env.MEDIA_MAX_SOCKETS, 10);
export const MEDIA_MAX_SOCKETS =
  Number.isInteger(parsedMediaSockets) && parsedMediaSockets > 0
    ? parsedMediaSockets
    : 30;

export const httpsAgent = new https.Agent({
  // LocalWP Nginx drops idle keepalive sockets quickly; in dev, avoid stale socket resets
  keepAlive: isProd,
  keepAliveMsecs: 10000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  rejectUnauthorized: !allowInsecureLocalTls,
});

export const httpAgent = new http.Agent({
  keepAlive: isProd,
  keepAliveMsecs: 10000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

// Dedicated agents for media streaming to prevent socket starvation of core API/checkout
export const mediaHttpsAgent = new https.Agent({
  keepAlive: isProd,
  keepAliveMsecs: 10000,
  maxSockets: MEDIA_MAX_SOCKETS,
  maxFreeSockets: 10,
  timeout: 60000,
  rejectUnauthorized: !allowInsecureLocalTls,
});

export const mediaHttpAgent = new http.Agent({
  keepAlive: isProd,
  keepAliveMsecs: 10000,
  maxSockets: MEDIA_MAX_SOCKETS,
  maxFreeSockets: 10,
  timeout: 60000,
});
