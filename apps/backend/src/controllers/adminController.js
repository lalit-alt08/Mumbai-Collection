import api from "../config/woocommerce.js";

/**
 * Executive Overview Analytics
 */
export const getDashboardOverview = async (req, res) => {
  try {
    // 1. Fetch recent orders
    const ordersRes = await api.get("orders", {
      per_page: 100,
      orderby: "date",
      order: "desc",
    });

    const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];

    // 2. Fetch catalog products
    const productsRes = await api.get("products", {
      per_page: 100,
    });

    const products = Array.isArray(productsRes.data) ? productsRes.data : [];

    // Metrics calculation
    let totalRevenue = 0;
    let todaySales = 0;
    let activeOrdersCount = 0;
    let completedOrdersCount = 0;
    let cancelledOrdersCount = 0;

    const todayDateString = new Date().toISOString().split("T")[0];

    // Last 7 days map for sales chart
    const last7DaysMap = new Map();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split("T")[0];
      const dayLabel = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
      last7DaysMap.set(dateKey, { date: dateKey, label: dayLabel, revenue: 0, orders: 0 });
    }

    orders.forEach((order) => {
      const orderTotal = Number(order.total) || 0;
      const orderDate = order.date_created ? order.date_created.split("T")[0] : "";
      const isCancelled = ["cancelled", "failed", "refunded"].includes(order.status);

      if (!isCancelled) {
        totalRevenue += orderTotal;

        if (orderDate === todayDateString) {
          todaySales += orderTotal;
        }

        if (last7DaysMap.has(orderDate)) {
          const dayData = last7DaysMap.get(orderDate);
          dayData.revenue += orderTotal;
          dayData.orders += 1;
        }
      }

      if (["pending", "processing", "on-hold", "out-for-delivery", "dispatched"].includes(order.status)) {
        activeOrdersCount += 1;
      } else if (order.status === "completed") {
        completedOrdersCount += 1;
      } else if (isCancelled) {
        cancelledOrdersCount += 1;
      }
    });

    // Low stock products (< 5 items or marked out of stock)
    const lowStockProducts = products
      .filter((p) => {
        if (p.stock_status === "outofstock") return true;
        if (p.manage_stock && p.stock_quantity !== null && p.stock_quantity <= 5) return true;
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

    // Formatted recent 8 orders
    const recentOrders = orders.slice(0, 8).map((o) => ({
      id: o.id,
      order_number: o.number || String(o.id),
      customer_name:
        `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() ||
        o.billing?.email ||
        "Guest Customer",
      customer_email: o.billing?.email || "",
      customer_phone: o.billing?.phone || "",
      total: o.total,
      status: o.status,
      date: o.date_created,
      items_count: o.line_items?.reduce((sum, i) => sum + (i.quantity || 1), 0) || 0,
      payment_method: o.payment_method_title || "Cash on Delivery",
    }));

    res.json({
      success: true,
      data: {
        summary: {
          totalRevenue: Math.round(totalRevenue),
          todaySales: Math.round(todaySales),
          totalOrders: orders.length,
          activeOrders: activeOrdersCount,
          completedOrders: completedOrdersCount,
          cancelledOrders: cancelledOrdersCount,
          totalProducts: products.length,
          lowStockCount: lowStockProducts.length,
          avgOrderValue: orders.length > 0 ? Math.round(totalRevenue / Math.max(1, (orders.length - cancelledOrdersCount))) : 0,
        },
        salesTrend: Array.from(last7DaysMap.values()),
        lowStockProducts: lowStockProducts.slice(0, 6),
        recentOrders,
      },
    });
  } catch (error) {
    console.error("Admin dashboard overview error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load dashboard overview.",
    });
  }
};

/**
 * Get Orders with search and status filtering
 */
export const getAdminOrders = async (req, res) => {
  try {
    const { status, search } = req.query;

    const response = await api.get("orders", {
      per_page: 100,
      orderby: "date",
      order: "desc",
    });

    let orders = Array.isArray(response.data) ? response.data : [];

    // Filter by status safely in Node
    if (status && status !== "all") {
      orders = orders.filter((o) => {
        if (status === "out-for-delivery" || status === "dispatched") {
          return (
            o.status === "out-for-delivery" ||
            o.status === "dispatched" ||
            o.meta_data?.some(
              (m) =>
                m.key === "_delivery_status" &&
                (m.value === "out-for-delivery" || m.value === "dispatched")
            )
          );
        }
        return o.status === status;
      });
    }

    // Filter by search query safely in Node
    if (search) {
      const q = search.trim().toLowerCase();
      orders = orders.filter((o) => {
        const orderIdStr = String(o.id || "");
        const orderNumStr = String(o.number || "");
        const firstName = (o.billing?.first_name || "").toLowerCase();
        const lastName = (o.billing?.last_name || "").toLowerCase();
        const email = (o.billing?.email || "").toLowerCase();
        const phone = String(o.billing?.phone || "");

        return (
          orderIdStr.includes(q) ||
          orderNumStr.includes(q) ||
          firstName.includes(q) ||
          lastName.includes(q) ||
          email.includes(q) ||
          phone.includes(q)
        );
      });
    }

    const formatted = orders.map((o) => {
      // Check if custom delivery status is stored in metadata
      const deliveryMeta = o.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || o.status;

      return {
        id: o.id,
        order_number: o.number || String(o.id),
        status: effectiveStatus,
        date_created: o.date_created,
        total: o.total,
        shipping_total: o.shipping_total || "0.00",
        discount_total: o.discount_total || "0.00",
        payment_method: o.payment_method_title || "Cash on Delivery",
        customer: {
          id: o.customer_id,
          name:
            `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() ||
            "Guest Customer",
          email: o.billing?.email || "",
          phone: o.billing?.phone || "",
          address: `${o.billing?.address_1 || ""}${
            o.billing?.address_2 ? ", " + o.billing.address_2 : ""
          }, ${o.billing?.city || ""}, ${o.billing?.state || ""} - ${
            o.billing?.postcode || ""
          }`,
        },
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
      count: formatted.length,
      orders: formatted,
    });
  } catch (error) {
    console.error("Get admin orders error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load orders.",
      orders: [],
    });
  }
};

/**
 * Update Order Status (Instant dispatch sync)
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required.",
      });
    }

    let payload = { status };

    // If setting a custom dispatch state like out-for-delivery, attach metadata
    if (status === "out-for-delivery" || status === "dispatched") {
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
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Failed to update order status.",
    });
  }
};

/**
 * Get Products for Inventory Manager
 */
export const getAdminProducts = async (req, res) => {
  try {
    const { category, search } = req.query;

    const queryParams = {
      per_page: 100,
      orderby: "date",
      order: "desc",
    };

    if (category && category !== "all") {
      queryParams.category = category;
    }

    if (search) {
      queryParams.search = search;
    }

    const response = await api.get("products", queryParams);
    const products = Array.isArray(response.data) ? response.data : [];

    const formatted = products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku || `MC-${p.id}`,
      price: p.price,
      regular_price: p.regular_price,
      sale_price: p.sale_price,
      stock_quantity: p.stock_quantity,
      manage_stock: p.manage_stock,
      stock_status: p.stock_status,
      categories: p.categories?.map((c) => ({ id: c.id, name: c.name, slug: c.slug })) || [],
      image: p.images?.[0]?.src || null,
      images: (p.images || []).map((img) => img.src),
      date_created: p.date_created,
    }));

    res.json({
      success: true,
      count: formatted.length,
      products: formatted,
    });
  } catch (error) {
    console.error("Get admin products error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load products.",
      products: [],
    });
  }
};

/**
 * Update Product Price and Stock Quantity
 */
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { regular_price, sale_price, stock_quantity, stock_status, name } = req.body;

    const updatePayload = {};

    if (name !== undefined) updatePayload.name = name;
    if (regular_price !== undefined) updatePayload.regular_price = String(regular_price);
    if (sale_price !== undefined) updatePayload.sale_price = sale_price ? String(sale_price) : "";
    if (stock_quantity !== undefined) {
      updatePayload.manage_stock = true;
      updatePayload.stock_quantity = Number(stock_quantity);
      updatePayload.stock_status = Number(stock_quantity) > 0 ? "instock" : "outofstock";
    } else if (stock_status !== undefined) {
      updatePayload.stock_status = stock_status;
    }

    const response = await api.put(`products/${encodeURIComponent(id)}`, updatePayload);

    res.json({
      success: true,
      message: `Product #${id} updated successfully.`,
      product: response.data,
    });
  } catch (error) {
    console.error("Update product error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Failed to update product.",
    });
  }
};

/**
 * Create New Product
 */
export const createProduct = async (req, res) => {
  try {
    const { name, regular_price, sale_price, stock_quantity, category_ids, image_url, description } = req.body;

    if (!name || !regular_price) {
      return res.status(400).json({
        success: false,
        message: "Product name and regular price are required.",
      });
    }

    const payload = {
      name,
      type: "simple",
      regular_price: String(regular_price),
      sale_price: sale_price ? String(sale_price) : "",
      description: description || "",
      manage_stock: true,
      stock_quantity: Number(stock_quantity) || 10,
      stock_status: (Number(stock_quantity) || 10) > 0 ? "instock" : "outofstock",
      categories: Array.isArray(category_ids) ? category_ids.map((id) => ({ id })) : [],
      images: image_url ? [{ src: image_url }] : [],
    };

    const response = await api.post("products", payload);

    res.status(201).json({
      success: true,
      message: "Product created successfully.",
      product: response.data,
    });
  } catch (error) {
    console.error("Create product error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Failed to create product.",
    });
  }
};

/**
 * Customer Directory with Aggregated Lifetime Value
 */
export const getAdminCustomers = async (req, res) => {
  try {
    const ordersRes = await api.get("orders", {
      per_page: 100,
      orderby: "date",
      order: "desc",
    });

    const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
    const customerMap = new Map();

    orders.forEach((o) => {
      const email = (o.billing?.email || "").trim().toLowerCase();
      if (!email) return;

      const orderTotal = Number(o.total) || 0;
      const customerName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || email;
      const phone = o.billing?.phone || "";
      const city = o.billing?.city || "";
      const state = o.billing?.state || "";

      if (!customerMap.has(email)) {
        customerMap.set(email, {
          email,
          name: customerName,
          phone,
          location: city ? `${city}, ${state}` : "Vasai, Maharashtra",
          ordersCount: 1,
          lifetimeSpent: orderTotal,
          lastOrderDate: o.date_created,
          lastOrderId: o.id,
        });
      } else {
        const existing = customerMap.get(email);
        existing.ordersCount += 1;
        existing.lifetimeSpent += orderTotal;
        if (new Date(o.date_created) > new Date(existing.lastOrderDate)) {
          existing.lastOrderDate = o.date_created;
          existing.lastOrderId = o.id;
        }
      }
    });

    const customers = Array.from(customerMap.values()).map((c) => ({
      ...c,
      lifetimeSpent: Math.round(c.lifetimeSpent),
    }));

    res.json({
      success: true,
      count: customers.length,
      customers,
    });
  } catch (error) {
    console.error("Get admin customers error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load customers.",
      customers: [],
    });
  }
};
