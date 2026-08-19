import https from "https";
import http from "http";

const isDev = process.env.NODE_ENV !== "production";

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
