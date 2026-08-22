import api from "../config/woocommerce.js";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

/**
 * Product Input Validation Helper
 */
const validateProductInput = ({
  name,
  regular_price,
  sale_price,
  stock_quantity,
  stock_status,
}) => {
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return "Product name must be a non-empty string.";
    }

    if (name.trim().length > 200) {
      return "Product name cannot exceed 200 characters.";
    }
  }

  if (regular_price !== undefined) {
    const price = Number(regular_price);

    if (!Number.isFinite(price) || price < 0) {
      return "Regular price must be a valid non-negative number.";
    }
  }

  if (sale_price !== undefined && sale_price !== "") {
    const salePrice = Number(sale_price);

    if (!Number.isFinite(salePrice) || salePrice < 0) {
      return "Sale price must be a valid non-negative number.";
    }

    if (
      regular_price !== undefined &&
      salePrice > Number(regular_price)
    ) {
      return "Sale price cannot be greater than regular price.";
    }
  }

  if (stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== "") {
    const stock = Number(stock_quantity);

    if (!Number.isInteger(stock) || stock < 0) {
      return "Stock quantity must be a non-negative integer.";
    }
  }

  if (stock_status !== undefined) {
    const allowedStockStatuses = [
      "instock",
      "outofstock",
      "onbackorder",
    ];

    if (!allowedStockStatuses.includes(stock_status)) {
      return "Invalid stock status.";
    }
  }

  return null;
};

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
    let monthSales = 0;
    let monthOrdersCount = 0;
    let activeOrdersCount = 0;
    let completedOrdersCount = 0;
    let cancelledOrdersCount = 0;

    const todayDateString = new Date().toISOString().split("T")[0];
    const currentYearMonth = new Date().toISOString().slice(0, 7);

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
      const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || order.status;

      const orderTotal = Number(order.total) || 0;
      const orderDate = order.date_created ? order.date_created.split("T")[0] : "";
      const isCancelled = ["cancelled", "failed", "refunded"].includes(effectiveStatus);

      if (!isCancelled) {
        totalRevenue += orderTotal;

        if (orderDate === todayDateString) {
          todaySales += orderTotal;
        }

        if (orderDate && orderDate.startsWith(currentYearMonth)) {
          monthSales += orderTotal;
          monthOrdersCount += 1;
        }

        if (last7DaysMap.has(orderDate)) {
          const dayData = last7DaysMap.get(orderDate);
          dayData.revenue += orderTotal;
          dayData.orders += 1;
        }
      }

      if (["pending", "processing", "packed", "on-hold", "out-for-delivery", "dispatched"].includes(effectiveStatus)) {
        activeOrdersCount += 1;
      } else if (effectiveStatus === "completed") {
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
    const recentOrders = orders.slice(0, 8).map((o) => {
      const deliveryMeta = o.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || o.status;

      return {
        id: o.id,
        order_number: o.number || String(o.id),
        customer_name:
          `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() ||
          o.billing?.email ||
          "Guest Customer",
        customer_email: o.billing?.email || "",
        customer_phone: o.billing?.phone || "",
        total: o.total,
        status: effectiveStatus,
        date: o.date_created,
        items_count: o.line_items?.reduce((sum, i) => sum + (i.quantity || 1), 0) || 0,
        payment_method: o.payment_method_title || "Cash on Delivery",
      };
    });

    const summaryData = {
      totalRevenue: Math.round(totalRevenue),
      todaySales: Math.round(todaySales),
      monthSales: Math.round(monthSales),
      monthOrdersCount,
      totalOrders: orders.length,
      activeOrders: activeOrdersCount,
      completedOrders: completedOrdersCount,
      cancelledOrders: cancelledOrdersCount,
      totalProducts: products.length,
      lowStockCount: lowStockProducts.length,
      avgOrderValue: orders.length > 0 ? Math.round(totalRevenue / Math.max(1, (orders.length - cancelledOrdersCount))) : 0,
    };

    res.json({
      success: true,
      summary: summaryData,
      salesTrend: Array.from(last7DaysMap.values()),
      lowStockProducts: lowStockProducts.slice(0, 6),
      recentOrders,
      data: {
        summary: summaryData,
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
 * Get Products for Inventory Manager with Server-Side Pagination & Search
 */
export const getAdminProducts = async (req, res) => {
  try {
    const { category, search, page = 1, per_page = 20, stock_status } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));

    const queryParams = {
      page: pageNum,
      per_page: limit,
      orderby: "date",
      order: "desc",
    };

    if (category && category !== "all") {
      queryParams.category = category;
    }

    if (stock_status && stock_status !== "all") {
      queryParams.stock_status = stock_status;
    }

    if (search && search.trim()) {
      queryParams.search = search.trim();
    }

    const response = await api.get("products", queryParams);
    const products = Array.isArray(response.data) ? response.data : [];

    const totalProducts = Number(response.headers["x-wp-total"]) || products.length;
    const totalPages = Number(response.headers["x-wp-totalpages"]) || Math.ceil(totalProducts / limit) || 1;

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
      page: pageNum,
      per_page: limit,
      total: totalProducts,
      totalPages,
      count: formatted.length,
      products: formatted,
    });
  } catch (error) {
    console.error("Get admin products error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load products.",
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

    const validationError = validateProductInput({
      name,
      regular_price,
      sale_price,
      stock_quantity,
      stock_status,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const updatePayload = {};

    if (name !== undefined) updatePayload.name = name.trim();
    if (regular_price !== undefined) updatePayload.regular_price = String(regular_price);
    if (sale_price !== undefined) updatePayload.sale_price = sale_price ? String(sale_price) : "";
    if (stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== "") {
      const stockNum = Number(stock_quantity);
      updatePayload.manage_stock = true;
      updatePayload.stock_quantity = stockNum;
      updatePayload.stock_status = stockNum > 0 ? "instock" : "outofstock";
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
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to update product.",
    });
  }
};

/**
 * Permanently Delete Product from WooCommerce Catalog
 */
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required.",
      });
    }

    const response = await api.delete(`products/${encodeURIComponent(id)}`, {
      params: { force: true },
    });

    res.json({
      success: true,
      message: `Product #${id} permanently deleted from store catalog.`,
      product: response.data,
    });
  } catch (error) {
    console.error("Delete product error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to delete product.",
    });
  }
};

/**
 * Upload Product Image to WordPress Media Library
 */
export const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided.",
      });
    }

    const { originalname, buffer, mimetype } = req.file;

    const wpUrl = `${process.env.WORDPRESS_URL}/wp-json/wp/v2/media`;
    const authHeader = Buffer.from(
      `${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`
    ).toString("base64");

    const wpRes = await axios.post(wpUrl, buffer, {
      headers: {
        "Content-Type": mimetype,
        "Content-Disposition": `attachment; filename="${originalname}"`,
        Authorization: `Basic ${authHeader}`,
      },
      httpsAgent,
      timeout: 15000,
    });

    res.json({
      success: true,
      url: wpRes.data?.source_url || wpRes.data?.guid?.rendered,
      id: wpRes.data?.id,
    });
  } catch (error) {
    console.error("Upload image error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to upload image to WordPress.",
    });
  }
};

/**
 * Create New Product
 */
export const createProduct = async (req, res) => {
  try {
    const { name, regular_price, sale_price, stock_quantity, category_ids, image_url, description } = req.body;

    if (!name || regular_price === undefined || regular_price === null || regular_price === "") {
      return res.status(400).json({
        success: false,
        message: "Product name and regular price are required.",
      });
    }

    const validationError = validateProductInput({
      name,
      regular_price,
      sale_price,
      stock_quantity,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const finalStock =
      stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== ""
        ? Number(stock_quantity)
        : 10;

    const payload = {
      name: name.trim(),
      type: "simple",
      regular_price: String(regular_price),
      sale_price: sale_price ? String(sale_price) : "",
      description: description || "",
      manage_stock: true,
      stock_quantity: finalStock,
      stock_status: finalStock > 0 ? "instock" : "outofstock",
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
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to create product.",
    });
  }
};

/**
 * Customer Directory with Aggregated Lifetime Value
 */
/**
 * Customer Directory with Aggregated Lifetime Value & Order History
 */
export const getAdminCustomers = async (req, res) => {
  try {
    const { search, page = 1, per_page = 20 } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));

    // Fetch orders to aggregate customer lifetime spend and past purchases
    const ordersRes = await api.get("orders", {
      per_page: 100,
      orderby: "date",
      order: "desc",
    });

    const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
    const customerMap = new Map();

    orders.forEach((o) => {
      const email = (o.billing?.email || "").trim().toLowerCase();
      const customerId = o.customer_id || email || `guest-${o.id}`;
      const mapKey = email || String(customerId);
      if (!mapKey) return;

      const orderTotal = Number(o.total) || 0;
      const customerName =
        `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() ||
        o.shipping?.first_name ||
        "Valued Customer";
      const phone = o.billing?.phone || o.shipping?.phone || "";
      const address = `${o.billing?.address_1 || ""}${
        o.billing?.address_2 ? ", " + o.billing.address_2 : ""
      }, ${o.billing?.city || ""}, ${o.billing?.state || ""} - ${
        o.billing?.postcode || ""
      }`.replace(/^, |, $/g, "").trim() || "Vasai, Maharashtra";

      const orderSummary = {
        id: o.id,
        order_number: o.number || String(o.id),
        date: o.date_created,
        total: o.total,
        status: o.status,
        payment_method: o.payment_method_title || "Cash on Delivery",
        items_count: o.line_items?.length || 0,
      };

      if (!customerMap.has(mapKey)) {
        customerMap.set(mapKey, {
          id: customerId,
          email: email || "N/A",
          name: customerName,
          phone,
          location: o.billing?.city ? `${o.billing.city}, ${o.billing.state || "Maharashtra"}` : "Vasai, Maharashtra",
          full_address: address,
          ordersCount: 1,
          lifetimeSpent: orderTotal,
          lastOrderDate: o.date_created,
          lastOrderId: o.id,
          orders: [orderSummary],
        });
      } else {
        const existing = customerMap.get(mapKey);
        existing.ordersCount += 1;
        existing.lifetimeSpent += orderTotal;
        existing.orders.push(orderSummary);

        if (new Date(o.date_created) > new Date(existing.lastOrderDate)) {
          existing.lastOrderDate = o.date_created;
          existing.lastOrderId = o.id;
        }
      }
    });

    let customerList = Array.from(customerMap.values()).map((c) => ({
      ...c,
      lifetimeSpent: Math.round(c.lifetimeSpent),
    }));

    // Server-side null-safe search
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      customerList = customerList.filter((c) => {
        const name = (c.name || "").toLowerCase();
        const email = (c.email || "").toLowerCase();
        const phone = String(c.phone || "");
        const loc = (c.location || "").toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q) || loc.includes(q);
      });
    }

    const totalCustomers = customerList.length;
    const totalPages = Math.ceil(totalCustomers / limit) || 1;
    const paginatedCustomers = customerList.slice((pageNum - 1) * limit, pageNum * limit);

    res.json({
      success: true,
      page: pageNum,
      per_page: limit,
      total: totalCustomers,
      totalPages,
      count: paginatedCustomers.length,
      customers: paginatedCustomers,
    });
  } catch (error) {
    console.error("Get admin customers error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load customers.",
      customers: [],
    });
  }
};

/**
 * Dedicated Store Analytics & Deep Reporting
 */
export const getAdminAnalytics = async (req, res) => {
  try {
    const ordersRes = await api.get("orders", {
      per_page: 100,
      orderby: "date",
      order: "desc",
    });

    const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];

    let totalRevenue = 0;
    let completedRevenue = 0;
    let shippingRevenue = 0;
    let discountTotal = 0;

    let completedOrders = 0;
    let processingOrders = 0;
    let outForDeliveryOrders = 0;
    let cancelledOrders = 0;
    let refundedOrders = 0;
    let otherOrders = 0;

    let codCount = 0;
    let codRevenue = 0;
    let onlineCount = 0;
    let onlineRevenue = 0;

    const productSalesMap = new Map();
    const customerSalesMap = new Map();
    const dailyRevenueMap = new Map();

    // Prepare last 7 days daily buckets
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split("T")[0];
      const dayName = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
      dailyRevenueMap.set(dateKey, { date: dateKey, day: dayName, sales: 0, orders: 0 });
    }

    orders.forEach((o) => {
      const orderTotal = Number(o.total) || 0;
      const orderShipping = Number(o.shipping_total) || 0;
      const orderDiscount = Number(o.discount_total) || 0;
      const paymentMethod = (o.payment_method_title || o.payment_method || "").toLowerCase();
      const status = o.status;
      const deliveryMeta = o.meta_data?.find((m) => m.key === "_delivery_status");
      const effectiveStatus = deliveryMeta?.value || status;

      totalRevenue += orderTotal;
      shippingRevenue += orderShipping;
      discountTotal += orderDiscount;

      // Status aggregation
      if (effectiveStatus === "completed") {
        completedOrders++;
        completedRevenue += orderTotal;
      } else if (effectiveStatus === "out-for-delivery" || effectiveStatus === "dispatched") {
        outForDeliveryOrders++;
      } else if (effectiveStatus === "processing") {
        processingOrders++;
      } else if (effectiveStatus === "cancelled" || effectiveStatus === "failed") {
        cancelledOrders++;
      } else if (effectiveStatus === "refunded") {
        refundedOrders++;
      } else {
        otherOrders++;
      }

      // Payment aggregation
      if (paymentMethod.includes("cod") || paymentMethod.includes("cash")) {
        codCount++;
        codRevenue += orderTotal;
      } else {
        onlineCount++;
        onlineRevenue += orderTotal;
      }

      // Daily trend
      if (o.date_created) {
        const orderDate = o.date_created.split("T")[0];
        if (dailyRevenueMap.has(orderDate)) {
          const entry = dailyRevenueMap.get(orderDate);
          entry.sales += orderTotal;
          entry.orders += 1;
        }
      }

      // Product sales aggregation
      (o.line_items || []).forEach((item) => {
        const pId = item.product_id || item.id;
        const pName = item.name || "Product";
        const qty = Number(item.quantity) || 1;
        const itemTotal = Number(item.total) || 0;
        const pImage = item.image?.src || null;

        if (!productSalesMap.has(pId)) {
          productSalesMap.set(pId, {
            id: pId,
            name: pName,
            totalQuantitySold: qty,
            totalRevenue: itemTotal,
            image: pImage,
          });
        } else {
          const existing = productSalesMap.get(pId);
          existing.totalQuantitySold += qty;
          existing.totalRevenue += itemTotal;
          if (!existing.image && pImage) existing.image = pImage;
        }
      });

      // Customer sales aggregation
      const email = (o.billing?.email || "").trim().toLowerCase();
      if (email) {
        const custName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || email;
        const custPhone = o.billing?.phone || "";

        if (!customerSalesMap.has(email)) {
          customerSalesMap.set(email, {
            email,
            name: custName,
            phone: custPhone,
            ordersCount: 1,
            lifetimeSpent: orderTotal,
          });
        } else {
          const existing = customerSalesMap.get(email);
          existing.ordersCount += 1;
          existing.lifetimeSpent += orderTotal;
        }
      }
    });

    const activeOrders = orders.length - cancelledOrders - refundedOrders;
    const avgOrderValue = activeOrders > 0 ? Math.round(totalRevenue / activeOrders) : 0;

    // Top selling products sorted by quantity sold & revenue
    const topProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.totalQuantitySold - a.totalQuantitySold || b.totalRevenue - a.totalRevenue)
      .slice(0, 5);

    // Top customers sorted by lifetime spend
    const topCustomers = Array.from(customerSalesMap.values())
      .sort((a, b) => b.lifetimeSpent - a.lifetimeSpent)
      .slice(0, 5)
      .map((c) => ({
        ...c,
        lifetimeSpent: Math.round(c.lifetimeSpent),
      }));

    const repeatCustomersCount = Array.from(customerSalesMap.values()).filter((c) => c.ordersCount > 1).length;
    const repeatRate = customerSalesMap.size > 0 ? Math.round((repeatCustomersCount / customerSalesMap.size) * 100) : 0;

    res.json({
      success: true,
      data: {
        revenue: {
          totalRevenue: Math.round(totalRevenue),
          completedRevenue: Math.round(completedRevenue),
          shippingRevenue: Math.round(shippingRevenue),
          discountTotal: Math.round(discountTotal),
          avgOrderValue,
          dailyTrend: Array.from(dailyRevenueMap.values()),
        },
        orders: {
          total: orders.length,
          completed: completedOrders,
          processing: processingOrders,
          outForDelivery: outForDeliveryOrders,
          cancelled: cancelledOrders,
          refunded: refundedOrders,
          fulfillmentRate: orders.length > 0 ? Math.round((completedOrders / orders.length) * 100) : 100,
        },
        payments: {
          cod: {
            count: codCount,
            revenue: Math.round(codRevenue),
            percentage: orders.length > 0 ? Math.round((codCount / orders.length) * 100) : 0,
          },
          online: {
            count: onlineCount,
            revenue: Math.round(onlineRevenue),
            percentage: orders.length > 0 ? Math.round((onlineCount / orders.length) * 100) : 0,
          },
        },
        topProducts,
        topCustomers,
        customerMetrics: {
          totalUniqueCustomers: customerSalesMap.size,
          repeatCustomerRate: repeatRate,
        },
      },
    });
  } catch (error) {
    console.error("Get admin analytics error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load analytics.",
    });
  }
};
