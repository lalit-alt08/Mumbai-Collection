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
  "pending",
  "refunded",
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
 * Filters out trash orders.
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

  // 2. Fetch non-trash orders
  const orders = await fetchAllOrders();

  // Map registered customers by ID and email
  const customerMap = new Map();
  const emailToIdMap = new Map();

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
    if (email) {
      emailToIdMap.set(email, userId);
    }
  }

  // Reconcile WooCommerce orders with registered customers
  for (const o of orders) {
    if (o.status === "trash") continue;

    const rawCustId = Number(o.customer_id);
    const email = (o.billing?.email || "").trim().toLowerCase();
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
    } else if (email && emailToIdMap.has(email)) {
      matchedUser = customerMap.get(emailToIdMap.get(email));
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

  return Array.from(customerMap.values()).map((c) => ({
    ...c,
    lifetimeSpent: Math.round(c.lifetimeSpent),
  }));
}

/**
 * Customer Directory with Registered Customer Primary Population,
 * Lifetime Value Aggregation, & Order Reconciliation
 */
export const getAdminCustomers = async (req, res) => {
  try {
    const { search, location, page = 1, per_page = 20 } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limit = Math.min(100, Math.max(1, Number(per_page) || 20));

    // Get aggregated directory from coalesced cache (120s TTL)
    let customerList = await serverCache.getOrFetch(
      "admin:customers:directory",
      buildAggregatedCustomerDirectory,
      120000
    );

    // Server-side null-safe search across name, email, phone, location, address
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      customerList = customerList.filter((c) => {
        const name = (c.name || "").toLowerCase();
        const email = (c.email || "").toLowerCase();
        const phone = String(c.phone || "");
        const loc = (c.location || "").toLowerCase();
        const addr = (c.full_address || "").toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q) || loc.includes(q) || addr.includes(q);
      });
    }

    // Location facet filter
    if (location && location !== "all") {
      customerList = customerList.filter((customer) => matchesCustomerLocation(customer, location));
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
    logError(req, error, "Get admin customers error");
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to load customers.",
      customers: [],
    });
  }
};
