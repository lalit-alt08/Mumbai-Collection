/**
 * Shared Order Status Lifecycle & Lock Utilities
 * Enforces authoritative 3-day (72-hour) completion locks and maps quick-commerce
 * dispatch sub-statuses to WooCommerce core order payloads.
 */

export const ALLOWED_ORDER_STATUSES = [
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
    const t = new Date(order.date_completed).getTime();
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
    const t = new Date(order.date_created).getTime();
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