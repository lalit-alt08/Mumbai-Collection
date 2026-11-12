import {
  getBanners,
  saveBanners,
  DEFAULT_THIN_BANNER,
} from "../services/bannerService.js";
import { transformMediaUrls, transformMediaUrl } from "../utils/mediaUrl.js";
import { uploadVideoMedia } from "../services/wordpressMediaService.js";
import { logError } from "../utils/logger.js";

/**
 * Public Endpoint: Get Active Homepage Banners & Thin Banner for Customer Web
 * GET /api/banners
 */
export const getPublicBanners = async (req, res) => {
  try {
    const isForce = req.query.force === "true" || Boolean(req.query._t);
    const data = await getBanners(isForce);
    const banners = Array.isArray(data) ? data : data.banners || [];
    const activeBanners = banners.filter((b) => b.is_active !== false);
    const thinBanner = data.thin_banner || DEFAULT_THIN_BANNER;

    let publicThin = null;
    if (thinBanner && thinBanner.is_active !== false && thinBanner.image) {
      const transformedThin = transformMediaUrls([thinBanner], req)[0];
      // If video mode is active but video URL is unavailable, storefront falls back to poster image
      if (transformedThin && transformedThin.media_type === "video" && !transformedThin.video_url) {
        transformedThin.media_type = "image";
      }
      publicThin = transformedThin;
    }

    res.json({
      success: true,
      count: activeBanners.length,
      banners: transformMediaUrls(activeBanners, req),
      thin_banner: publicThin,
    });
  } catch (error) {
    logError(req, error, "Get public banners error");
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

    const savedResult = await saveBanners({ banners, thin_banner });
    const savedBanners = Array.isArray(savedResult) ? savedResult : [];
    const savedThin = savedResult.thin_banner || null;

    res.json({
      success: true,
      message: "Banners updated and published successfully.",
      count: savedBanners.length,
      banners: transformMediaUrls(savedBanners, req),
      thin_banner: savedThin ? transformMediaUrls([savedThin], req)[0] : null,
    });
  } catch (error) {
    logError(req, error, "Update employee banners error");
    const statusCode = error.response?.status || 400;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to update banners in WordPress.",
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
      message: error.response?.data?.message || error.message || "Failed to upload banner video.",
    });
  }
};
