import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { logger } from "../utils/logger.js";

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
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

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

  // 1. Manual Override takes highest precedence
  if (config.manual_override === "open") {
    return {
      is_open: true,
      reason: "manual_override_open",
      message: "Store is open (manual override active).",
      current_day: ist.dayName,
      current_time_ist: ist.formattedTime24,
      schedule_today: config.schedule[ist.dayName],
      next_opening: null,
      manual_override: "open",
      timezone: config.timezone,
    };
  }

  if (config.manual_override === "closed") {
    const nextOpening = calculateNextOpening(config, referenceDate);
    const msg = config.closed_message || config.notice_message || "Our store is currently closed for new orders.";
    return {
      is_open: false,
      reason: "manual_override_closed",
      message: msg,
      closed_message: msg,
      current_day: ist.dayName,
      current_time_ist: ist.formattedTime24,
      schedule_today: config.schedule[ist.dayName],
      next_opening: nextOpening,
      manual_override: "closed",
      timezone: config.timezone,
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
      is_open: true,
      reason: "schedule_open",
      message: "Store is open for orders.",
      current_day: ist.dayName,
      current_time_ist: ist.formattedTime24,
      schedule_today: todaySchedule,
      active_shift: activeShift,
      next_opening: null,
      manual_override: "auto",
      timezone: config.timezone,
    };
  }

  // Store is closed
  const nextOpening = calculateNextOpening(config, referenceDate);
  const msg = config.closed_message || config.notice_message || "Our store is currently closed for new orders.";
  return {
    is_open: false,
    reason: "schedule_closed",
    message: msg,
    closed_message: msg,
    current_day: ist.dayName,
    current_time_ist: ist.formattedTime24,
    schedule_today: todaySchedule,
    next_opening: nextOpening,
    manual_override: "auto",
    timezone: config.timezone,
  };
};

/**
 * Calculates the next upcoming opening day, time, and human-readable label
 */
export const calculateNextOpening = (configInput, referenceDate = new Date()) => {
  const config = normalizeStoreHoursConfig(configInput);
  const ist = getISTTimeComponents(referenceDate);

  // Look ahead up to 7 days to find the next opening slot
  for (let offset = 0; offset < 7; offset++) {
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
  if (!forceFresh && storeHoursCache && Date.now() - storeHoursCache.timestamp < CACHE_TTL_MS) {
    return storeHoursCache.data;
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

    const wpConfig = response.data?.store_hours;

    if (wpConfig && typeof wpConfig === "object" && wpConfig.schedule) {
      const normalized = normalizeStoreHoursConfig(wpConfig);
      storeHoursCache = {
        data: normalized,
        timestamp: Date.now(),
      };
      lastKnownGoodConfig = normalized;
      return normalized;
    }
  } catch (error) {
    logger.warn(
      { err: error.response?.data?.message || error.message },
      "[StoreHoursService] WordPress store-hours read warning"
    );
  }

  // Fallback 1: Return last known good config if available
  if (lastKnownGoodConfig) {
    return lastKnownGoodConfig;
  }

  // Fallback 2: Default static configuration
  const defaultConfig = JSON.parse(JSON.stringify(DEFAULT_STORE_HOURS_CONFIG));
  lastKnownGoodConfig = defaultConfig;
  return defaultConfig;
};

/**
 * Saves Store Hours Configuration to WordPress wp_options
 */
export const saveStoreHoursConfig = async (newConfig) => {
  const normalized = normalizeStoreHoursConfig(newConfig);

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

  // Invalidate in-memory cache immediately
  storeHoursCache = {
    data: saved,
    timestamp: Date.now(),
  };
  lastKnownGoodConfig = saved;

  return saved;
};

/**
 * Returns full live status of the store
 */
export const getStoreStatus = async (referenceDate = new Date()) => {
  const config = await getStoreHoursConfig();
  return evaluateStoreStatus(config, referenceDate);
};

/**
 * Convenience boolean helper for checking if store is currently open
 */
export const isStoreOpen = async (referenceDate = new Date()) => {
  const status = await getStoreStatus(referenceDate);
  return Boolean(status?.is_open);
};

export default {
  DAYS_OF_WEEK,
  DEFAULT_STORE_HOURS_CONFIG,
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

