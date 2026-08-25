import axios from "axios";
import path from "path";
import { httpsAgent } from "../config/httpAgent.js";

/**
 * Upload a media file buffer directly to WordPress Media Library (/wp-json/wp/v2/media)
 *
 * @param {Object} file - Multer file object containing originalname, buffer, mimetype
 * @returns {Promise<{ id: number, url: string }>} WordPress media ID and full source URL
 */
export const uploadMedia = async (file) => {
  if (!file || !file.buffer) {
    throw new Error("No file buffer provided for media upload.");
  }

  const { originalname, buffer, mimetype } = file;

  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const wpUrl = `${wpBaseUrl}/wp-json/wp/v2/media`;
  const wpUser = process.env.WP_USERNAME || "mumbaicollection";
  const wpPass = process.env.WP_APPLICATION_PASSWORD || "";

  if (!wpPass) {
    throw new Error("WordPress application password (WP_APPLICATION_PASSWORD) is not configured.");
  }

  const authHeader = Buffer.from(`${wpUser}:${wpPass}`).toString("base64");

  // Determine clean file extension
  const mimeToExt = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  const detectedExt = path.extname(originalname || "").toLowerCase();
  const validExt = detectedExt && [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(detectedExt)
    ? detectedExt
    : (mimeToExt[mimetype?.toLowerCase()] || ".jpg");

  // Sanitize base filename to avoid HTTP header corruption and WordPress sideload rejection
  const baseName = path.basename(originalname || "upload", detectedExt || validExt)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);

  const cleanFilename = `${baseName || "upload"}_${Date.now()}${validExt}`;
  const cleanMimeType = mimetype || (validExt === ".png" ? "image/png" : validExt === ".webp" ? "image/webp" : "image/jpeg");

  const response = await axios.post(wpUrl, buffer, {
    headers: {
      "Content-Type": cleanMimeType,
      "Content-Disposition": `attachment; filename="${cleanFilename}"`,
      Authorization: `Basic ${authHeader}`,
    },
    httpsAgent,
    timeout: 25000,
  });

  const mediaData = response.data;
  const mediaUrl = mediaData?.source_url || mediaData?.guid?.rendered || "";
  const mediaId = mediaData?.id;

  if (!mediaId || !mediaUrl) {
    throw new Error("Invalid response received from WordPress Media API.");
  }

  return {
    id: mediaId,
    url: mediaUrl,
  };
};

export default {
  uploadMedia,
};
