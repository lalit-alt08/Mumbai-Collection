import storeHoursService from "../services/storeHoursService.js";
import { logError } from "../utils/logger.js";

/**
 * Admin endpoint: GET /api/admin/store-hours
 * Returns full store hours configuration and current status
 */
export const getAdminStoreHours = async (req, res) => {
  try {
    const config = await storeHoursService.getStoreHoursConfig(true);
    const status = await storeHoursService.getStoreStatus();

    return res.json({
      success: true,
      config,
      status,
    });
  } catch (error) {
    logError(req, error, "[AdminStoreHours] Error fetching config");
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load store hours configuration.",
      config: storeHoursService.DEFAULT_STORE_HOURS_CONFIG,
    });
  }
};

/**
 * Admin endpoint: PUT /api/admin/store-hours
 * Updates store hours configuration (schedule, manual override, notice message)
 */
export const updateAdminStoreHours = async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || typeof payload !== "object") {
      return res.status(400).json({
        success: false,
        message: "Invalid configuration payload provided.",
      });
    }

    const savedConfig = await storeHoursService.saveStoreHoursConfig(payload);
    const currentStatus = storeHoursService.evaluateStoreStatus(savedConfig);

    return res.json({
      success: true,
      message: "Store hours updated successfully.",
      config: savedConfig,
      status: currentStatus,
    });
  } catch (error) {
    logError(req, error, "[AdminStoreHours] Error saving config");
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update store hours configuration.",
    });
  }
};
