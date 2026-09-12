import api from "../config/woocommerce.js";
import { uploadMedia, deleteMediaIfUnreferenced } from "../services/wordpressMediaService.js";
import { transformMediaUrls, transformMediaUrl } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { classifyDeliveryLocation } from "../utils/locationClassifier.js";
import { getISTDateBoundaries } from "../utils/orderDateBounds.js";
import { logError } from "../utils/logger.js";
import { fetchStockCounts } from "./adminProductController.js";
import {
  getOrderDeliveredTimestamp,
  isOrderStatusLocked,
  buildOrderStatusPayload,
  ALLOWED_ORDER_STATUSES,
} from "../utils/orderStatusTransition.js";

export {
  getOrderDeliveredTimestamp,
  isOrderStatusLocked,
  buildOrderStatusPayload,
  ALLOWED_ORDER_STATUSES,
};

/**
 * Upload Product Image to WordPress Media Library for Employee Panel
 */
export const formatEmployeeMediaUploadResponse = ({ id, url }, req) => ({
  success: true,
  url: transformMediaUrl(url, req),
  id,
});

const normalizeOrderSearchValue = (value) => String(value ?? "").trim().toLowerCase();

/** Match the employee order search contract across WooCommerce order fields. */
export const matchesEmployeeOrderSearch = (order, search) => {
  const query = normalizeOrderSearchValue(search);
  if (query.length < 2) return true;

  const billing = order?.billing || {};
  const shipping = order?.shipping || {};
  const name = [
    billing.first_name,
    billing.last_name,
    shipping.first_name,
    shipping.last_name,
  ].filter(Boolean).join(" ").toLowerCase();
  const email = normalizeOrderSearchValue(billing.email || shipping.email);
  const orderNumber = normalizeOrderSearchValue(order?.number || order?.id);
  const phoneQuery = query.replace(/\D/g, "");
  const phones = [billing.phone, shipping.phone]
    .filter(Boolean)
    .map((value) => String(value).replace(/\D/g, ""));

  return [orderNumber, name, email].some((value) => value.includes(query)) ||
    (phoneQuery.length >= 2 && phones.some((value) => value.includes(phoneQuery)));
};

const getEffectiveOrderStatus = (order) =>
  order?.meta_data?.find((meta) => meta.key === "_delivery_status")?.value || order?.status;

/** Apply all custom filters, then calculate totals and slice the requested page. */
export const filterAndPaginateEmployeeOrders = (orders, { status, location, search, page, limit }) => {
  let filtered = Array.isArray(orders) ? orders.filter((order) => order.status !== "trash") : [];
  const effectiveStatus = status === "active" ? null : status;

  if (status === "active") {
    filtered = filtered.filter((order) => !["completed", "cancelled"].includes(getEffectiveOrderStatus(order)));
  } else if (["processing", "packed", "out-for-delivery", "dispatched"].includes(status)) {
    filtered = filtered.filter((order) => {
      const current = getEffectiveOrderStatus(order);
      return status === "processing" ? current === "processing" :
        status === "packed" ? current === "packed" : ["out-for-delivery", "dispatched"].includes(current);
    });
  } else if (effectiveStatus && effectiveStatus !== "all") {
    filtered = filtered.filter((order) => order.status === effectiveStatus);
  }

  const normalizedLocation = normalizeOrderSearchValue(location);
  if (normalizedLocation && normalizedLocation !== "all") {
    filtered = filtered.filter((order) => classifyDeliveryLocation(order).location_key === normalizedLocation);
  }

  const normalizedSearch = normalizeOrderSearchValue(search);
  if (normalizedSearch.length >= 2) {
    filtered = filtered.filter((order) => matchesEmployeeOrderSearch(order, normalizedSearch));
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  return { orders: filtered.slice(start, start + limit), total, totalPages };
};

export const uploadEmployeeMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided.",
      });
    }

    const { id, url } = await uploadMedia(req.file, { uploaderId: req.user?.id });

    res.json(formatEmployeeMediaUploadResponse({ id, url }, req));
  } catch (error) {
    logError(req, error, "Employee media upload error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to upload image to WordPress Media Library.",
      code: error.response?.data?.code || "media_upload_error",
    });
  }
};

/**
 * Safely Remove Unattached Pending Product Image for Employee Panel
 */
export const deleteEmployeeMedia = async (req, res) => {
  try {
    const { id } = req.params;
    const mediaId = Number(id);

    if (!mediaId || isNaN(mediaId) || mediaId <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid numeric media ID is required.",
      });
    }

    const result = await deleteMediaIfUnreferenced([mediaId], {
      context: "pending_removal",
      uploaderId: req.user?.id,
    });

    const itemResult = result.results?.[0];
    if (itemResult?.deleted) {
      return res.json({
        success: true,
        message: `Media #${mediaId} successfully deleted.`,
        deleted: true,
        mediaId,
      });
    }

    if (itemResult?.reason === "not_pending") {
      return res.status(400).json({
        success: false,
        message: itemResult.message || "Cannot remove media that is already attached to a product.",
        code: "not_pending",
      });
    }

    if (itemResult?.reason === "referenced") {
      return res.status(409).json({
        success: false,
        message: "Cannot delete media because it is currently in use elsewhere.",
        code: "media_in_use",
        reference: itemResult.reference,
      });
    }

    if (itemResult?.reason === "ownership_mismatch") {
      return res.status(403).json({
        success: false,
        message: "You can only remove media uploaded during your own session.",
        code: "forbidden",
      });
    }

    res.json({
      success: false,
      message: "Media could not be deleted.",
      result: itemResult,
    });
  } catch (error) {
    logError(req, error, "Employee media delete error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to remove media.",
    });
  }
};

/**
 * Get Orders with search and status filtering for Employee Panel
 */
export const getEmployeeOrders = async (req, res) => {
  try {
    const {
      status,
      search,
      location,
      date_filter,
      dateFilter,
      date_from,
      dateFrom,
      date_to,
      dateTo,
      page = 1,
      per_page = 20,
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));

    const queryParams = {
      page: 1,
      per_page: 100,
      orderby: "date",
      order: "desc",
    };

    // Server-side date boundary filtering across Asia/Kolkata store timezone
    const resolvedDateFilter = date_filter || dateFilter;
    const resolvedDateFrom = date_from || dateFrom;
    const resolvedDateTo = date_to || dateTo;

    if (resolvedDateFilter && resolvedDateFilter !== "all") {
      const bounds = getISTDateBoundaries(resolvedDateFilter, resolvedDateFrom, resolvedDateTo);
      if (bounds?.after && bounds?.before) {
        queryParams.after = bounds.after;
        queryParams.before = bounds.before;
      }
    } else if (req.query.after || req.query.before) {
      if (req.query.after) queryParams.after = req.query.after;
      if (req.query.before) queryParams.before = req.query.before;
    }

    const cleanSearch = (search || "").trim();
    if (cleanSearch) {
      queryParams.search = cleanSearch;
    }

    // Direct Single-Page Server Query optimization:
    // When querying standard WC statuses with no custom location filter and no sub-status overrides
    const isCustomStatus = ["active", "packed", "out-for-delivery", "dispatched"].includes(status);
    const hasCustomLocation = location && location !== "all";

    let orders = [];
    let totalOrders = 0;
    let totalPages = 1;

    if (!isCustomStatus && !hasCustomLocation) {
      // Direct server-side pagination via WooCommerce SQL
      const directResponse = await api.get("orders", {
        ...queryParams,
        page: pageNum,
        per_page: limit,
      });
      const batch = Array.isArray(directResponse.data) ? directResponse.data : [];
      totalOrders = Number(directResponse.headers?.["x-wp-total"]) || batch.length;
      totalPages = Number(directResponse.headers?.["x-wp-totalpages"]) || Math.ceil(totalOrders / limit) || 1;
      orders = batch;
    } else {
      // For custom quick-commerce sub-statuses or delivery location facet filters:
      // Fetch matching batches from WooCommerce (if search is provided, WC filters in SQL first)
      const allOrders = [];
      const maxPages = cleanSearch ? 5 : 20;
      let currentPage = 1;
      while (currentPage <= maxPages) {
        const response = await api.get("orders", { ...queryParams, page: currentPage });
        const batch = Array.isArray(response.data) ? response.data : [];
        allOrders.push(...batch);
        const totalPagesFromWoo = Number(response.headers?.["x-wp-totalpages"]) || 1;
        if (currentPage >= totalPagesFromWoo || batch.length === 0) break;
        currentPage += 1;
      }

      const paginated = filterAndPaginateEmployeeOrders(allOrders, {
        status,
        location,
        search: cleanSearch,
        page: pageNum,
        limit,
      });
      orders = paginated.orders;
      totalOrders = paginated.total;
      totalPages = paginated.totalPages;
    }

    const formatted = orders.map((o) => {
      const deliveryMeta = o.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || o.status;
      const locInfo = classifyDeliveryLocation(o);

      const addressParts = [
        o.billing?.address_1,
        o.billing?.address_2,
        o.billing?.city,
        o.billing?.state,
        o.billing?.postcode,
      ].filter(Boolean);

      const shippingAddressParts = [
        o.shipping?.address_1,
        o.shipping?.address_2,
        o.shipping?.city,
        o.shipping?.state,
        o.shipping?.postcode,
      ].filter(Boolean);

      const deliveryCompletedAt =
        o.meta_data?.find((m) => m.key === "_delivery_completed_at")?.value || null;

      return {
        id: o.id,
        order_number: o.number || String(o.id),
        status: effectiveStatus,
        date_created: o.date_created,
        date_created_gmt: o.date_created_gmt || null,
        date_completed: o.date_completed || null,
        date_completed_gmt: o.date_completed_gmt || null,
        delivery_completed_at: deliveryCompletedAt,
        is_status_locked: isOrderStatusLocked(o),
        total: o.total,
        shipping_total: o.shipping_total || "0.00",
        discount_total: o.discount_total || "0.00",
        payment_method: o.payment_method_title || "Cash on Delivery",
        customer_name: formatCustomerDisplayName(o.billing?.first_name, o.billing?.last_name, "Guest Customer"),
        phone: o.billing?.phone || o.shipping?.phone || "",
        customer: {
          id: o.customer_id,
          name: formatCustomerDisplayName(o.billing?.first_name, o.billing?.last_name, "Guest Customer"),
          email: o.billing?.email || "",
          phone: o.billing?.phone || "",
          address: addressParts.length > 0 ? addressParts.join(", ") : "Vasai, Maharashtra",
        },
        billing: o.billing || {},
        shipping: o.shipping || {},
        delivery_address:
          shippingAddressParts.length > 0
            ? shippingAddressParts.join(", ")
            : addressParts.length > 0
            ? addressParts.join(", ")
            : "Vasai, Maharashtra",
        delivery_location: locInfo.location,
        delivery_location_key: locInfo.location_key,
        items_count:
          o.line_items?.reduce((sum, item) => sum + (item.quantity || 1), 0) ||
          o.line_items?.length ||
          1,
        items: (o.line_items || []).map((item) => ({
          id: item.id,
          product_id: item.product_id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          total: item.total,
          image: item.image?.src || null,
        })),
      };
    });

    res.json({
      success: true,
      page: pageNum,
      per_page: limit,
      total: totalOrders,
      totalPages: totalPages,
      count: formatted.length,
      orders: transformMediaUrls(formatted, req),
    });
  } catch (error) {
    logError(req, error, "Get employee orders error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load orders.",
      orders: [],
    });
  }
};

/**
 * Update Order Status (Instant dispatch sync)
 * Shared / Generic business function for order fulfillment
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !ALLOWED_ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status "${status}". Allowed: ${ALLOWED_ORDER_STATUSES.join(", ")}`,
      });
    }

    // Fetch existing order from WooCommerce to enforce 24-hour status lock on delivered orders
    const existingOrderRes = await api.get(`orders/${encodeURIComponent(id)}`);
    const currentOrder = existingOrderRes?.data;

    if (!currentOrder) {
      return res.status(404).json({
        success: false,
        message: `Order #${id} not found.`,
      });
    }

    // Reject status change if order is completed and 24 hours have elapsed
    if (isOrderStatusLocked(currentOrder)) {
      return res.status(400).json({
        success: false,
        message: "Status changes are locked after 24 hours of delivery.",
      });
    }

    const payload = buildOrderStatusPayload(status);

    const response = await api.put(`orders/${encodeURIComponent(id)}`, payload);

    // Invalidate cached overview/analytics/customers immediately upon status transition
    serverCache.invalidatePrefix("employee:overview");
    serverCache.invalidatePrefix("admin:analytics");
    serverCache.invalidatePrefix("admin:customers");

    // Structured operational audit log
    logAuditEvent({
      req,
      action: "ORDER_STATUS_UPDATE",
      targetType: "order",
      targetId: id,
      details: { newStatus: status },
    });

    res.json({
      success: true,
      message: `Order #${id} status updated to ${status}.`,
      order: response.data,
    });
  } catch (error) {
    logError(req, error, "Update order status error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to update order status.",
    });
  }
};

const formatOverviewOrderItem = (order, effectiveStatus) => ({
  id: order.id,
  order_number: order.number || String(order.id),
  status: effectiveStatus,
  customer_name: formatCustomerDisplayName(
    order.billing?.first_name,
    order.billing?.last_name,
    order.billing?.email || "Guest Customer"
  ),
  phone: order.billing?.phone || order.shipping?.phone || "",
  total: order.total,
  date_created: order.date_created,
  items_count:
    order.line_items?.reduce((sum, i) => sum + (i.quantity || 1), 0) ||
    order.line_items?.length ||
    1,
  items: (order.line_items || []).map((i) => ({
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    price: i.price,
    total: i.total,
    image: i.image?.src || null,
  })),
  delivery_address:
    [
      order.shipping?.address_1 || order.billing?.address_1,
      order.shipping?.city || order.billing?.city,
      order.shipping?.postcode || order.billing?.postcode,
    ]
      .filter(Boolean)
      .join(", ") || "Vasai, Maharashtra",
});

/**
 * Employee Task Force Operations Overview
 * Scalable workload metrics for store staff (Today's workload, active action items, low stock counts)
 */
export const getEmployeeOverview = async (req, res) => {
  try {
    const cachedData = serverCache.get("employee:overview");
    if (cachedData) {
      return res.json(cachedData);
    }

    const todayBounds = getISTDateBoundaries("today");
    const todayDateString = todayBounds?.startDate || new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());

    // Scalable parallel queries: count today's metrics and fetch active action items
    const [
      activeOrdersRes,
      receivedTodayRes,
      completedTodayRes,
      recentOrdersRes,
      stockCounts,
      lowStockProductsRes,
    ] = await Promise.all([
      // Active orders that require staff packing / dispatch action
      api.get("orders", {
        status: "processing",
        per_page: 100,
        orderby: "date",
        order: "desc",
      }).catch(() => ({ data: [] })),

      // Exact count of all orders received today in store timezone (Asia/Kolkata)
      api.get("orders", {
        after: todayBounds?.after,
        before: todayBounds?.before,
        per_page: 1,
      }).catch(() => ({ headers: { "x-wp-total": 0 }, data: [] })),

      // Exact count of orders completed today in store timezone (Asia/Kolkata)
      api.get("orders", {
        status: "completed",
        after: todayBounds?.after,
        before: todayBounds?.before,
        per_page: 1,
      }).catch(() => ({ headers: { "x-wp-total": 0 }, data: [] })),

      // 10 most recent orders for activity logs
      api.get("orders", {
        per_page: 10,
        orderby: "date",
        order: "desc",
      }).catch(() => ({ data: [] })),

      // Accurate live stock counts (cached for 60s)
      fetchStockCounts().catch(() => ({ all: 0, instock: 0, lowstock: 0, outofstock: 0 })),

      // Sample of low stock products for preview list
      api.get("products", {
        stock_status: "lowstock",
        per_page: 6,
      }).catch(() => ({ data: [] })),
    ]);

    const activeOrders = Array.isArray(activeOrdersRes?.data) ? activeOrdersRes.data : [];
    const recentOrders = Array.isArray(recentOrdersRes?.data) ? recentOrdersRes.data : [];
    const lowStockSample = Array.isArray(lowStockProductsRes?.data) ? lowStockProductsRes.data : [];

    let ordersToPackCount = 0;
    let ordersPackedCount = 0;
    let ordersOutForDeliveryCount = 0;

    const actionOrders = [];

    activeOrders.forEach((order) => {
      const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || order.status;

      // Current operational queue counts (Active work in the store)
      if (effectiveStatus === "processing") {
        ordersToPackCount += 1;
      } else if (effectiveStatus === "packed") {
        ordersPackedCount += 1;
      } else if (effectiveStatus === "out-for-delivery" || effectiveStatus === "dispatched") {
        ordersOutForDeliveryCount += 1;
      }

      // Only add to actionOrders if effectiveStatus is an active fulfillment state
      if (["processing", "packed", "out-for-delivery", "dispatched"].includes(effectiveStatus)) {
        actionOrders.push(formatOverviewOrderItem(order, effectiveStatus));
      }
    });

    // Priority sorting for Task Force:
    // 1. processing (Pack now)
    // 2. packed (Dispatch)
    // 3. out-for-delivery (In transit)
    // 4. pending / on-hold
    const statusPriority = {
      processing: 1,
      packed: 2,
      "out-for-delivery": 3,
      dispatched: 3,
      pending: 4,
      "on-hold": 4,
    };

    actionOrders.sort((a, b) => {
      const pA = statusPriority[a.status] || 99;
      const pB = statusPriority[b.status] || 99;
      if (pA !== pB) return pA - pB;
      return new Date(b.date_created) - new Date(a.date_created);
    });

    const recentOrdersFormatted = recentOrders.map((order) => {
      const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || order.status;
      return formatOverviewOrderItem(order, effectiveStatus);
    });

    const lowStockProductsFormatted = lowStockSample.map((p) => ({
      id: p.id,
      name: p.name,
      image: p.images?.[0]?.src || null,
      stock_quantity: p.stock_quantity,
      stock_status: p.stock_status,
      price: p.price,
    }));

    const receivedTodayCount = Number(receivedTodayRes?.headers?.["x-wp-total"]) || 0;
    const completedTodayCount = Number(completedTodayRes?.headers?.["x-wp-total"]) || 0;
    const totalActiveCount = ordersToPackCount + ordersPackedCount + ordersOutForDeliveryCount;

    const summary = {
      // 4 Operational Console Cards
      ordersToPack: ordersToPackCount,
      ordersPacked: ordersPackedCount,
      ordersOutForDelivery: ordersOutForDeliveryCount,
      completedToday: completedTodayCount,
      receivedToday: receivedTodayCount,
      lowStockCount: stockCounts?.lowstock ?? lowStockProductsFormatted.length,

      // Compatibility fields
      activeOrders: totalActiveCount,
      totalOrders: receivedTodayCount || totalActiveCount,
      completedOrders: completedTodayCount,
      todayDate: todayDateString,
    };

    const responsePayload = {
      success: true,
      summary,
      ordersNeedingAction: actionOrders,
      lowStockProducts: lowStockProductsFormatted,
      recentOrders: recentOrdersFormatted,
      data: {
        summary,
        ordersNeedingAction: actionOrders,
        lowStockProducts: lowStockProductsFormatted,
        recentOrders: recentOrdersFormatted,
      },
    };

    serverCache.set("employee:overview", responsePayload, 60000);

    res.json(responsePayload);
  } catch (error) {
    logError(req, error, "Employee overview error");
    res.status(500).json({
      success: false,
      message: "Failed to load employee operations overview.",
    });
  }
};
