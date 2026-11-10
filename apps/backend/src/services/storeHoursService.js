import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";

export const DAYS_OF_WEEK = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const DEFAULT_STORE_HOURS_CONFIG = {
  manual_override: "auto", // "auto" | "open" | "closed"
  timezone: "Asia/Kolkata",
  notice_message: "Our store is currently closed for new orders. We operate daily from 9:00 AM to 10:00 PM IST.",
  is_peak_hours: false,
  peak_delivery_text: "Delivery in 2–3 hours",
  normal_delivery_text: "Delivery in 60–90 mins",
  peak_notice_message: "High order volume in progress. Deliveries may take 2–3 hours today.",
  schedule: {
    monday:    { is_enabled: true, open: "09:00", close: "22:00" },
    tuesday:   { is_enabled: true, open: "09:00", close: "22:00" },
    wednesday: { is_enabled: true, open: "09:00", close: "22:00" },
    thursday:  { is_enabled: true, open: "09:00", close: "22:00" },
    friday:    { is_enabled: true, open: "09:00", close: "22:00" },
    saturday:  { is_enabled: true, open: "09:00", close: "22:00" },
    sunday:    { is_enabled: true, open: "09:00", close: "22:00" },
  },
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
 * Prioritizes authoritative WordPress site timezone from WordPress API responses,
 * then cached site timezone, then store hours config, then environment variables,
 * and falls back to default store timezone.
 */
export const getVerifiedStoreTimezone = () => {
  if (verifiedWpTimezone) return verifiedWpTimezone;
  const cachedSiteTz = serverCache.get("wp:site_timezone");
  if (cachedSiteTz?.timezone) {
    verifiedWpTimezone = cachedSiteTz.timezone;
    return verifiedWpTimezone;
  }
  const cachedHours = serverCache.get(STORE_HOURS_CACHE_KEY);
  if (cachedHours?.wp_timezone) {
    verifiedWpTimezone = cachedHours.wp_timezone;
    return verifiedWpTimezone;
  }
  if (cachedHours?.timezone) {
    return cachedHours.timezone;
  }
  return (
    process.env.STORE_TIMEZONE ||
    process.env.TZ ||
    DEFAULT_STORE_HOURS_CONFIG.timezone ||
    "Asia/Kolkata"
  );
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
  const match = timeStr.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return Boolean(match);
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

/**
 * Normalizes and validates the full store hours configuration
 */
export const normalizeStoreHoursConfig = (raw) => {
  if (!raw || typeof raw !== "object") {
    return JSON.parse(JSON.stringify(DEFAULT_STORE_HOURS_CONFIG));
  }

  const manual_override = ["auto", "open", "closed"].includes(raw.manual_override)
    ? raw.manual_override
    : "auto";

  const notice_message =
    typeof raw.closed_message === "string" && raw.closed_message.trim()
      ? raw.closed_message.trim()
      : typeof raw.notice_message === "string" && raw.notice_message.trim()
      ? raw.notice_message.trim()
      : DEFAULT_STORE_HOURS_CONFIG.notice_message;

  const is_peak_hours = Boolean(raw.is_peak_hours);

  const peak_delivery_text =
    typeof raw.peak_delivery_text === "string" && raw.peak_delivery_text.trim()
      ? raw.peak_delivery_text.trim()
      : DEFAULT_STORE_HOURS_CONFIG.peak_delivery_text;

  const normal_delivery_text =
    typeof raw.normal_delivery_text === "string" && raw.normal_delivery_text.trim()
      ? raw.normal_delivery_text.trim()
      : DEFAULT_STORE_HOURS_CONFIG.normal_delivery_text;

  const peak_notice_message =
    typeof raw.peak_notice_message === "string" && raw.peak_notice_message.trim()
      ? raw.peak_notice_message.trim()
      : typeof raw.peak_notice === "string" && raw.peak_notice.trim()
      ? raw.peak_notice.trim()
      : DEFAULT_STORE_HOURS_CONFIG.peak_notice_message;

  const delivery_eta_text = is_peak_hours ? peak_delivery_text : normal_delivery_text;

  const rawSchedule = raw.schedule || {};
  const schedule = {};

  for (const day of DAYS_OF_WEEK) {
    const dayData = rawSchedule[day] || DEFAULT_STORE_HOURS_CONFIG.schedule[day] || { is_enabled: true, open: "09:00", close: "22:00" };
    const is_enabled = dayData.is_enabled !== false && dayData.enabled !== false;
    const open = isValidTimeFormat(dayData.open) ? dayData.open.trim() : "09:00";
    const close = isValidTimeFormat(dayData.close) ? dayData.close.trim() : "22:00";

    schedule[day] = {
      is_enabled,
      open,
      close,
    };
  }

  return {
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

  // Use standard Intl to extract components in Asia/Kolkata
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

  const parts = formatter.formatToParts(d);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  const weekday = (map.weekday || "").toLowerCase();
  const dayIndex = DAYS_OF_WEEK.indexOf(weekday) >= 0 ? DAYS_OF_WEEK.indexOf(weekday) : d.getUTCDay();
  const dayName = DAYS_OF_WEEK[dayIndex];

  let hour = parseInt(map.hour || "0", 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(map.minute || "0", 10);
  const second = parseInt(map.second || "0", 10);

  const currentMinutes = hour * 60 + minute;
  const formattedTime24 = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  return {
    dayName,
    dayIndex,
    hour,
    minute,
    second,
    currentMinutes,
    formattedTime24,
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
  const yesterdayIndex = (ist.dayIndex + 6) % 7;
  const yesterdayName = DAYS_OF_WEEK[yesterdayIndex];
  const yesterdaySchedule = config.schedule[yesterdayName];

  let isOpen = false;
  let activeShift = null;

  // A. Check if yesterday had an overnight shift that is still active past midnight today
  if (yesterdaySchedule && yesterdaySchedule.is_enabled) {
    const yOpenM = timeToMinutes(yesterdaySchedule.open);
    const yCloseM = timeToMinutes(yesterdaySchedule.close);

    // Overnight shift: open > close (e.g. 18:00 to 02:00)
    if (yOpenM > yCloseM && ist.currentMinutes < yCloseM) {
      isOpen = true;
      activeShift = {
        day: yesterdayName,
        open: yesterdaySchedule.open,
        close: yesterdaySchedule.close,
        is_spillover: true,
      };
    }
  }

  // B. Check today's schedule if not already opened by yesterday's overnight spillover
  if (!isOpen && todaySchedule && todaySchedule.is_enabled) {
    const openM = timeToMinutes(todaySchedule.open);
    const closeM = timeToMinutes(todaySchedule.close);

    if (openM === closeM) {
      // 00:00 to 00:00 or open == close with is_enabled: true means 24-hour operation
      isOpen = true;
      activeShift = {
        day: ist.dayName,
        open: todaySchedule.open,
        close: todaySchedule.close,
        is_24h: true,
      };
    } else if (openM < closeM) {
      // Regular daytime shift (e.g. 09:00 to 22:00): open inclusive, close exclusive
      if (ist.currentMinutes >= openM && ist.currentMinutes < closeM) {
        isOpen = true;
        activeShift = {
          day: ist.dayName,
          open: todaySchedule.open,
          close: todaySchedule.close,
        };
      }
    } else {
      // Overnight shift starting today (e.g. 18:00 to 02:00): active from openM until midnight
      if (ist.currentMinutes >= openM) {
        isOpen = true;
        activeShift = {
          day: ist.dayName,
          open: todaySchedule.open,
          close: todaySchedule.close,
        };
      }
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
  const nextDeliveryEta = nextOpening?.time_formatted
    ? `Fulfillment starts ${nextOpening.label}`
    : "No upcoming opening is scheduled";
  return {
    ...baseStatus,
    is_open: false,
    is_after_hours: true,
    is_next_day_delivery: Boolean(nextOpening && nextOpening.relative_day !== "today"),
    scheduled_delivery_date: nextOpening?.date || null,
    next_delivery_eta_text: nextDeliveryEta,
    reason: "schedule_closed",
    evaluation_reason: "schedule_closed",
    message: msg,
    closed_message: msg,
    schedule_today: todaySchedule,
    next_opening: nextOpening,
    manual_override: "auto",
  };
};

/**
 * Calculates the next upcoming opening day, time, and human-readable label
 */
export const calculateNextOpening = (configInput, referenceDate = new Date()) => {
  const config = normalizeStoreHoursConfig(configInput);
  const ist = getISTTimeComponents(referenceDate);

  // Look ahead up to 7 days to find the next opening slot
  for (let offset = 0; offset <= 7; offset++) {
    const targetDayIndex = (ist.dayIndex + offset) % 7;
    const targetDayName = DAYS_OF_WEEK[targetDayIndex];
    const targetSchedule = config.schedule[targetDayName];

    if (!targetSchedule || !targetSchedule.is_enabled) {
      continue;
    }

    const openM = timeToMinutes(targetSchedule.open);

    if (offset === 0) {
      // Today: only valid if opening time is in the future
      if (ist.currentMinutes < openM) {
        return {
          day: targetDayName,
          date: shiftCalendarDate(ist.formattedDate, offset),
          time: targetSchedule.open,
          time_formatted: format12HourTime(targetSchedule.open),
          label: `Today at ${format12HourTime(targetSchedule.open)} IST`,
          relative_day: "today",
        };
      }
    } else {
      const relative = offset === 1 ? "Tomorrow" : capitalizeFirstLetter(targetDayName);
      return {
        day: targetDayName,
        date: shiftCalendarDate(ist.formattedDate, offset),
        time: targetSchedule.open,
        time_formatted: format12HourTime(targetSchedule.open),
        label: `${relative} at ${format12HourTime(targetSchedule.open)} IST`,
        relative_day: offset === 1 ? "tomorrow" : targetDayName,
      };
    }
  }

  return {
    day: null,
    time: null,
    time_formatted: null,
    label: "Check back later",
    relative_day: "unknown",
  };
};

function shiftCalendarDate(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function capitalizeFirstLetter(string) {
  if (!string) return "";
  return string.charAt(0).toUpperCase() + string.slice(1);
}

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
    if (sharedCached && typeof sharedCached === "object" && sharedCached.schedule) {
      return {
        ...sharedCached,
        _metadata: {
          source: "cache",
          age_ms: Date.now() - (lastSuccessfulFetchTime || Date.now()),
          is_fallback: false,
          is_stale: false,
        },
      };
    }
    if (storeHoursCache && Date.now() - storeHoursCache.timestamp < CACHE_TTL_MS) {
      return {
        ...storeHoursCache.data,
        _metadata: {
          source: "cache",
          age_ms: Date.now() - (lastSuccessfulFetchTime || storeHoursCache.timestamp),
          is_fallback: false,
          is_stale: false,
        },
      };
    }
  }

  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/store-hours`;

  try {
    const response = await axios.get(endpoint, {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
      },
      httpsAgent,
      timeout: 8000,
    });

    if (response.data?.wp_timezone) {
      verifiedWpTimezone = response.data.wp_timezone;
      verifiedGmtOffset = response.data.gmt_offset;
      serverCache.set("wp:site_timezone", {
        timezone: verifiedWpTimezone,
        gmt_offset: verifiedGmtOffset,
      }, 3600000);
    }
    const wpConfig = response.data?.store_hours;

    if (wpConfig && typeof wpConfig === "object" && wpConfig.schedule) {
      const normalized = normalizeStoreHoursConfig(wpConfig);
      const now = Date.now();
      storeHoursCache = {
        data: normalized,
        timestamp: now,
      };
      serverCache.set(STORE_HOURS_CACHE_KEY, normalized, CACHE_TTL_MS);
      lastKnownGoodConfig = normalized;
      lastSuccessfulFetchTime = now;
      return {
        ...normalized,
        _metadata: {
          source: "wordpress",
          age_ms: 0,
          is_fallback: false,
          is_stale: false,
        },
      };
    }
  } catch (error) {
    logger.warn(
      { err: error.response?.data?.message || error.message },
      "[StoreHoursService] WordPress store-hours read warning"
    );
  }

  // Fallback 1: Return last known good config if available
  if (lastKnownGoodConfig) {
    const ageMs = lastSuccessfulFetchTime ? (Date.now() - lastSuccessfulFetchTime) : Infinity;
    return {
      ...lastKnownGoodConfig,
      _metadata: {
        source: "fallback",
        age_ms: ageMs,
        is_fallback: true,
        is_stale: ageMs > MAX_FALLBACK_CONFIG_AGE_MS,
      },
    };
  }

  // Fallback 2: Default static configuration (do NOT assign to lastKnownGoodConfig so defaults don't overwrite true WP config)
  const defaultConfig = JSON.parse(JSON.stringify(DEFAULT_STORE_HOURS_CONFIG));
  return {
    ...defaultConfig,
    _metadata: {
      source: "default",
      age_ms: Infinity,
      is_fallback: true,
      is_stale: true,
    },
  };
};

/**
 * Saves Store Hours Configuration to WordPress wp_options
 */
export const saveStoreHoursConfig = async (newConfig) => {
  let existing = {};
  try {
    existing = await getStoreHoursConfig();
  } catch (_) {
    existing = DEFAULT_STORE_HOURS_CONFIG;
  }

  const merged = {
    ...existing,
    ...(newConfig && typeof newConfig === "object" ? newConfig : {}),
  };
  const normalized = normalizeStoreHoursConfig(merged);

  const wpBaseUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
  const endpoint = `${wpBaseUrl}/wp-json/mumbai-auth/v1/store-hours`;

  const response = await axios.post(
    endpoint,
    { store_hours: normalized },
    {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
      },
      httpsAgent,
      timeout: 10000,
    }
  );

  const saved = response.data?.store_hours ? normalizeStoreHoursConfig(response.data.store_hours) : normalized;

  // Invalidate in-memory cache and broadcast across workers
  const now = Date.now();
  storeHoursCache = {
    data: saved,
    timestamp: now,
  };
  lastKnownGoodConfig = saved;
  lastSuccessfulFetchTime = now;
  serverCache.set(STORE_HOURS_CACHE_KEY, saved, CACHE_TTL_MS);
  serverCache.delete(STORE_HOURS_CACHE_KEY);

  return saved;
};

/**
 * Returns full live status of the store
 */
export const getStoreStatus = async (referenceDate = new Date()) => {
  const config = await getStoreHoursConfig();
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
  const status = await getStoreStatus(referenceDate);
  return Boolean(status?.is_open);
};

/**
 * Shared Authoritative Checkout Store Hours Guard
 * Evaluates whether the store is open for placing new orders / initiating payment intents.
 * 
 * Rules:
 * 1. Must have a valid boolean is_open.
 * 2. If status is_stale (> 5 minutes without fresh WP read), fail closed / trigger fallback check.
 * 3. Fresh live reads update the last-known-good fallback cache; fallback/stale reads NEVER overwrite it.
 * 4. If store is closed, returns { allowed: false, statusCode: 403, payload: { code: 'STORE_CLOSED', ... } }.
 * 5. If upstream check fails or status is stale:
 *    - Uses fresh fallback if recorded within MAX_FALLBACK_CONFIG_AGE_MS (5 mins).
 *    - If fallback was closed, returns 403 STORE_CLOSED.
 *    - If fallback was open, allows checkout (allowed: true).
 *    - If no valid fallback within 5 mins, fails closed: { allowed: false, statusCode: 503, payload: { code: 'STORE_HOURS_UNAVAILABLE', ... } }.
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

    if (!storeStatus.is_open) {
      // Allow checkout for after-hours night orders (routine scheduled closure)
      const isAfterHours = Boolean(storeStatus.is_after_hours || storeStatus.reason === "schedule_closed");
      if (isAfterHours && storeStatus.manual_override !== "closed") {
        if (!storeStatus.next_opening?.time || !storeStatus.next_opening?.day || !storeStatus.next_opening?.date) {
          return { allowed: false, statusCode: 403, payload: { success: false, code: "STORE_CLOSED", message: "Our store is currently closed and not accepting scheduled orders.", manual_override: storeStatus.manual_override || "auto", next_opening: storeStatus.next_opening || null } };
        }
        return {
          allowed: true,
          storeStatus,
          is_after_hours: true,
          is_next_day_delivery: storeStatus.next_opening.relative_day !== "today",
          scheduled_delivery_date: storeStatus.next_opening.date,
          scheduled_delivery_label: storeStatus.next_opening.label || null,
        };
      }

      return {
        allowed: false,
        statusCode: 403,
        payload: {
          success: false,
          code: "STORE_CLOSED",
          message: storeStatus.message || "Our store is currently closed for new orders.",
          next_opening: storeStatus.next_opening,
          manual_override: storeStatus.manual_override || "auto",
          current_day: storeStatus.current_day,
          current_time_ist: storeStatus.current_time_ist,
          schedule_today: storeStatus.schedule_today,
          timezone: storeStatus.timezone || "Asia/Kolkata",
        },
      };
    }

    return { allowed: true, storeStatus };
  } catch (statusErr) {
    logger.warn({ err: statusErr.message }, "[StoreHours] Checkout store hours evaluation warning, checking fallback cache");

    const fallbackRecord = localFallback || sharedCheckoutFallback;
    const hasValidFallback =
      fallbackRecord &&
      Date.now() - fallbackRecord.timestamp <= MAX_FALLBACK_CONFIG_AGE_MS;

    if (hasValidFallback) {
      const fallback = fallbackRecord.status;
      if (!fallback || !fallback.is_open) {
        const isFallbackAfterHours = Boolean(fallback?.is_after_hours || fallback?.reason === "schedule_closed");
        if (fallback && isFallbackAfterHours && fallback.manual_override !== "closed") {
          if (!fallback.next_opening?.time || !fallback.next_opening?.day || !fallback.next_opening?.date) {
            return { allowed: false, statusCode: 403, payload: { success: false, code: "STORE_CLOSED", message: "Our store is currently closed and not accepting scheduled orders.", manual_override: fallback.manual_override || "auto", next_opening: fallback.next_opening || null } };
          }
          return {
            allowed: true,
            storeStatus: fallback,
            isFallback: true,
            is_after_hours: true,
            is_next_day_delivery: fallback.next_opening.relative_day !== "today",
            scheduled_delivery_date: fallback.next_opening.date,
            scheduled_delivery_label: fallback.next_opening.label || null,
          };
        }

        return {
          allowed: false,
          statusCode: 403,
          payload: {
            success: false,
            code: "STORE_CLOSED",
            message: fallback?.message || "Our store is currently closed for new orders.",
            next_opening: fallback?.next_opening || null,
            manual_override: fallback?.manual_override || "auto",
            manual_override: fallback?.manual_override || "auto",
            current_day: fallback?.current_day,
            current_time_ist: fallback?.current_time_ist,
            schedule_today: fallback?.schedule_today,
            timezone: fallback?.timezone || "Asia/Kolkata",
          },
        };
      }
      return { allowed: true, storeStatus: fallback, isFallback: true };
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

