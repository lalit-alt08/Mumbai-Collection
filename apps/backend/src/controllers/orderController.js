import api from "../config/woocommerce.js";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { transformMediaUrls } from "../utils/mediaUrl.js";
import { logError, logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import { sendResult } from "../utils/responseHelper.js";
import { getOrderDetail } from "../services/orderDetailCache.js";

/**
 * Fetch authenticated customer's orders from WooCommerce
 */
const formatCustomerOrder = (order) => {
  const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
  const effectiveStatus = deliveryMeta?.value || order.status;

  let trackingStage = 1; // 1: Placed, 2: Packed, 3: Out for Delivery, 4: Delivered, 0: Cancelled
  let displayStatus = "Order Placed";
  let statusColor = "orange";

  switch (effectiveStatus) {
    case "pending":
    case "on-hold":
      trackingStage = 1;
      displayStatus = "Order Placed";
      statusColor = "amber";
      break;
    case "processing":
      trackingStage = 2;
      displayStatus = "Preparing & Packing";
      statusColor = "blue";
      break;
    case "packed":
      trackingStage = 2;
      displayStatus = "Packed & Ready";
      statusColor = "purple";
      break;
    case "out-for-delivery":
    case "dispatched":
      trackingStage = 3;
      displayStatus = "Out for Delivery";
      statusColor = "orange";
      break;
    case "completed":
      trackingStage = 4;
      displayStatus = "Delivered";
      statusColor = "emerald";
      break;
    case "cancelled":
      trackingStage = 0;
      displayStatus = "Cancelled";
      statusColor = "rose";
      break;
    case "refunded":
      trackingStage = 0;
      displayStatus = "Refunded";
      statusColor = "purple";
      break;
    case "failed":
      trackingStage = 0;
      displayStatus = "Failed";
      statusColor = "rose";
      break;
    default:
      trackingStage = 1;
      displayStatus = "Confirmed";
      statusColor = "blue";
  }

  const totalItemsCount =
    order.line_items?.reduce(
      (sum, item) => sum + (item.quantity || 1),
      0
    ) || 0;

  return {
    id: order.id,
    order_number: order.number || String(order.id),
    status: effectiveStatus,
    display_status: displayStatus,
    status_color: statusColor,
    tracking_stage: trackingStage,
    date_created: order.date_created,
    date_completed: order.date_completed || null,
    date_modified: order.date_modified || null,
    total: order.total,
    currency_symbol: order.currency_symbol || "₹",
    payment_method_title: order.payment_method_title || order.payment_method || "Cash on Delivery",
    billing: {
      first_name: order.billing?.first_name || "",
      last_name: order.billing?.last_name || "",
      phone: order.billing?.phone || "",
      email: order.billing?.email || "",
      address_1: order.billing?.address_1 || "",
      address_2: order.billing?.address_2 || "",
      city: order.billing?.city || "",
      state: order.billing?.state || "",
      postcode: order.billing?.postcode || "",
    },
    shipping: {
      first_name: order.shipping?.first_name || order.billing?.first_name || "",
      last_name: order.shipping?.last_name || order.billing?.last_name || "",
      phone: order.shipping?.phone || order.billing?.phone || "",
      address_1: order.shipping?.address_1 || order.billing?.address_1 || "",
      address_2: order.shipping?.address_2 || order.billing?.address_2 || "",
      city: order.shipping?.city || order.billing?.city || "",
      state: order.shipping?.state || order.billing?.state || "",
      postcode: order.shipping?.postcode || order.billing?.postcode || "",
    },
    item_count: totalItemsCount,
    line_items: (order.line_items || []).map((item) => ({
      id: item.id,
      product_id: item.product_id,
      name: item.name,
      quantity: item.quantity,
      subtotal: item.subtotal,
      total: item.total,
      price: item.price,
      image: item.image?.src || (item.images?.[0]?.src) || null,
    })),
    shipping_total: order.shipping_total || "0.00",
    discount_total: order.discount_total || "0.00",
    total_tax: order.total_tax || "0.00",
  };
};

/**
 * Fetch authenticated customer's orders from WooCommerce
 */
const CUSTOMER_ORDER_FIELDS = "id,customer_id,number,status,total,currency_symbol,payment_method,payment_method_title,date_created,date_completed,date_modified,billing,shipping,line_items,meta_data,shipping_total,discount_total,total_tax";

const fetchCustomerOrderPage = async ({ userId, page, limit, after, before }) => {
  let rawOrders = [];
  let totalOrders = 0;
  let totalPages = 1;
  try {
    const query = {
      customer: userId,
      page,
      per_page: limit,
      orderby: "date",
      order: "desc",
      _fields: CUSTOMER_ORDER_FIELDS,
    };
    if (after) {
      query.after = after;
      query.dates_are_gmt = true;
    }
    if (before) {
      query.before = before;
      query.dates_are_gmt = true;
    }
    const response = await api.get("orders", query);
    rawOrders = Array.isArray(response.data) ? response.data : [];
    totalOrders = Number(response.headers?.["x-wp-total"]) || rawOrders.length;
    totalPages = Number(response.headers?.["x-wp-totalpages"]) || Math.ceil(totalOrders / limit) || 1;
  } catch (error) {
    logger.warn({ userId, err: error.message }, "Could not query orders by customer ID");
  }

  const normalizedUserId = Number(userId);
  const verifiedOrders = rawOrders.filter(
    (order) => normalizedUserId > 0 && Number(order.customer_id) === normalizedUserId
  );
  const formattedOrders = verifiedOrders.map(formatCustomerOrder);
  formattedOrders.sort((a, b) => new Date(b.date_created) - new Date(a.date_created));
  return {
    success: true,
    page,
    per_page: limit,
    total: totalOrders,
    totalPages,
    count: formattedOrders.length,
    orders: formattedOrders,
  };
};

export const getCustomerOrders = async (req, res) => {
  try {
    const userId = req.wpUserId;
    if (!userId) {
      return sendResult(res, {
        success: false,
        errorCode: "AUTH_REQUIRED",
        message: "Authentication required.",
        orders: [],
      });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.per_page) || 10));
    const after = req.query.after || "";
    const before = req.query.before || "";
    const cacheKey = `customer:orders:${userId}:p${page}:l${limit}:a${after}:b${before}`;
    const result = await serverCache.getOrFetch(
      cacheKey,
      () => fetchCustomerOrderPage({ userId, page, limit, after, before }),
      60000
    );

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }
    return sendResult(res, {
      ...result,
      orders: transformMediaUrls(result.orders || [], req),
    });
  } catch (error) {
    logError(req, error, "Get customer orders error");

    return sendResult(res, {
      success: false,
      errorCode: "INTERNAL_SERVER_ERROR",
      message: "Unable to retrieve orders.",
      orders: [],
    });
  }
};

/**
 * Fetch specific order details by ID (with ownership validation)
 */
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.wpUserId;

    if (!userId) {
      return sendResult(res, {
        success: false,
        errorCode: "AUTH_REQUIRED",
        message: "Authentication required.",
      });
    }

    const order = await getOrderDetail(id, async () => {
      const response = await api.get(`orders/${encodeURIComponent(id)}`);
      return response?.data || null;
    });

    if (!order || !order.id) {
      return sendResult(res, {
        success: false,
        errorCode: "ORDER_NOT_FOUND",
        message: "Order not found.",
      });
    }

    // Orders from signed-in checkout are linked to the customer's WooCommerce
    // ID. Do not authorize access by billing email alone; email addresses can
    // be reused and must not grant access to another account's order history.
    if (Number(order.customer_id || 0) !== Number(userId)) {
      return sendResult(res, {
        success: false,
        errorCode: "ORDER_NOT_FOUND",
        message: "Order not found.",
      });
    }

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }

    return sendResult(res, {
      success: true,
      order: transformMediaUrls(formatCustomerOrder(order), req),
    });
  } catch (error) {
    logError(req, error, "Get order by ID error");

    return sendResult(res, {
      success: false,
      errorCode: "INTERNAL_SERVER_ERROR",
      message: "Unable to load order details.",
    });
  }
};
