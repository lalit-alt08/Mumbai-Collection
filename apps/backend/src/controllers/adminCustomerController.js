import api from "../config/woocommerce.js";
import { serverCache } from "../utils/memoryCache.js";

/**
 * Fetch all WooCommerce orders using server-side pagination (H5 fix).
 * Caps at 20 pages (2 000 orders max) to avoid runaway loops.
 */
async function fetchAllOrders() {
  const perPage = 100;
  const maxPages = 20;
  let page = 1;
  const allOrders = [];

  while (page <= maxPages) {
    const res = await api.get("orders", {
      per_page: perPage,
      page,
      orderby: "date",
      order: "desc",
    });

    const batch = Array.isArray(res.data) ? res.data : [];
    allOrders.push(...batch);

    const totalPages = Number(res.headers?.["x-wp-totalpages"]) || 1;
    if (page >= totalPages || batch.length === 0) break;
    page += 1;
  }

  return allOrders;
}

/**
 * Customer Directory with Aggregated Lifetime Value & Order History
 */
export const getAdminCustomers = async (req, res) => {
  try {
    const { search, page = 1, per_page = 20 } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));

    // Fetch orders via coalesced cache (120s TTL) to prevent repeated 20-page scans
    const orders = await serverCache.getOrFetch(
      "admin:customers:orders",
      fetchAllOrders,
      120000
    );
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
