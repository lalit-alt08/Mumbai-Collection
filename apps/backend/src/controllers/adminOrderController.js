import { mutateStaffOrder } from "../services/staffOrderService.js";
import api from "../config/woocommerce.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { serverCache } from "../utils/memoryCache.js";
import { logError } from "../utils/logger.js";
import {
  isOrderStatusLocked,
  isOnlineOrderUnpaid,
  validateOrderStatusTransition,
  buildOrderStatusPayload,
  ALLOWED_ORDER_STATUSES,
} from "../utils/orderStatusTransition.js";
import { publishOrderEvent } from "../services/orderNotificationService.js";
import { invalidateOrderDetailCache } from "../services/orderDetailCache.js";

/**
 * Admin Order Management Controller (Placeholder / Extensible domain controller)
 */
export const getAdminOrders = async (req, res) => {
  try {
    const { status, search, page = 1, per_page = 10 } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 10));

    const queryParams = {
      page: pageNum,
      per_page: limit,
      orderby: "date",
      order: "desc",
    };

    if (search && search.trim()) {
      queryParams.search = search.trim();
    }

    if (status && status !== "all") {
      queryParams.status = status;
    }

    const response = await api.get("orders", queryParams);
    const rawOrders = Array.isArray(response.data) ? response.data : [];

    const totalOrders = Number(response.headers["x-wp-total"]) || rawOrders.length;
    const totalPages = Number(response.headers["x-wp-totalpages"]) || Math.ceil(totalOrders / limit) || 1;

    const orders = rawOrders.map((o) => {
      const deliveryMeta = o.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || o.status;

      const customerName = formatCustomerDisplayName(o.billing?.first_name, o.billing?.last_name, o.billing?.email || "Guest Customer");
      const customerAddress = `${o.billing?.address_1 || ""}${
        o.billing?.address_2 ? ", " + o.billing.address_2 : ""
      }, ${o.billing?.city || ""}, ${o.billing?.state || ""}`.replace(/^,\s*|,\s*$/g, "") || "Address not provided";

      return {
        ...o,
        id: o.id,
        order_number: o.number || String(o.id),
        customer_name: customerName,
        customer_email: o.billing?.email || "",
        customer_phone: o.billing?.phone || "",
        customer: {
          id: o.customer_id,
          name: customerName,
          email: o.billing?.email || "",
          phone: o.billing?.phone || "",
          address: customerAddress,
        },
        items: (o.line_items || []).map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          price: i.price,
          total: i.total,
          image: i.image?.src || null,
        })),
        total: o.total,
        status: effectiveStatus,
        date: o.date_created,
        items_count: o.line_items?.reduce((sum, i) => sum + (i.quantity || 1), 0) || 0,
        payment_method: o.payment_method_title || "Cash on Delivery",
        is_unpaid: isOnlineOrderUnpaid(o),
        is_status_locked: isOrderStatusLocked(o),
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
      totalPages,
      count: orders.length,
      orders,
    });
  } catch (error) {
    logError(req, error, "Get admin orders error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load orders.",
      orders: [],
    });
  }
};

/**
 * Update Admin Order Status
 */
export const updateAdminOrderStatus = async (req, res) => {
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
      message: `Order #${id} updated to ${status}.`,
      order,
    });
  } catch (error) {
    logError(req, error, "Update admin order status error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to update order status.",
    });
  }
};
