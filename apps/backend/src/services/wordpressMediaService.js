import axios from "axios";
import path from "path";
import { httpsAgent } from "../config/httpAgent.js";
import { logger } from "../utils/logger.js";
import { processProductImage } from "./imageProcessor.js";

/**
 * Upload a media file buffer directly to WordPress Media Library (/wp-json/wp/v2/media)
 * Processes the image through Sharp (auto-rotate, strip metadata, max 1600px, WebP quality 82)
 * before uploading to WordPress.
 *
 * @param {Object} file - Multer file object containing originalname, buffer, mimetype
 * @param {Object} [options] - Optional processing options passed to imageProcessor
 * @returns {Promise<{ id: number, url: string }>} WordPress media ID and full source URL
 */
export const uploadMedia = async (file, options = {}) => {
  if (!file || !file.buffer) {
    throw new Error("No file buffer provided for media upload.");
  }

  const { originalname, buffer } = file;

  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const internalApiKey = process.env.MUMBAI_INTERNAL_API_KEY;

  // Process image: auto-rotate EXIF, strip metadata, max 1600px, WebP quality 82
  const processed = await processProductImage(buffer, options);
  const uploadBuffer = processed?.buffer || buffer;

  // Sanitize base filename to avoid HTTP header corruption and WordPress sideload rejection
  const detectedExt = path.extname(originalname || "").toLowerCase();
  const baseName = path.basename(originalname || "upload", detectedExt)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);

  const cleanFilename = `${baseName || "upload"}_${Date.now()}.webp`;
  const cleanMimeType = "image/webp";

  // Primary Method: Internal endpoint (bypasses Application Passwords and tracks pending in one shot)
  if (internalApiKey) {
    try {
      const uploadUrl = `${wpBaseUrl}/wp-json/mumbai-auth/v1/media/upload?filename=${encodeURIComponent(cleanFilename)}&uploader_id=${encodeURIComponent(options.uploaderId || 0)}`;
      const response = await axios.post(uploadUrl, uploadBuffer, {
        headers: {
          "Content-Type": cleanMimeType,
          "X-Mumbai-Internal-Key": internalApiKey,
        },
        httpsAgent,
        timeout: 25000,
      });

      const mediaData = response.data;
      const mediaId = mediaData?.id;
      const mediaUrl = mediaData?.source_url || mediaData?.url || "";

      if (mediaId && mediaUrl) {
        return {
          id: Number(mediaId),
          url: mediaUrl,
        };
      }
    } catch (internalErr) {
      logger.warn(
        { err: internalErr.response?.data || internalErr.message },
        "[wordpressMediaService] Internal media upload failed, attempting fallback to WP REST API"
      );
    }
  }

  // Fallback Method: Standard WordPress REST API
  const wpUser = process.env.WP_USERNAME || "mumbaicollection";
  const wpPass = process.env.WP_APPLICATION_PASSWORD || "";

  if (!wpPass) {
    throw new Error("WordPress media upload failed: Internal key and application password are both unavailable or rejected.");
  }

  const authHeader = Buffer.from(`${wpUser}:${wpPass}`).toString("base64");
  const wpUrl = `${wpBaseUrl}/wp-json/wp/v2/media`;

  const response = await axios.post(wpUrl, uploadBuffer, {
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

  // Automatically track uploaded media as pending
  if (options.trackPending !== false) {
    try {
      await trackPendingMedia(mediaId, { uploaderId: options.uploaderId });
    } catch (trackErr) {
      logger.warn(
        { mediaId, err: trackErr.message },
        "[wordpressMediaService] Failed to track media as pending"
      );
    }
  }

  return {
    id: mediaId,
    url: mediaUrl,
  };
};

/**
 * Track an uploaded media attachment as pending in WordPress
 *
 * @param {number} mediaId
 * @param {Object} [options]
 * @param {number} [options.uploaderId]
 * @returns {Promise<Object>}
 */
export const trackPendingMedia = async (mediaId, options = {}) => {
  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/media/track-pending`;

  const response = await axios.post(
    endpoint,
    {
      media_id: Number(mediaId),
      uploader_id: Number(options.uploaderId) || 0,
    },
    {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        "Content-Type": "application/json",
      },
      httpsAgent,
      timeout: 10000,
    }
  );

  return response.data;
};

/**
 * Mark uploaded media as attached to a specific WooCommerce product
 *
 * @param {number[]|number} mediaIds
 * @param {number} targetId
 * @param {"product"|"category"} [targetType]
 * @returns {Promise<Object>}
 */
export const markMediaAttached = async (mediaIds, targetId, targetType = "product") => {
  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/media/mark-attached`;

  const idsArray = Array.isArray(mediaIds) ? mediaIds.map(Number) : [Number(mediaIds)];
  const validIds = idsArray.filter((id) => Number.isInteger(id) && id > 0);

  if (validIds.length === 0) {
    return { success: true, count: 0, updated_ids: [] };
  }

  const targetField = targetType === "category" ? "category_id" : "product_id";
  const response = await axios.post(
    endpoint,
    {
      media_ids: validIds,
      [targetField]: Number(targetId) || 0,
    },
    {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        "Content-Type": "application/json",
      },
      httpsAgent,
      timeout: 10000,
    }
  );

  return response.data;
};

/**
 * Safely delete media from WordPress only if it is completely unreferenced
 *
 * @param {number[]|number} mediaIds
 * @param {Object} [options]
 * @param {string} [options.context] - 'pending_removal' | 'product_deletion' | 'orphan_maintenance'
 * @param {number} [options.uploaderId]
 * @returns {Promise<Object>}
 */
export const deleteMediaIfUnreferenced = async (mediaIds, options = {}) => {
  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/media/delete-if-unreferenced`;

  const idsArray = Array.isArray(mediaIds) ? mediaIds.map(Number) : [Number(mediaIds)];
  const validIds = idsArray.filter((id) => Number.isInteger(id) && id > 0);

  if (validIds.length === 0) {
    return { success: true, results: [] };
  }

  const response = await axios.post(
    endpoint,
    {
      media_ids: validIds,
      context: options.context || "unknown",
      uploader_id: Number(options.uploaderId) || 0,
    },
    {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        "Content-Type": "application/json",
      },
      httpsAgent,
      timeout: 15000,
    }
  );

  return response.data;
};

/**
 * Trigger cleanup of pending media older than 24 hours
 *
 * @returns {Promise<Object>}
 */
export const cleanupPendingOrphanMedia = async () => {
  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/media/cleanup-pending-orphans`;

  const response = await axios.post(
    endpoint,
    {},
    {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        "Content-Type": "application/json",
      },
      httpsAgent,
      timeout: 20000,
    }
  );

  return response.data;
};

export default {
  uploadMedia,
  trackPendingMedia,
  markMediaAttached,
  deleteMediaIfUnreferenced,
  cleanupPendingOrphanMedia,
};
