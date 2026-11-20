import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";

export const DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export const DEFAULT_STORE_HOURS_CONFIG = {
  version: 1,
  manual_override: "auto", // "auto" | "open" | "closed"
  timezone: "Asia/Kolkata",
  notice_message: "Our store is currently closed for new orders. We operate daily from 9:00 AM to 10:00 PM IST.",
  is_peak_hours: false,
  peak_delivery_text: "Same Day Delivery (High Demand)",
  normal_delivery_text: "Same Day Local Delivery",
  peak_notice_message: "High order volume in progress. Deliveries may arrive by late evening today.",
  schedule: Object.fromEntries(
    DAYS_OF_WEEK.map((d) => [d, { is_enabled: true, open: "09:00", close: "22:00" }])
  ),
};

// In-memory cache: { data: Object, timestamp: number }
let storeHoursCache = null;
let lastKnownGoodConfig = null;
let lastSuccessfulFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL
export const MAX_FALLBACK_CONFIG_AGE_MS = 5 * 60 * 1000; // 5 minutes fallback window
const STORE_HOURS_CACHE_KEY = "store_hours:config";

// Shared checkout fallback cache
let sharedCheckoutFallback = null;

export const _resetCheckoutStoreFallbackForTesting = () => {
  sharedCheckoutFallback = null;
};

let verifiedWpTimezone = null;
let verifiedGmtOffset = null;

export const _setVerifiedWpTimezoneForTesting = (tz, offset = null) => {
  verifiedWpTimezone = tz;
  verifiedGmtOffset = offset;
  if (tz) {
    serverCache.set("wp:site_timezone", { timezone: tz, gmt_offset: offset }, 3600000);
  } else {
    serverCache.delete("wp:site_timezone");
  }
};

/**
 * Returns the verified store timezone string (e.g. "Asia/Kolkata", "+05:30").
 */
export const getVerifiedStoreTimezone = () => {
  if (verifiedWpTimezone) return verifiedWpTimezone;
  const cachedSiteTz = serverCache.get("wp:site_timezone");
  if (cachedSiteTz?.timezone) return (verifiedWpTimezone = cachedSiteTz.timezone);
  const cachedHours = serverCache.get(STORE_HOURS_CACHE_KEY);
  if (cachedHours?.wp_timezone) return (verifiedWpTimezone = cachedHours.wp_timezone);
  if (cachedHours?.timezone) return cachedHours.timezone;
  return process.env.STORE_TIMEZONE || process.env.TZ || DEFAULT_STORE_HOURS_CONFIG.timezone || "Asia/Kolkata";
};

export const _resetStoreHoursCacheForTesting = () => {
  storeHoursCache = null;
  lastKnownGoodConfig = null;
  lastSuccessfulFetchTime = 0;
  sharedCheckoutFallback = null;
  verifiedWpTimezone = null;
  verifiedGmtOffset = null;
  serverCache.delete(STORE_HOURS_CACHE_KEY);
  serverCache.delete("wp:site_timezone");
};

/**
 * Validates HH:MM format in 24h format (00:00 to 23:59)
 */
export const isValidTimeFormat = (timeStr) => {
  if (typeof timeStr !== "string") return false;
  return Boolean(timeStr.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/));
};

/**
 * Converts HH:MM string to minutes since midnight (0..1439)
 */
export const timeToMinutes = (timeStr) => {
  if (!isValidTimeFormat(timeStr)) return 0;
  const [hours, minutes] = timeStr.trim().split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * Formats HH:MM 24h string into a friendly 12h time string (e.g. "9:00 AM", "10:30 PM")
 */
export const format12HourTime = (timeStr) => {
  if (!isValidTimeFormat(timeStr)) return timeStr || "N/A";
  const [hours, minutes] = timeStr.trim().split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  const m = minutes < 10 ? `0${minutes}` : minutes;
  return `${h}:${m} ${period}`;
};

const trimOrFallback = (...candidates) => {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
};

/**
 * Normalizes and validates the full store hours configuration
 */
export const normalizeStoreHoursConfig = (raw) => {
  if (!raw || typeof raw !== "object") {
    return JSON.parse(JSON.stringify(DEFAULT_STORE_HOURS_CONFIG));
  }

  const manual_override = ["auto", "open", "closed"].includes(raw.manual_override) ? raw.manual_override : "auto";
  const notice_message = trimOrFallback(raw.closed_message, raw.notice_message, DEFAULT_STORE_HOURS_CONFIG.notice_message);
  const is_peak_hours = Boolean(raw.is_peak_hours);
  let peak_delivery_text = trimOrFallback(raw.peak_delivery_text, DEFAULT_STORE_HOURS_CONFIG.peak_delivery_text);
  let normal_delivery_text = trimOrFallback(raw.normal_delivery_text, DEFAULT_STORE_HOURS_CONFIG.normal_delivery_text);
  let peak_notice_message = trimOrFallback(raw.peak_notice_message, raw.peak_notice, DEFAULT_STORE_HOURS_CONFIG.peak_notice_message);

  if (normal_delivery_text.includes("60") || normal_delivery_text.includes("90")) {
    normal_delivery_text = "Same Day Local Delivery";
  }
  if (peak_delivery_text.includes("2–3") || peak_delivery_text.includes("2-3") || peak_delivery_text.includes("60")) {
    peak_delivery_text = "Same Day Delivery (High Demand)";
  }
  if (peak_notice_message.includes("2–3 hours") || peak_notice_message.includes("2-3 hours")) {
    peak_notice_message = "High order volume in progress. Deliveries may arrive by late evening today.";
  }
  const delivery_eta_text = is_peak_hours ? peak_delivery_text : normal_delivery_text;

  const rawSchedule = raw.schedule || {};
  const schedule = Object.fromEntries(
    DAYS_OF_WEEK.map((day) => {
      const dayData = rawSchedule[day] || DEFAULT_STORE_HOURS_CONFIG.schedule[day] || { is_enabled: true, open: "09:00", close: "22:00" };
      return [
        day,
        {
          is_enabled: dayData.is_enabled !== false && dayData.enabled !== false,
          open: isValidTimeFormat(dayData.open) ? dayData.open.trim() : "09:00",
          close: isValidTimeFormat(dayData.close) ? dayData.close.trim() : "22:00",
        },
      ];
    })
  );

  const version =
    raw.version !== undefined && raw.version !== null && Number.isFinite(Number(raw.version)) && Number(raw.version) > 0
      ? Number(raw.version)
      : 1;

  return {
    version,
    manual_override,
    timezone: "Asia/Kolkata",
    notice_message,
    closed_message: notice_message,
    is_peak_hours,
    peak_delivery_text,
    normal_delivery_text,
    peak_notice_message,
    peak_notice: peak_notice_message,
    delivery_eta_text,
    schedule,
  };
};

/**
 * Extracts current IST time components from a Date object
 */
export const getISTTimeComponents = (referenceDate = new Date()) => {
  const d = referenceDate instanceof Date && !isNaN(referenceDate) ? referenceDate : new Date();

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const map = {};
  for (const p of formatter.formatToParts(d)) {
    map[p.type] = p.value;
  }

  const weekday = (map.weekday || "").toLowerCase();
  const dayIndex = DAYS_OF_WEEK.indexOf(weekday) >= 0 ? DAYS_OF_WEEK.indexOf(weekday) : d.getUTCDay();
  let hour = parseInt(map.hour || "0", 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(map.minute || "0", 10);

  return {
    dayName: DAYS_OF_WEEK[dayIndex],
    dayIndex,
    hour,
    minute,
    second: parseInt(map.second || "0", 10),
    currentMinutes: hour * 60 + minute,
    formattedTime24: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    formattedDate: `${map.year}-${map.month}-${map.day}`,
  };
};

/**
 * Core evaluation engine: determines whether the store is open at a given moment in Asia/Kolkata
 */
export const evaluateStoreStatus = (configInput, referenceDate = new Date()) => {
  const config = normalizeStoreHoursConfig(configInput);
  const ist = getISTTimeComponents(referenceDate);

  const baseStatus = {
    is_peak_hours: config.is_peak_hours,
    delivery_eta_text: config.delivery_eta_text,
    normal_delivery_text: config.normal_delivery_text,
    peak_delivery_text: config.peak_delivery_text,
    peak_notice: config.peak_notice_message,
    peak_notice_message: config.peak_notice_message,
    timezone: config.timezone,
    current_day: ist.dayName,
    current_time_ist: ist.formattedTime24,
    current_ist_time: ist.formattedTime24,
  };

  // 1. Manual Override takes highest precedence
  if (config.manual_override === "open") {
    return {
      ...baseStatus,
      is_open: true,
      reason: "manual_override_open",
      evaluation_reason: "manual_override_open",
      message: "Store is open (manual override active).",
      schedule_today: config.schedule[ist.dayName],
      next_opening: null,
      manual_override: "open",
    };
  }

  if (config.manual_override === "closed") {
    const nextOpening = calculateNextOpening(config, referenceDate);
    const msg = config.closed_message || config.notice_message || "Our store is currently closed for new orders.";
    return {
      ...baseStatus,
      is_open: false,
      reason: "manual_override_closed",
      evaluation_reason: "manual_override_closed",
      message: msg,
      closed_message: msg,
      schedule_today: config.schedule[ist.dayName],
      next_opening: nextOpening,
      manual_override: "closed",
    };
  }

  // 2. Automated schedule evaluation
  const todaySchedule = config.schedule[ist.dayName];
  const yesterdayName = DAYS_OF_WEEK[(ist.dayIndex + 6) % 7];
  const yesterdaySchedule = config.schedule[yesterdayName];

  let isOpen = false;
  let activeShift = null;

  // A. Check yesterday overnight shift spillover past midnight
  if (yesterdaySchedule?.is_enabled) {
    const yOpenM = timeToMinutes(yesterdaySchedule.open);
    const yCloseM = timeToMinutes(yesterdaySchedule.close);
    if (yOpenM > yCloseM && ist.currentMinutes < yCloseM) {
      isOpen = true;
      activeShift = { day: yesterdayName, open: yesterdaySchedule.open, close: yesterdaySchedule.close, is_spillover: true };
    }
  }

  // B. Check today's shift if not already active
  if (!isOpen && todaySchedule?.is_enabled) {
    const openM = timeToMinutes(todaySchedule.open);
    const closeM = timeToMinutes(todaySchedule.close);

    if (openM === closeM) {
      isOpen = true;
      activeShift = { day: ist.dayName, open: todaySchedule.open, close: todaySchedule.close, is_24h: true };
    } else if (openM < closeM) {
      if (ist.currentMinutes >= openM && ist.currentMinutes < closeM) {
        isOpen = true;
        activeShift = { day: ist.dayName, open: todaySchedule.open, close: todaySchedule.close };
      }
    } else if (ist.currentMinutes >= openM) {
      isOpen = true;
      activeShift = { day: ist.dayName, open: todaySchedule.open, close: todaySchedule.close };
    }
  }

  if (isOpen) {
    return {
      ...baseStatus,
      is_open: true,
      reason: "schedule_open",
      evaluation_reason: "schedule_open",
      message: "Store is open for orders.",
      schedule_today: todaySchedule,
      active_shift: activeShift,
      next_opening: null,
      manual_override: "auto",
    };
  }

  // Store is closed
  const nextOpening = calculateNextOpening(config, referenceDate);
  const msg = config.closed_message || config.notice_message || "Our store is currently closed for new orders.";
  return {
    ...baseStatus,
    is_open: false,
    is_after_hours: true,
    is_next_day_delivery: Boolean(nextOpening && nextOpening.relative_day !== "today"),
    scheduled_delivery_date: nextOpening?.date || null,
    next_delivery_eta_text: nextOpening?.time_formatted ? `Fulfillment starts ${nextOpening.label}` : "No upcoming opening is scheduled",
    reason: "schedule_closed",
    evaluation_reason: "schedule_closed",
    message: msg,
    closed_message: msg,
    schedule_today: todaySchedule,
    next_opening: nextOpening,
    manual_override: "auto",
  };
};

function shiftCalendarDate(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Calculates the next upcoming opening day, time, and human-readable label
 */
export const calculateNextOpening = (configInput, referenceDate = new Date()) => {
  const config = normalizeStoreHoursConfig(configInput);
  const ist = getISTTimeComponents(referenceDate);

  for (let offset = 0; offset <= 7; offset++) {
    const targetDayName = DAYS_OF_WEEK[(ist.dayIndex + offset) % 7];
    const targetSchedule = config.schedule[targetDayName];

    if (!targetSchedule?.is_enabled) continue;

    const openM = timeToMinutes(targetSchedule.open);
    if (offset === 0 && ist.currentMinutes >= openM) continue;

    const formatted12 = format12HourTime(targetSchedule.open);
    const relative = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : targetDayName.charAt(0).toUpperCase() + targetDayName.slice(1);
    return {
      day: targetDayName,
      date: shiftCalendarDate(ist.formattedDate, offset),
      time: targetSchedule.open,
      time_formatted: formatted12,
      label: `${relative} at ${formatted12} IST`,
      relative_day: offset === 0 ? "today" : offset === 1 ? "tomorrow" : targetDayName,
    };
  }

  return { day: null, time: null, time_formatted: null, label: "Check back later", relative_day: "unknown" };
};

const withMetadata = (config, source, ageMs = 0, isFallback = false, isStale = false) => ({
  ...config,
  _metadata: { source, age_ms: ageMs, is_fallback: isFallback, is_stale: isStale },
});

const updateHoursCache = (normalized, now = Date.now()) => {
  storeHoursCache = { data: normalized, timestamp: now };
  serverCache.set(STORE_HOURS_CACHE_KEY, normalized, CACHE_TTL_MS);
  lastKnownGoodConfig = normalized;
  lastSuccessfulFetchTime = now;
};

/**
 * Fetches Store Hours Configuration with resilience hierarchy:
 * 1. Fresh in-memory cache (<60s)
 * 2. WordPress wp_options fetch
 * 3. Last-known-good cache (if WordPress fails)
 * 4. Safe default configuration
 */
export const getStoreHoursConfig = async (forceFresh = false) => {
  if (!forceFresh) {
    const sharedCached = serverCache.get(STORE_HOURS_CACHE_KEY);
    if (sharedCached?.schedule) {
      return withMetadata(sharedCached, "cache", Date.now() - (lastSuccessfulFetchTime || Date.now()));
    }
    if (storeHoursCache && Date.now() - storeHoursCache.timestamp < CACHE_TTL_MS) {
      return withMetadata(storeHoursCache.data, "cache", Date.now() - (lastSuccessfulFetchTime || storeHoursCache.timestamp));
    }
  }

  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/store-hours`;

  try {
    const response = await axios.get(endpoint, {
      headers: { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY },
      httpsAgent,
      timeout: 8000,
    });

    if (response.data?.wp_timezone) {
      verifiedWpTimezone = response.data.wp_timezone;
      verifiedGmtOffset = response.data.gmt_offset;
      serverCache.set("wp:site_timezone", { timezone: verifiedWpTimezone, gmt_offset: verifiedGmtOffset }, 3600000);
    }
    const wpConfig = response.data?.store_hours;
    if (wpConfig?.schedule) {
      const upstreamVer =
        response.data?.version !== undefined && response.data?.version !== null
          ? Number(response.data.version)
          : (wpConfig.version !== undefined && wpConfig.version !== null
              ? Number(wpConfig.version)
              : null);

      if (forceFresh && (upstreamVer === null || !Number.isSafeInteger(upstreamVer) || upstreamVer <= 0)) {
        throw new Error("WordPress store operating hours response is missing a valid authoritative version.");
      }

      if (upstreamVer !== null && Number.isSafeInteger(upstreamVer) && upstreamVer > 0) {
        wpConfig.version = upstreamVer;
      }
      const normalized = normalizeStoreHoursConfig(wpConfig);
      updateHoursCache(normalized);
      return withMetadata(normalized, "wordpress", 0);
    }
  } catch (error) {
    logger.warn({ err: error.response?.data?.message || error.message }, "[StoreHoursService] WordPress store-hours read warning");
    if (forceFresh) {
      throw new Error(`WordPress store operating hours unavailable: ${error.response?.data?.message || error.message}`);
    }
  }

  if (forceFresh) {
    throw new Error("WordPress store operating hours configuration is missing or malformed.");
  }

  // Fallback 1: Return last known good config if available (strictly non-admin shopper reads)
  if (lastKnownGoodConfig) {
    const ageMs = lastSuccessfulFetchTime ? Date.now() - lastSuccessfulFetchTime : Infinity;
    return withMetadata(lastKnownGoodConfig, "fallback", ageMs, true, ageMs > MAX_FALLBACK_CONFIG_AGE_MS);
  }

  // Fallback 2: Default static configuration (strictly non-admin shopper reads)
  return withMetadata(JSON.parse(JSON.stringify(DEFAULT_STORE_HOURS_CONFIG)), "default", Infinity, true, true);
};

/**
 * Saves Store Hours Configuration to WordPress wp_options with optimistic locking
 */
export const saveStoreHoursConfig = async (newConfig, { expectedVersion } = {}) => {
  const effectiveExpectedVersion =
    expectedVersion !== undefined && expectedVersion !== null
      ? Number(expectedVersion)
      : (newConfig?.expected_version !== undefined && newConfig?.expected_version !== null
          ? Number(newConfig.expected_version)
          : (newConfig?.version !== undefined && newConfig?.version !== null
              ? Number(newConfig.version)
              : null));

  if (effectiveExpectedVersion === null || !Number.isSafeInteger(effectiveExpectedVersion) || effectiveExpectedVersion <= 0) {
    throw new Error("expected_version is required and must be a positive integer.");
  }

  // Read current authoritative configuration directly from WordPress (strictly fail-closed on outage)
  const existing = await getStoreHoursConfig(true);

  const merged = { ...existing, ...(newConfig && typeof newConfig === "object" ? newConfig : {}) };
  const normalized = normalizeStoreHoursConfig(merged);
  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";

  const requestPayload = {
    store_hours: normalized,
    expected_version: effectiveExpectedVersion,
  };

  const response = await axios.post(
    `${wpBaseUrl}/wp-json/mumbai-auth/v1/store-hours`,
    requestPayload,
    {
      headers: { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY },
      httpsAgent,
      timeout: 10000,
    }
  );

  const returnedHours = response.data?.store_hours || normalized;
  if (response.data?.version) {
    returnedHours.version = Number(response.data.version);
  }
  const saved = normalizeStoreHoursConfig(returnedHours);
  updateHoursCache(saved);
  serverCache.delete(STORE_HOURS_CACHE_KEY);
  return saved;
};

/**
 * Returns full live status of the store
 */
export const getStoreStatus = async (referenceDate = new Date()) => {
  const fetchConfig = (storeHoursService && storeHoursService.getStoreHoursConfig) || getStoreHoursConfig;
  const config = await fetchConfig();
  const status = evaluateStoreStatus(config, referenceDate);
  if (config._metadata) {
    status._metadata = config._metadata;
    status.is_fallback = Boolean(config._metadata.is_fallback);
    status.is_stale = Boolean(config._metadata.is_stale);
  }
  return status;
};

/**
 * Convenience boolean helper for checking if store is currently open
 */
export const isStoreOpen = async (referenceDate = new Date()) => {
  const fetchStatus = (storeHoursService && storeHoursService.getStoreStatus) || getStoreStatus;
  const status = await fetchStatus(referenceDate);
  return Boolean(status?.is_open);
};

/**
 * Internal helper to evaluate checkout eligibility from a resolved store status.
 */
const evaluateCheckoutEligibility = (status, { isFallback = false } = {}) => {
  if (!status || !status.is_open) {
    const isAfterHours = Boolean(status?.is_after_hours || status?.reason === "schedule_closed");
    if (status && isAfterHours && status.manual_override !== "closed") {
      if (!status.next_opening?.time || !status.next_opening?.day || !status.next_opening?.date) {
        return {
          allowed: false,
          statusCode: 403,
          payload: {
            success: false,
            code: "STORE_CLOSED",
            message: "Our store is currently closed and not accepting scheduled orders.",
            manual_override: status.manual_override || "auto",
            next_opening: status.next_opening || null,
          },
        };
      }
      return {
        allowed: true,
        storeStatus: status,
        ...(isFallback ? { isFallback: true } : {}),
        is_after_hours: true,
        is_next_day_delivery: status.next_opening.relative_day !== "today",
        scheduled_delivery_date: status.next_opening.date,
        scheduled_delivery_label: status.next_opening.label || null,
      };
    }

    return {
      allowed: false,
      statusCode: 403,
      payload: {
        success: false,
        code: "STORE_CLOSED",
        message: status?.message || "Our store is currently closed for new orders.",
        next_opening: status?.next_opening || null,
        manual_override: status?.manual_override || "auto",
        current_day: status?.current_day,
        current_time_ist: status?.current_time_ist,
        schedule_today: status?.schedule_today,
        timezone: status?.timezone || "Asia/Kolkata",
      },
    };
  }

  return {
    allowed: true,
    storeStatus: status,
    ...(isFallback ? { isFallback: true } : {}),
  };
};

/**
 * Shared Authoritative Checkout Store Hours Guard
 */
export const checkCheckoutStoreGuard = async (localFallback = null, setLocalFallback = null) => {
  try {
    const fetchFn = (storeHoursService && storeHoursService.getStoreStatus) || getStoreStatus;
    const storeStatus = await fetchFn();
    if (!storeStatus || typeof storeStatus.is_open !== "boolean") {
      throw new Error("Invalid store status payload");
    }

    if (storeStatus.is_stale) {
      throw new Error("Store status configuration is stale (> 5 minutes)");
    }

    if (!storeStatus.is_fallback) {
      const record = { status: storeStatus, timestamp: Date.now() };
      sharedCheckoutFallback = record;
      if (typeof setLocalFallback === "function") {
        setLocalFallback(record);
      }
    }

    return evaluateCheckoutEligibility(storeStatus, { isFallback: false });
  } catch (statusErr) {
    logger.warn({ err: statusErr.message }, "[StoreHours] Checkout store hours evaluation warning, checking fallback cache");

    const fallbackRecord = localFallback || sharedCheckoutFallback;
    const hasValidFallback = fallbackRecord && Date.now() - fallbackRecord.timestamp <= MAX_FALLBACK_CONFIG_AGE_MS;

    if (hasValidFallback) {
      return evaluateCheckoutEligibility(fallbackRecord.status, { isFallback: true });
    }

    return {
      allowed: false,
      statusCode: 503,
      payload: {
        success: false,
        code: "STORE_HOURS_UNAVAILABLE",
        message: "Unable to verify store operating hours. Please try again in a few moments.",
      },
    };
  }
};

const storeHoursService = {
  DAYS_OF_WEEK,
  DEFAULT_STORE_HOURS_CONFIG,
  MAX_FALLBACK_CONFIG_AGE_MS,
  _resetStoreHoursCacheForTesting,
  _resetCheckoutStoreFallbackForTesting,
  _setVerifiedWpTimezoneForTesting,
  getVerifiedStoreTimezone,
  checkCheckoutStoreGuard,
  isValidTimeFormat,
  timeToMinutes,
  format12HourTime,
  normalizeStoreHoursConfig,
  getISTTimeComponents,
  evaluateStoreStatus,
  calculateNextOpening,
  getStoreHoursConfig,
  saveStoreHoursConfig,
  getStoreStatus,
  isStoreOpen,
};

export default storeHoursService;
