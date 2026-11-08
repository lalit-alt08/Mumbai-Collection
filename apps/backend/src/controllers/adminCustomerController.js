import { getVerifiedStoreTimezone } from "../services/storeHoursService.js";
import api from "../config/woocommerce.js";
import wp from "../services/wordpress.js";
import { serverCache } from "../utils/memoryCache.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { logError, logger } from "../utils/logger.js";
import { fetchRazorpayPayment, fetchRazorpayOrder } from "../services/razorpayService.js";
import { findWcOrderByRazorpayOrderId } from "../services/paymentIntentService.js";

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

function parseLocalInTimezone(localIso, timeZone) {
  const tz = timeZone || getVerifiedStoreTimezone();
  if (!tz) return null;

  if (/^[+-]\d{2}(?::?\d{2})?$/.test(tz)) {
    const formattedTz = tz.includes(":") ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`;
    const d = new Date(`${localIso}${formattedTz}`);
    return isNaN(d.getTime()) ? null : d;
  }

  const [datePart, timePart = "00:00:00"] = localIso.split("T");
  if (!datePart) return null;
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm, ss = 0] = timePart.split(":").map(Number);
  if (!y || !m || !d) return null;

  const utcGuess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  if (isNaN(utcGuess.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(utcGuess);

    const p = {};
    for (const part of parts) p[part.type] = part.value;
    const pHour = p.hour === "24" ? 0 : Number(p.hour);
    const tzAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), pHour, Number(p.minute), Number(p.second));
    const offsetMs = tzAsUtc - utcGuess.getTime();
    return new Date(utcGuess.getTime() - offsetMs);
  } catch {
    return null;
  }
}

function normalizeCustomerOrderDate(dateGmt, dateLocal) {
  if (dateGmt && typeof dateGmt === "string") {
    const trimmed = dateGmt.trim();
    if (trimmed) {
      const candidate = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
      const d = new Date(candidate);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  if (dateLocal && typeof dateLocal === "string") {
    const trimmed = dateLocal.trim();
    if (trimmed) {
      if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(trimmed)) {
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) return d.toISOString();
      } else {
        const storeTz = getVerifiedStoreTimezone();
        const d = parseLocalInTimezone(trimmed, storeTz);
        if (d && !isNaN(d.getTime())) return d.toISOString();
      }
    }
  }
  return "";
}

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

      if (!Array.isArray(wcRes?.data)) {
        throw new Error("Invalid response received from WooCommerce orders API.");
      }
      rawOrders = wcRes.data;
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
        date: normalizeCustomerOrderDate(o.date_created_gmt, o.date_created),
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

/**
 * Read-only recent payments lookup for a specific registered customer.
 * Queries indexed wp_mumbai_payment_intents (max 10 recent rows).
 */
export const getAdminCustomerPayments = async (req, res) => {
  try {
    const customerId = Number(req.params?.id);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, message: "A valid customer ID is required." });
    }

    try {
      const response = await wp.get(`/wp-json/mumbai-auth/v1/admin/customers/${customerId}/payments`, {
        headers: { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY },
        timeout: 8000,
      });

      if (response.data?.success && Array.isArray(response.data.payments)) {
        res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
        return res.json(response.data);
      }
      throw new Error("Invalid response received from payments service.");
    } catch (wpErr) {
      logger.warn(
        { customerId, err: wpErr.message, status: wpErr.response?.status },
        "[AdminCustomerPayments] Direct payments query failed or unavailable"
      );
      const statusCode = wpErr.response?.status === 503 ? 503 : 503;
      return res.status(statusCode).json({
        success: false,
        message: "Payment lookup unavailable",
        payments: [],
      });
    }
  } catch (error) {
    logError(req, error, "Get admin customer payments error");
    return res.status(error.response?.status || 500).json({
      success: false,
      message: "Payment lookup unavailable",
      payments: [],
    });
  }
};

/**
 * Validates that an order payload returned by WooCommerce is well-formed
 * and that its Razorpay order or transaction ID matches the payment being checked.
 */
function verifyStoredOrderMatchesPayment(wcOrder, rzpData, localPayment) {
  if (!wcOrder || typeof wcOrder !== "object" || Array.isArray(wcOrder)) {
    return { valid: false, matches: false, status: "unavailable" };
  }
  const orderId = wcOrder.id || wcOrder.number;
  if (!orderId) {
    return { valid: false, matches: false, status: "unavailable" };
  }

  // Expected IDs from the payment being checked
  const isPayment = String(rzpData?.id || "").startsWith("pay_");
  const expectedRzpOrderId = isPayment
    ? String(rzpData.order_id || localPayment?.rzp_order_id || "").trim()
    : String(rzpData?.id || localPayment?.rzp_order_id || "").trim();

  const expectedRzpPaymentId = isPayment
    ? String(rzpData.id || "").trim()
    : String(localPayment?.rzp_payment_id || "").trim();

  // Extract Razorpay IDs from WooCommerce order meta_data and properties
  const meta = Array.isArray(wcOrder.meta_data) ? wcOrder.meta_data : [];
  const getMeta = (key) => meta.find((m) => m && m.key === key)?.value;

  const orderRzpOrderId = String(
    wcOrder._razorpay_order_id ||
    wcOrder.razorpay_order_id ||
    wcOrder.rzp_order_id ||
    getMeta("_razorpay_order_id") ||
    getMeta("razorpay_order_id") ||
    ""
  ).trim();

  const orderTransactionId = String(
    wcOrder.transaction_id ||
    wcOrder._razorpay_payment_id ||
    wcOrder.razorpay_payment_id ||
    wcOrder.rzp_payment_id ||
    getMeta("_razorpay_payment_id") ||
    getMeta("razorpay_payment_id") ||
    ""
  ).trim();

  // Missing references: if stored order has neither reference, we cannot verify it
  if (!orderRzpOrderId && !orderTransactionId) {
    return { valid: true, matches: false, status: "unavailable" };
  }

  // Check for conflicting references: if both specify an order or transaction ID,
  // but they differ, treat missing or conflicting references as unavailable.
  const hasOrderConflict = Boolean(
    expectedRzpOrderId && orderRzpOrderId && expectedRzpOrderId !== orderRzpOrderId
  );
  const hasTxnConflict = Boolean(
    expectedRzpPaymentId && orderTransactionId && expectedRzpPaymentId !== orderTransactionId
  );

  if (hasOrderConflict || hasTxnConflict) {
    return { valid: true, matches: false, status: "unavailable" };
  }

  const matches = Boolean(
    (expectedRzpOrderId && orderRzpOrderId && expectedRzpOrderId === orderRzpOrderId) ||
    (expectedRzpPaymentId && orderTransactionId && expectedRzpPaymentId === orderTransactionId)
  );

  if (!matches) {
    return { valid: true, matches: false, status: "unavailable" };
  }

  return {
    valid: true,
    matches: true,
    status: "matched",
    orderId,
    customerId: wcOrder.customer_id,
  };
}

/**
 * Exact reference lookup (order_... or pay_...) for store staff.
 * Checks local payment records; when live=true, executes an authoritative gateway lookup,
 * refreshes status, and verifies WooCommerce order existence separately.
 * Strictly read-only: never creates WooCommerce orders, never executes reconciliations or refunds.
 */
export const lookupAdminPaymentReference = async (req, res) => {
  try {
    const ref = String(req.query?.ref || "").trim();
    const live = req.query?.live === "1" || req.query?.live === "true";

    if (!ref) {
      return res.status(400).json({ success: false, message: "Payment reference (ref) is required." });
    }

    // 1. Check local payment intents table
    let localFound = false;
    let localPayment = null;
    let localAvailable = true;

    try {
      const response = await wp.get("/wp-json/mumbai-auth/v1/admin/payments/lookup", {
        params: { ref },
        headers: { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY },
        timeout: 8000,
      });

      if (response.data?.success) {
        if (response.data.found && response.data.payment) {
          localFound = true;
          localPayment = response.data.payment;
        }
      } else {
        localAvailable = false;
      }
    } catch (wpErr) {
      localAvailable = false;
      logger.warn({ ref, err: wpErr.message }, "[AdminCustomerPayments] Local payment lookup failed");
    }

    // When NOT in live mode, return local results directly
    if (!live) {
      if (localFound) {
        res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
        return res.json({
          success: true,
          found: true,
          source: "local",
          payment: localPayment,
        });
      }

      if (!localAvailable) {
        return res.status(503).json({
          success: false,
          found: false,
          payment: null,
          message: "Payment lookup unavailable",
        });
      }

      res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
      return res.json({
        success: true,
        found: false,
        payment: null,
        message: "No matching payment record found",
      });
    }

    // 2. LIVE GATEWAY CHECK: Do not skip Razorpay!
    let gatewayChecked = false;
    let gatewayFound = false;
    let gatewayError = null;
    let rzpData = null;

    if (ref.startsWith("order_") || ref.startsWith("pay_")) {
      gatewayChecked = true;
      try {
        if (ref.startsWith("order_")) {
          rzpData = await fetchRazorpayOrder(ref);
        } else {
          rzpData = await fetchRazorpayPayment(ref);
        }

        if (rzpData && rzpData.id) {
          gatewayFound = true;
        }
      } catch (gatewayErr) {
        const is404 =
          gatewayErr?.statusCode === 404 ||
          gatewayErr?.response?.status === 404 ||
          gatewayErr?.error?.code === "BAD_REQUEST_ERROR";
        if (is404) {
          gatewayFound = false;
        } else {
          gatewayError = gatewayErr;
          logger.warn({ ref, err: gatewayErr.message }, "[AdminCustomerPayments] Gateway lookup failed with error");
        }
      }
    }

    // Gateway outage / failure during live check -> Payment lookup unavailable
    if (gatewayError) {
      return res.status(503).json({
        success: false,
        found: false,
        payment: null,
        message: "Payment lookup unavailable",
      });
    }

    // If payment/order found at gateway, refresh status & verify order existence separately
    if (gatewayFound && rzpData) {
      const isPayment = rzpData.id.startsWith("pay_");
      const amountPaise = Number(rzpData.amount || 0);
      const capturedPaise = isPayment
        ? (rzpData.status === "captured" ? amountPaise : (Number(rzpData.amount_refunded || 0) > 0 ? amountPaise : 0))
        : Number(rzpData.amount_paid || 0);
      const status = String(rzpData.status || "");
      const isCaptured = status === "captured" || status === "paid" || (capturedPaise > 0 && capturedPaise >= amountPaise);

      // Verify WooCommerce order existence separately
      let orderVerification = { checked: false, orderFound: false, wcOrderId: null, customerId: null };
      if (isCaptured) {
        const targetRzpOrderId = isPayment ? (rzpData.order_id || null) : rzpData.id;
        if (targetRzpOrderId) {
          try {
            const matchedOrder = await findWcOrderByRazorpayOrderId(targetRzpOrderId);
            orderVerification.checked = true;
            if (matchedOrder && (matchedOrder.id || matchedOrder.number)) {
              orderVerification.orderFound = true;
              orderVerification.wcOrderId = matchedOrder.number || matchedOrder.id;
              orderVerification.customerId = matchedOrder.customer_id;
            } else if (localPayment?.wc_order_id) {
              // Not matched by RZP order ID in HPOS table, but local record has a stored wc_order_id:
              // Verify the stored WooCommerce order ID directly before reporting a live result.
              try {
                const wcRes = await api.get(`orders/${localPayment.wc_order_id}`);
                const verified = verifyStoredOrderMatchesPayment(wcRes?.data, rzpData, localPayment);
                if (!verified.valid || verified.status === "unavailable") {
                  orderVerification.checked = false;
                  orderVerification.orderFound = false;
                } else if (verified.matches) {
                  orderVerification.checked = true;
                  orderVerification.orderFound = true;
                  orderVerification.wcOrderId = verified.orderId;
                  orderVerification.customerId = verified.customerId;
                } else {
                  orderVerification.checked = true;
                  orderVerification.orderFound = false;
                }
              } catch (wcErr) {
                if (wcErr.response?.status === 404) {
                  orderVerification.orderFound = false;
                } else {
                  logger.warn({ ref, wcOrderId: localPayment.wc_order_id, err: wcErr.message }, "[AdminCustomerPayments] Failed to verify stored WooCommerce order existence");
                  orderVerification.checked = false;
                  orderVerification.orderFound = false;
                }
              }
            } else {
              orderVerification.orderFound = false;
            }
          } catch (wcErr) {
            logger.warn({ ref, targetRzpOrderId, err: wcErr.message }, "[AdminCustomerPayments] Failed to verify WooCommerce order existence");
            orderVerification.checked = false;
            orderVerification.orderFound = false;
          }
        } else if (localPayment?.wc_order_id) {
          // Direct payment with stored local order ID: verify before reporting a live result
          try {
            const wcRes = await api.get(`orders/${localPayment.wc_order_id}`);
            const verified = verifyStoredOrderMatchesPayment(wcRes?.data, rzpData, localPayment);
            if (!verified.valid || verified.status === "unavailable") {
              orderVerification.checked = false;
              orderVerification.orderFound = false;
            } else if (verified.matches) {
              orderVerification.checked = true;
              orderVerification.orderFound = true;
              orderVerification.wcOrderId = verified.orderId;
              orderVerification.customerId = verified.customerId;
            } else {
              orderVerification.checked = true;
              orderVerification.orderFound = false;
            }
          } catch (wcErr) {
            if (wcErr.response?.status === 404) {
              orderVerification.checked = true;
              orderVerification.orderFound = false;
            } else {
              logger.warn({ ref, wcOrderId: localPayment.wc_order_id, err: wcErr.message }, "[AdminCustomerPayments] Failed to verify stored WooCommerce order existence");
              orderVerification.checked = false;
              orderVerification.orderFound = false;
            }
          }
        } else {
          // Direct payment without Razorpay order association and without local wc_order_id:
          // Order check cannot be performed against WooCommerce, so order verification is unavailable
          orderVerification.checked = false;
          orderVerification.orderFound = false;
        }
      }

      let outcome_label = "Payment capture not confirmed";
      let outcome_type = "unconfirmed";

      const refundedPaise = Number(rzpData.amount_refunded || 0);
      const formatPaiseAmount = (paise) => {
        const num = Number(paise || 0);
        const rupees = num / 100;
        return Number.isInteger(rupees)
          ? rupees.toLocaleString("en-IN")
          : rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };
      const isPartiallyRefunded = rzpData.refund_status === "partial" || (refundedPaise > 0 && refundedPaise < amountPaise);

      if (status === "refunded" || rzpData.refund_status === "full" || (amountPaise > 0 && refundedPaise >= amountPaise)) {
        outcome_label = "Refunded";
        outcome_type = "refunded";
      } else if (isPartiallyRefunded) {
        outcome_label = refundedPaise > 0 ? `Partially refunded · ₹${formatPaiseAmount(refundedPaise)}` : "Partially refunded";
        outcome_type = "partially_refunded";
      } else if (status === "refund_pending") {
        outcome_label = "Refund pending";
        outcome_type = "refund_pending";
      } else if (isCaptured) {
        if (orderVerification.orderFound && orderVerification.wcOrderId) {
          outcome_label = `Order created · #${orderVerification.wcOrderId}`;
          outcome_type = "order_created";
        } else if (orderVerification.checked && !orderVerification.orderFound) {
          outcome_label = "Payment captured · Order not created yet";
          outcome_type = "captured_no_order";
        } else {
          // If order existence could not be verified due to DB/network failure
          outcome_label = "Payment captured · Order verification unavailable";
          outcome_type = "captured_order_unverified";
        }
      } else if (status === "failed") {
        outcome_label = "Payment capture not confirmed";
        outcome_type = "failed";
      }

      const localUserId = localPayment?.user_id ? Number(localPayment.user_id) : null;
      const orderCustomerId = orderVerification.customerId ? Number(orderVerification.customerId) : null;
      const hasCustomerConflict = Boolean(localUserId && orderCustomerId && localUserId !== orderCustomerId);

      res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
      return res.json({
        success: true,
        found: true,
        source: "gateway",
        payment: {
          rzp_order_id: isPayment ? (rzpData.order_id || "") : rzpData.id,
          rzp_payment_id: isPayment ? rzpData.id : "",
          user_id: hasCustomerConflict ? null : (localUserId || orderCustomerId || null),
          customer_conflict: hasCustomerConflict,
          payment_customer_id: localUserId,
          order_customer_id: orderCustomerId,
          amount: Math.round(amountPaise / 100),
          amount_paise: amountPaise,
          captured_amount_paise: capturedPaise,
          refunded_amount: Number((refundedPaise / 100).toFixed(2)),
          refunded_amount_paise: refundedPaise,
          status,
          wc_order_id: (orderVerification.orderFound && orderVerification.wcOrderId) ? orderVerification.wcOrderId : null,
          outcome_label,
          outcome_type,
          date: rzpData.created_at ? new Date(rzpData.created_at * 1000).toISOString() : new Date().toISOString(),
        },
      });
    }

    // Gateway did not find record (or ref wasn't gateway format), but local record exists
    if (localFound) {
      res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
      return res.json({
        success: true,
        found: true,
        source: "local",
        payment: localPayment,
      });
    }

    // If local was unavailable and gateway didn't match / couldn't confirm
    if (!localAvailable) {
      return res.status(503).json({
        success: false,
        found: false,
        payment: null,
        message: "Payment lookup unavailable",
      });
    }

    res.set?.("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.json({
      success: true,
      found: false,
      payment: null,
      message: "No matching payment record found",
    });
  } catch (error) {
    logError(req, error, "Lookup payment reference error");
    return res.status(500).json({
      success: false,
      found: false,
      payment: null,
      message: "Payment lookup unavailable",
    });
  }
};
