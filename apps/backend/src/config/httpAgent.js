import https from "https";
import http from "http";

const isDev = process.env.NODE_ENV !== "production";

// Parse MEDIA_MAX_SOCKETS with conservative default (30)
const parsedMediaSockets = parseInt(process.env.MEDIA_MAX_SOCKETS, 10);
export const MEDIA_MAX_SOCKETS =
  Number.isInteger(parsedMediaSockets) && parsedMediaSockets > 0
    ? parsedMediaSockets
    : 30;

export const httpsAgent = new https.Agent({
  // LocalWP Nginx drops idle keepalive sockets quickly; in dev, avoid stale socket resets
  keepAlive: !isDev,
  keepAliveMsecs: 10000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  rejectUnauthorized: !isDev,
});

export const httpAgent = new http.Agent({
  keepAlive: !isDev,
  keepAliveMsecs: 10000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

// Dedicated agents for media streaming to prevent socket starvation of core API/checkout
export const mediaHttpsAgent = new https.Agent({
  keepAlive: !isDev,
  keepAliveMsecs: 10000,
  maxSockets: MEDIA_MAX_SOCKETS,
  maxFreeSockets: 10,
  timeout: 60000,
  rejectUnauthorized: !isDev,
});

export const mediaHttpAgent = new http.Agent({
  keepAlive: !isDev,
  keepAliveMsecs: 10000,
  maxSockets: MEDIA_MAX_SOCKETS,
  maxFreeSockets: 10,
  timeout: 60000,
});
