/**
 * Order Date Boundary Helper for Asia/Kolkata (IST = UTC+5:30)
 *
 * Converts date filters ("today", "yesterday", "7days", "custom") to ISO-8601 UTC
 * strings suitable for WooCommerce REST API `after` and `before` query parameters.
 */

export const getISTDateBoundaries = (filter, customFrom, customTo, referenceDate = new Date()) => {
  if (!filter || filter === "all") {
    return null;
  }

  // Get current date parts in Asia/Kolkata
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formatISTDate = (date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const todayStr = formatISTDate(referenceDate);

  const isValidDateOnly = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };

  // Helper to create a Date in IST and get UTC ISO string
  const getStartOfISTDay = (dateStr) => {
    return new Date(`${dateStr}T00:00:00.000+05:30`).toISOString();
  };

  const getEndOfISTDay = (dateStr) => {
    return new Date(`${dateStr}T23:59:59.999+05:30`).toISOString();
  };

  // Helper to shift IST days
  const shiftISTDays = (baseDateStr, days) => {
    const [year, month, day] = baseDateStr.split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  };

  switch (filter) {
    case "today": {
      return {
        after: getStartOfISTDay(todayStr),
        before: getEndOfISTDay(todayStr),
        startDate: todayStr,
        endDate: todayStr,
      };
    }

    case "yesterday": {
      const yesterdayStr = shiftISTDays(todayStr, -1);
      return {
        after: getStartOfISTDay(yesterdayStr),
        before: getEndOfISTDay(yesterdayStr),
        startDate: yesterdayStr,
        endDate: yesterdayStr,
      };
    }

    case "7days": {
      const sevenDaysAgoStr = shiftISTDays(todayStr, -6);
      return {
        after: getStartOfISTDay(sevenDaysAgoStr),
        before: getEndOfISTDay(todayStr),
        startDate: sevenDaysAgoStr,
        endDate: todayStr,
      };
    }

    case "custom": {
      const fromStr = String(customFrom || "").trim();
      const toStr = String(customTo || "").trim();
      if (!isValidDateOnly(fromStr) || !isValidDateOnly(toStr) || fromStr > toStr) {
        return null;
      }

      return {
        after: getStartOfISTDay(fromStr),
        before: getEndOfISTDay(toStr),
        startDate: fromStr,
        endDate: toStr,
      };
    }

    default:
      return null;
  }
};
