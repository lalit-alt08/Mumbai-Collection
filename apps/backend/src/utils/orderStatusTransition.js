/**
 * Shared Order Status Lifecycle & Lock Utilities
 * Enforces authoritative 3-day (72-hour) completion locks and maps quick-commerce
 * dispatch sub-statuses to WooCommerce core order payloads.
 */

export const ALLOWED_ORDER_STATUSES = [
  "pending",
  "processing",
  "packed",
  "out-for-delivery",
  "dispatched",
  "completed",
  "cancelled",
  "failed",
];

/**
 * Resolves the server-provided timestamp representing the actual Delivered/Completed time.
 * Priority:
 * 1. _delivery_completed_at / delivery_completed_at / _delivered_at
 * 2. date_completed_gmt
 * 3. date_completed
 * 4. date_created_gmt
 * 5. date_created
 * NOTE: date_modified is intentionally NOT used because unrelated modifications change it.
 */
export const getOrderDeliveredTimestamp = (order) => {
  if (!order) return null;

  // 1. _delivery_completed_at / delivery_completed_at / _delivered_at
  const metaDelivered =
    order.meta_data?.find((m) => m.key === "_delivery_completed_at")?.value ||
    order.meta_data?.find((m) => m.key === "_delivered_at")?.value ||
    order.delivery_completed_at;

  if (metaDelivered) {
    const t = new Date(metaDelivered).getTime();
    if (!isNaN(t) && t > 0) return t;
  }

  // 2. date_completed_gmt
  if (order.date_completed_gmt) {
    const gmtStr = order.date_completed_gmt.endsWith("Z")
      ? order.date_completed_gmt
      : `${order.date_completed_gmt}Z`;
    const t = new Date(gmtStr).getTime();
    if (!isNaN(t) && t > 0) return t;
  }

  // 3. date_completed
  if (order.date_completed) {
    const t = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(order.date_completed) ? order.date_completed : order.date_completed + "+05:30").getTime();
    if (!isNaN(t) && t > 0) return t;
  }

  // 4. date_created_gmt
  if (order.date_created_gmt) {
    const gmtStr = order.date_created_gmt.endsWith("Z")
      ? order.date_created_gmt
      : `${order.date_created_gmt}Z`;
    const t = new Date(gmtStr).getTime();
    if (!isNaN(t) && t > 0) return t;
  }

  // 5. date_created
  if (order.date_created) {
    const t = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(order.date_created) ? order.date_created : order.date_created + "+05:30").getTime();
    if (!isNaN(t) && t > 0) return t;
  }

  return null;
};

/**
 * Checks whether an order's status change is locked.
 * Rule: Delivered (Completed) orders are locked once 3 days / 72 hours (259,200,000 ms) have elapsed.
 * Fail-closed: Delivered (Completed) orders with no usable timestamp are locked.
 * Non-delivered orders are never locked.
 */
export const isOrderStatusLocked = (order, nowMs = Date.now()) => {
  if (!order) return false;
  const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
  const effectiveStatus = deliveryMeta?.value || order.status;

  if (effectiveStatus !== "completed") {
    return false;
  }

  const deliveredAt = getOrderDeliveredTimestamp(order);
  if (!deliveredAt) {
    // Fail closed: completed order with no usable timestamps is locked
    return true;
  }

  const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000; // 259,200,000 ms (3 days)
  return (nowMs - deliveredAt) >= SEVENTY_TWO_HOURS_MS;
};

/**
 * Checks whether an order is Cash on Delivery (COD).
 */
export const isCodOrder = (order) => {
  if (!order) return false;
  const method = String(order.payment_method || "").trim().toLowerCase();
  const title = String(order.payment_method_title || "").trim().toLowerCase();
  return method === "cod" || title.includes("cash on delivery") || title.includes("cod");
};

/**
 * Determines whether an order is an online order that has not yet received payment.
 * COD orders are never unpaid in this context (collected on delivery).
 * Online orders require a paid date, transaction ID, or explicit payment verification timestamp.
 * A fulfillment status alone does not establish payment.
 */
export const isOnlineOrderUnpaid = (order) => {
  if (!order) return false;
  if (isCodOrder(order)) return false;


  // If order has captured payment indicators, it is paid
  if (order.date_paid) return false;
  if (order.transaction_id && String(order.transaction_id).trim().length > 0) return false;
  if (
    Array.isArray(order.meta_data) &&
    order.meta_data.some(
      (m) =>
        m.key === "_payment_verified_at" &&
        Boolean(m.value)
    )
  ) {
    return false;
  }

  return true;
};

/**
 * Validates whether an order status transition is allowed.
 * Enforces:
 * 1. Target status must be in ALLOWED_ORDER_STATUSES.
 * 2. 72-hour delivery lock on completed orders.
 * 3. Cancelled/refunded orders cannot transition to active fulfillment states.
 * 4. Unpaid online orders cannot transition to active fulfillment or completed states.
 */
export const validateOrderStatusTransition = (currentOrder, targetStatus, nowMs = Date.now()) => {
  if (targetStatus === "refunded") {
    return {
      valid: false,
      message: "Orders cannot be marked refunded through status mutation. Please issue refunds through the payment gateway or WooCommerce refund workflow.",
    };
  }

  if (targetStatus === "on-hold") {
    return {
      valid: false,
      message: "The on-hold status is disabled and cannot be selected.",
    };
  }

  if (!targetStatus || !ALLOWED_ORDER_STATUSES.includes(targetStatus)) {
    return {
      valid: false,
      message: `Invalid status "${targetStatus}". Allowed: ${ALLOWED_ORDER_STATUSES.join(", ")}`,
    };
  }

  // 1. 72-hour delivery lock
  if (isOrderStatusLocked(currentOrder, nowMs)) {
    return {
      valid: false,
      message: "Status changes are locked after 72 hours (3 days) of delivery.",
    };
  }

  const fulfillmentStatuses = ["processing", "packed", "out-for-delivery", "dispatched", "completed"];
  const currentStatus = String(currentOrder?.status || "").toLowerCase();
  const effectiveStatus = currentOrder?.meta_data?.find((m) => m.key === "_delivery_status")?.value || currentStatus;
  const terminal = ["cancelled", "refunded", "failed", "completed"];
  if (terminal.includes(currentStatus) || terminal.includes(effectiveStatus)) {
    return targetStatus === currentStatus || targetStatus === effectiveStatus
      ? { valid: true }
      : { valid: false, message: "A terminal order cannot be reopened or regressed through fulfillment controls." };
  }
  const allowed = {
    pending: ["processing", "cancelled", "failed"],
    "on-hold": ["cancelled", "failed"],
    processing: ["packed", "out-for-delivery", "dispatched", "cancelled", "failed"],
    packed: ["out-for-delivery", "dispatched", "cancelled"],
    "out-for-delivery": ["completed"],
    dispatched: ["completed"],
  };
  if (targetStatus !== effectiveStatus && !(allowed[effectiveStatus] || []).includes(targetStatus)) {
    return { valid: false, message: `Cannot transition ${effectiveStatus} to ${targetStatus}.` };
  }

  // 2. Terminal statuses cannot transition to active fulfillment
  if ((currentStatus === "cancelled" || currentStatus === "refunded") && fulfillmentStatuses.includes(targetStatus)) {
    return {
      valid: false,
      message: `Cannot transition a ${currentStatus} order to ${targetStatus}.`,
    };
  }

  // 3. Unpaid online order guard: cannot advance to fulfillment or completed
  if (isOnlineOrderUnpaid(currentOrder) && fulfillmentStatuses.includes(targetStatus)) {
    return {
      valid: false,
      message: "Cannot fulfill order: online payment has not been received.",
    };
  }

  return { valid: true };
};

/**
 * Builds the canonical WooCommerce REST API payload for an order status transition.
 * Quick-commerce semantics:
 * - "packed", "out-for-delivery", and "dispatched" keep WooCommerce core status as "processing"
 *   and record the custom state in meta_data `_delivery_status`.
 * - "completed" sets WooCommerce status to "completed", sets `_delivery_status` = "completed",
 *   and records the ISO completion timestamp in `_delivery_completed_at`.
 * - Other statuses (pending, on-hold, cancelled, refunded, failed) set both status and `_delivery_status`.
 */
export const buildOrderStatusPayload = (status) => {
  if (status === "completed") {
    return {
      status: "completed",
      meta_data: [
        { key: "_delivery_status", value: "completed" },
        { key: "_delivery_completed_at", value: new Date().toISOString() },
      ],
    };
  }

  if (status === "out-for-delivery" || status === "dispatched" || status === "packed") {
    return {
      status: "processing",
      meta_data: [{ key: "_delivery_status", value: status }],
    };
  }

  return {
    status,
    meta_data: [{ key: "_delivery_status", value: status }],
  };
};
