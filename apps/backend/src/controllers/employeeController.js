import api from "../config/woocommerce.js";
import { uploadMedia } from "../services/wordpressMediaService.js";
import { transformMediaUrls, transformMediaUrl } from "../utils/mediaUrl.js";

/**
 * Upload Product Image to WordPress Media Library for Employee Panel
 */
export const uploadEmployeeMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided.",
      });
    }

    const { id, url } = await uploadMedia(req.file);

    res.json({
      success: true,
      url: transformMediaUrl(url, req),
      id,
    });
  } catch (error) {
    console.error("Employee media upload error:", error.response?.data || error.message);
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
 * Get Orders with search and status filtering for Employee Panel
 */
export const getEmployeeOrders = async (req, res) => {
  try {
    const { status, search, page = 1, per_page = 20 } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));

    const queryParams = {
      page: pageNum,
      per_page: limit,
      orderby: "date",
      order: "desc",
    };

    // Server-side search across historical WooCommerce database
    if (search && search.trim()) {
      queryParams.search = search.trim();
    }

    // Both "processing", "packed", and "out-for-delivery" query WooCommerce "processing"
    if (status === "out-for-delivery" || status === "dispatched" || status === "packed") {
      queryParams.status = "processing";
    } else if (status && status !== "all") {
      queryParams.status = status;
    }

    const response = await api.get("orders", queryParams);
    let orders = Array.isArray(response.data) ? response.data : [];

    // Filter custom local delivery statuses cleanly
    if (status === "processing") {
      orders = orders.filter((o) => {
        const deliveryMeta = o.meta_data?.find((m) => m.key === "_delivery_status");
        const eff = deliveryMeta?.value || o.status;
        return eff === "processing";
      });
    } else if (status === "packed") {
      orders = orders.filter((o) => {
        const deliveryMeta = o.meta_data?.find((m) => m.key === "_delivery_status");
        const eff = deliveryMeta?.value || o.status;
        return eff === "packed";
      });
    } else if (status === "out-for-delivery" || status === "dispatched") {
      orders = orders.filter((o) => {
        const deliveryMeta = o.meta_data?.find((m) => m.key === "_delivery_status");
        const eff = deliveryMeta?.value || o.status;
        return eff === "out-for-delivery" || eff === "dispatched";
      });
    }

    const totalOrders = Number(response.headers["x-wp-total"]) || orders.length;
    const totalPages = Number(response.headers["x-wp-totalpages"]) || Math.ceil(totalOrders / limit) || 1;

    const formatted = orders.map((o) => {
      const deliveryMeta = o.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || o.status;

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

      return {
        id: o.id,
        order_number: o.number || String(o.id),
        status: effectiveStatus,
        date_created: o.date_created,
        total: o.total,
        shipping_total: o.shipping_total || "0.00",
        discount_total: o.discount_total || "0.00",
        payment_method: o.payment_method_title || "Cash on Delivery",
        customer_name:
          `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() ||
          "Guest Customer",
        phone: o.billing?.phone || o.shipping?.phone || "",
        customer: {
          id: o.customer_id,
          name:
            `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() ||
            "Guest Customer",
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
    console.error("Get employee orders error:", error.response?.data || error.message);
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

    const ALLOWED_STATUSES = [
      "pending",
      "processing",
      "packed",
      "on-hold",
      "out-for-delivery",
      "dispatched",
      "completed",
      "cancelled",
      "refunded",
      "failed",
    ];

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status "${status}". Allowed: ${ALLOWED_STATUSES.join(", ")}`,
      });
    }

    let payload = {};

    // For custom quick-commerce dispatch statuses, keep WC status as processing while updating delivery meta
    if (status === "out-for-delivery" || status === "dispatched" || status === "packed") {
      payload = {
        status: "processing",
        meta_data: [{ key: "_delivery_status", value: status }],
      };
    } else {
      payload = {
        status,
        meta_data: [{ key: "_delivery_status", value: status }],
      };
    }

    const response = await api.put(`orders/${encodeURIComponent(id)}`, payload);

    res.json({
      success: true,
      message: `Order #${id} status updated to ${status}.`,
      order: response.data,
    });
  } catch (error) {
    console.error("Update order status error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to update order status.",
    });
  }
};

/**
 * Employee Task Force Operations Overview
 * Provides real-time operational workload metrics for store staff (Today's workload, active action items, low stock)
 */
export const getEmployeeOverview = async (req, res) => {
  try {
    const [ordersRes, productsRes] = await Promise.all([
      api.get("orders", {
        per_page: 100,
        orderby: "date",
        order: "desc",
      }),
      api.get("products", {
        per_page: 100,
      }),
    ]);

    const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
    const products = Array.isArray(productsRes.data) ? productsRes.data : [];

    // Store timezone date format (Asia/Kolkata)
    const todayDateString = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());

    let ordersToPackCount = 0;
    let ordersPackedCount = 0;
    let ordersOutForDeliveryCount = 0;
    let completedTodayCount = 0;
    let receivedTodayCount = 0;

    const actionOrders = [];
    const recentOrdersFormatted = [];

    orders.forEach((order) => {
      const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || order.status;
      const orderDate = order.date_created ? order.date_created.split("T")[0] : "";
      const isCancelled = ["cancelled", "failed", "refunded"].includes(effectiveStatus);

      // Operational today counters
      if (!isCancelled && orderDate === todayDateString) {
        receivedTodayCount += 1;
      }

      if (effectiveStatus === "completed" && orderDate === todayDateString) {
        completedTodayCount += 1;
      }

      // Current operational queue counts (Active work in the store)
      if (effectiveStatus === "processing") {
        ordersToPackCount += 1;
      } else if (effectiveStatus === "packed") {
        ordersPackedCount += 1;
      } else if (effectiveStatus === "out-for-delivery" || effectiveStatus === "dispatched") {
        ordersOutForDeliveryCount += 1;
      }

      const formattedItem = {
        id: order.id,
        order_number: order.number || String(order.id),
        status: effectiveStatus,
        customer_name:
          `${order.billing?.first_name || ""} ${order.billing?.last_name || ""}`.trim() ||
          order.billing?.email ||
          "Guest Customer",
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
      };

      // If order is active (needs employee action or in transit), add to action list
      if (
        [
          "processing",
          "packed",
          "out-for-delivery",
          "dispatched",
          "pending",
          "on-hold",
        ].includes(effectiveStatus)
      ) {
        actionOrders.push(formattedItem);
      }

      recentOrdersFormatted.push(formattedItem);
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

    // Low stock products (strictly low stock: stock > 0 and <= 5 items)
    const lowStockProducts = products
      .filter((p) => {
        if (p.stock_status === "outofstock") return false;
        const qty = p.stock_quantity;
        if (qty !== null && qty !== undefined && qty > 0 && qty <= 5) return true;
        if (p.manage_stock && qty !== null && qty !== undefined && qty > 0 && qty <= 5) return true;
        return false;
      })
      .map((p) => ({
        id: p.id,
        name: p.name,
        image: p.images?.[0]?.src || null,
        stock_quantity: p.stock_quantity,
        stock_status: p.stock_status,
        price: p.price,
      }));

    const summary = {
      // 4 Operational Console Cards
      ordersToPack: ordersToPackCount,
      ordersPacked: ordersPackedCount,
      ordersOutForDelivery: ordersOutForDeliveryCount,
      completedToday: completedTodayCount,
      receivedToday: receivedTodayCount,
      lowStockCount: lowStockProducts.length,

      // Compatibility fields
      activeOrders: ordersToPackCount + ordersPackedCount + ordersOutForDeliveryCount,
      totalOrders: orders.length,
      completedOrders: completedTodayCount,
      todayDate: todayDateString,
    };

    res.json({
      success: true,
      summary,
      ordersNeedingAction: actionOrders,
      lowStockProducts: lowStockProducts.slice(0, 6),
      recentOrders: recentOrdersFormatted.slice(0, 10),
      data: {
        summary,
        ordersNeedingAction: actionOrders,
        lowStockProducts: lowStockProducts.slice(0, 6),
        recentOrders: recentOrdersFormatted.slice(0, 10),
      },
    });
  } catch (error) {
    console.error("Employee overview error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load employee operations overview.",
    });
  }
};
