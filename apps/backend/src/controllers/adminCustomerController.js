import api from "../config/woocommerce.js";
import wp from "../services/wordpress.js";
import { serverCache } from "../utils/memoryCache.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { logError, logger } from "../utils/logger.js";

const VALID_REVENUE_STATUSES = [
  "completed",
  "processing",
  "dispatched",
  "out-for-delivery",
  "out_for_delivery",
  "delivered",
  "on-hold",
];

const CUSTOMER_LOCATION_KEYWORDS = {
  "vasai-east": ["vasai east", "vasai (e)", "vasai-east", "evershine", "navghar", "401202", "401208"],
  "vasai-west": ["vasai west", "vasai (w)", "vasai-west", "chulna", "babola", "ambadi", "401201"],
  "nallasopara-east": ["nallasopara east", "nalasopara east", "nallasopara (e)", "nalasopara (e)", "achole", "moregaon", "401209"],
  "nalasopara-east": ["nallasopara east", "nalasopara east", "nallasopara (e)", "nalasopara (e)", "achole", "moregaon", "401209"],
  "nallasopara-west": ["nallasopara west", "nalasopara west", "nallasopara (w)", "nalasopara (w)", "sopara west", "patankar", "401203"],
  "nalasopara-west": ["nallasopara west", "nalasopara west", "nallasopara (w)", "nalasopara (w)", "sopara west", "patankar", "401203"],
};

const matchesCustomerLocation = (customer, location) => {
  const keywords = CUSTOMER_LOCATION_KEYWORDS[String(location || "").trim().toLowerCase()];
  if (!keywords) return true;
  const haystack = `${customer.location || ""} ${customer.full_address || ""}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
};

/**
 * Fetch registered WordPress customers via internal REST API.
 * Cached in-memory (60s TTL).
 */
async function fetchRegisteredCustomers() {
  try {
    const response = await wp.get("/wp-json/mumbai-auth/v1/admin/customers", {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
      },
      timeout: 7000,
    });
    return Array.isArray(response.data?.customers) ? response.data.customers : [];
  } catch (err) {
    logger.warn({ err: err.message }, "[AdminCustomers] Failed to fetch registered customers from WP");
    return [];
  }
}

/**
 * Fetch all WooCommerce orders using server-side pagination (H5 fix).
 * Caps at 20 pages (2 000 orders max) to avoid runaway loops.
 * Filters out trash orders. Used as fallback if direct SQL aggregate endpoint is offline.
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
    const nonTrash = batch.filter((o) => o.status !== "trash");
    allOrders.push(...nonTrash);

    const totalPages = Number(res.headers?.["x-wp-totalpages"]) || 1;
    if (page >= totalPages || batch.length === 0) break;
    page += 1;
  }

  return allOrders;
}

/**
 * Build the reconciled customer directory with aggregated Lifetime Value (LTV),
 * order counts, and registered customer profile records.
 * Cached globally (120s TTL) so search/pagination queries don't re-scan raw orders.
 */
async function buildAggregatedCustomerDirectory() {
  // 1. Fetch registered customer accounts (authoritative population)
  const registeredCustomers = await fetchRegisteredCustomers();

  // Map registered customers by ID and email
  const customerMap = new Map();

  for (const u of registeredCustomers) {
    const userId = Number(u.id);
    const email = (u.email || "").trim().toLowerCase();

    const record = {
      id: userId,
      email: email || "N/A",
      name: formatCustomerDisplayName(u.first_name, u.last_name, u.name || "Customer"),
      first_name: u.first_name || "",
      last_name: u.last_name || "",
      phone: u.phone || "",
      secondary_phone: u.secondary_phone || "",
      location: u.location || "Vasai, Maharashtra",
      full_address: u.full_address || "Vasai, Maharashtra",
      registered_at: u.registered_at || null,
      ordersCount: 0,
      lifetimeSpent: 0,
      lastOrderDate: null,
      lastOrderId: null,
      orders: [],
    };

    customerMap.set(userId, record);
  }

  // 2. Fast HPOS direct SQL customer LTV aggregations
  let sqlAggregated = false;
  try {
    const ltvRes = await wp.get("/wp-json/mumbai-auth/v1/admin/analytics-summary", {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
      },
      params: { type: "customer_ltv" },
      timeout: 7000,
    });

    if (ltvRes.data?.success && Array.isArray(ltvRes.data.customer_ltv)) {
      sqlAggregated = true;
      for (const row of ltvRes.data.customer_ltv) {
        const rawCustId = Number(row.customer_id);
        let matchedUser = null;
        if (rawCustId > 0 && customerMap.has(rawCustId)) {
          matchedUser = customerMap.get(rawCustId);
        }

        if (matchedUser) {
          matchedUser.ordersCount += Number(row.ordersCount) || 0;
          matchedUser.lifetimeSpent += Number(row.lifetimeSpent) || 0;
          if (!matchedUser.lastOrderDate || new Date(row.lastOrderDate) > new Date(matchedUser.lastOrderDate)) {
            matchedUser.lastOrderDate = row.lastOrderDate;
            matchedUser.lastOrderId = row.lastOrderId;
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, "[AdminCustomers] SQL LTV aggregation failed, falling back to orders fetch");
  }

  // 3. Fallback to fetchAllOrders only if SQL endpoint was unavailable
  if (!sqlAggregated) {
    const orders = await fetchAllOrders();
    for (const o of orders) {
      if (o.status === "trash") continue;

      const rawCustId = Number(o.customer_id);
      const orderTotal = Number(o.total) || 0;

      const orderSummary = {
        id: o.id,
        order_number: o.number || String(o.id),
        date: o.date_created,
        total: o.total,
        status: o.status,
        payment_method: o.payment_method_title || "Cash on Delivery",
        items_count: o.line_items?.length || 0,
      };

      let matchedUser = null;
      if (rawCustId > 0 && customerMap.has(rawCustId)) {
        matchedUser = customerMap.get(rawCustId);
      }

      if (matchedUser) {
        matchedUser.orders.push(orderSummary);
        if (VALID_REVENUE_STATUSES.includes(o.status)) {
          matchedUser.ordersCount += 1;
          matchedUser.lifetimeSpent += orderTotal;
        }
        if (!matchedUser.lastOrderDate || new Date(o.date_created) > new Date(matchedUser.lastOrderDate)) {
          matchedUser.lastOrderDate = o.date_created;
          matchedUser.lastOrderId = o.id;
          if ((!matchedUser.phone || matchedUser.phone === "") && (o.billing?.phone || o.shipping?.phone)) {
            matchedUser.phone = o.billing?.phone || o.shipping?.phone;
          }
        }
      }
    }
  }

  return Array.from(customerMap.values()).map((c) => ({
    ...c,
    lifetimeSpent: Math.round(c.lifetimeSpent),
  }));
}

/**
 * Customer Directory with Registered Customer Primary Population,
 * Database-Level Sorting, Pagination, Lifetime Value Aggregation, & Order Reconciliation
 */
export const getAdminCustomers = async (req, res) => {
  try {
    const { search, location, sort, page = 1, per_page = 20 } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));
    const sortKey = String(sort || "ltv_desc").trim();
    const locKey = String(location || "all").trim();
    const searchKey = String(search || "").trim();

    // Cache per query slice to avoid loading all accounts into RAM
    const cacheKey = `admin:customers:p${pageNum}:l${limit}:s${sortKey}:loc${locKey}:q${searchKey.toLowerCase()}`;

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
              total: Number(response.data.total) || formattedCustomers.length,
              totalPages: Number(response.data.totalPages) || 1,
              count: formattedCustomers.length,
              customers: formattedCustomers,
            };
          }
        } catch (wpErr) {
          logger.warn({ err: wpErr.message }, "[AdminCustomers] Direct SQL endpoint failed, using fallback aggregator");
        }

        // Fallback to in-memory aggregation if direct WP SQL endpoint was unreachable
        let customerList = await buildAggregatedCustomerDirectory();

        if (searchKey) {
          const q = searchKey.toLowerCase();
          customerList = customerList.filter((c) => {
            const name = (c.name || "").toLowerCase();
            const email = (c.email || "").toLowerCase();
            const phone = String(c.phone || "");
            const loc = (c.location || "").toLowerCase();
            const addr = (c.full_address || "").toLowerCase();
            return name.includes(q) || email.includes(q) || phone.includes(q) || loc.includes(q) || addr.includes(q);
          });
        }

        if (locKey && locKey !== "all") {
          customerList = customerList.filter((customer) => matchesCustomerLocation(customer, locKey));
        }

        // Apply sort
        customerList.sort((a, b) => {
          if (sortKey === "ltv_asc") return (a.lifetimeSpent || 0) - (b.lifetimeSpent || 0);
          if (sortKey === "orders_desc") return (b.ordersCount || 0) - (a.ordersCount || 0);
          if (sortKey === "recent") {
            const dateA = a.lastOrderDate ? new Date(a.lastOrderDate).getTime() : 0;
            const dateB = b.lastOrderDate ? new Date(b.lastOrderDate).getTime() : 0;
            return dateB - dateA;
          }
          if (sortKey === "name_asc") {
            return (a.name || "").localeCompare(b.name || "");
          }
          // Default: ltv_desc
          return (b.lifetimeSpent || 0) - (a.lifetimeSpent || 0);
        });

        const totalCustomers = customerList.length;
        const totalPages = Math.ceil(totalCustomers / limit) || 1;
        const paginatedCustomers = customerList.slice((pageNum - 1) * limit, pageNum * limit);

        return {
          success: true,
          page: pageNum,
          per_page: limit,
          total: totalCustomers,
          totalPages,
          count: paginatedCustomers.length,
          customers: paginatedCustomers,
        };
      },
      30000 // 30s TTL per slice
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
    const customerEmail = String(req.query?.email || "").trim().toLowerCase();

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
      logger.warn({ customerId, err: wcErr.message }, "[AdminCustomers] WooCommerce customer orders query error");
    }

    // 3. Secondary fallback for legacy guest orders if customer ID search yielded 0 results and email is provided
    if (rawOrders.length === 0 && customerEmail && page === 1) {
      try {
        const searchRes = await api.get("orders", {
          search: customerEmail,
          page: 1,
          per_page: perPage,
          orderby: "date",
          order: "desc",
        });

        const batch = Array.isArray(searchRes.data) ? searchRes.data : [];
        const matchedOrders = batch.filter((o) => {
          const billingEmail = (o.billing?.email || "").trim().toLowerCase();
          return billingEmail === customerEmail || Number(o.customer_id) === customerId;
        });

        if (matchedOrders.length > 0) {
          rawOrders = matchedOrders;
          totalCount = Number(searchRes.headers?.["x-wp-total"]) || matchedOrders.length;
          totalPages = Number(searchRes.headers?.["x-wp-totalpages"]) || Math.ceil(totalCount / perPage) || 1;
        }
      } catch (searchErr) {
        logger.warn({ customerId, customerEmail, err: searchErr.message }, "[AdminCustomers] Email search fallback error");
      }
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
