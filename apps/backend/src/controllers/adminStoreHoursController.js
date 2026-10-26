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
      ...config,
      ...status,
      current_ist_time: status.current_time_ist || status.current_ist_time,
      evaluation_reason: status.reason || status.evaluation_reason,
    });
  } catch (error) {
    logError(req, error, "[AdminStoreHours] Error fetching config");
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load store hours configuration.",
      config: storeHoursService.DEFAULT_STORE_HOURS_CONFIG,
      ...storeHoursService.DEFAULT_STORE_HOURS_CONFIG,
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
      ...savedConfig,
      ...currentStatus,
      current_ist_time: currentStatus.current_time_ist || currentStatus.current_ist_time,
      evaluation_reason: currentStatus.reason || currentStatus.evaluation_reason,
    });
  } catch (error) {
    logError(req, error, "[AdminStoreHours] Error saving config");
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update store hours configuration.",
    });
  }
};

/**
 * Admin endpoint: PUT /api/admin/store-hours/peak-toggle
 * 1-click toggle for Peak Hours delivery mode
 */
export const toggleAdminPeakHours = async (req, res) => {
  try {
    const currentConfig = await storeHoursService.getStoreHoursConfig();
    const isPeak =
      typeof req.body?.is_peak_hours === "boolean"
        ? req.body.is_peak_hours
        : !currentConfig.is_peak_hours;

    const savedConfig = await storeHoursService.saveStoreHoursConfig({
      ...currentConfig,
      is_peak_hours: isPeak,
      ...(typeof req.body?.peak_delivery_text === "string" ? { peak_delivery_text: req.body.peak_delivery_text } : {}),
      ...(typeof req.body?.peak_notice_message === "string" ? { peak_notice_message: req.body.peak_notice_message } : {}),
      ...(typeof req.body?.normal_delivery_text === "string" ? { normal_delivery_text: req.body.normal_delivery_text } : {}),
    });
    const currentStatus = storeHoursService.evaluateStoreStatus(savedConfig);


    return res.json({
      success: true,
      message: `Peak hours ${isPeak ? "activated" : "deactivated"} successfully.`,
      is_peak_hours: isPeak,
      delivery_eta_text: currentStatus.delivery_eta_text,
      config: savedConfig,
      status: currentStatus,
      ...savedConfig,
      ...currentStatus,
    });
  } catch (error) {
    logError(req, error, "[AdminStoreHours] Error toggling peak hours");
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to toggle peak hours.",
    });
  }
};
