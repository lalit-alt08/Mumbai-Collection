import {
  getBanners,
  saveBanners,
  DEFAULT_THIN_BANNER,
} from "../services/bannerService.js";
import { transformMediaUrls } from "../utils/mediaUrl.js";
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

    res.json({
      success: true,
      count: activeBanners.length,
      banners: transformMediaUrls(activeBanners, req),
      thin_banner: thinBanner && thinBanner.is_active !== false && thinBanner.image
        ? transformMediaUrls([thinBanner], req)[0]
        : null,
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
