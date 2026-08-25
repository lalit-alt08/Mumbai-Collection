import express from "express";
import axios from "axios";
import path from "path";
import { httpsAgent } from "../config/httpAgent.js";

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

  // Security 1: Prevent directory traversal
  const normalized = path.normalize(mediaPath).replace(/^(\.\.[/\\])+/, "");
  if (normalized.includes("..") || /[\0\r\n]/.test(normalized)) {
    return res.status(400).json({ success: false, message: "Invalid media path." });
  }

  // Security 2: Whitelist allowed media extensions
  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return res.status(403).json({ success: false, message: "Unsupported file type." });
  }

  const targetUrl = `${WP_BASE_URL}/wp-content/uploads/${normalized.replace(/\\/g, "/")}`;

  console.log(`[MediaProxy] 1. Incoming media path: ${req.originalUrl || req.path}`);
  console.log(`[MediaProxy] 2. Normalized media path: ${normalized}`);
  console.log(`[MediaProxy] 3. Exact WordPress URL being requested: ${targetUrl}`);

  try {
    let response;
    try {
      response = await axios({
        method: "GET",
        url: targetUrl,
        httpsAgent,
        responseType: "stream",
        timeout: 10000,
        validateStatus: (status) => status === 200,
      });
      console.log(`[MediaProxy] 4. Upstream HTTP status: ${response.status} from ${targetUrl}`);
    } catch (err) {
      if (err.response?.status === 404 && normalized.includes(".SY522.")) {
        const altPath = normalized.replace(".SY522.", "._SY522_.");
        const altUrl = `${WP_BASE_URL}/wp-content/uploads/${altPath.replace(/\\/g, "/")}`;
        console.log(`[MediaProxy] 3b. Trying alternative path: ${altUrl}`);
        response = await axios({
          method: "GET",
          url: altUrl,
          httpsAgent,
          responseType: "stream",
          timeout: 10000,
          validateStatus: (status) => status === 200,
        });
        console.log(`[MediaProxy] 4. Upstream HTTP status: ${response.status} (resolved via alternative path ${altUrl})`);
      } else {
        console.log(`[MediaProxy] 4. Upstream HTTP status: ${err.response?.status || 500} (${err.message})`);
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

    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

    return response.data.pipe(res);
  } catch (error) {
    if (error.response?.status === 404 || error.code === "ERR_BAD_REQUEST") {
      return res.status(404).json({ success: false, message: "Media file not found." });
    }
    console.error(`Media proxy error: ${error.message}`);
    return res.status(502).json({ success: false, message: "Failed to load media file." });
  }
});

export default router;
