import {
  getBanners,
  saveBanners,
  DEFAULT_THIN_BANNER,
} from "../services/bannerService.js";
import { transformMediaUrls, transformMediaUrl } from "../utils/mediaUrl.js";
import { uploadVideoMedia } from "../services/wordpressMediaService.js";
import { logError } from "../utils/logger.js";

const appendMediaVersion = (url, tag) => {
  if (!url || !tag || typeof url !== "string" || !url.includes("/api/media/uploads/")) {
    return url;
  }
  const hashIndex = url.indexOf("#");
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1));
  params.set("v", String(tag));
  return `${path}?${params}${hash}`;
};

const normalizePublicVideoBanner = (banner, version) => {
  if (!banner) return banner;
  const normalized = { ...banner };
  if (normalized.media_type === "video" && !normalized.video_url) {
    normalized.media_type = "image";
  }
  const mediaTag = (id) => [id, version].filter(Boolean).join("-");
  const videoTag = mediaTag(normalized.video_media_id);
  if (normalized.video_url && videoTag) {
    normalized.video_url = appendMediaVersion(normalized.video_url, videoTag);
  }
  const desktopTag = mediaTag(normalized.desktop_media_id || normalized.media_id);
  const mobileTag = mediaTag(normalized.mobile_media_id || normalized.media_id);
  if (normalized.desktop_image) {
    normalized.desktop_image = appendMediaVersion(normalized.desktop_image, desktopTag);
  }
  if (normalized.mobile_image) {
    normalized.mobile_image = appendMediaVersion(normalized.mobile_image, mobileTag);
  }
  if (normalized.image) {
    normalized.image = appendMediaVersion(normalized.image, mediaTag(normalized.media_id));
  }
  return normalized;
};

/**
 * Public Endpoint: Get Active Homepage Banners & Thin Banner for Customer Web
 * GET /api/banners
 */
export const getPublicBanners = async (req, res) => {
  try {
    const revalidate = req.query?.force === "true";
    const data = await getBanners(false, { revalidate });
    const banners = Array.isArray(data) ? data : data.banners || [];
    const activeBanners = banners.filter((b) => b.is_active !== false);
    const thinBanner = data.thin_banner || DEFAULT_THIN_BANNER;

    let publicThin = null;
    if (thinBanner && thinBanner.is_active !== false && thinBanner.image) {
      const transformedThin = transformMediaUrls([thinBanner], req)[0];
      publicThin = normalizePublicVideoBanner(transformedThin, data.version);
    }

    const publicHeroBanners = transformMediaUrls(activeBanners, req).map((banner) =>
      normalizePublicVideoBanner(banner, data.version)
    );

    if (revalidate || data?.degraded === true) {
      res.setHeader?.("Cache-Control", "no-store, no-cache, must-revalidate");
    } else {
      res.setHeader?.("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
    }

    res.json({
      success: true,
      degraded: data?.degraded === true,
      count: publicHeroBanners.length,
      banners: publicHeroBanners,
      thin_banner: publicThin,
    });
  } catch (error) {
    logError(req, error, "Get public banners error");
    res.setHeader?.("Cache-Control", "no-store, no-cache, must-revalidate");
    res.status(500).json({
      success: false,
      message: "Failed to load homepage banners.",
      banners: [],
      thin_banner: null,
    });
  }
};

/**
 * Employee Endpoint: Get All Banners & Thin Banner for Management UI
 * GET /api/employee/banners
 */
export const getEmployeeBanners = async (req, res) => {
  try {
    const data = await getBanners(true);
    const banners = Array.isArray(data) ? data : data.banners || [];
    const thinBanner = data.thin_banner || DEFAULT_THIN_BANNER;

    res.json({
      success: true,
      count: banners.length,
      banners: transformMediaUrls(banners, req),
      thin_banner: transformMediaUrls([thinBanner], req)[0],
      version: data.version || 1,
    });
  } catch (error) {
    logError(req, error, "Get employee banners error");
    res.status(500).json({
      success: false,
      message: "Failed to load banner configuration.",
      banners: [],
      thin_banner: null,
    });
  }
};

/**
 * Employee Endpoint: Update/Persist Banners & Thin Banner
 * PUT /api/employee/banners
 */
export const updateEmployeeBanners = async (req, res) => {
  try {
    const { banners, thin_banner } = req.body;

    if (thin_banner?.media_type === "video" && thin_banner?.is_active !== false) {
      const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
      if (!validId(thin_banner.video_media_id) || !validId(thin_banner.media_id)) {
        return res.status(400).json({
          success: false,
          message: "An uploaded MP4 video and an uploaded poster image are required before publishing Video mode.",
        });
      }
    }

    if (banners !== undefined && !Array.isArray(banners)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload: banners must be an array.",
      });
    }

    if (Array.isArray(banners) && banners.length > 3) {
      return res.status(400).json({
        success: false,
        message: "Maximum 3 homepage hero banners allowed.",
      });
    }

    if (Array.isArray(banners)) {
      const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
      for (const banner of banners) {
        if (!banner || typeof banner !== "object") continue;
        if (banner.media_type === "video") {
          if (!validId(banner.video_media_id)) {
            return res.status(400).json({
              success: false,
              message: `Banner "${banner.title || banner.id || "Slide"}" requires an uploaded MP4 video before switching to Video mode.`,
            });
          }
          if (banner.is_active !== false && !validId(banner.desktop_media_id) && !validId(banner.mobile_media_id)) {
            return res.status(400).json({
              success: false,
              message: `Banner "${banner.title || banner.id || "Slide"}" requires at least one uploaded poster image (desktop or mobile) before publishing Video mode.`,
            });
          }
        }
      }
    }

    const expected_version = req.body?.expected_version;
    const savedResult = await saveBanners({ banners, thin_banner, expected_version });
    const savedBanners = Array.isArray(savedResult) ? savedResult : [];
    const savedThin = savedResult.thin_banner || null;

    res.json({
      success: true,
      message: "Banners updated and published successfully.",
      count: savedBanners.length,
      banners: transformMediaUrls(savedBanners, req),
      thin_banner: savedThin ? transformMediaUrls([savedThin], req)[0] : null,
      version: savedResult.version || null,
    });
  } catch (error) {
    logError(req, error, "Update employee banners error");
    const statusCode = error.response?.status || 400;
    const isConflict = statusCode === 409;
    res.status(statusCode).json({
      success: false,
      code: isConflict ? "BANNER_CONFLICT" : "BANNER_UPDATE_FAILED",
      message: isConflict
        ? (error.response?.data?.message || "Another staff member updated the banners while you were editing. Please reload and review the latest banners before saving.")
        : "Failed to update banners. Please check the banner details and try again.",
      current_version: error.response?.data?.data?.current_version || null,
    });
  }
};

/**
 * Employee Endpoint: Upload Mobile Thin Banner Video
 * POST /api/employee/banners/video
 */
export const uploadBannerVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No video file provided.",
      });
    }

    const uploaderId = req.user?.id || req.user?.userId || 0;
    const { id, url } = await uploadVideoMedia(req.file, { uploaderId });

    const clientUrl = transformMediaUrl(url, req);

    res.status(201).json({
      success: true,
      id,
      url: clientUrl,
      source_url: clientUrl,
      message: "Banner video uploaded successfully.",
    });
  } catch (error) {
    logError(req, error, "Upload banner video error");
    const statusCode = error.statusCode || error.response?.status || 400;
    res.status(statusCode).json({
      success: false,
      message: "Failed to upload banner video. Please try again.",
    });
  }
};
