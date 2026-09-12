import storeHoursService from "../services/storeHoursService.js";
import { logError } from "../utils/logger.js";

/**
 * Public endpoint: GET /api/store-hours
 * Returns live store opening status, today's schedule, and next opening time in Asia/Kolkata
 */
export const getPublicStoreHours = async (req, res) => {
  try {
    const status = await storeHoursService.getStoreStatus();
    return res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    logError(req, error, "[StoreHours] Error fetching public store status");
    // Fallback safely to open=true default evaluation to never crash client
    const fallbackStatus = storeHoursService.evaluateStoreStatus(
      storeHoursService.DEFAULT_STORE_HOURS_CONFIG
    );
    return res.json({
      success: true,
      ...fallbackStatus,
    });
  }
};
