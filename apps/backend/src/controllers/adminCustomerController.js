import api from "../config/woocommerce.js";
import wp from "../services/wordpress.js";
import { serverCache } from "../utils/memoryCache.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { logError, logger } from "../utils/logger.js";

/**
 * Customer Directory with Registered Customer Primary Population,
 * Database-Level Sorting, Pagination, Lifetime Value Aggregation, & Order Reconciliation
 */
export const getAdminCustomers = async (req, res) => {
  try {
    const { search, location, sort, page = 1, per_page = 20 } = req.query;
    const forceRefresh = req.query?.refresh === "1" || req.query?.refresh === "true";

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));
    const sortKey = String(sort || "ltv_desc").trim();
    const locKey = String(location || "all").trim();
    const searchKey = String(search || "").trim();

    // Cache each query slice briefly; explicit Refresh gets a unique key to force
    // an authoritative WordPress query rather than reusing a stale cached slice.
    const cacheKey = `admin:customers:p${pageNum}:l${limit}:s${sortKey}:loc${locKey}:q${searchKey.toLowerCase()}${forceRefresh ? `:refresh:${Date.now()}` : ""}`;
    if (forceRefresh) {
      serverCache.invalidatePrefix("admin:customers");
    }

    const data = await serverCache.getOrFetch(
      cacheKey,
      async () => {
        try {
          const response = await wp.get("/wp-json/mumbai-auth/v1/admin/customers", {
            params: {
              page: pageNum,
              per_page: limit,
              sort: sortKey,
              location: locKey !== "all" ? locKey : undefined,
              search: searchKey || undefined,
            },
            headers: {
              "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
            },
            timeout: 8000,
          });

          if (response.data?.success && Array.isArray(response.data.customers)) {
            const formattedCustomers = response.data.customers.map((c) => ({
              ...c,
              name: formatCustomerDisplayName(c.first_name, c.last_name, c.name || "Customer"),
              lifetimeSpent: Math.round(Number(c.lifetimeSpent) || 0),
              ordersCount: Number(c.ordersCount) || 0,
            }));

            return {
              success: true,
              page: Number(response.data.page) || pageNum,
              per_page: Number(response.data.per_page) || limit,
              total: Number.isFinite(Number(response.data.total)) ? Number(response.data.total) : formattedCustomers.length,
              totalPages: Number(response.data.totalPages) || 1,
              count: formattedCustomers.length,
              customers: formattedCustomers,
            };
          }
          throw new Error(response.data?.message || "WordPress returned an invalid customer directory response.");
        } catch (wpErr) {
          logger.error({ err: wpErr.message }, "[AdminCustomers] WordPress customer query failed");
          throw wpErr;
        }
      },
      5000 // Keep cross-instance staleness bounded while limiting repeated WP queries
    );

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }

    res.json(data);
  } catch (error) {
    logError(req, error, "Get admin customers error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load customers.",
      customers: [],
      total: 0,
      totalPages: 1,
    });
  }
};

/** Paginated order history for one customer; avoids truncating history on the directory page. */
export const getAdminCustomerOrders = async (req, res) => {
  try {
    const customerId = Number(req.params?.id);
    const page = Math.max(1, Number(req.query?.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page) || 10));


    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, message: "A valid customer ID is required." });
    }

    // 1. Attempt fast direct SQL query via WordPress internal endpoint
    try {
      const response = await wp.get(`/wp-json/mumbai-auth/v1/admin/customers/${customerId}/orders`, {
        params: { page, per_page: perPage },
        headers: { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY },
        timeout: 8000,
      });
      if (response.data?.success && Array.isArray(response.data.orders)) {
        res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
        return res.json(response.data);
      }
    } catch (wpErr) {
      logger.warn(
        { customerId, err: wpErr.message, status: wpErr.response?.status },
        "[AdminCustomers] Direct SQL orders endpoint failed or unrouted, falling back to WooCommerce REST API"
      );
    }

    // 2. Resilient fallback: Query WooCommerce Core REST API by customer ID
    let rawOrders = [];
    let totalCount = 0;
    let totalPages = 1;

    try {
      const wcRes = await api.get("orders", {
        customer: customerId,
        page,
        per_page: perPage,
        orderby: "date",
        order: "desc",
      });

      rawOrders = Array.isArray(wcRes.data) ? wcRes.data : [];
      totalCount = Number(wcRes.headers?.["x-wp-total"]) || rawOrders.length;
      totalPages = Number(wcRes.headers?.["x-wp-totalpages"]) || Math.ceil(totalCount / perPage) || 1;
    } catch (wcErr) {
      throw wcErr;
    }

    const formattedOrders = rawOrders
      .filter((o) => o.status !== "trash")
      .map((o) => ({
        id: o.id,
        order_number: o.number || String(o.id),
        date: o.date_created_gmt ? new Date(o.date_created_gmt + "Z").toISOString() : o.date_created,
        total: Number(o.total) || 0,
        status: String(o.status || "").replace(/^wc-/, ""),
        payment_method: o.payment_method_title || "Cash on Delivery",
        items: (o.line_items || []).map((item) => ({
          product_id: item.product_id,
          name: item.name,
          quantity: Number(item.quantity) || 1,
          total: Number(item.total) || 0,
        })),
      }));

    res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.json({
      success: true,
      page,
      per_page: perPage,
      total: totalCount,
      totalPages,
      orders: formattedOrders,
    });
  } catch (error) {
    logError(req, error, "Get admin customer order history error");
    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Unable to load this customer's order history.",
      orders: [],
      total: 0,
      totalPages: 1,
    });
  }
};
