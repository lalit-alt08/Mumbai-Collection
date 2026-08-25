import api from "../config/woocommerce.js";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

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
export const getCustomerOrders = async (req, res) => {
  try {
    const userId = req.wpUserId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
        orders: [],
      });
    }

    // 1. Resolve authenticated customer's verified email from WooCommerce customer record
    let customerEmail = "";
    try {
      const customerRes = await api.get(`customers/${userId}`);
      if (customerRes.data?.email) {
        customerEmail = customerRes.data.email.trim().toLowerCase();
      }
    } catch (custErr) {
      console.warn("Could not fetch customer email for user", userId, custErr.message);
    }

    // 2. Query WooCommerce using the customer's verified email (scoped search)
    // If no email could be resolved, fall back to querying by customer ID
    let rawOrders = [];
    if (customerEmail) {
      const searchRes = await api.get("orders", {
        search: customerEmail,
        per_page: 50,
        orderby: "date",
        order: "desc",
      });
      rawOrders = Array.isArray(searchRes.data) ? searchRes.data : [];
    } else {
      const customerOrderRes = await api.get("orders", {
        customer: userId,
        per_page: 50,
        orderby: "date",
        order: "desc",
      });
      rawOrders = Array.isArray(customerOrderRes.data) ? customerOrderRes.data : [];
    }

    // 3. Strict secondary in-memory authorization guard:
    // Accept an order ONLY when billing.email matches verified customerEmail,
    // or customer_id matches authenticated userId (for future orders).
    const normalizedUserId = Number(userId);
    const verifiedOrders = rawOrders.filter((order) => {
      const orderCustomerId = Number(order.customer_id);
      const orderBillingEmail = (order.billing?.email || "").trim().toLowerCase();

      const isEmailMatch = Boolean(customerEmail && orderBillingEmail === customerEmail);
      const isIdMatch = normalizedUserId > 0 && orderCustomerId === normalizedUserId;

      return isEmailMatch || isIdMatch;
    });

    // 4. Format clean, customer-facing order objects with live delivery metadata sync
    const formattedOrders = verifiedOrders.map(formatCustomerOrder);

    res.json({
      success: true,
      count: formattedOrders.length,
      orders: formattedOrders,
    });
  } catch (error) {
    console.error("Get customer orders error:", error.response?.data || error.message);

    res.status(error.response?.status || 500).json({
      success: false,
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
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const response = await api.get(`orders/${encodeURIComponent(id)}`);
    const order = response.data;

    if (!order || !order.id) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // Ownership verification matching authenticated user ID or verified email
    const orderCustomerId = Number(order.customer_id);
    const orderBillingEmail = (order.billing?.email || "").trim().toLowerCase();
    
    let isOwner = orderCustomerId > 0 && orderCustomerId === Number(userId);
    
    if (!isOwner && userId) {
      try {
        const customerRes = await api.get(`customers/${userId}`);
        const userEmail = customerRes.data?.email?.trim().toLowerCase();
        if (userEmail && orderBillingEmail === userEmail) {
          isOwner = true;
        }
      } catch (err) {
        // Ignore lookup error
      }
    }

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this order.",
      });
    }

    res.json({
      success: true,
      order: formatCustomerOrder(order),
    });
  } catch (error) {
    console.error("Get order by ID error:", error.response?.data || error.message);

    res.status(error.response?.status || 500).json({
      success: false,
      message: "Unable to load order details.",
    });
  }
};
