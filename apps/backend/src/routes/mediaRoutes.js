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
]);

/**
 * Secure WordPress Media Proxy
 * Streams images from WordPress /wp-content/uploads/*
 */
router.use(async (req, res) => {
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

  try {
    let response;
    try {
      response = await axios({
        method: "GET",
        url: targetUrl,
        httpsAgent: mediaHttpsAgent,
        httpAgent: mediaHttpAgent,
        responseType: "stream",
        timeout: 10000,
        validateStatus: (status) => status === 200,
      });
    } catch (err) {
      if (err.response?.status === 404 && normalized.includes(".SY522.")) {
        const altPath = normalized.replace(".SY522.", "._SY522_.");
        const altUrl = `${wpBaseUrl}/wp-content/uploads/${altPath.replace(/\\/g, "/")}`;
        response = await axios({
          method: "GET",
          url: altUrl,
          httpsAgent: mediaHttpsAgent,
          httpAgent: mediaHttpAgent,
          responseType: "stream",
          timeout: 10000,
          validateStatus: (status) => status === 200,
        });
      } else {
        throw err;
      }
    }

    // Pass through Content-Type and caching headers
    if (response.headers["content-type"]) {
      res.setHeader("Content-Type", response.headers["content-type"]);
    }
    if (response.headers["content-length"]) {
      res.setHeader("Content-Length", response.headers["content-length"]);
    }
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

    return response.data.pipe(res);
  } catch (error) {
    if (error.response?.status === 404 || error.code === "ERR_BAD_REQUEST") {
      return res.status(404).json({ success: false, message: "Media file not found." });
    }
    logError(req, error, "Media proxy error");
    return res.status(502).json({ success: false, message: "Failed to load media file." });
  }
});

export default router;
