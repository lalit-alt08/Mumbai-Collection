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
import { EDITABLE_PRODUCT_SCOPE, fetchStockCounts } from "./adminProductController.js";
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
import {
  normalizeOrderSearchValue,
  matchesEmployeeOrderSearch,
  getEffectiveOrderStatus,
  parseWooCommerceDate,
  getOrderTimestamp,
  compareOrdersDescending,
  isOrderOlderThanCursor,
  serializeOrderCursor,
  parseOrderCursor,
  isOrderNeedingPacking,
  filterAndPaginateEmployeeOrders,
} from "../utils/employeeOrderQuery.js";
import {
  formatEmployeeOrderRecord,
  formatOverviewOrderItem,
  sanitizeEmployeeOrderMeta,
} from "../utils/employeeOrderFormatter.js";
import { getEmployeePackingAlarms } from "../services/employeeAlarmService.js";

const employeeErrorMessages = {
  order_busy: "Another staff member is updating this order. Please retry.",
  order_missing: "Order not found.",
  order_changed: "This order changed. Refresh it before updating.",
  terminal_order: "A completed or cancelled order cannot be reopened.",
  invalid_transition: "This order status change is not allowed.",
  unpaid_order: "Online payment has not been confirmed.",
  delivery_review_required: "Confirm delivery arrangements before dispatch.",
  order_location_changed: "The delivery area changed. Refresh and review the order.",
};
const safeEmployeeError = (error, fallback) => error.employeeSafe === true
  ? error.message
  : employeeErrorMessages[error.response?.data?.code] || fallback;

export {
  getOrderDeliveredTimestamp,
  isOrderStatusLocked,
  isCodOrder,
  isOnlineOrderUnpaid,
  validateOrderStatusTransition,
  buildOrderStatusPayload,
  ALLOWED_ORDER_STATUSES,
  normalizeOrderSearchValue,
  matchesEmployeeOrderSearch,
  getEffectiveOrderStatus,
  parseWooCommerceDate,
  getOrderTimestamp,
  compareOrdersDescending,
  isOrderOlderThanCursor,
  serializeOrderCursor,
  parseOrderCursor,
  isOrderNeedingPacking,
  filterAndPaginateEmployeeOrders,
  getEmployeePackingAlarms,
};

/**
 * Upload Product Image to WordPress Media Library for Employee Panel
 */
export const formatEmployeeMediaUploadResponse = ({ id, url }, req) => ({
  success: true,
  url: transformMediaUrl(url, req),
  id,
});

export const uploadEmployeeMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No image file provided." });
    }
    const { id, url } = await uploadMedia(req.file, { uploaderId: req.user?.id });
    res.json(formatEmployeeMediaUploadResponse({ id, url }, req));
  } catch (error) {
    logError(req, error, "Employee media upload error");
    res.status(error.response?.status || 500).json({
      success: false,
      message: "Failed to upload image to WordPress Media Library.",
      code: error.response?.data?.code || "media_upload_error",
    });
  }
};

export const deleteEmployeeMedia = async (req, res) => {
  try {
    const mediaId = Number(req.params.id);
    if (!mediaId || isNaN(mediaId) || mediaId <= 0) {
      return res.status(400).json({ success: false, message: "A valid numeric media ID is required." });
    }

    const result = await deleteMediaIfUnreferenced([mediaId], { context: "pending_removal", uploaderId: req.user?.id });
    const itemResult = result.results?.[0];
    if (itemResult?.deleted) {
      return res.json({ success: true, message: `Media #${mediaId} successfully deleted.`, deleted: true, mediaId });
    }

    const failureResponses = {
      not_pending: { status: 400, message: itemResult?.message || "Cannot remove media that is already attached to a product.", code: "not_pending" },
      referenced: { status: 409, message: "Cannot delete media because it is currently in use elsewhere.", code: "media_in_use", reference: itemResult?.reference },
      ownership_mismatch: { status: 403, message: "You can only remove media uploaded during your own session.", code: "forbidden" },
    };
    const mapped = failureResponses[itemResult?.reason];
    if (mapped) return res.status(mapped.status).json({ success: false, ...mapped });

    res.json({ success: false, message: "Media could not be deleted.", result: itemResult });
  } catch (error) {
    logError(req, error, "Employee media delete error");
    res.status(error.response?.status || 500).json({
      success: false,
      message: "Failed to remove media.",
    });
  }
};

async function scanOrdersFallback(queryParams, cleanSearch, { status, location, pageNum, limit }) {
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
      if (currentPage === MAX_SCAN_PAGES && totalPagesHeader > MAX_SCAN_PAGES) {
        throw Object.assign(new Error("Complete filtering requires the updated HPOS plugin."), { response: { status: 503 } });
      }
      if (batch.length === 0 || (totalPagesHeader > 0 && currentPage >= totalPagesHeader) || (totalPagesHeader <= 0 && batch.length < queryParams.per_page)) {
        break;
      }
      currentPage += 1;
    }
    serverCache.set(scanCacheKey, allOrders, 30000);
  }

  return filterAndPaginateEmployeeOrders(allOrders, { status, location, search: cleanSearch, page: pageNum, limit });
}

export const getEmployeeOrders = async (req, res) => {
  try {
    const {
      status, search, location,
      date_filter, dateFilter, date_from, dateFrom, date_to, dateTo, date_basis,
      page = 1, per_page = 20,
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

    const resolvedDateFilter = date_filter || dateFilter;
    const dateBasis = date_basis || "created";
    if (!['created', 'completed'].includes(dateBasis) || (dateBasis === 'completed' && status !== 'completed')) {
      return res.status(400).json({ success: false, message: "Choose a valid order date filter." });
    }
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

    const cleanSearch = (search || "").trim().replace(/^(?:order\s*)?#(?=\d+$)/i, "");
    if (cleanSearch) queryParams.search = cleanSearch;

    const isCustomStatus = ["active", "processing", "packed", "out-for-delivery", "dispatched"].includes(status);
    const hasCustomLocation = location && location !== "all";

    if (isCustomStatus) {
      queryParams.status = status === "active"
        ? "pending,processing,on-hold,completed"
        : ["out-for-delivery", "dispatched"].includes(status)
        ? "processing,on-hold,completed"
        : "pending,processing,on-hold";
    } else if (status && status !== "all") {
      queryParams.status = status;
    }

    let orders = [];
    let totalOrders = 0;
    let totalPages = 1;
    let isCustomStatusFallback = false;

    if (!isCustomStatus && !hasCustomLocation && dateBasis !== "completed") {
      const directResponse = await api.get("orders", { ...queryParams, page: pageNum, per_page: limit });
      const batch = Array.isArray(directResponse.data) ? directResponse.data : [];
      totalOrders = Number(directResponse.headers?.["x-wp-total"]) || batch.length;
      totalPages = Number(directResponse.headers?.["x-wp-totalpages"]) || Math.ceil(totalOrders / limit) || 1;
      orders = batch;
    } else {
      try {
        const response = await wp.get("/wp-json/mumbai-auth/v1/employee/orders", {
          params: {
            status,
            ...(dateBasis === "completed" ? { date_basis: dateBasis } : {}),
            ...(hasCustomLocation ? { location } : {}),
            page: pageNum,
            per_page: limit,
            ...(cleanSearch ? { search: cleanSearch } : {}),
            ...(queryParams.after ? { after: queryParams.after } : {}),
            ...(queryParams.before ? { before: queryParams.before } : {}),
          },
        });
        const payload = response.data || {};
        if (dateBasis === "completed" && payload.date_basis !== "completed") {
          const error = new Error("The store must be updated before filtering by completion date.");
          error.employeeSafe = true;
          error.response = { status: 503 };
          throw error;
        }
        orders = Array.isArray(payload.orders) ? payload.orders : [];
        totalOrders = Number(payload.total) || 0;
        totalPages = Number(payload.total_pages) || 1;
      } catch (error) {
        const code = error.response?.data?.code;
        if (dateBasis === "completed" && (error.response?.status === 404 || code === "hpos_required")) {
          const unavailable = new Error("Completion-date filtering is unavailable. Update the store plugin and try again.");
          unavailable.employeeSafe = true;
          unavailable.response = { status: 503 };
          throw unavailable;
        }
        if (error.response?.status !== 404 && code !== "hpos_required") throw error;
        if (hasCustomLocation) {
          const locationError = new Error("Location filtering requires the updated WooCommerce plugin with HPOS enabled. Please contact an administrator.");
          locationError.employeeSafe = true;
          locationError.response = { status: 503 };
          throw locationError;
        }
        logger.warn({ code, status: error.response?.status }, "[Employee Orders] Falling back to WooCommerce REST pagination");
        isCustomStatusFallback = true;
      }
    }

    if (isCustomStatusFallback) {
      const paginated = await scanOrdersFallback(queryParams, cleanSearch, { status, location, pageNum, limit });
      orders = paginated.orders;
      totalOrders = paginated.total;
      totalPages = paginated.totalPages;
    }

    const orderIds = orders.map((o) => o.id);
    const ackSet = await getAcknowledgedOrderIds(orderIds);
    const formatted = orders.map((o) => formatEmployeeOrderRecord(o, ackSet));

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }
    res.json({
      success: true,
      page: pageNum,
      per_page: limit,
      total: totalOrders,
      totalPages,
      count: formatted.length,
      orders: transformMediaUrls(formatted, req),
    });
  } catch (error) {
    logError(req, error, "Get employee orders error");
    res.status(error.response?.status || 500).json({
      success: false,
      message: safeEmployeeError(error, "Failed to load orders. Please try again."),
      orders: [],
    });
  }
};

export const bulkDispatchOrders = async (req, res) => {
  const ids = req.body?.ids;
  const expectedLocations = req.body?.expected_locations;
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
      const order = await mutateStaffOrder(ids[index], "out-for-delivery", { packedOnly: true, expectedLocation: expectedLocations?.[ids[index]] });
        results[index] = { id: ids[index], success: true, order: { ...order, meta_data: sanitizeEmployeeOrderMeta(order.meta_data) } };
      } catch (error) {
        results[index] = { id: ids[index], success: false, message: safeEmployeeError(error, "Dispatch failed. Please try again.") };
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
      order: { ...order, meta_data: sanitizeEmployeeOrderMeta(order.meta_data) },
    });
  } catch (error) {
    logError(req, error, "Update order status error");
    res.status(error.response?.status || 500).json({
      success: false,
      message: safeEmployeeError(error, "Failed to update order status. Please try again."),
    });
  }
};

export const confirmOrderDeliveryReview = async (req, res) => {
  try {
    await wp.post(`/wp-json/mumbai-auth/v1/staff/orders/${req.params.id}/delivery-review`);
    for (const prefix of ["employee:overview", "employee:orders_scan", "admin:customers"]) serverCache.invalidatePrefix(prefix);
    await invalidateOrderDetailCache(req.params.id);
    void publishOrderEvent({ event: "ORDER_STATUS_UPDATED", orderId: Number(req.params.id) });
    return res.json({ success: true });
  } catch (error) {
    logError(req, error, "Confirm delivery review error");
    return res.status(error.response?.status || 500).json({ success: false, message: "Could not confirm delivery arrangements. Please retry." });
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
    return { refundedPaise, isPartial: refundedPaise + 1 < orderTotalPaise, source: "woocommerce" };
  }

  const paymentId = String(getOrderMetaValue(order, "_razorpay_payment_id") || order?.transaction_id || "").trim();
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
    return { error: "This online order has no valid Razorpay payment reference to verify." };
  }

  let payment;
  try {
    payment = await fetchRazorpayPayment(paymentId);
  } catch (error) {
    logger.warn({ orderId: order?.id, paymentId, err: error?.message }, "[RefundEmail] Razorpay refund verification failed");
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
    isPartial: payment?.refund_status !== "full" && refundedPaise + 1 < paymentAmountPaise,
    source: "razorpay",
  };
};

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
    const rawVal = emailMeta?.value ? String(emailMeta.value).trim() : "";
    if (rawVal) {
      if (rawVal.startsWith("sending:")) {
        const markerTime = new Date(rawVal.replace(/^sending:/, "")).getTime();
        // If stamped less than 2 minutes ago, treat as currently in flight
        if (!isNaN(markerTime) && Date.now() - markerTime < 120000) {
          return res.status(409).json({ success: false, message: "A refund email is currently in progress. Please wait a moment." });
        }
      } else {
        return res.status(409).json({ success: false, message: "A refund email has already been sent for this order." });
      }
    }

    const verifiedRefund = await verifyRefundForNotification(order);
    if (verifiedRefund.error) {
      return res.status(409).json({ success: false, message: verifiedRefund.error });
    }

    const toEmail = String(order.billing?.email || "").trim();
    if (!toEmail || !toEmail.includes("@")) {
      return res.status(422).json({ success: false, message: "This order does not have a valid customer email address." });
    }

    const emailMarker = { key: "_manual_refund_email_sent_at", value: `sending:${new Date().toISOString()}` };
    await api.put(`orders/${encodeURIComponent(id)}`, {
      meta_data: [emailMarker],
    });

    try {
      await sendRefundEmail({
        toEmail,
        toName: `${order.billing?.first_name || ""} ${order.billing?.last_name || ""}`.trim(),
        orderNumber: order.number || id,
        amountInInr: (verifiedRefund.refundedPaise / 100).toFixed(2),
        isPartial: verifiedRefund.isPartial,
      });
    } catch (emailError) {
      // Clear in-flight sending marker on failure so subsequent retries are unblocked
      try {
        await api.put(`orders/${encodeURIComponent(id)}`, {
          meta_data: [{ key: emailMarker.key, value: "" }],
        });
      } catch (cleanupError) {
        logError(req, cleanupError, "Could not clear failed refund-email marker");
      }
      throw emailError;
    }

    const sentAt = new Date().toISOString();
    await api.put(`orders/${encodeURIComponent(id)}`, {
      meta_data: [{ key: "_manual_refund_email_sent_at", value: sentAt }],
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
      message: "Could not confirm whether the refund email was sent. Check the order before retrying.",
    });
  } finally {
    if (locked) await releaseLock(lockKey, workerId);
  }
};

export const getEmployeeOverview = async (req, res) => {
  try {
    const responsePayload = await serverCache.getOrFetch("employee:overview", async () => {
      const failedSections = [];
      const unavailable = (section, fallback) => () => {
        failedSections.push(section);
        return fallback;
      };
      const todayBounds = getISTDateBoundaries("today");
      const todayDateString = todayBounds?.startDate || new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
      }).format(new Date());

      const [
        activeOrdersRes,
        operationalSummaryRes,
        receivedTodayRes,
        completedTodayRes,
        recentOrdersRes,
        stockCounts,
        lowStockProductsRes,
      ] = await Promise.all([
        api.get("orders", {
          status: "processing",
          per_page: 100,
          orderby: "date",
          order: "asc",
          _fields: "id,number,status,total,date_created,billing,shipping,line_items,meta_data,payment_method,payment_method_title,date_paid,transaction_id",
        }).catch(unavailable("action_orders", { data: [] })),
        wp.get("/wp-json/mumbai-auth/v1/employee/orders/summary").then((response) => {
          const counts = response.data?.counts;
          const keys = ["processing", "packed", "out-for-delivery", "dispatched"];
          if (!counts || keys.some((key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0)) {
            throw new Error("Operational order counts are unavailable");
          }
          return response;
        }).catch(unavailable("order_summary", { data: null })),
        api.get("orders", {
          after: todayBounds?.after,
          before: todayBounds?.before,
          dates_are_gmt: true,
          per_page: 1,
          _fields: "id",
        }).catch(unavailable("received_today", { headers: {}, data: [] })),
        wp.get("/wp-json/mumbai-auth/v1/employee/orders", {
          params: { status: "completed", date_basis: "completed", after: todayBounds?.after, before: todayBounds?.before, page: 1, per_page: 1 },
        }).then((response) => {
          if (response.data?.success !== true || response.data?.date_basis !== "completed" || !Number.isSafeInteger(response.data?.total) || response.data.total < 0) {
            throw new Error("Authoritative completion count unavailable");
          }
          return response;
        }).catch(unavailable("completed_today", { data: null })),
        api.get("orders", {
          per_page: 10,
          orderby: "date",
          order: "desc",
          _fields: "id,number,status,total,date_created,billing,shipping,line_items,meta_data,payment_method,payment_method_title,date_paid,transaction_id",
        }).catch(unavailable("recent_orders", { data: [] })),
        fetchStockCounts().catch(unavailable("stock_counts", null)),
        api.get("products", {
          ...EDITABLE_PRODUCT_SCOPE,
          stock_status: "lowstock",
          per_page: 6,
          _fields: "id,name,images,stock_quantity,stock_status,price",
        }).catch(unavailable("low_stock_products", { data: [] })),
      ]);

      const activeOrders = Array.isArray(activeOrdersRes?.data) ? activeOrdersRes.data : [];
      const recentOrders = Array.isArray(recentOrdersRes?.data) ? recentOrdersRes.data : [];
      const allCatalogProducts = Array.isArray(lowStockProductsRes?.data) ? lowStockProductsRes.data : [];

      let ordersToPackCount = 0;
      let ordersPackedCount = 0;
      let ordersOutForDeliveryCount = 0;
      const actionOrders = [];

      activeOrders.forEach((order) => {
        const effectiveStatus = getEffectiveOrderStatus(order);
        if (effectiveStatus === "processing") ordersToPackCount += 1;
        else if (effectiveStatus === "packed") ordersPackedCount += 1;
        else if (effectiveStatus === "out-for-delivery" || effectiveStatus === "dispatched") ordersOutForDeliveryCount += 1;

        if (["processing", "packed", "out-for-delivery", "dispatched"].includes(effectiveStatus)) {
          actionOrders.push(formatOverviewOrderItem(order, effectiveStatus));
        }
      });

      const operationalCounts = operationalSummaryRes?.data?.counts;
      if (operationalCounts && typeof operationalCounts === "object") {
        ordersToPackCount = Number(operationalCounts.processing) || 0;
        ordersPackedCount = Number(operationalCounts.packed) || 0;
        ordersOutForDeliveryCount = (Number(operationalCounts["out-for-delivery"]) || 0) + (Number(operationalCounts.dispatched) || 0);
      }

      const statusPriority = { processing: 1, packed: 2, "out-for-delivery": 3, dispatched: 3, pending: 4, "on-hold": 4 };
      actionOrders.sort((a, b) => {
        const diff = (statusPriority[a.status] || 99) - (statusPriority[b.status] || 99);
        return diff !== 0 ? diff : new Date(a.date_created) - new Date(b.date_created);
      });

      const recentOrdersFormatted = recentOrders.map((order) =>
        formatOverviewOrderItem(order, getEffectiveOrderStatus(order))
      );

      const lowStockProductsFormatted = allCatalogProducts.slice(0, 6).map((p) => ({
        id: p.id,
        name: p.name,
        image: p.images?.[0]?.src || null,
        stock_quantity: p.stock_quantity,
        stock_status: p.stock_status,
      }));

      const receivedTodayCount = Number(receivedTodayRes?.headers?.["x-wp-total"]) || 0;
      const completedTodayCount = completedTodayRes?.data?.total ?? 0;
      const totalActiveCount = ordersToPackCount + ordersPackedCount + ordersOutForDeliveryCount;

      const operationalUnavailable = failedSections.includes("order_summary");
      const payload = {
        success: true,
        data: {
          is_degraded: failedSections.length > 0,
          unavailable_sections: failedSections,
          summary: {
            ordersToPack: operationalUnavailable ? null : ordersToPackCount,
            ordersPacked: operationalUnavailable ? null : ordersPackedCount,
            ordersOutForDelivery: operationalUnavailable ? null : ordersOutForDeliveryCount,
            completedToday: failedSections.includes("completed_today") ? null : completedTodayCount,
            receivedToday: failedSections.includes("received_today") ? null : receivedTodayCount,
            lowStockCount: stockCounts?.lowstock ?? null,
            activeOrders: operationalUnavailable ? null : totalActiveCount,
            totalOrders: failedSections.includes("received_today") ? null : receivedTodayCount,
            completedOrders: failedSections.includes("completed_today") ? null : completedTodayCount,
            todayDate: todayDateString,
          },
          ordersNeedingAction: actionOrders,
          lowStockProducts: lowStockProductsFormatted,
          recentOrders: recentOrdersFormatted,
        },
      };
      if (failedSections.length) {
        // Do not cache partial data as a healthy overview for 90 seconds.
        const degraded = new Error("Employee overview is partially unavailable");
        degraded.overviewPayload = payload;
        throw degraded;
      }
      return payload;
    }, 90000);

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }
    const finalPayload = {
      ...responsePayload,
      data: responsePayload?.data
        ? {
            ...responsePayload.data,
            lowStockProducts: transformMediaUrls(responsePayload.data.lowStockProducts, req),
          }
        : responsePayload?.data,
    };
    res.json(finalPayload);
  } catch (error) {
    if (error.overviewPayload) {
      res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
      return res.json({
        ...error.overviewPayload,
        data: {
          ...error.overviewPayload.data,
          lowStockProducts: transformMediaUrls(error.overviewPayload.data?.lowStockProducts, req),
        },
      });
    }
    logError(req, error, "Employee overview error");
    res.status(500).json({ success: false, message: "Failed to load employee operations overview." });
  }
};

export const acknowledgeEmployeeOrder = async (req, res) => {
  try {
    const cleanId = Number(req.params.id);
    if (!cleanId) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    let order;
    try {
      const response = await api.get(`orders/${encodeURIComponent(cleanId)}`);
      order = response?.data;
    } catch (orderErr) {
      if (orderErr.response?.status === 404) {
        return res.status(404).json({ success: false, message: `Order #${cleanId} not found.` });
      }
      logger.error({ err: orderErr.message, orderId: cleanId }, "[Employee] Upstream check before ack encountered warning");
      return res.status(503).json({ success: false, message: "Authoritative order verification unavailable. Please retry." });
    }

    if (!order) {
      return res.status(404).json({ success: false, message: `Order #${cleanId} not found.` });
    }

    if (["cancelled", "failed", "trash"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Order #${cleanId} is marked as '${order.status}' and cannot be acknowledged.`,
      });
    }

    if (isOnlineOrderUnpaid(order)) {
      return res.status(400).json({
        success: false,
        message: `Order #${cleanId} is unpaid and not eligible for packing acknowledgment.`,
      });
    }

    if (!isOrderNeedingPacking(order)) {
      return res.json({ success: true, alreadyHandled: true, orderId: cleanId });
    }

    const result = await acknowledgeOrderNotification({ orderId: cleanId, employeeId: req.user?.id });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err: err.message, orderId: req.params.id }, "[Employee] Failed to acknowledge order");
    return res.status(500).json({ success: false, message: "Failed to acknowledge order" });
  }
};

export const getEmployeePushPublicKey = (req, res) => {
  try {
    const publicKey = getVapidPublicKey();
    return res.json({ success: true, publicKey });
  } catch (err) {
    logger.error({ err: err.message }, "[Employee] Failed getting VAPID public key");
    return res.status(500).json({ success: false, message: "Failed to get push key" });
  }
};

export const subscribeEmployeePush = async (req, res) => {
  try {
    const subscription = req.body?.subscription || req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, message: "Invalid push subscription object" });
    }
    const result = await registerPushSubscription({ subscription, employeeId: req.user?.id });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err: err.message }, "[Employee] Failed subscribing to push");
    return res.status(500).json({ success: false, message: "Failed to save push subscription" });
  }
};

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
      return res.status(403).json({ success: false, message: "Cannot unsubscribe a device registered to another employee" });
    }
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err: err.message }, "[Employee] Failed unsubscribing from push");
    return res.status(500).json({ success: false, message: "Failed to unsubscribe" });
  }
};
