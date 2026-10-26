import api from "../config/woocommerce.js";
import wp from "../services/wordpress.js";
import { uploadMedia, deleteMediaIfUnreferenced } from "../services/wordpressMediaService.js";
import { transformMediaUrls, transformMediaUrl } from "../utils/mediaUrl.js";
import { serverCache } from "../utils/memoryCache.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { classifyDeliveryLocation } from "../utils/locationClassifier.js";
import { getISTDateBoundaries } from "../utils/orderDateBounds.js";
import { logError, logger } from "../utils/logger.js";
import { acquireLock, releaseLock } from "../services/paymentIntentService.js";
import { sendRefundEmail } from "../services/brevoService.js";
import { fetchStockCounts } from "./adminProductController.js";
import { publishOrderEvent } from "../services/orderNotificationService.js";
import { invalidateOrderDetailCache } from "../services/orderDetailCache.js";
import {
  getOrderDeliveredTimestamp,
  isOrderStatusLocked,
  isCodOrder,
  isOnlineOrderUnpaid,
  validateOrderStatusTransition,
  buildOrderStatusPayload,
  ALLOWED_ORDER_STATUSES,
} from "../utils/orderStatusTransition.js";

export {
  getOrderDeliveredTimestamp,
  isOrderStatusLocked,
  isCodOrder,
  isOnlineOrderUnpaid,
  validateOrderStatusTransition,
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
    const activeStatuses = new Set([
      "pending",
      "processing",
      "on-hold",
      "packed",
      "out-for-delivery",
      "dispatched",
    ]);
    filtered = filtered.filter((order) => activeStatuses.has(getEffectiveOrderStatus(order)));
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
      _fields: "id,number,status,total,shipping_total,discount_total,total_tax,customer_note,fee_lines,date_created,date_created_gmt,date_completed,date_completed_gmt,billing,shipping,line_items,meta_data,payment_method,payment_method_title",
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
        queryParams.dates_are_gmt = true;
      }
    } else if (req.query.after || req.query.before) {
      if (req.query.after) queryParams.after = req.query.after;
      if (req.query.before) queryParams.before = req.query.before;
      queryParams.dates_are_gmt = true;
    }

    const cleanSearch = (search || "").trim();
    if (cleanSearch) {
      queryParams.search = cleanSearch;
    }

    // Direct Single-Page Server Query optimization:
    // When querying standard WC statuses with no custom location filter and no sub-status overrides
    const isCustomStatus = ["active", "processing", "packed", "out-for-delivery", "dispatched"].includes(status);
    const hasCustomLocation = location && location !== "all";

    if (isCustomStatus) {
      // Narrow WooCommerce SQL query to relevant operational statuses only
      queryParams.status = status === "active"
        ? "pending,processing,on-hold,completed"
        : ["out-for-delivery", "dispatched"].includes(status)
        ? "processing,on-hold,completed"
        : "pending,processing,on-hold";
    } else if (status && status !== "all") {
      // Standard WooCommerce statuses can be filtered directly without scanning pages.
      queryParams.status = status;
    }

    let orders = [];
    let totalOrders = 0;
    let totalPages = 1;
    let isCustomStatusFallback = false;

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
    } else if ((isCustomStatus && !hasCustomLocation) || hasCustomLocation) {
      // Ask the protected WooCommerce endpoint to filter status, location, date,
      // and search before pagination instead of scanning a fixed number of orders.
      try {
        const response = await wp.get("/wp-json/mumbai-auth/v1/employee/orders", {
          params: {
            status,
            ...(hasCustomLocation ? { location } : {}),
            page: pageNum,
            per_page: limit,
            ...(cleanSearch ? { search: cleanSearch } : {}),
            ...(queryParams.after ? { after: queryParams.after } : {}),
            ...(queryParams.before ? { before: queryParams.before } : {}),
          },
        });
        const payload = response.data || {};
        orders = Array.isArray(payload.orders) ? payload.orders : [];
        totalOrders = Number(payload.total) || 0;
        totalPages = Number(payload.total_pages) || 1;
      } catch (error) {
        const code = error.response?.data?.code;
        // Older plugin versions and non-HPOS sites use the compatible REST
        // fallback for custom delivery statuses only. Location filtering must
        // stay database-side; scanning every WooCommerce order would be both
        // expensive and liable to time out on a large store.
        if (error.response?.status !== 404 && code !== "hpos_required") throw error;
        if (hasCustomLocation) {
          const locationError = new Error("Location filtering requires the updated WooCommerce plugin with HPOS enabled. Please contact an administrator.");
          locationError.response = { status: 503 };
          throw locationError;
        }
        logger.warn({ code, status: error.response?.status }, "[Employee Orders] Falling back to WooCommerce REST pagination");
        isCustomStatusFallback = true;
      }
    }

    if (isCustomStatusFallback) {
      // Compatibility path for custom delivery statuses on older/non-HPOS
      // WordPress installations. Location filters never use this path: they
      // must be handled by the server-side endpoint above.
      const scanCacheKey = `employee:orders_scan:${queryParams.status || "all"}:${queryParams.after || ""}:${queryParams.before || ""}:${cleanSearch || ""}`;
      let allOrders = serverCache.get(scanCacheKey);

      if (!allOrders) {
        allOrders = [];
        let currentPage = 1;
        const MAX_SCAN_PAGES = 5;

        while (currentPage <= MAX_SCAN_PAGES) {
          const response = await api.get("orders", { ...queryParams, page: currentPage });
          const batch = Array.isArray(response.data) ? response.data : [];
          allOrders.push(...batch);
          const totalPagesHeader = Number(response.headers?.["x-wp-totalpages"]);
          if (
            batch.length === 0 ||
            (totalPagesHeader > 0 && currentPage >= totalPagesHeader) ||
            (totalPagesHeader <= 0 && batch.length < queryParams.per_page)
          ) {
            break;
          }
          currentPage += 1;
        }

        serverCache.set(scanCacheKey, allOrders, 30000);
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
        is_unpaid: isOnlineOrderUnpaid(o),
        total: o.total,
        shipping_total: o.shipping_total || "0.00",
        discount_total: o.discount_total || "0.00",
        total_tax: o.total_tax || "0.00",
        fee_total: Array.isArray(o.fee_lines)
          ? o.fee_lines.reduce((sum, f) => sum + (Number(f.total) || 0), 0).toFixed(2)
          : "0.00",
        customer_note: o.customer_note || "",
        payment_method: o.payment_method_title || "Cash on Delivery",
        customer_name: formatCustomerDisplayName(o.billing?.first_name, o.billing?.last_name, "Guest Customer"),
        phone: o.billing?.phone || o.shipping?.phone || "",
        meta_data: o.meta_data || [],
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

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }
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

    // Fetch existing order from WooCommerce to enforce 72-hour (3-day) status lock on delivered orders
    const existingOrderRes = await api.get(`orders/${encodeURIComponent(id)}`);
    const currentOrder = existingOrderRes?.data;

    if (!currentOrder) {
      return res.status(404).json({
        success: false,
        message: `Order #${id} not found.`,
      });
    }

    // Enforce status transition rules (72-hour delivery lock, unpaid online orders, terminal statuses)
    const transitionValidation = validateOrderStatusTransition(currentOrder, status);
    if (!transitionValidation.valid) {
      return res.status(400).json({
        success: false,
        message: transitionValidation.message,
      });
    }

    const payload = buildOrderStatusPayload(status);

    const response = await api.put(`orders/${encodeURIComponent(id)}`, payload);

    // Publish minimal real-time event for employee dashboard (fire-and-forget, never throws)
    publishOrderEvent({ event: "ORDER_STATUS_UPDATED", orderId: id, status });

    // Invalidate cached overview/analytics/customers immediately upon status transition
    serverCache.invalidatePrefix("employee:overview");
    serverCache.invalidatePrefix("employee:orders_scan");
    serverCache.invalidatePrefix("admin:analytics");
    serverCache.invalidatePrefix("admin:customers");
    if (currentOrder.customer_id) {
      serverCache.invalidatePrefix(`customer:orders:${currentOrder.customer_id}:`);
    }
    await invalidateOrderDetailCache(id);


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

/** Explicit employee action: send a refund notification only when requested. */
export const sendOrderRefundEmail = async (req, res) => {
  const { id } = req.params;
  const lockKey = `employee_refund_email_${id}`;
  const workerId = `refund_mail_${process.pid}_${Date.now()}`;
  let locked = false;

  try {
    locked = await acquireLock(lockKey, workerId, 1500);
    if (!locked) {
      return res.status(409).json({ success: false, message: "A refund email request for this order is already being processed." });
    }

    const response = await api.get(`orders/${encodeURIComponent(id)}`);
    const order = response?.data;
    if (!order) return res.status(404).json({ success: false, message: `Order #${id} not found.` });

    const emailMeta = (order.meta_data || []).find((meta) => meta.key === "_manual_refund_email_sent_at");
    if (emailMeta?.value) {
      return res.status(409).json({ success: false, message: "A refund email has already been sent for this order." });
    }

    const toEmail = String(order.billing?.email || "").trim();
    if (!toEmail || !toEmail.includes("@")) {
      return res.status(422).json({ success: false, message: "This order does not have a valid customer email address." });
    }

    // Persist a claim before calling the mail provider so retries cannot send
    // duplicate notifications if the provider succeeds but the request times out.
    const emailMarker = { key: "_manual_refund_email_sent_at", value: `sending:${new Date().toISOString()}` };
    await api.put(`orders/${encodeURIComponent(id)}`, {
      meta_data: [
        ...(order.meta_data || []).filter((meta) => meta.key !== emailMarker.key),
        emailMarker,
      ],
    });

    let sent;
    try {
      // This action sends a notification only. The employee must first process
      // the actual refund through the appropriate payment/WooCommerce workflow.
      sent = await sendRefundEmail({
        toEmail,
        toName: `${order.billing?.first_name || ""} ${order.billing?.last_name || ""}`.trim(),
        orderNumber: order.number || id,
        amountInInr: Number(order.total || 0).toFixed(2),
      });
    } catch (emailError) {
      // Permit a deliberate retry when delivery failed. If cleanup fails, the
      // marker remains and prevents accidental duplicate sends.
      try {
        await api.put(`orders/${encodeURIComponent(id)}`, {
          meta_data: (order.meta_data || []).filter((meta) => meta.key !== emailMarker.key),
        });
      } catch (cleanupError) {
        logError(req, cleanupError, "Could not clear failed refund-email marker");
      }
      throw emailError;
    }

    const sentAt = new Date().toISOString();
    await api.put(`orders/${encodeURIComponent(id)}`, {
      meta_data: [
        ...(order.meta_data || []).filter((meta) => meta.key !== "_manual_refund_email_sent_at"),
        { key: "_manual_refund_email_sent_at", value: sentAt },
      ],
    });


    return res.json({ success: true, message: `Refund email sent to ${toEmail}.`, sent_at: sentAt });
  } catch (error) {
    logError(req, error, "Send employee-triggered refund email error");
    return res.status(error.response?.status || error.status || 502).json({
      success: false,
      message: error.response?.data?.message || error.message || "Could not send the refund email.",
    });
  } finally {
    if (locked) await releaseLock(lockKey, workerId);
  }
};

const formatOverviewOrderItem = (order, effectiveStatus) => ({
  id: order.id,
  order_number: order.number || String(order.id),
  status: effectiveStatus,
  is_unpaid: isOnlineOrderUnpaid(order),
  payment_method:
    order.payment_method_title ||
    order.payment_method ||
    (isCodOrder(order) ? "Cash on Delivery" : "Online Payment"),
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
      if (typeof res.set === "function") {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      }
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
        _fields: "id,number,status,total,shipping_total,discount_total,total_tax,customer_note,fee_lines,date_created,date_created_gmt,date_completed,date_completed_gmt,billing,shipping,line_items,meta_data,payment_method,payment_method_title",
      }).catch(() => ({ data: [] })),

      // Exact count of all orders received today in store timezone (Asia/Kolkata)
      api.get("orders", {
        after: todayBounds?.after,
        before: todayBounds?.before,
        dates_are_gmt: true,
        per_page: 1,
        _fields: "id",
      }).catch(() => ({ headers: { "x-wp-total": 0 }, data: [] })),

      // Exact count of orders completed today in store timezone (Asia/Kolkata)
      api.get("orders", {
        status: "completed",
        after: todayBounds?.after,
        before: todayBounds?.before,
        dates_are_gmt: true,
        per_page: 1,
        _fields: "id",
      }).catch(() => ({ headers: { "x-wp-total": 0 }, data: [] })),

      // 10 most recent orders for activity logs
      api.get("orders", {
        per_page: 10,
        orderby: "date",
        order: "desc",
        _fields: "id,number,status,total,shipping_total,discount_total,total_tax,customer_note,fee_lines,date_created,date_created_gmt,date_completed,date_completed_gmt,billing,shipping,line_items,meta_data,payment_method,payment_method_title",
      }).catch(() => ({ data: [] })),

      // Accurate live stock counts (cached for 60s)
      fetchStockCounts().catch(() => ({ all: 0, instock: 0, lowstock: 0, outofstock: 0 })),

      // Direct query for low stock products (up to 6 items)
      api.get("products", {
        stock_status: "lowstock",
        per_page: 6,
        _fields: "id,name,images,stock_quantity,stock_status,price",
      }).catch(() => ({ data: [] })),
    ]);

    const activeOrders = Array.isArray(activeOrdersRes?.data) ? activeOrdersRes.data : [];
    const recentOrders = Array.isArray(recentOrdersRes?.data) ? recentOrdersRes.data : [];
    const allCatalogProducts = Array.isArray(lowStockProductsRes?.data) ? lowStockProductsRes.data : [];

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

    // Directly queried low stock items (up to 6)
    const lowStockProductsFormatted = allCatalogProducts.slice(0, 6).map((p) => ({
      id: p.id,
      name: p.name,
      image: p.images?.[0]?.src || null,
      stock_quantity: p.stock_quantity,
      stock_status: p.stock_status,
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

    serverCache.set("employee:overview", responsePayload, 90000);

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }
    res.json(responsePayload);
  } catch (error) {
    logError(req, error, "Employee overview error");
    res.status(500).json({
      success: false,
      message: "Failed to load employee operations overview.",
    });
  }
};
