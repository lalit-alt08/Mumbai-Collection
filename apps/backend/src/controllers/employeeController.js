import { mutateStaffOrder } from "../services/staffOrderService.js";
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
import { fetchRazorpayPayment } from "../services/razorpayService.js";
import { fetchStockCounts } from "./adminProductController.js";
import { publishOrderEvent, acknowledgeOrderNotification, getAcknowledgedOrderIds } from "../services/orderNotificationService.js";
import { getVapidPublicKey, registerPushSubscription, unregisterPushSubscription } from "../services/pushNotificationService.js";
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

export const getEffectiveOrderStatus = (order) =>
  order?.meta_data?.find((meta) => meta.key === "_delivery_status")?.value || order?.status;

export const parseWooCommerceDate = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?(?:(Z)|([+-]\d{2}:?\d{2}))?$/i
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Calendar validation: reject invalid calendar dates such as Feb 31, April 31, etc.
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  if (match[4]) {
    const hour = Number(match[4]);
    const min = Number(match[5]);
    const sec = Number(match[6]);
    if (hour > 23 || min > 59 || sec > 59) return null;
  }

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getOrderTimestamp = (order) =>
  parseWooCommerceDate(order?.date_created_gmt || order?.date_created || order?.date)?.getTime() ?? 0;

export const compareOrdersDescending = (a, b) => {
  const timeA = getOrderTimestamp(a);
  const timeB = getOrderTimestamp(b);
  if (timeA !== timeB) return timeB - timeA;
  return Number(b.id) - Number(a.id);
};

export const isOrderOlderThanCursor = (cursor, order) => {
  if (!cursor) return true;
  return compareOrdersDescending(cursor, order) < 0;
};

export const serializeOrderCursor = (order) => {
  if (!order || !order.id) return null;
  const date = parseWooCommerceDate(order.date_created_gmt || order.date_created || order.date);
  if (!date) return null;
  return `${date.toISOString()}_${order.id}`;
};

export const parseOrderCursor = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const lastUnderscore = trimmed.lastIndexOf("_");
  if (lastUnderscore === -1) {
    if (!/^[1-9]\d*$/.test(trimmed)) return null;
    const num = Number(trimmed);
    if (Number.isSafeInteger(num) && num > 0) {
      return { id: num, date: null, legacyPage: num };
    }
    return null;
  }
  const dateStr = trimmed.slice(0, lastUnderscore);
  const idStr = trimmed.slice(lastUnderscore + 1).trim();
  // Strictly validate original ID before conversion: positive integer only, no signs, decimals, or non-digits
  if (!/^[1-9]\d*$/.test(idStr)) return null;
  const id = Number(idStr);
  const date = parseWooCommerceDate(dateStr);
  if (!Number.isSafeInteger(id) || id <= 0 || !date) return null;
  return { id, date: date.toISOString(), legacyPage: null };
};

/**
 * Checks whether an order legitimately needs packing at the counter.
 *
 * Rules:
 * - Excludes non-operational states (cancelled, failed, refunded, trash, completed).
 * - Excludes orders already packed, out-for-delivery, or dispatched (even if raw status is still 'processing').
 * - Excludes unpaid online orders (requires payment confirmation before fulfillment).
 * - Preserves legitimate COD orders and paid online orders.
 */
export const isOrderNeedingPacking = (order) => {
  if (!order) return false;
  const rawStatus = String(order.status || "").trim().toLowerCase();
  if (["trash", "cancelled", "failed", "refunded", "completed", "packed", "out-for-delivery", "dispatched"].includes(rawStatus)) {
    return false;
  }
  const effectiveStatus = String(getEffectiveOrderStatus(order) || "").trim().toLowerCase();
  if (!["pending", "processing"].includes(effectiveStatus)) {
    return false;
  }
  if (["packed", "out-for-delivery", "dispatched", "completed", "cancelled", "refunded", "failed", "trash"].includes(effectiveStatus)) {
    return false;
  }
  if (isOnlineOrderUnpaid(order)) {
    return false;
  }
  return true;
};

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
      _fields: "id,number,status,total,shipping_total,discount_total,total_tax,customer_note,fee_lines,date_created,date_created_gmt,date_completed,date_completed_gmt,customer_id,date_paid,transaction_id,billing,shipping,line_items,meta_data,payment_method,payment_method_title",
    };

    // Server-side date boundary filtering across Asia/Kolkata store timezone
    const resolvedDateFilter = date_filter || dateFilter;
    const resolvedDateFrom = date_from || dateFrom;
    const resolvedDateTo = date_to || dateTo;

    if (resolvedDateFilter && resolvedDateFilter !== "all") {
      const bounds = getISTDateBoundaries(resolvedDateFilter, resolvedDateFrom, resolvedDateTo);
      if (!bounds) return res.status(400).json({ success: false, message: "Choose a valid date range." });
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
          if (currentPage === MAX_SCAN_PAGES && Number(response.headers?.["x-wp-totalpages"]) > MAX_SCAN_PAGES) throw Object.assign(new Error("Complete filtering requires the updated HPOS plugin."), { response: { status: 503 } });
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

    const orderIds = orders.map((o) => o.id);
    const ackSet = await getAcknowledgedOrderIds(orderIds);

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
        is_acknowledged: ackSet.has(Number(o.id)),
        date_created: o.date_created,
        date_created_gmt: o.date_created_gmt || null,
        date_completed: o.date_completed || null,
        date_completed_gmt: o.date_completed_gmt || null,
        delivery_completed_at: deliveryCompletedAt,
        allowed_next_statuses: ALLOWED_ORDER_STATUSES.filter((next) => next !== effectiveStatus && validateOrderStatusTransition(o, next).valid),
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
export const bulkDispatchOrders = async (req, res) => {
  const ids = req.body?.ids;
  if (req.body?.status !== "out-for-delivery" || !Array.isArray(ids) || ids.length < 1 || ids.length > 50 ||
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ success: false, message: "Choose 1–50 unique order IDs and out-for-delivery status." });
  }
  const results = new Array(ids.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const index = cursor++;
      try {
        const order = await mutateStaffOrder(ids[index], "out-for-delivery", { packedOnly: true });
        results[index] = { id: ids[index], success: true, order };
      } catch (error) {
        results[index] = { id: ids[index], success: false, message: error.response?.data?.message || error.message || "Dispatch failed." };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
  return res.json({ success: true, results });
};

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

    const order = await mutateStaffOrder(id, status);

    res.json({
      success: true,
      message: `Order #${id} status updated to ${status}.`,
      order,
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

const getOrderMetaValue = (order, key) =>
  (order?.meta_data || []).find((meta) => meta?.key === key)?.value;

const getWooRefundedAmountPaise = (order) =>
  Math.round(
    (order?.refunds || []).reduce(
      (sum, refund) => sum + Math.abs(Number(refund?.total || 0)),
      0
    ) * 100
  );

const verifyRefundForNotification = async (order) => {
  const orderTotalPaise = Math.round(Number(order?.total || 0) * 100);
  if (!Number.isFinite(orderTotalPaise) || orderTotalPaise <= 0) {
    return { error: "This order does not have a valid refundable total." };
  }

  if (isCodOrder(order)) {
    const refundedPaise = getWooRefundedAmountPaise(order);
    if (refundedPaise <= 0) {
      return { error: "No WooCommerce refund has been recorded for this cash-on-delivery order." };
    }
    return {
      refundedPaise,
      isPartial: refundedPaise + 1 < orderTotalPaise,
      source: "woocommerce",
    };
  }

  const paymentId = String(
    getOrderMetaValue(order, "_razorpay_payment_id") || order?.transaction_id || ""
  ).trim();
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
    return { error: "This online order has no valid Razorpay payment reference to verify." };
  }

  let payment;
  try {
    payment = await fetchRazorpayPayment(paymentId);
  } catch (error) {
    logger.warn(
      { orderId: order?.id, paymentId, err: error?.message },
      "[RefundEmail] Razorpay refund verification failed"
    );
    return { error: "Razorpay could not confirm the refund. Please retry after checking the payment." };
  }

  if (String(payment?.currency || "INR").toUpperCase() !== "INR") {
    return { error: "The payment currency could not be verified as INR." };
  }

  const refundedPaise = Number(payment?.amount_refunded || 0);
  const paymentAmountPaise = Number(payment?.amount || orderTotalPaise);
  if (!Number.isFinite(refundedPaise) || refundedPaise <= 0) {
    return { error: "Razorpay has not confirmed any refunded amount for this payment." };
  }

  return {
    refundedPaise,
    isPartial:
      payment?.refund_status !== "full" && refundedPaise + 1 < paymentAmountPaise,
    source: "razorpay",
  };
};

/** Explicit employee action: verify the refund, then notify the customer. */
export const sendOrderRefundEmail = async (req, res) => {
  const { id } = req.params;
  const lockKey = `employee_refund_email_${id}`;
  const workerId = `refund_mail_${process.pid}_${Date.now()}`;
  let locked = false;

  try {
    locked = await acquireLock(lockKey, workerId, 10000);
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

    const verifiedRefund = await verifyRefundForNotification(order);
    if (verifiedRefund.error) {
      return res.status(409).json({ success: false, message: verifiedRefund.error });
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
        amountInInr: (verifiedRefund.refundedPaise / 100).toFixed(2),
        isPartial: verifiedRefund.isPartial,
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


    return res.json({
      success: true,
      message: `${verifiedRefund.isPartial ? "Partial refund" : "Refund"} email sent to ${toEmail}.`,
      refunded_amount: (verifiedRefund.refundedPaise / 100).toFixed(2),
      refund_source: verifiedRefund.source,
      sent_at: sentAt,
    });
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
    const responsePayload = await serverCache.getOrFetch("employee:overview", async () => {
      const todayBounds = getISTDateBoundaries("today");
      const todayDateString = todayBounds?.startDate || new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
      }).format(new Date());

    // Scalable parallel queries: count today's metrics and fetch active action items
    const [
      activeOrdersRes,
      operationalSummaryRes,
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
        _fields: "id,number,status,total,date_created,billing,shipping,line_items,meta_data,payment_method,payment_method_title",
      }).catch(() => ({ data: [] })),

      // Exact HPOS-backed counts are independent of the capped action-item page.
      wp.get("/wp-json/mumbai-auth/v1/employee/orders/summary")
        .catch(() => ({ data: null })),

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
        _fields: "id,number,status,total,date_created,billing,shipping,line_items,meta_data,payment_method,payment_method_title",
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

    const operationalCounts = operationalSummaryRes?.data?.counts;
    if (operationalCounts && typeof operationalCounts === "object") {
      ordersToPackCount = Number(operationalCounts.processing) || 0;
      ordersPackedCount = Number(operationalCounts.packed) || 0;
      ordersOutForDeliveryCount =
        (Number(operationalCounts["out-for-delivery"]) || 0) +
        (Number(operationalCounts.dispatched) || 0);
    }

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

      return {
        success: true,
        data: {
          summary,
          ordersNeedingAction: actionOrders,
          lowStockProducts: lowStockProductsFormatted,
          recentOrders: recentOrdersFormatted,
        },
      };
    }, 90000);

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

/**
 * Lightweight endpoint for Employee Panel counter packing alarms.
 * Returns only order IDs, status, and acknowledgement state for orders needing packing (processing/pending).
 */
/**
 * Lightweight endpoint for Employee Panel counter packing alarms.
 * Returns only order IDs, status, and acknowledgement state for orders needing packing (processing/pending).
 *
 * Requirements:
 * 1. Ring only for orders that actually need packing (excludes packed, dispatched, completed,
 *    cancelled, refunded, failed, and unpaid online orders; preserves legitimate COD orders).
 * 2. Cross-device silencing: Accepts `ringing_ids` to authoritatively reconcile ringing orders,
 *    returning `acknowledged_ringing_ids` if acknowledged on another device or no longer needing packing.
 * 3. Prevents newest-50 limit from crowding out older unacknowledged orders using bounded pagination
 *    (up to 3 pages / 150 items max) filtering candidate orders before capping at 50.
 * 4. Response is compact and fast (only id, status, is_acknowledged, and acknowledged_ringing_ids).
 */
export const getEmployeePackingAlarms = async (req, res) => {
  const TOTAL_POLL_BUDGET_MS = 8500;
  const pollStartTime = Date.now();
  const pollAbortController = new AbortController();
  const pollTimeoutId = setTimeout(() => {
    pollAbortController.abort();
  }, TOTAL_POLL_BUDGET_MS);

  const getRemainingPollMs = () => {
    const elapsed = Date.now() - pollStartTime;
    return Math.max(1, TOTAL_POLL_BUDGET_MS - elapsed);
  };

  try {
    const rawRinging = req.query?.ringing_ids || req.query?.ringingIds;
    const ringingCandidates =
      typeof rawRinging === "string"
        ? rawRinging.split(",")
        : Array.isArray(rawRinging)
          ? rawRinging
          : [];

    const ringingIds = [];
    const seenRinging = new Set();
    for (const raw of ringingCandidates) {
      const num = Number(raw);
      if (Number.isSafeInteger(num) && num > 0 && !seenRinging.has(num)) {
        seenRinging.add(num);
        ringingIds.push(num);
        if (ringingIds.length >= 50) break;
      }
    }

    const unacknowledgedOrders = [];
    const acknowledgedScannedOrders = [];
    const allScannedCandidateMap = new Map();

    const PAGE_BUDGET = 2; // Bounded amount of upstream work per poll
    const PER_PAGE = 50;
    const TOTAL_UNACK_CAP = 50;
    const NEWEST_UNACK_RESERVE = 25; // Reserve at least 25 slots for backlog discovery

    let totalPages = 1;
    let budgetRemaining = PAGE_BUDGET;
    let nextCursor = null;

    const rawCursor = req.query?.cursor;
    const parsedCursor = parseOrderCursor(rawCursor);
    const isLegacyCursor = Boolean(parsedCursor?.legacyPage || (parsedCursor && !parsedCursor.date));
    const validKeysetCursor = parsedCursor && !isLegacyCursor ? parsedCursor : null;
    const hasBacklogCursor = Boolean(validKeysetCursor);

    // Track Page 1 quota rotation for when Page 1 stays full across consecutive polls
    const rawPage1Offset = req.query?.page1_offset || req.query?.page1Offset;
    const page1Offset = Math.max(0, Number.parseInt(rawPage1Offset, 10) || 0);
    let nextPage1Offset = 0;

    // Helper to determine if WooCommerce destination matches configured WordPress origin
    const isMatchingWpOrigin = () => {
      try {
        const wpUrl = process.env.WORDPRESS_URL || "http://localhost";
        const wcUrl = process.env.WOOCOMMERCE_URL || (process.env.NODE_ENV === "production" ? "" : "https://mumbai-collection.local");
        if (!wcUrl) return false;
        return new URL(wpUrl).origin === new URL(wcUrl).origin;
      } catch (_) {
        return false;
      }
    };

    const fallbackHeaders = isMatchingWpOrigin() && process.env.MUMBAI_INTERNAL_API_KEY
      ? { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY }
      : {};

    const hasKeysetCapability = (resp) => {
      if (!resp) return false;
      const header = resp.headers?.["x-mumbai-keyset-capability"] || resp.headers?.["x-mumbai-alarm-keyset"];
      const body = resp.data?.keyset_capability;
      return header === "v1" || body === "v1";
    };

    let useWpEndpoint = true;
    let page1Failed = false;
    let backlogFailed = false;
    let page1CandidateBatch = [];

    // 1. Scan Page 1 (newest orders) first so newly arrived orders
    // are discovered immediately while catching up on the backlog.
    try {
      const wpResponse = await wp.get("/wp-json/mumbai-auth/v1/employee/orders", {
        params: {
          status: "processing",
          per_page: PER_PAGE,
          page: 1,
          mode: "packing_alarms",
        },
        signal: pollAbortController.signal,
        timeout: getRemainingPollMs(),
      });

      const payload = wpResponse.data || {};
      page1CandidateBatch = Array.isArray(payload.orders) ? payload.orders : [];
      totalPages = Number(payload.total_pages) || 1;
      budgetRemaining--;
    } catch (hposErr) {
      logger.warn({ err: hposErr?.message }, "[PackingAlarms] HPOS employee endpoint query failed, falling back to WooCommerce REST");
      useWpEndpoint = false;
    }

    // Fallback: Query WooCommerce REST API for Page 1 if HPOS was unavailable
    if (!useWpEndpoint) {
      try {
        const wcResponse = await api.get(
          "orders",
          {
            status: "pending,processing",
            per_page: PER_PAGE,
            page: 1,
            orderby: "date",
            order: "desc",
            mode: "packing_alarms",
            _fields: "id,status,meta_data,payment_method,payment_method_title,date_paid,transaction_id,date_created,date_created_gmt",
          },
          {
            signal: pollAbortController.signal,
            timeout: getRemainingPollMs(),
            headers: fallbackHeaders,
          }
        );

        page1CandidateBatch = Array.isArray(wcResponse.data) ? wcResponse.data : [];
        totalPages = Number(wcResponse.headers?.["x-wp-totalpages"]) || 1;
        budgetRemaining--;
      } catch (wcErr) {
        logger.error({ err: wcErr?.message }, "[PackingAlarms] WooCommerce REST fallback query failed for page 1");
        page1Failed = true;
      }
    }

    const remainingPage1Unack = [];

    // If older orders exist in the backlog (cursor active or totalPages > 1), cap Page 1
    // unacknowledged orders at NEWEST_UNACK_RESERVE (25), strictly reserving at least 25 slots
    // so a full first page never starves older backlog orders.
    const hasBacklog = hasBacklogCursor || isLegacyCursor || totalPages > 1;
    const newestUnackLimit = hasBacklog ? NEWEST_UNACK_RESERVE : TOTAL_UNACK_CAP;

    if (!page1Failed && page1CandidateBatch.length > 0) {
      page1CandidateBatch.sort(compareOrdersDescending);

      const page1Eligible = [];
      for (const order of page1CandidateBatch) {
        allScannedCandidateMap.set(Number(order.id), order);
        if (isOrderNeedingPacking(order)) {
          page1Eligible.push(order);
        }
      }

      if (page1Eligible.length > 0) {
        const page1Ids = page1Eligible.map((o) => o.id);
        const page1AckSet = await getAcknowledgedOrderIds(page1Ids, { signal: pollAbortController.signal });
        const page1Unacknowledged = page1Eligible.filter((order) => !page1AckSet.has(Number(order.id)));
        let page1Selection = page1Unacknowledged;

        if (page1Unacknowledged.length > newestUnackLimit && hasBacklog) {
          // Keep the newest actionable order visible on every poll, then rotate
          // a window over every remaining order, including the final page slot.
          const anchor = page1Unacknowledged[0];
          const tail = page1Unacknowledged.slice(1);
          const windowSize = newestUnackLimit - 1;
          const start = tail.length ? page1Offset % tail.length : 0;
          const rotated = Array.from(
            { length: Math.min(windowSize, tail.length) },
            (_, index) => tail[(start + index) % tail.length]
          );
          page1Selection = [anchor, ...rotated];
          nextPage1Offset = tail.length > windowSize ? (start + windowSize) % tail.length : 0;
        } else {
          nextPage1Offset = 0;
        }

        const selectedPage1Ids = new Set(page1Selection.map((order) => Number(order.id)));

        for (const order of page1Eligible) {
          const id = Number(order.id);
          const isAck = page1AckSet.has(id);
          if (!isAck) {
            const isSelected = selectedPage1Ids.has(id);
            if (isSelected) {
              if (!unacknowledgedOrders.some((o) => o.id === order.id) && unacknowledgedOrders.length < newestUnackLimit) {
                unacknowledgedOrders.push({
                  id: order.id,
                  status: getEffectiveOrderStatus(order) || order.status,
                  is_acknowledged: false,
                  date_created_gmt: order.date_created_gmt || order.date_created,
                });
              } else {
                remainingPage1Unack.push({
                  id: order.id,
                  status: getEffectiveOrderStatus(order) || order.status,
                  is_acknowledged: false,
                  date_created_gmt: order.date_created_gmt || order.date_created,
                });
              }
            } else {
              remainingPage1Unack.push({
                id: order.id,
                status: getEffectiveOrderStatus(order) || order.status,
                is_acknowledged: false,
                date_created_gmt: order.date_created_gmt || order.date_created,
              });
            }
          } else {
            if (!acknowledgedScannedOrders.some((o) => o.id === order.id)) {
              acknowledgedScannedOrders.push({
                id: order.id,
                status: getEffectiveOrderStatus(order) || order.status,
                is_acknowledged: true,
                date_created_gmt: order.date_created_gmt || order.date_created,
              });
            }
          }
        }
      }
    }

    // 2. Scan backlog from stable cursor if discovery is operational and budget remains
    let lastExaminedOrder = null;
    let hitCapHalfway = false;
    let backlogBatchEmpty = false;
    let cursorStalled = false;

    // Determine the last raw row of verified page 1 for starting a fresh backlog scan
    const sortedP1 = [...page1CandidateBatch].sort(compareOrdersDescending);
    const lastRawP1 = sortedP1.length > 0 ? sortedP1[sortedP1.length - 1] : null;
    const p1DerivedCursor = lastRawP1 ? serializeOrderCursor(lastRawP1) : null;
    const parsedP1DerivedCursor = p1DerivedCursor ? parseOrderCursor(p1DerivedCursor) : null;

    // Use incoming keyset cursor if present; for legacy numeric cursors (or initial poll),
    // restart from the last raw row of verified first page with a fresh date-and-ID cursor.
    const activeBacklogCursor = validKeysetCursor || (totalPages > 1 ? parsedP1DerivedCursor : null);

    if (!page1Failed && budgetRemaining > 0 && activeBacklogCursor && unacknowledgedOrders.length < TOTAL_UNACK_CAP) {
      let backlogCandidateBatch = [];
      let backlogResp = null;

      try {
        if (useWpEndpoint) {
          const wpParams = {
            status: "processing",
            per_page: PER_PAGE,
            mode: "packing_alarms",
            cursor: `${activeBacklogCursor.date}_${activeBacklogCursor.id}`,
            cursor_date: activeBacklogCursor.date,
            cursor_id: activeBacklogCursor.id,
          };

          backlogResp = await wp.get("/wp-json/mumbai-auth/v1/employee/orders", {
            params: wpParams,
            signal: pollAbortController.signal,
            timeout: getRemainingPollMs(),
          });
          const payload = backlogResp.data || {};
          backlogCandidateBatch = Array.isArray(payload.orders) ? payload.orders : [];
          totalPages = Number(payload.total_pages) || totalPages;
          budgetRemaining--;
        } else {
          const wcParams = {
            status: "pending,processing",
            per_page: PER_PAGE,
            orderby: "date",
            order: "desc",
            mode: "packing_alarms",
            _fields: "id,status,meta_data,payment_method,payment_method_title,date_paid,transaction_id,date_created,date_created_gmt",
            cursor: `${activeBacklogCursor.date}_${activeBacklogCursor.id}`,
            cursor_date: activeBacklogCursor.date,
            cursor_id: activeBacklogCursor.id,
          };

          backlogResp = await api.get("orders", wcParams, {
            headers: fallbackHeaders,
            signal: pollAbortController.signal,
            timeout: getRemainingPollMs(),
          });
          backlogCandidateBatch = Array.isArray(backlogResp.data) ? backlogResp.data : [];
          totalPages = Number(backlogResp.headers?.["x-wp-totalpages"]) || totalPages;
          budgetRemaining--;
        }
      } catch (backlogErr) {
        logger.warn({ err: backlogErr?.message }, "[PackingAlarms] Backlog page fetch encountered warning or failure");
        backlogFailed = true;
      }

      // Require capability proof on EVERY backlog response (both first backlog request and every continuation)
      if (!backlogFailed) {
        const verifiedKeyset = hasKeysetCapability(backlogResp);
        if (!verifiedKeyset) {
          logger.warn("[PackingAlarms] Keyset capability signal absent in backlog response; preserving retry cursor");
          backlogFailed = true;
        }
      }

      backlogCandidateBatch.sort(compareOrdersDescending);

      // Filter candidate orders strictly older than activeBacklogCursor using tie-breaker
      const backlogOrdersToExamine = backlogCandidateBatch.filter((o) => isOrderOlderThanCursor(activeBacklogCursor, o));

      if (!backlogFailed) {
        if (backlogCandidateBatch.length > 0 && backlogOrdersToExamine.length === 0) {
          cursorStalled = true;
          backlogFailed = true;
          logger.warn("[PackingAlarms] Keyset cursor stalled on identical or non-advancing rows");
        } else if (backlogOrdersToExamine.length === 0) {
          backlogBatchEmpty = true;
        } else {
          const backlogEligible = [];
          for (const order of backlogOrdersToExamine) {
            allScannedCandidateMap.set(Number(order.id), order);
            if (isOrderNeedingPacking(order)) {
              backlogEligible.push(order);
            }
          }

          const backlogEligibleIds = backlogEligible.map((o) => o.id);
          const backlogAckSet = await getAcknowledgedOrderIds(backlogEligibleIds, { signal: pollAbortController.signal });

          for (const order of backlogOrdersToExamine) {
            lastExaminedOrder = order;
            const isEligible = isOrderNeedingPacking(order);
            if (isEligible) {
              const isAck = backlogAckSet.has(Number(order.id));
              if (!isAck) {
                if (!unacknowledgedOrders.some((o) => o.id === order.id)) {
                  unacknowledgedOrders.push({
                    id: order.id,
                    status: getEffectiveOrderStatus(order) || order.status,
                    is_acknowledged: false,
                    date_created_gmt: order.date_created_gmt || order.date_created,
                  });
                  if (unacknowledgedOrders.length >= TOTAL_UNACK_CAP) {
                    hitCapHalfway = true;
                    break;
                  }
                }
              } else {
                if (!acknowledgedScannedOrders.some((o) => o.id === order.id)) {
                  acknowledgedScannedOrders.push({
                    id: order.id,
                    status: getEffectiveOrderStatus(order) || order.status,
                    is_acknowledged: true,
                    date_created_gmt: order.date_created_gmt || order.date_created,
                  });
                }
              }
            }
          }
        }
      }

      // Calculate next cursor:
      // Advance or clear the backlog cursor only after a verified keyset response.
      // If the capability signal is absent, the cursor stalls, or a backlog read fails,
      // preserve retry state and report partial discovery failure.
      if (backlogFailed || cursorStalled) {
        nextCursor = validKeysetCursor ? rawCursor : (p1DerivedCursor || null);
      } else if (hitCapHalfway && lastExaminedOrder) {
        // If cap was reached halfway through backlog rows, resume from lastExaminedOrder (never advance past unread rows)
        nextCursor = serializeOrderCursor(lastExaminedOrder);
      } else if (lastExaminedOrder && (backlogCandidateBatch.length >= PER_PAGE || totalPages > (validKeysetCursor ? 1 : 2))) {
        // Full batch examined, or more pages exist in totalPages
        nextCursor = serializeOrderCursor(lastExaminedOrder);
      } else if (backlogBatchEmpty || backlogCandidateBatch.length < PER_PAGE) {
        // Confirmed exhaustion of backlog
        nextCursor = null;
      } else {
        nextCursor = null;
      }

      // If backlog finished and we still have room, backfill remaining unacknowledged orders from Page 1
      if (nextCursor === null && !backlogFailed && unacknowledgedOrders.length < TOTAL_UNACK_CAP && remainingPage1Unack.length > 0) {
        const slotsAvailable = TOTAL_UNACK_CAP - unacknowledgedOrders.length;
        unacknowledgedOrders.push(...remainingPage1Unack.slice(0, slotsAvailable));
      }
    } else if (!page1Failed && !hasBacklogCursor && totalPages > 1) {
      // First poll without keyset cursor (or legacy cursor restarting) and no backlog scan in this poll:
      // Start new backlog scan from the last raw row of verified first page
      nextCursor = p1DerivedCursor;
    } else if (validKeysetCursor && unacknowledgedOrders.length >= TOTAL_UNACK_CAP) {
      // Preserved cursor when newest orders filled the poll without backlog scan
      nextCursor = rawCursor;
    } else if (isLegacyCursor && totalPages > 1) {
      // Legacy cursor when page 1 filled the poll without backlog scan: issue fresh P1-derived cursor
      nextCursor = p1DerivedCursor;
    }

    // 3. Reconcile ringing IDs with strict cancellation deadline & rotation across polls
    const acknowledgedRingingIds = [];
    const missingRingingIds = [];

    const rawReconPos = req.query?.reconciliation_position || req.query?.reconciliationPosition || req.query?.ringing_offset;
    const reconPos = Math.max(0, Number.parseInt(rawReconPos, 10) || 0);
    let nextReconciliationPosition = reconPos;

    if (ringingIds.length > 0) {
      const ringingAckSet = await getAcknowledgedOrderIds(ringingIds, { signal: pollAbortController.signal });

      for (const rId of ringingIds) {
        if (ringingAckSet.has(rId)) {
          acknowledgedRingingIds.push(rId);
        } else if (allScannedCandidateMap.has(rId)) {
          const ord = allScannedCandidateMap.get(rId);
          if (!isOrderNeedingPacking(ord)) {
            acknowledgedRingingIds.push(rId);
          }
        } else {
          missingRingingIds.push(rId);
        }
      }

      // 4. Resolve missing ringing IDs using bounded batch lookup + bounded concurrency fallback
      if (missingRingingIds.length > 0) {
        const RECONCILIATION_BUDGET_MS = Math.min(2500, getRemainingPollMs());
        const reconStartTime = Date.now();
        const reconAbortController = new AbortController();
        const abortReconciliation = () => reconAbortController.abort();
        if (pollAbortController.signal.aborted || RECONCILIATION_BUDGET_MS <= 0) {
          reconAbortController.abort();
        } else {
          pollAbortController.signal.addEventListener("abort", abortReconciliation, { once: true });
        }
        const reconTimeoutId = setTimeout(() => {
          reconAbortController.abort();
        }, RECONCILIATION_BUDGET_MS);

        const getRemainingReconMs = () => {
          const elapsed = Date.now() - reconStartTime;
          return Math.max(0, Math.min(RECONCILIATION_BUDGET_MS - elapsed, getRemainingPollMs()));
        };

        let unresolvedIds = [...missingRingingIds];
        const reconOffset = reconPos % missingRingingIds.length;
        nextReconciliationPosition = (reconOffset + Math.min(6, missingRingingIds.length)) % missingRingingIds.length;

        // Attempt batch include lookup first (with cancellation signal & remaining budget)
        try {
          try {
            const batchTimeoutMs = getRemainingReconMs();
            if (!reconAbortController.signal.aborted && batchTimeoutMs > 0) {
              const batchResp = await api.get(
                "orders",
                {
                  include: missingRingingIds.join(","),
                  per_page: Math.min(50, missingRingingIds.length),
                  _fields: "id,status,meta_data,payment_method,payment_method_title,date_paid,transaction_id",
                },
                {
                  signal: reconAbortController.signal,
                  timeout: batchTimeoutMs,
                }
              );
              const batchOrders = Array.isArray(batchResp.data) ? batchResp.data : [];
              const batchMap = new Map(batchOrders.map((o) => [Number(o.id), o]));

              for (const rId of missingRingingIds) {
                if (batchMap.has(rId)) {
                  unresolvedIds = unresolvedIds.filter((id) => id !== rId);
                  const ord = batchMap.get(rId);
                  if (!isOrderNeedingPacking(ord)) {
                    acknowledgedRingingIds.push(rId);
                  }
                }
              }
            }
          } catch (batchErr) {
            logger.warn({ err: batchErr?.message }, "[PackingAlarms] Batch lookup for ringing IDs failed; falling back to bounded concurrency");
          }

          // Bounded fallback: concurrency limit of 3, capped at MAX_INDIVIDUAL_LOOKUPS (6).
          if (unresolvedIds.length > 0 && !reconAbortController.signal.aborted && getRemainingReconMs() > 0) {
            const CONCURRENCY_LIMIT = 3;
            const MAX_INDIVIDUAL_LOOKUPS = 6;

            const offset = reconPos % unresolvedIds.length;
            const rotatedIds = [...unresolvedIds.slice(offset), ...unresolvedIds.slice(0, offset)];
            const idsToQuery = rotatedIds.slice(0, MAX_INDIVIDUAL_LOOKUPS);

            const workerCount = Math.min(CONCURRENCY_LIMIT, idsToQuery.length);
            let currentIdx = 0;

            const workers = Array.from({ length: workerCount }, async () => {
              while (
                currentIdx < idsToQuery.length &&
                !reconAbortController.signal.aborted &&
                getRemainingReconMs() > 0
              ) {
                const rId = idsToQuery[currentIdx++];
                try {
                  const lookupTimeoutMs = getRemainingReconMs();
                  if (lookupTimeoutMs <= 0) break;
                  const resp = await api.get(
                    `orders/${rId}`,
                    {
                      _fields: "id,status,meta_data,payment_method,payment_method_title,date_paid,transaction_id",
                    },
                    {
                      signal: reconAbortController.signal,
                      timeout: lookupTimeoutMs,
                    }
                  );
                  const ord = resp.data;
                  if (!ord || !isOrderNeedingPacking(ord)) {
                    acknowledgedRingingIds.push(rId);
                  }
                } catch (lookupErr) {
                  if (lookupErr?.response?.status === 404) {
                    acknowledgedRingingIds.push(rId);
                  }
                  // On timeout, abort, network error, 500, etc., keep alarm active (do NOT silence)
                }
              }
            });

            await Promise.all(workers);
          }
        } finally {
          clearTimeout(reconTimeoutId);
          pollAbortController.signal.removeEventListener("abort", abortReconciliation);
        }
      }
    }

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }

    // 1) Total discovery outage: both page 1 sources failed
    if (page1Failed) {
      return res.json({
        success: false,
        discovery_unavailable: true,
        message: "Order discovery temporarily unavailable. Retrying...",
        orders: [],
        acknowledged_ringing_ids: Array.from(new Set(acknowledgedRingingIds)),
        next_cursor: validKeysetCursor ? rawCursor : null,
        next_reconciliation_position: nextReconciliationPosition,
        next_page1_offset: nextPage1Offset,
      });
    }

    const alarms = [...unacknowledgedOrders, ...acknowledgedScannedOrders.slice(0, 50)];

    // 2) Partial discovery failure: page 1 succeeded, but backlog scan failed
    if (backlogFailed) {
      return res.json({
        success: true,
        partial_discovery_failure: true,
        discovery_unavailable: true,
        message: "Backlog discovery temporarily unavailable. Retrying...",
        count: alarms.length,
        orders: alarms,
        acknowledged_ringing_ids: Array.from(new Set(acknowledgedRingingIds)),
        next_cursor: nextCursor || (validKeysetCursor ? rawCursor : p1DerivedCursor) || null,
        next_reconciliation_position: nextReconciliationPosition,
        next_page1_offset: nextPage1Offset,
      });
    }

    // 3) Healthy discovery: complete scan or confirmed exhaustion
    return res.json({
      success: true,
      discovery_unavailable: false,
      partial_discovery_failure: false,
      count: alarms.length,
      orders: alarms,
      acknowledged_ringing_ids: Array.from(new Set(acknowledgedRingingIds)),
      next_cursor: nextCursor,
      next_reconciliation_position: nextReconciliationPosition,
      next_page1_offset: nextPage1Offset,
    });
  } catch (error) {
    logError(req, error, "Get employee packing alarms error");
    const timedOut = pollAbortController.signal.aborted;
    return res.status(timedOut ? 503 : 500).json({
      success: false,
      discovery_unavailable: true,
      message: timedOut ? "Order alarm check timed out. Retrying..." : undefined,
      orders: [],
      acknowledged_ringing_ids: [],
      next_cursor: validKeysetCursor ? rawCursor : null,
    });
  } finally {
    clearTimeout(pollTimeoutId);
  }
};

/**
 * Acknowledges an incoming order alert across the counter / employee panel.
 */
export const acknowledgeEmployeeOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const cleanId = Number(id);
    if (!cleanId) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Authoritatively verify order exists and is actionable in WooCommerce
    let order;
    try {
      const response = await api.get(`orders/${encodeURIComponent(cleanId)}`);
      order = response?.data;
    } catch (orderErr) {
      if (orderErr.response?.status === 404) {
        return res.status(404).json({ success: false, message: `Order #${cleanId} not found.` });
      }
      logger.error({ err: orderErr.message, orderId: cleanId }, "[Employee] Upstream check before ack encountered warning");
      return res.status(503).json({
        success: false,
        message: "Authoritative order verification unavailable. Please retry.",
      });
    }

    if (!order) {
      return res.status(404).json({ success: false, message: `Order #${cleanId} not found.` });
    }

    if (order && ["cancelled", "failed", "trash"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Order #${cleanId} is marked as '${order.status}' and cannot be acknowledged.`,
      });
    }

    const result = await acknowledgeOrderNotification({
      orderId: cleanId,
      employeeId: req.user?.id,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err: err.message, orderId: req.params.id }, "[Employee] Failed to acknowledge order");
    return res.status(500).json({ success: false, message: "Failed to acknowledge order" });
  }
};

/**
 * Returns VAPID public key for Web Push subscriptions.
 */
export const getEmployeePushPublicKey = (req, res) => {
  try {
    const publicKey = getVapidPublicKey();
    return res.json({ success: true, publicKey });
  } catch (err) {
    logger.error({ err: err.message }, "[Employee] Failed getting VAPID public key");
    return res.status(500).json({ success: false, message: "Failed to get push key" });
  }
};

/**
 * Registers an employee push subscription for background order alerts.
 */
export const subscribeEmployeePush = async (req, res) => {
  try {
    const subscription = req.body?.subscription || req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, message: "Invalid push subscription object" });
    }
    const result = await registerPushSubscription({
      subscription,
      employeeId: req.user?.id,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err: err.message }, "[Employee] Failed subscribing to push");
    return res.status(500).json({ success: false, message: "Failed to save push subscription" });
  }
};

/**
 * Unregisters an employee push subscription.
 * Scoped to the authenticated employee unless caller is administrator.
 */
export const unsubscribeEmployeePush = async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) {
      return res.status(400).json({ success: false, message: "Endpoint required to unsubscribe" });
    }
    const result = await unregisterPushSubscription({
      endpoint,
      employeeId: req.user?.id,
      userRoles: req.user?.roles || (req.user?.role ? [req.user.role] : []),
    });
    if (result && !result.success && result.reason === "forbidden") {
      return res.status(403).json({
        success: false,
        message: "Cannot unsubscribe a device registered to another employee",
      });
    }
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err: err.message }, "[Employee] Failed unsubscribing from push");
    return res.status(500).json({ success: false, message: "Failed to unsubscribe" });
  }
};

