import api from "../config/woocommerce.js";
import wp from "../services/wordpress.js";
import { serverCache } from "../utils/memoryCache.js";
import { logError } from "../utils/logger.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { fetchStockCounts } from "./adminProductController.js";
import { getISTDateBoundaries } from "../utils/orderDateBounds.js";

/**
 * Returns the effective status for an order, respecting Employee Panel meta.
 */
function getEffectiveStatus(order) {
  const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
  return ["completed", "cancelled", "failed", "refunded"].includes(order.status) ? order.status : deliveryMeta?.value || order.status;
}

/**
 * Helper to calculate current month start and next month start in IST,
 * returned as UTC timestamps for order date comparison.
 */
export const getISTMonthBoundaries = (referenceDate = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  });
  const currentISTYearMonth = formatter.format(referenceDate); // "YYYY-MM"
  
  const istMonthStartStr = `${currentISTYearMonth}-01T00:00:00.000+05:30`;
  const istMonthStartUTC = new Date(istMonthStartStr).getTime();
  
  const [yearStr, monthStr] = currentISTYearMonth.split("-");
  let nextYear = parseInt(yearStr, 10);
  let nextMonth = parseInt(monthStr, 10) + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const nextMonthStrFormatted = nextMonth.toString().padStart(2, "0");
  const istNextMonthStartStr = `${nextYear}-${nextMonthStrFormatted}-01T00:00:00.000+05:30`;
  const istNextMonthStartUTC = new Date(istNextMonthStartStr).getTime();

  return { istMonthStartUTC, istNextMonthStartUTC };
};

/**
 * Executive Overview Analytics
 * (Unchanged — uses its own clean-revenue logic)
 */
export const getDashboardOverview = async (req, res) => {
  try {
    const isRefresh = req.query.refresh === "true" || req.query.refresh === "1";
    if (!isRefresh) {
      const cachedOverview = serverCache.get("admin:analytics:overview");
      if (cachedOverview) {
        if (typeof res.set === "function") {
          res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        }
        return res.json(cachedOverview);
      }
    }

    const todayBounds = getISTDateBoundaries("today");
    const { istMonthStartUTC, istNextMonthStartUTC } = getISTMonthBoundaries();
    const monthAfter = new Date(istMonthStartUTC).toISOString();
    const monthBefore = new Date(istNextMonthStartUTC).toISOString();

    const todayDateString = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    // Parallel fetch: direct low stock query, 10 recent orders, live stock counts, and HPOS analytics summary
    const [summaryRes, recentOrdersRes, lowStockRes, stockCounts] = await Promise.all([
      wp.get("/wp-json/mumbai-auth/v1/admin/analytics-summary", {
        headers: { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY },
        params: {
          today_after: todayBounds?.after,
          today_before: todayBounds?.before,
          month_after: monthAfter,
          month_before: monthBefore,
        },
        timeout: 6000,
      }).catch(() => null),

      api.get("orders", {
        per_page: 10,
        orderby: "date",
        order: "desc",
      }).catch(() => ({ data: [] })),

      api.get("products", {
        stock_status: "lowstock",
        per_page: 6,
      }).catch(() => ({ data: [] })),

      fetchStockCounts().catch(() => ({ all: 0, instock: 0, lowstock: 0, outofstock: 0 })),
    ]);

    const lowStockProducts = (Array.isArray(lowStockRes?.data) ? lowStockRes.data : []).slice(0, 6).map((p) => ({
      id: p.id,
      name: p.name,
      image: p.images?.[0]?.src || null,
      stock_quantity: p.stock_quantity,
      stock_status: p.stock_status,
      price: p.price,
    }));

    const rawRecentOrders = Array.isArray(recentOrdersRes?.data) ? recentOrdersRes.data : [];
    const recentOrders = rawRecentOrders.map((o) => {
      const effectiveStatus = getEffectiveStatus(o);
      return {
        id: o.id,
        order_number: o.number || String(o.id),
        customer_name:
          formatCustomerDisplayName(o.billing?.first_name, o.billing?.last_name, o.billing?.email || "Guest Customer"),
        customer_email: o.billing?.email || "",
        customer_phone: o.billing?.phone || "",
        total: o.total,
        status: effectiveStatus,
        date: o.date_created,
        items_count: o.line_items?.reduce((sum, i) => sum + (i.quantity || 1), 0) || 0,
        payment_method: o.payment_method_title || "Cash on Delivery",
      };
    });

    // Last 7 days map for sales chart (IST keys)
    const last7DaysMap = new Map();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
      const dayLabel = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
      last7DaysMap.set(dateKey, { date: dateKey, label: dayLabel, revenue: 0, orders: 0 });
    }

    let summaryData = null;

    if (summaryRes?.data?.success) {
      const s = summaryRes.data;
      const sc = s.statusCounts || {};
      const activeOrdersCount =
        (sc.processing || 0) +
        (sc.packed || 0) +
        (sc["on-hold"] || 0) +
        (sc["out-for-delivery"] || 0) +
        (sc.dispatched || 0);

      summaryData = {
        totalRevenue: s.totalRevenue,
        todaySales: s.todaySales,
        monthSales: s.monthSales,
        monthOrdersCount: s.monthOrdersCount,
        totalOrders: s.totalOrders,
        activeOrders: activeOrdersCount,
        completedOrders: sc.completed || 0,
        cancelledOrders: (sc.cancelled || 0) + (sc.failed || 0) + (sc.refunded || 0),
        totalProducts: stockCounts?.all || 0,
        lowStockCount: stockCounts?.lowstock ?? lowStockProducts.length,
        avgOrderValue: s.avgOrderValue,
      };

      // Populate 7-day sales trend from real-time database aggregation
      if (s.weeklyTrend && typeof s.weeklyTrend === "object") {
        for (const [dateStr, dayStats] of Object.entries(s.weeklyTrend)) {
          if (last7DaysMap.has(dateStr)) {
            const entry = last7DaysMap.get(dateStr);
            entry.revenue = Number(dayStats.revenue) || 0;
            entry.orders = Number(dayStats.orders) || 0;
          }
        }
      }
    } else {
      return res.status(503).json({ success: false, message: "Complete analytics requires the reporting plugin and authoritative HPOS. Restore them and retry." });
    }

    const responsePayload = {
      success: true,
      summary: summaryData,
      salesTrend: Array.from(last7DaysMap.values()),
      lowStockProducts: lowStockProducts.slice(0, 6),
      recentOrders,
      data: {
        summary: summaryData,
        salesTrend: Array.from(last7DaysMap.values()),
        lowStockProducts: lowStockProducts.slice(0, 6),
        recentOrders,
      },
    };

    serverCache.set("admin:analytics:overview", responsePayload, 120000);

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }

    res.json(responsePayload);
  } catch (error) {
    logError(req, error, "Admin dashboard overview error");
    res.status(500).json({
      success: false,
      message: "Failed to load dashboard overview.",
    });
  }
};

/**
 * Dedicated Store Analytics & Deep Reporting
 *
 * Accounting rule: Only orders whose effectiveStatus is NOT in
 * {cancelled, failed, refunded} contribute to:
 *   - totalRevenue
 *   - avgOrderValue
 *   - productSalesMap (units sold, product revenue)
 *   - customerSalesMap (LTV, ordersCount, repeat-customer rate)
 *   - payment breakdown (cod/online revenue & count)
 *   - dailyRevenueMap (trend)
 *
 * Order counts (total, completed, processing, outForDelivery,
 * cancelled, refunded) are tracked across ALL orders so operational
 * reporting remains complete.
 *
 * fulfillmentRate = completedOrders / totalOrders (all-orders denominator)
 */
export const getAdminAnalytics = async (req, res) => {
  try {
    const isRefresh = req.query?.refresh === "true" || req.query?.refresh === "1";
    if (!isRefresh) {
      const cachedAnalytics = serverCache.get("admin:analytics:deep");
      if (cachedAnalytics) {
        if (typeof res.set === "function") {
          res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        }
        return res.json(cachedAnalytics);
      }
    }

    // Always query real-time MySQL SQL summary first (even on refresh); fall back to WooCommerce REST loop only if WP custom endpoint is offline
    let summaryRes = null;
    try {
      summaryRes = await wp.get("/wp-json/mumbai-auth/v1/admin/analytics-summary", {
        headers: { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY },
        timeout: 7000,
      });
    } catch (_) {}

    let responsePayload = null;

    if (summaryRes?.data?.success) {
      const s = summaryRes.data;
      const sc = s.statusCounts || {};
      const outForDeliveryOrders = (sc["out-for-delivery"] || 0) + (sc.dispatched || 0);

      // 7-day daily trend template (IST dates)
      const dailyRevenueMap = new Map();
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(d);
        const dayName = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
        dailyRevenueMap.set(dateKey, { date: dateKey, day: dayName, sales: 0, orders: 0 });
      }

      // Populate 7-day daily trend from real-time database aggregation
      if (s.weeklyTrend && typeof s.weeklyTrend === "object") {
        for (const [dateStr, dayStats] of Object.entries(s.weeklyTrend)) {
          if (dailyRevenueMap.has(dateStr)) {
            const entry = dailyRevenueMap.get(dateStr);
            entry.sales = Number(dayStats.revenue) || 0;
            entry.orders = Number(dayStats.orders) || 0;
          }
        }
      }

      const validOrderCount = s.validOrderCount || 0;
      const codCount = s.payments?.cod?.count || 0;
      const codRevenue = s.payments?.cod?.revenue || 0;
      const onlineCount = s.payments?.online?.count || 0;
      const onlineRevenue = s.payments?.online?.revenue || 0;

      responsePayload = {
        success: true,
        data: {
          revenue: {
            totalRevenue: Math.round(Number(s.totalRevenue) || 0),
            completedRevenue: Math.round(Number(s.completedRevenue) || 0),
            shippingRevenue: Math.round(Number(s.shippingRevenue) || 0),
            discountTotal: Math.round(Number(s.discountTotal) || 0),
            avgOrderValue: Math.round(Number(s.avgOrderValue) || 0),
            dailyTrend: Array.from(dailyRevenueMap.values()),
          },
          orders: {
            total: Number(s.totalOrders) || 0,
            completed: sc.completed || 0,
            processing: sc.processing || 0,
            outForDelivery: outForDeliveryOrders,
            cancelled: (sc.cancelled || 0) + (sc.failed || 0),
            refunded: sc.refunded || 0,
            fulfillmentRate: s.totalOrders > 0 ? Math.round(((sc.completed || 0) / s.totalOrders) * 100) : 100,
          },
          payments: {
            cod: {
              count: codCount,
              revenue: Math.round(Number(codRevenue) || 0),
              percentage: validOrderCount > 0 ? Math.round((codCount / validOrderCount) * 100) : 0,
            },
            online: {
              count: onlineCount,
              revenue: Math.round(Number(onlineRevenue) || 0),
              percentage: validOrderCount > 0 ? Math.round((onlineCount / validOrderCount) * 100) : 0,
            },
          },
          topProducts: (s.topProducts || []).map((p) => ({
            ...p,
            totalRevenue: Math.round(Number(p.totalRevenue) || 0),
            totalQuantitySold: Number(p.totalQuantitySold) || 0,
          })),
          topCustomers: (s.topCustomers || []).map((c) => ({
            ...c,
            name: c.name || (c.email ? c.email.split("@")[0].replace(/[._\-+]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) : "Customer"),
            lifetimeSpent: Math.round(Number(c.lifetimeSpent) || 0),
            ordersCount: Number(c.ordersCount) || 0,
          })),
          customerMetrics: s.customerMetrics || {
            totalUniqueCustomers: 0,
            repeatCustomerRate: 0,
          },
        },
      };
    } else {
      return res.status(503).json({ success: false, message: "Complete analytics is temporarily unavailable. Restore the HPOS reporting endpoint and retry." });
    }

    serverCache.set("admin:analytics:deep", responsePayload, 120000);

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }

    res.json(responsePayload);
  } catch (error) {
    logError(req, error, "Get admin analytics error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load analytics.",
    });
  }
};

const parseReportDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) return null;
  return Date.parse(`${value}T00:00:00+05:30`);
};

/** Filterable, bounded analytics report backed by WooCommerce's HPOS tables. */
export const getAdminAnalyticsReport = async (req, res) => {
  try {
    const { date_from: dateFrom, date_to: dateTo, product_id: rawProductId, refresh } = req.query || {};
    const start = parseReportDate(dateFrom);
    const end = parseReportDate(dateTo);
    if (start === null || end === null || end < start) {
      return res.status(400).json({ success: false, message: "Choose a valid start and end date." });
    }
    const productId = rawProductId ? Number(rawProductId) : 0;
    if (rawProductId && (!Number.isSafeInteger(productId) || productId <= 0)) {
      return res.status(400).json({ success: false, message: "Choose a valid product." });
    }

    const cacheKey = `admin:analytics:report:${dateFrom}:${dateTo}:${productId || "all"}`;
    if (refresh !== "true" && refresh !== "1") {
      const cached = serverCache.get(cacheKey);
      if (cached) {
        res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
        return res.json(cached);
      }
    }

    const endExclusive = end + 24 * 60 * 60 * 1000;
    const response = await wp.get("/wp-json/mumbai-auth/v1/admin/analytics-report", {
      headers: { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY },
      params: {
        date_after: new Date(start).toISOString(),
        date_before: new Date(endExclusive).toISOString(),
        product_id: productId || undefined,
      },
      timeout: 10000,
    });

    if (!response.data?.success || !response.data?.data) {
      return res.status(502).json({ success: false, message: "WooCommerce could not generate this report." });
    }
    serverCache.set(cacheKey, response.data, 60000);
    res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Get date-filtered admin analytics report error");
    return res.status(error.response?.status || 502).json({
      success: false,
      message: error.response?.data?.message || "Unable to load the selected sales report.",
    });
  }
};
