import {
  getBanners,
  saveBanners,
} from "../services/bannerService.js";

/**
 * Public Endpoint: Get Active Homepage Banners for Customer Web
 * GET /api/banners
 */
export const getPublicBanners = async (req, res) => {
  try {
    const banners = await getBanners(false);
    const activeBanners = banners.filter((b) => b.is_active !== false);

    res.json({
      success: true,
      count: activeBanners.length,
      banners: activeBanners,
    });
  } catch (error) {
    console.error("Get public banners error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load homepage banners.",
      banners: [],
    });
  }
};

/**
 * Employee Endpoint: Get All Banners for Management UI
 * GET /api/employee/banners
 */
export const getEmployeeBanners = async (req, res) => {
  try {
    const banners = await getBanners(true);

    res.json({
      success: true,
      count: banners.length,
      banners,
    });
  } catch (error) {
    console.error("Get employee banners error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load banner configuration.",
      banners: [],
    });
  }
};

/**
 * Employee Endpoint: Update/Persist Banners (Max 3)
 * PUT /api/employee/banners
 */
export const updateEmployeeBanners = async (req, res) => {
  try {
    const { banners } = req.body;

    if (!Array.isArray(banners)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload: banners array is required.",
      });
    }

    if (banners.length > 3) {
      return res.status(400).json({
        success: false,
        message: "Maximum 3 homepage banners allowed.",
      });
    }

    const savedBanners = await saveBanners(banners);

    res.json({
      success: true,
      message: "Homepage banners updated and published to WordPress successfully.",
      count: savedBanners.length,
      banners: savedBanners,
    });
  } catch (error) {
    console.error("Update employee banners error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 400;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to update banners in WordPress.",
    });
  }
};
