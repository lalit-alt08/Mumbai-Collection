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
      version: config.version || 1,
      ...config,
      ...status,
      current_ist_time: status.current_time_ist || status.current_ist_time,
      evaluation_reason: status.reason || status.evaluation_reason,
    });
  } catch (error) {
    logError(req, error, "[AdminStoreHours] Error fetching config");
    return res.status(503).json({
      success: false,
      message: "Store operating hours are temporarily unavailable from upstream database. Please retry before modifying checkout settings.",
      config: null,
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

    const rawExpected =
      payload.expected_version !== undefined
        ? payload.expected_version
        : (payload.version !== undefined ? payload.version : undefined);

    const expectedVersion =
      rawExpected !== undefined && rawExpected !== null && rawExpected !== ""
        ? Number(rawExpected)
        : null;

    if (expectedVersion === null || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
      return res.status(400).json({
        success: false,
        error: "MISSING_VERSION",
        message: "expected_version is required and must be a positive integer.",
      });
    }

    const savedConfig = await storeHoursService.saveStoreHoursConfig(payload, { expectedVersion });
    const currentStatus = storeHoursService.evaluateStoreStatus(savedConfig);

    return res.json({
      success: true,
      message: "Store hours updated successfully.",
      config: savedConfig,
      status: currentStatus,
      version: savedConfig.version || 1,
      ...savedConfig,
      ...currentStatus,
      current_ist_time: currentStatus.current_time_ist || currentStatus.current_ist_time,
      evaluation_reason: currentStatus.reason || currentStatus.evaluation_reason,
    });
  } catch (error) {
    logError(req, error, "[AdminStoreHours] Error saving config");

    const upstreamStatus = error.response?.status || error.status;
    const upstreamCode = error.response?.data?.code || error.code;
    const upstreamData = error.response?.data;

    if (upstreamStatus === 409 || upstreamCode === "store_hours_conflict") {
      return res.status(409).json({
        success: false,
        error: "STORE_HOURS_CONFLICT",
        code: "store_hours_conflict",
        message:
          "Another administrator updated the store operating hours while you were editing.",
        current_version: upstreamData?.data?.current_version || upstreamData?.current_version || null,
      });
    }

    if (upstreamStatus === 400 || upstreamCode === "missing_version" || error.message?.includes("expected_version is required")) {
      return res.status(400).json({
        success: false,
        message: "expected_version is required to safely update store operating hours.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update store hours configuration. Please retry.",
    });
  }
};

/**
 * Admin endpoint: PUT /api/admin/store-hours/peak-toggle
 * 1-click toggle for Peak Hours delivery mode
 */
export const toggleAdminPeakHours = async (req, res) => {
  try {
    const rawExpected =
      req.body?.expected_version !== undefined
        ? req.body.expected_version
        : (req.body?.version !== undefined ? req.body.version : undefined);

    const expectedVersion =
      rawExpected !== undefined && rawExpected !== null && rawExpected !== ""
        ? Number(rawExpected)
        : null;

    if (expectedVersion === null || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
      return res.status(400).json({
        success: false,
        error: "MISSING_VERSION",
        message: "expected_version is required and must be a positive integer.",
      });
    }

    const currentConfig = await storeHoursService.getStoreHoursConfig(true);
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
    }, { expectedVersion });
    const currentStatus = storeHoursService.evaluateStoreStatus(savedConfig);

    return res.json({
      success: true,
      message: `Peak hours ${isPeak ? "activated" : "deactivated"} successfully.`,
      is_peak_hours: isPeak,
      delivery_eta_text: currentStatus.delivery_eta_text,
      config: savedConfig,
      status: currentStatus,
      version: savedConfig.version || 1,
      ...savedConfig,
      ...currentStatus,
    });
  } catch (error) {
    logError(req, error, "[AdminStoreHours] Error toggling peak hours");

    const upstreamStatus = error.response?.status || error.status;
    const upstreamCode = error.response?.data?.code || error.code;
    const upstreamData = error.response?.data;

    if (upstreamStatus === 409 || upstreamCode === "store_hours_conflict") {
      return res.status(409).json({
        success: false,
        error: "STORE_HOURS_CONFLICT",
        code: "store_hours_conflict",
        message:
          "Another administrator updated the store operating hours while you were editing.",
        current_version: upstreamData?.data?.current_version || upstreamData?.current_version || null,
      });
    }

    if (upstreamStatus === 400 || upstreamCode === "missing_version" || error.message?.includes("expected_version is required")) {
      return res.status(400).json({
        success: false,
        message: "expected_version is required to safely toggle peak hours.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to toggle peak hours. Please retry.",
    });
  }
};
