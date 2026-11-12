import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { logger } from "../utils/logger.js";

/**
 * Default banners empty fallback
 */
export const DEFAULT_BANNERS = [];

export const DEFAULT_THIN_BANNER = {
  id: "thin-banner-1",
  title: "Welcome to Mumbai Collection",
  link: "",
  image: "/banners/welcome-thin-banner.webp",
  media_id: null,
  media_type: "image",
  video_url: "",
  video_media_id: null,
  is_active: true,
};

// In-memory cache: { data: Array, timestamp: number }
let bannersCache = null;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds TTL

// Minimum interval between upstream WordPress reads (even on forceFresh) to prevent load spikes
const MIN_UPSTREAM_INTERVAL_MS = 5 * 1000; // 5 seconds upstream cooldown
let lastUpstreamFetchTimestamp = 0;

// Shared in-flight Promise for upstream WordPress calls across all concurrent shoppers
let bannersFetchInFlight = null;

// Monotonically incrementing save counter & timestamp to protect against stale read race conditions
let saveSequenceCounter = 0;
let lastConfirmedSaveTimestamp = 0;

/**
 * Normalize and sanitize banner link
 */
export const sanitizeBannerLink = (link) => {
  const raw = String(link || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) {
    if (raw.startsWith("//")) return "";
    return raw;
  }
  try {
    const parsed = new URL(raw);
    const allowedHosts = ["mumbaicollection.in", "www.mumbaicollection.in", "localhost"];
    if (allowedHosts.includes(parsed.hostname.toLowerCase())) {
      return parsed.pathname + parsed.search;
    }
  } catch {
    return "";
  }
  return "";
};

/**
 * Normalize and sanitize hero banner item
 */
export const sanitizeBannerItem = (item, index) => {
  if (!item || typeof item !== "object") return null;

  return {
    id: String(item.id || `banner-${index + 1}`).trim(),
    title: String(item.title || "").trim(),
    link: sanitizeBannerLink(item.link),
    desktop_image: String(item.desktop_image || "").trim(),
    desktop_media_id: item.desktop_media_id ? Number(item.desktop_media_id) : null,
    mobile_image: String(item.mobile_image || "").trim(),
    mobile_media_id: item.mobile_media_id ? Number(item.mobile_media_id) : null,
    is_active: item.is_active !== false,
  };
};

/**
 * Normalize and sanitize mobile thin banner item
 */
export const sanitizeThinBanner = (item) => {
  if (!item || typeof item !== "object") return DEFAULT_THIN_BANNER;
  const rawMediaType = String(item.media_type || "").trim().toLowerCase();
  const media_type = rawMediaType === "video" ? "video" : "image";
  return {
    id: String(item.id || "thin-banner-1").trim(),
    title: String(item.title || "Welcome to Mumbai Collection").trim(),
    link: sanitizeBannerLink(item.link),
    image: String(item.image || "").trim(),
    media_id: item.media_id ? Number(item.media_id) : null,
    media_type,
    video_url: String(item.video_url || "").trim(),
    video_media_id: item.video_media_id ? Number(item.video_media_id) : null,
    is_active: item.is_active !== false,
  };
};

const getOutageFallback = () => {
  if (bannersCache?.data) {
    return bannersCache.data;
  }
  const fallback = [...DEFAULT_BANNERS];
  fallback.thin_banner = { ...DEFAULT_THIN_BANNER, is_active: false };
  return fallback;
};

/**
 * Fetch Homepage Banners & Thin Banner from WordPress
 */
export const getBanners = async (forceFresh = false) => {
  const now = Date.now();

  // 1. If cache is valid and fresh, serve directly
  if (!forceFresh && bannersCache && now - bannersCache.timestamp < CACHE_TTL_MS) {
    return bannersCache.data;
  }

  // 2. Coalesce concurrent calls across all shoppers into one shared in-flight Promise first!
  // Any shopper arriving while an upstream read is in progress must wait for that read rather than receiving a fallback.
  if (bannersFetchInFlight) {
    return bannersFetchInFlight;
  }

  // 3. Enforce a minimum interval between upstream read attempts (applies to normal & forced requests, success & failure)
  if (now - lastUpstreamFetchTimestamp < MIN_UPSTREAM_INTERVAL_MS) {
    return getOutageFallback();
  }

  const readSaveSeq = saveSequenceCounter;
  const reqStartedAt = now;
  // Record the start of every WordPress read attempt so failed reads respect the cooldown
  lastUpstreamFetchTimestamp = reqStartedAt;

  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/banners`;

  bannersFetchInFlight = (async () => {
    try {
      const response = await axios.get(endpoint, {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
        httpsAgent,
        timeout: 8000,
      });

      // Guard: If an explicit save succeeded while this read was in flight, discard the stale read!
      if (readSaveSeq < saveSequenceCounter || reqStartedAt < lastConfirmedSaveTimestamp) {
        logger.info(
          { readSaveSeq, saveSequenceCounter },
          "Discarding stale WordPress banners read result: a newer save completed while this read was in flight."
        );
        if (bannersCache?.data) {
          return bannersCache.data;
        }
      }

      const wpBanners = response.data?.banners;
      const wpThinBanner = response.data?.thin_banner;

      const sanitized = Array.isArray(wpBanners)
        ? wpBanners.map((b, idx) => sanitizeBannerItem(b, idx)).filter(Boolean).slice(0, 3)
        : [];

      const sanitizedThin = wpThinBanner
        ? sanitizeThinBanner(wpThinBanner)
        : DEFAULT_THIN_BANNER;

      sanitized.thin_banner = sanitizedThin;

      bannersCache = {
        data: sanitized,
        timestamp: Date.now(),
      };
      return sanitized;
    } catch (error) {
      logger.warn(
        { err: error.response?.data?.message || error.message },
        "WordPress banners fetch fallback (using default static banners)"
      );

      // Preserve the last confirmed state during a WordPress outage, or serve safe hidden fallback
      return getOutageFallback();
    } finally {
      bannersFetchInFlight = null;
    }
  })();

  return bannersFetchInFlight;
};

/**
 * Persist Homepage Banners and/or Thin Banner to WordPress
 */
export const saveBanners = async ({ banners, thin_banner } = {}) => {
  let sanitizedBanners = null;
  if (Array.isArray(banners)) {
    if (banners.length > 3) {
      throw new Error("Maximum 3 homepage hero banners allowed.");
    }
    sanitizedBanners = banners
      .map((b, idx) => sanitizeBannerItem(b, idx))
      .filter(Boolean)
      .slice(0, 3);

    for (const b of sanitizedBanners) {
      if (b.is_active && !b.desktop_image && !b.mobile_image) {
        throw new Error(`Banner "${b.title || b.id}" must have at least a desktop or mobile image.`);
      }
    }
  }

  let sanitizedThin = null;
  if (thin_banner !== undefined && thin_banner !== null) {
    sanitizedThin = sanitizeThinBanner(thin_banner);
  }

  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/banners`;

  const payload = {};
  if (sanitizedBanners !== null) payload.banners = sanitizedBanners;
  if (sanitizedThin !== null) payload.thin_banner = sanitizedThin;

  const response = await axios.post(
    endpoint,
    payload,
    {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
      },
      httpsAgent,
      timeout: 10000,
    }
  );

  // Require explicit confirmation from WordPress before reporting success
  if (sanitizedBanners !== null && !Array.isArray(response.data?.banners)) {
    throw new Error("WordPress failed to confirm saving homepage hero banners.");
  }
  if (sanitizedThin !== null) {
    if (!response.data?.thin_banner) {
      throw new Error("WordPress failed to confirm saving the mobile thin banner.");
    }
    const wpSavedThin = response.data.thin_banner;
    // Verify stored active state strictly matches the requested active state
    if (wpSavedThin.is_active !== sanitizedThin.is_active) {
      throw new Error(
        `WordPress stored thin banner active state (${wpSavedThin.is_active}) did not match requested state (${sanitizedThin.is_active}).`
      );
    }
    // Confirm saved mode and attachment ID
    const expectedMode = sanitizedThin.media_type || "image";
    const actualMode = wpSavedThin.media_type || "image";
    if (actualMode !== expectedMode) {
      throw new Error(
        `WordPress stored thin banner media type (${actualMode}) did not match requested mode (${expectedMode}).`
      );
    }
    if (expectedMode === "video" && sanitizedThin.is_active && (!sanitizedThin.video_media_id || !sanitizedThin.media_id)) {
      throw new Error("WordPress did not confirm both the video and poster attachments for the active banner.");
    }
    if (expectedMode === "video" && sanitizedThin.video_media_id) {
      if (Number(wpSavedThin.video_media_id) !== Number(sanitizedThin.video_media_id)) {
        throw new Error(
          `WordPress stored thin banner video ID (${wpSavedThin.video_media_id}) did not match requested ID (${sanitizedThin.video_media_id}).`
        );
      }
    }
    if (expectedMode === "video" && sanitizedThin.is_active && Number(wpSavedThin.media_id) !== Number(sanitizedThin.media_id)) {
      throw new Error("WordPress did not confirm the requested video poster attachment.");
    }
  }

  const savedBanners = Array.isArray(response.data?.banners)
    ? response.data.banners
    : (Array.isArray(bannersCache?.data) ? bannersCache.data : []);

  const savedThin = response.data?.thin_banner !== undefined
    ? response.data.thin_banner
    : (bannersCache?.data?.thin_banner || DEFAULT_THIN_BANNER);

  const result = Array.isArray(savedBanners) ? [...savedBanners] : [];
  result.thin_banner = savedThin;

  // Increment save sequence counter and update timestamp
  saveSequenceCounter++;
  lastConfirmedSaveTimestamp = Date.now();

  // Invalidate in-memory cache
  bannersCache = {
    data: result,
    timestamp: Date.now(),
  };

  return result;
};

export default {
  getBanners,
  saveBanners,
  DEFAULT_BANNERS,
  DEFAULT_THIN_BANNER,
  sanitizeBannerItem,
  sanitizeThinBanner,
};
