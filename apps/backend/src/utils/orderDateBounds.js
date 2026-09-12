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
  const todayStr = formatter.format(referenceDate); // "YYYY-MM-DD"

  // Helper to create a Date in IST and get UTC ISO string
  const getStartOfISTDay = (dateStr) => {
    return new Date(`${dateStr}T00:00:00.000+05:30`).toISOString();
  };

  const getEndOfISTDay = (dateStr) => {
    return new Date(`${dateStr}T23:59:59.999+05:30`).toISOString();
  };

  // Helper to shift IST days
  const shiftISTDays = (baseDateStr, days) => {
    const baseDate = new Date(`${baseDateStr}T12:00:00+05:30`);
    baseDate.setDate(baseDate.getDate() + days);
    return formatter.format(baseDate);
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
      if (!customFrom) {
        return null;
      }
      const fromStr = String(customFrom).trim();
      const toStr = customTo ? String(customTo).trim() : todayStr;

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
