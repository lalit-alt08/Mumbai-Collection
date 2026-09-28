import api from "../config/woocommerce.js";
import wp from "../services/wordpress.js";
import { serverCache } from "../utils/memoryCache.js";
import { logError } from "../utils/logger.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { fetchStockCounts } from "./adminProductController.js";
import { getISTDateBoundaries } from "../utils/orderDateBounds.js";

/**
 * Statuses that represent invalid/voided/unpaid orders.
 * These must NOT contribute to revenue, AOV, product sales, customer LTV,
 * repeat-customer counts, or payment operational metrics.
 *
 * Matches the clean-revenue policy used by getDashboardOverview.
 */
const INVALID_ORDER_STATUSES = new Set(["pending", "cancelled", "failed", "refunded", "trash"]);

/**
 * Returns true when an order's effective status marks it as invalid/unpaid for
 * revenue/metric purposes (pending, cancelled, failed, refunded, or trash).
 *
 * Respects the custom _delivery_status meta written by the Employee Panel.
 */
function isInvalidOrder(order) {
  const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
  const effectiveStatus = deliveryMeta?.value || order.status;
  return INVALID_ORDER_STATUSES.has(effectiveStatus);
}

/**
 * Returns the effective status for an order, respecting Employee Panel meta.
 */
function getEffectiveStatus(order) {
  const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
  return deliveryMeta?.value || order.status;
}

/**
 * Fetch all WooCommerce orders using server-side pagination (H5 fix).
 * WooCommerce caps per_page at 100; we loop until no more pages.
 * To avoid runaway loops on huge stores we cap at 20 pages (2000 orders).
 */
async function fetchAllOrders() {
  const perPage = 100;
  const maxPages = 20;
  let page = 1;
  const allOrders = [];

  while (page <= maxPages) {
    const res = await api.get("orders", {
      per_page: perPage,
      page,
      orderby: "date",
      order: "desc",
    });

    const batch = Array.isArray(res.data) ? res.data : [];
    allOrders.push(...batch);

    const totalPages = Number(res.headers?.["x-wp-totalpages"]) || 1;
    if (page >= totalPages || batch.length === 0) break;
    page += 1;
  }

  return allOrders;
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
    } else {
      // Fallback: paginated WooCommerce requests if direct SQL summary is offline
      const orders = await fetchAllOrders();

      let totalRevenue = 0;
      let todaySales = 0;
      let monthSales = 0;
      let monthOrdersCount = 0;
      let activeOrdersCount = 0;
      let completedOrdersCount = 0;
      let cancelledOrdersCount = 0;
      let validRevenueOrderCount = 0;

      orders.forEach((order) => {
        const effectiveStatus = getEffectiveStatus(order);
        const orderTotal = Number(order.total) || 0;
        const orderDate = order.date_created ? order.date_created.split("T")[0] : "";
        const isInvalid = isInvalidOrder(order);
        const isCancelled = ["cancelled", "failed", "refunded"].includes(effectiveStatus);

        if (!isInvalid) {
          validRevenueOrderCount += 1;
          totalRevenue += orderTotal;

          if (orderDate === todayDateString) {
            todaySales += orderTotal;
          }

          const orderTimestamp = order.date_created ? new Date(order.date_created).getTime() : 0;
          if (orderTimestamp >= istMonthStartUTC && orderTimestamp < istNextMonthStartUTC) {
            monthSales += orderTotal;
            monthOrdersCount += 1;
          }

          if (last7DaysMap.has(orderDate)) {
            const dayData = last7DaysMap.get(orderDate);
            dayData.revenue += orderTotal;
            dayData.orders += 1;
          }
        }

        if (["processing", "packed", "on-hold", "out-for-delivery", "dispatched"].includes(effectiveStatus)) {
          activeOrdersCount += 1;
        } else if (effectiveStatus === "completed") {
          completedOrdersCount += 1;
        } else if (isCancelled) {
          cancelledOrdersCount += 1;
        }
      });

      summaryData = {
        totalRevenue: Math.round(totalRevenue),
        todaySales: Math.round(todaySales),
        monthSales: Math.round(monthSales),
        monthOrdersCount,
        totalOrders: orders.length,
        activeOrders: activeOrdersCount,
        completedOrders: completedOrdersCount,
        cancelledOrders: cancelledOrdersCount,
        totalProducts: stockCounts?.all || 0,
        lowStockCount: stockCounts?.lowstock ?? lowStockProducts.length,
        avgOrderValue: validRevenueOrderCount > 0 ? Math.round(totalRevenue / validRevenueOrderCount) : 0,
      };
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
        return res.json(cachedAnalytics);
      }
    }

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

      const validOrderCount = s.validOrderCount || 0;
      const codCount = s.payments?.cod?.count || 0;
      const codRevenue = s.payments?.cod?.revenue || 0;
      const onlineCount = s.payments?.online?.count || 0;
      const onlineRevenue = s.payments?.online?.revenue || 0;

      responsePayload = {
        success: true,
        data: {
          revenue: {
            totalRevenue: s.totalRevenue,
            completedRevenue: s.completedRevenue,
            shippingRevenue: s.shippingRevenue,
            discountTotal: s.discountTotal,
            avgOrderValue: s.avgOrderValue,
            dailyTrend: Array.from(dailyRevenueMap.values()),
          },
          orders: {
            total: s.totalOrders,
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
              revenue: codRevenue,
              percentage: validOrderCount > 0 ? Math.round((codCount / validOrderCount) * 100) : 0,
            },
            online: {
              count: onlineCount,
              revenue: onlineRevenue,
              percentage: validOrderCount > 0 ? Math.round((onlineCount / validOrderCount) * 100) : 0,
            },
          },
          topProducts: s.topProducts || [],
          topCustomers: s.topCustomers || [],
          customerMetrics: s.customerMetrics || {
            totalUniqueCustomers: 0,
            repeatCustomerRate: 0,
          },
        },
      };
    } else {
      // Fallback: paginated WooCommerce requests
      const orders = await fetchAllOrders();

      let totalRevenue = 0;
      let completedRevenue = 0;
      let shippingRevenue = 0;
      let discountTotal = 0;
      let validOrderCount = 0;

      let completedOrders = 0;
      let processingOrders = 0;
      let outForDeliveryOrders = 0;
      let cancelledOrders = 0;
      let refundedOrders = 0;
      let otherOrders = 0;

      let codCount = 0;
      let codRevenue = 0;
      let onlineCount = 0;
      let onlineRevenue = 0;

      const productSalesMap = new Map();
      const customerSalesMap = new Map();

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

      orders.forEach((o) => {
        const effectiveStatus = getEffectiveStatus(o);
        const orderTotal = Number(o.total) || 0;
        const orderShipping = Number(o.shipping_total) || 0;
        const orderDiscount = Number(o.discount_total) || 0;
        const paymentMethod = (o.payment_method_title || o.payment_method || "").toLowerCase();
        const invalid = INVALID_ORDER_STATUSES.has(effectiveStatus);

        if (effectiveStatus === "completed") {
          completedOrders++;
          completedRevenue += orderTotal;
        } else if (effectiveStatus === "out-for-delivery" || effectiveStatus === "dispatched") {
          outForDeliveryOrders++;
        } else if (effectiveStatus === "processing") {
          processingOrders++;
        } else if (effectiveStatus === "cancelled" || effectiveStatus === "failed") {
          cancelledOrders++;
        } else if (effectiveStatus === "refunded") {
          refundedOrders++;
        } else {
          otherOrders++;
        }

        if (invalid) return;

        validOrderCount++;
        totalRevenue += orderTotal;
        shippingRevenue += orderShipping;
        discountTotal += orderDiscount;

        if (paymentMethod.includes("cod") || paymentMethod.includes("cash")) {
          codCount++;
          codRevenue += orderTotal;
        } else {
          onlineCount++;
          onlineRevenue += orderTotal;
        }

        if (o.date_created) {
          const orderDate = o.date_created.split("T")[0];
          if (dailyRevenueMap.has(orderDate)) {
            const entry = dailyRevenueMap.get(orderDate);
            entry.sales += orderTotal;
            entry.orders += 1;
          }
        }

        (o.line_items || []).forEach((item) => {
          const pId = item.product_id || item.id;
          const pName = item.name || "Product";
          const qty = Number(item.quantity) || 1;
          const itemTotal = Number(item.total) || 0;
          const pImage = item.image?.src || null;

          if (!productSalesMap.has(pId)) {
            productSalesMap.set(pId, {
              id: pId,
              name: pName,
              totalQuantitySold: qty,
              totalRevenue: itemTotal,
              image: pImage,
            });
          } else {
            const existing = productSalesMap.get(pId);
            existing.totalQuantitySold += qty;
            existing.totalRevenue += itemTotal;
            if (!existing.image && pImage) existing.image = pImage;
          }
        });

        const email = (o.billing?.email || "").trim().toLowerCase();
        if (email) {
          const custName = formatCustomerDisplayName(o.billing?.first_name, o.billing?.last_name, email);
          const custPhone = o.billing?.phone || "";

          if (!customerSalesMap.has(email)) {
            customerSalesMap.set(email, {
              email,
              name: custName,
              phone: custPhone,
              ordersCount: 1,
              lifetimeSpent: orderTotal,
            });
          } else {
            const existing = customerSalesMap.get(email);
            existing.ordersCount += 1;
            existing.lifetimeSpent += orderTotal;
          }
        }
      });

      const avgOrderValue = validOrderCount > 0 ? Math.round(totalRevenue / validOrderCount) : 0;

      const topProducts = Array.from(productSalesMap.values())
        .sort((a, b) => b.totalQuantitySold - a.totalQuantitySold || b.totalRevenue - a.totalRevenue)
        .slice(0, 5);

      const topCustomers = Array.from(customerSalesMap.values())
        .sort((a, b) => b.lifetimeSpent - a.lifetimeSpent)
        .slice(0, 5)
        .map((c) => ({
          ...c,
          lifetimeSpent: Math.round(c.lifetimeSpent),
        }));

      const repeatCustomersCount = Array.from(customerSalesMap.values()).filter((c) => c.ordersCount > 1).length;
      const repeatRate = customerSalesMap.size > 0 ? Math.round((repeatCustomersCount / customerSalesMap.size) * 100) : 0;

      responsePayload = {
        success: true,
        data: {
          revenue: {
            totalRevenue: Math.round(totalRevenue),
            completedRevenue: Math.round(completedRevenue),
            shippingRevenue: Math.round(shippingRevenue),
            discountTotal: Math.round(discountTotal),
            avgOrderValue,
            dailyTrend: Array.from(dailyRevenueMap.values()),
          },
          orders: {
            total: orders.length,
            completed: completedOrders,
            processing: processingOrders,
            outForDelivery: outForDeliveryOrders,
            cancelled: cancelledOrders,
            refunded: refundedOrders,
            fulfillmentRate: orders.length > 0 ? Math.round((completedOrders / orders.length) * 100) : 100,
          },
          payments: {
            cod: {
              count: codCount,
              revenue: Math.round(codRevenue),
              percentage: validOrderCount > 0 ? Math.round((codCount / validOrderCount) * 100) : 0,
            },
            online: {
              count: onlineCount,
              revenue: Math.round(onlineRevenue),
              percentage: validOrderCount > 0 ? Math.round((onlineCount / validOrderCount) * 100) : 0,
            },
          },
          topProducts,
          topCustomers,
          customerMetrics: {
            totalUniqueCustomers: customerSalesMap.size,
            repeatCustomerRate: repeatRate,
          },
        },
      };
    }

    serverCache.set("admin:analytics:deep", responsePayload, 120000);

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
