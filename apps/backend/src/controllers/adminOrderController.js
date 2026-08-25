import api from "../config/woocommerce.js";

/**
 * Admin Order Management Controller (Placeholder / Extensible domain controller)
 */
export const getAdminOrders = async (req, res) => {
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

    if (search && search.trim()) {
      queryParams.search = search.trim();
    }

    if (status && status !== "all") {
      queryParams.status = status;
    }

    const response = await api.get("orders", queryParams);
    const orders = Array.isArray(response.data) ? response.data : [];

    const totalOrders = Number(response.headers["x-wp-total"]) || orders.length;
    const totalPages = Number(response.headers["x-wp-totalpages"]) || Math.ceil(totalOrders / limit) || 1;

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
    console.error("Get admin orders error:", error.response?.data || error.message);
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

    if (!id || !status) {
      return res.status(400).json({
        success: false,
        message: "Order ID and status are required.",
      });
    }

    const response = await api.put(`orders/${encodeURIComponent(id)}`, {
      status,
      meta_data: [{ key: "_delivery_status", value: status }],
    });

    res.json({
      success: true,
      message: `Order #${id} updated to ${status}.`,
      order: response.data,
    });
  } catch (error) {
    console.error("Update admin order status error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to update order status.",
    });
  }
};
