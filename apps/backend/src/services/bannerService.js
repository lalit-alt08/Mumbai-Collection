import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

/**
 * Default fallback banners if WordPress options are empty or during first setup
 */
export const DEFAULT_BANNERS = [
  {
    id: "default-1",
    title: "Art & Crafts Collection",
    link: "/category/art",
    desktop_image: "/banner/Art.webp",
    desktop_media_id: null,
    mobile_image: "/banner/Art.webp",
    mobile_media_id: null,
    is_active: true,
  },
  {
    id: "default-2",
    title: "Playstation & Gaming",
    link: "/category/playstation",
    desktop_image: "/banner/Playstation.webp",
    desktop_media_id: null,
    mobile_image: "/banner/Playstation.webp",
    mobile_media_id: null,
    is_active: true,
  },
  {
    id: "default-3",
    title: "Toys and Fun",
    link: "/category/toys",
    desktop_image: "/banner/Toys.webp",
    desktop_media_id: null,
    mobile_image: "/banner/Toys.webp",
    mobile_media_id: null,
    is_active: true,
  },
];

// In-memory cache: { data: Array, timestamp: number }
let bannersCache = null;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds TTL

/**
 * Normalize and sanitize banner link (M2 fix)
 */
export const sanitizeBannerLink = (link) => {
  const raw = String(link || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return "";
};

/**
 * Normalize and sanitize banner item
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
 * Fetch Homepage Banners from WordPress
 * (WordPress wp_options is the persistent Source of Truth)
 */
export const getBanners = async (forceFresh = false) => {
  if (!forceFresh && bannersCache && Date.now() - bannersCache.timestamp < CACHE_TTL_MS) {
    return bannersCache.data;
  }

  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/banners`;

  try {
    const response = await axios.get(endpoint, {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
      },
      httpsAgent,
      timeout: 8000,
    });

    const wpBanners = response.data?.banners;

    if (Array.isArray(wpBanners) && wpBanners.length > 0) {
      const sanitized = wpBanners
        .map((b, idx) => sanitizeBannerItem(b, idx))
        .filter(Boolean)
        .slice(0, 3);

      bannersCache = {
        data: sanitized,
        timestamp: Date.now(),
      };
      return sanitized;
    }
  } catch (error) {
    console.warn(
      "WordPress banners fetch fallback (using default static banners):",
      error.response?.data?.message || error.message
    );
  }

  // If WordPress has no stored banners yet, return default banners
  return DEFAULT_BANNERS;
};

/**
 * Persist Homepage Banners to WordPress (Maximum 3 Banners)
 */
export const saveBanners = async (banners) => {
  if (!Array.isArray(banners)) {
    throw new Error("Banners must be provided as an array.");
  }

  if (banners.length > 3) {
    throw new Error("Maximum 3 homepage banners allowed.");
  }

  const sanitized = banners
    .map((b, idx) => sanitizeBannerItem(b, idx))
    .filter(Boolean)
    .slice(0, 3);

  // Validate that each active banner has at least one valid image
  for (const b of sanitized) {
    if (b.is_active && !b.desktop_image && !b.mobile_image) {
      throw new Error(`Banner "${b.title || b.id}" must have at least a desktop or mobile image.`);
    }
  }

  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/banners`;

  const response = await axios.post(
    endpoint,
    { banners: sanitized },
    {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
      },
      httpsAgent,
      timeout: 10000,
    }
  );

  const saved = response.data?.banners || sanitized;

  // Invalidate in-memory cache with newly saved data
  bannersCache = {
    data: saved,
    timestamp: Date.now(),
  };

  return saved;
};

export default {
  getBanners,
  saveBanners,
  DEFAULT_BANNERS,
  sanitizeBannerItem,
};
