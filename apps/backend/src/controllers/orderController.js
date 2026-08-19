import api from "../config/woocommerce.js";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

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

    // 1. Fetch user email from WooCommerce customer record
    let userEmail = (req.query.email || "").trim().toLowerCase();

    if (!userEmail && userId) {
      try {
        const customerRes = await api.get(`customers/${userId}`);
        if (customerRes.data?.email) {
          userEmail = customerRes.data.email.trim().toLowerCase();
        }
      } catch (custErr) {
        console.warn("Could not fetch WooCommerce customer email:", custErr.message);
      }
    }

    // 2. Fetch recent orders from WooCommerce
    const response = await api.get("orders", {
      per_page: 100,
      orderby: "date",
      order: "desc",
    });

    const allOrders = Array.isArray(response.data) ? response.data : [];

    // 3. Filter orders matching either customer_id OR billing_email
    const matchedOrders = allOrders.filter((order) => {
      const orderCustomerId = Number(order.customer_id);
      const orderBillingEmail = (order.billing?.email || "").trim().toLowerCase();

      const isUserIdMatch = orderCustomerId > 0 && orderCustomerId === Number(userId);
      const isEmailMatch = userEmail && orderBillingEmail === userEmail;

      return isUserIdMatch || isEmailMatch;
    });

    // 4. Format clean, customer-facing order objects
    const formattedOrders = matchedOrders.map((order) => {
      let trackingStage = 1; // 1: Placed, 2: Packed, 3: Out for Delivery, 4: Delivered
      let displayStatus = "Order Placed";
      let statusColor = "orange";

      switch (order.status) {
        case "pending":
        case "on-hold":
          trackingStage = 1;
          displayStatus = "Payment Pending";
          statusColor = "amber";
          break;
        case "processing":
          trackingStage = 2;
          displayStatus = "Preparing & Packing";
          statusColor = "blue";
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
          statusColor = "red";
          break;
        case "refunded":
          trackingStage = 0;
          displayStatus = "Refunded";
          statusColor = "purple";
          break;
        case "failed":
          trackingStage = 0;
          displayStatus = "Failed";
          statusColor = "red";
          break;
        default:
          trackingStage = 1;
          displayStatus = "Confirmed";
          statusColor = "orange";
      }

      const totalItemsCount =
        order.line_items?.reduce(
          (sum, item) => sum + (item.quantity || 1),
          0
        ) || 0;

      return {
        id: order.id,
        order_number: order.number || String(order.id),
        status: order.status,
        display_status: displayStatus,
        status_color: statusColor,
        tracking_stage: trackingStage,
        date_created: order.date_created,
        total: order.total,
        currency_symbol: order.currency_symbol || "₹",
        payment_method_title: order.payment_method_title || "Cash on Delivery",
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
          first_name: order.shipping?.first_name || "",
          last_name: order.shipping?.last_name || "",
          address_1: order.shipping?.address_1 || "",
          address_2: order.shipping?.address_2 || "",
          city: order.shipping?.city || "",
          state: order.shipping?.state || "",
          postcode: order.shipping?.postcode || "",
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
          image: item.image?.src || null,
        })),
        shipping_total: order.shipping_total || "0.00",
        discount_total: order.discount_total || "0.00",
        total_tax: order.total_tax || "0.00",
      };
    });

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
 * Fetch specific order details by ID
 */
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.wpUserId;

    const response = await api.get(`orders/${encodeURIComponent(id)}`);
    const order = response.data;

    if (!order || !order.id) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    res.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("Get order by ID error:", error.response?.data || error.message);

    res.status(error.response?.status || 500).json({
      success: false,
      message: "Unable to load order details.",
    });
  }
};
