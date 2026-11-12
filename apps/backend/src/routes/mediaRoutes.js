import express from "express";
import axios from "axios";
import path from "path";
import { mediaHttpsAgent, mediaHttpAgent } from "../config/httpAgent.js";
import { logError } from "../utils/logger.js";

const router = express.Router();

const WP_BASE_URL = process.env.WORDPRESS_URL || "https://mumbai-collection.local";

// Allowed media file extensions for security
const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".svg",
  ".avif",
  ".ico",
  ".mp4",
]);

/**
 * Secure WordPress Media Proxy
 * Streams images and MP4 videos from WordPress /wp-content/uploads/*
 * Supports GET and HEAD methods, byte range requests (206 Partial Content),
 * and clean upstream teardown on client abort.
 */
router.use(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const rawPath = req.path;

  // Strip leading /uploads or /
  const mediaPath = rawPath.replace(/^\/uploads\/?/, "").replace(/^\//, "");

  if (!mediaPath) {
    return res.status(400).json({ success: false, message: "Media path is required." });
  }

  // Security 1: Prevent directory traversal, CRLF, and null byte injection
  // Strip query parameters or hashes from path checks so query strings cannot bypass validation
  const cleanPath = mediaPath.split("?")[0].split("#")[0];

  // Decode repeatedly until stable with strict iteration limit to reject double-encoding
  let decoded = cleanPath;
  for (let i = 0; i < 5; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch (_) {
      return res.status(400).json({ success: false, message: "Invalid media path encoding." });
    }
  }

  if (
    cleanPath.includes("..") ||
    decoded.includes("..") ||
    /[\0\r\n\x00-\x1f]/.test(mediaPath) ||
    /%00|%0d|%0a/i.test(mediaPath) ||
    /%25|%2e|%2f|%5c/i.test(cleanPath)
  ) {
    return res.status(400).json({ success: false, message: "Invalid media path." });
  }

  const normalized = path.normalize(decoded).replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/") || path.isAbsolute(decoded)) {
    return res.status(400).json({ success: false, message: "Invalid media path." });
  }

  const wpBaseUrl = process.env.WORDPRESS_URL || WP_BASE_URL;
  let baseUploadsUrl;
  let targetUrlObj;
  try {
    baseUploadsUrl = new URL("/wp-content/uploads/", wpBaseUrl);
    targetUrlObj = new URL(normalized.replace(/^\/+/, ""), baseUploadsUrl);
  } catch (_) {
    return res.status(400).json({ success: false, message: "Invalid media URL." });
  }

  // Strictly verify the target URL stays beneath /wp-content/uploads/
  if (
    !targetUrlObj.pathname.startsWith(baseUploadsUrl.pathname) ||
    targetUrlObj.origin !== baseUploadsUrl.origin
  ) {
    return res.status(400).json({ success: false, message: "Invalid media path traversal." });
  }

  // Security 2: Whitelist allowed media extensions
  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return res.status(403).json({ success: false, message: "Unsupported file type." });
  }

  const targetUrl = targetUrlObj.href;

  // Forward Range header if present
  const requestHeaders = {};
  if (req.headers.range) {
    requestHeaders.Range = req.headers.range;
  }

  const upstreamAbort = new AbortController();
  const abortUpstreamOnDisconnect = () => {
    if (!res.writableEnded) upstreamAbort.abort();
  };
  res.on("close", abortUpstreamOnDisconnect);

  try {
    let response;
    const isHead = req.method === "HEAD";

    const fetchConfig = {
      method: isHead ? "HEAD" : "GET",
      url: targetUrl,
      headers: requestHeaders,
      httpsAgent: mediaHttpsAgent,
      httpAgent: mediaHttpAgent,
      responseType: isHead ? "text" : "stream",
      timeout: 15000,
      signal: upstreamAbort.signal,
      validateStatus: (status) => status === 200 || status === 206 || status === 416,
    };

    try {
      response = await axios(fetchConfig);
    } catch (err) {
      if (err.response?.status === 404 && normalized.includes(".SY522.")) {
        const altPath = normalized.replace(".SY522.", "._SY522_.");
        const altUrl = `${wpBaseUrl}/wp-content/uploads/${altPath.replace(/\\/g, "/")}`;
        response = await axios({
          ...fetchConfig,
          url: altUrl,
        });
      } else {
        throw err;
      }
    }

    // Pass through status (200, 206 Partial Content, or 416 Range Not Satisfiable)
    res.status(response.status);

    // Pass through Content-Type and caching headers
    if (ext === ".mp4") {
      res.setHeader("Content-Type", "video/mp4");
    } else if (response.headers["content-type"]) {
      res.setHeader("Content-Type", response.headers["content-type"]);
    }

    if (response.status !== 416 && response.headers["content-length"]) {
      res.setHeader("Content-Length", response.headers["content-length"]);
    }
    if (response.headers["content-range"]) {
      res.setHeader("Content-Range", response.headers["content-range"]);
    }
    res.setHeader("Accept-Ranges", response.headers["accept-ranges"] || "bytes");

    if (response.headers["last-modified"]) {
      res.setHeader("Last-Modified", response.headers["last-modified"]);
    }
    if (response.headers["etag"]) {
      res.setHeader("ETag", response.headers["etag"]);
    }

    // Explicitly allow cross-origin embedding by frontend apps (e.g. Vercel deployment)
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Strictly neutralize stored XSS execution in SVG files
    if (ext === ".svg") {
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    }

    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

    if (response.status === 416) {
      if (response.data && typeof response.data.destroy === "function") response.data.destroy();
      res.setHeader("Content-Length", "0");
      res.removeListener("close", abortUpstreamOnDisconnect);
      return res.end();
    }

    if (isHead) {
      if (response.data && typeof response.data.destroy === "function") response.data.destroy();
      res.removeListener("close", abortUpstreamOnDisconnect);
      return res.end();
    }

    // Clean up upstream stream when the client disconnects before the response ends.
    res.on("close", () => {
      if (res.writableEnded) return;
      if (response?.data && typeof response.data.destroy === "function") {
        response.data.destroy();
      }
    });
    response.data.on("error", (streamError) => {
      if (!res.headersSent) {
        res.status(502).json({ success: false, message: "Media stream could not be completed." });
      } else {
        res.destroy(streamError);
      }
    });
    res.once("finish", () => res.removeListener("close", abortUpstreamOnDisconnect));
    return response.data.pipe(res);
  } catch (error) {
    res.removeListener("close", abortUpstreamOnDisconnect);
    if (error.response?.status === 404 || error.code === "ERR_BAD_REQUEST") {
      return res.status(404).json({ success: false, message: "Media file not found." });
    }
    logError(req, error, "Media proxy error");
    return res.status(502).json({ success: false, message: "Failed to load media file." });
  }
});

export default router;
