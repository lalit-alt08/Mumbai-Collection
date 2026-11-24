import { formatCustomerDisplayName } from "./nameFormatter.js";
import { classifyDeliveryLocation } from "./locationClassifier.js";
import {
  getOrderDeliveredTimestamp,
  isOrderStatusLocked,
  isCodOrder,
  isOnlineOrderUnpaid,
  validateOrderStatusTransition,
  ALLOWED_ORDER_STATUSES,
} from "./orderStatusTransition.js";
import { getEffectiveOrderStatus } from "./employeeOrderQuery.js";

const EMPLOYEE_ORDER_META_KEYS = new Set([
  "_delivery_status", "_delivery_completed_at", "_delivered_at",
  "_manual_refund_email_sent_at", "_order_placed_after_hours",
  "_payment_captured_without_delivery_slot", "_scheduled_delivery_date",
  "_scheduled_delivery_label",
]);
export const sanitizeEmployeeOrderMeta = (meta) =>
  (Array.isArray(meta) ? meta : []).filter((entry) => EMPLOYEE_ORDER_META_KEYS.has(entry.key));

export const formatEmployeeOrderRecord = (o, ackSet) => {
  const effectiveStatus = getEffectiveOrderStatus(o);
  const locInfo = classifyDeliveryLocation(o);
  const addressParts = [
    o.billing?.address_1,
    o.billing?.address_2,
    o.billing?.city,
    o.billing?.state,
    o.billing?.postcode,
  ].filter(Boolean);
  const shippingParts = [
    o.shipping?.address_1,
    o.shipping?.address_2,
    o.shipping?.city,
    o.shipping?.state,
    o.shipping?.postcode,
  ].filter(Boolean);
  const deliveryAddr =
    shippingParts.length > 0
      ? shippingParts.join(", ")
      : addressParts.length > 0
      ? addressParts.join(", ")
      : "Vasai, Maharashtra";

  return {
    id: o.id,
    order_number: o.number || String(o.id),
    status: effectiveStatus,
    is_acknowledged: ackSet.has(Number(o.id)),
    date_created: o.date_created,
    date_created_gmt: o.date_created_gmt || null,
    date_completed: o.date_completed || null,
    date_completed_gmt: o.date_completed_gmt || null,
    delivery_completed_at:
      o.meta_data?.find((m) => m.key === "_delivery_completed_at")?.value || null,
    allowed_next_statuses: ALLOWED_ORDER_STATUSES.filter(
      (next) => next !== effectiveStatus && validateOrderStatusTransition(o, next).valid
    ),
    is_status_locked: isOrderStatusLocked(o),
    is_unpaid: isOnlineOrderUnpaid(o),
    total: o.total,
    shipping_total: o.shipping_total || "0.00",
    discount_total: o.discount_total || "0.00",
    total_tax: o.total_tax || "0.00",
    fee_total: Array.isArray(o.fee_lines)
      ? o.fee_lines.reduce((sum, f) => sum + (Number(f.total) || 0), 0).toFixed(2)
      : "0.00",
    customer_note: o.customer_note || "",
    payment_method:
      o.payment_method_title ||
      (String(o.payment_method || "").toLowerCase() === "cod" ? "Cash on Delivery" : "Online Payment"),
    customer_name: formatCustomerDisplayName(
      o.billing?.first_name,
      o.billing?.last_name,
      "Guest Customer"
    ),
    phone: o.billing?.phone || o.shipping?.phone || "",
    meta_data: sanitizeEmployeeOrderMeta(o.meta_data),
    customer: {
      id: o.customer_id,
      name: formatCustomerDisplayName(
        o.billing?.first_name,
        o.billing?.last_name,
        "Guest Customer"
      ),
      email: o.billing?.email || "",
      phone: o.billing?.phone || "",
      address: addressParts.length > 0 ? addressParts.join(", ") : "Vasai, Maharashtra",
    },
    billing: o.billing || {},
    shipping: o.shipping || {},
    delivery_address: deliveryAddr,
    delivery_location: locInfo.location,
    delivery_location_key: locInfo.location_key,
    items_count:
      o.line_items?.reduce((sum, item) => sum + (item.quantity || 1), 0) ||
      o.line_items?.length ||
      1,
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
};

export const formatOverviewOrderItem = (order, effectiveStatus) => ({
  id: order.id,
  order_number: order.number || String(order.id),
  status: effectiveStatus,
  is_unpaid: isOnlineOrderUnpaid(order),
  delivery_review_required: Array.isArray(order.meta_data) && order.meta_data.some(
    (meta) => meta.key === "_payment_captured_without_delivery_slot" && meta.value === "yes"
  ),
  payment_method:
    order.payment_method_title ||
    order.payment_method ||
    (isCodOrder(order) ? "Cash on Delivery" : "Online Payment"),
  customer_name: formatCustomerDisplayName(
    order.billing?.first_name,
    order.billing?.last_name,
    order.billing?.email || "Guest Customer"
  ),
  phone: order.billing?.phone || order.shipping?.phone || "",
  total: order.total,
  date_created: order.date_created,
  items_count:
    order.line_items?.reduce((sum, i) => sum + (i.quantity || 1), 0) ||
    order.line_items?.length ||
    1,
  items: (order.line_items || []).map((i) => ({
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    price: i.price,
    total: i.total,
    image: i.image?.src || null,
  })),
  delivery_address:
    [
      order.shipping?.address_1 || order.billing?.address_1,
      order.shipping?.city || order.billing?.city,
      order.shipping?.postcode || order.billing?.postcode,
    ]
      .filter(Boolean)
      .join(", ") || "Vasai, Maharashtra",
});
