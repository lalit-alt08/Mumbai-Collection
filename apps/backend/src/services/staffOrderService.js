import api from "../config/woocommerce.js";
import wp from "./wordpress.js";
import { validateOrderStatusTransition, buildOrderStatusPayload } from "../utils/orderStatusTransition.js";
import { serverCache } from "../utils/memoryCache.js";
import { publishOrderEvent } from "./orderNotificationService.js";
import { invalidateOrderDetailCache } from "./orderDetailCache.js";

export async function mutateStaffOrder(id, status, { packedOnly = false } = {}) {
  const { data: previous } = await api.get(`orders/${encodeURIComponent(id)}`);
  const effective = previous.meta_data?.find((m) => m.key === "_delivery_status")?.value || previous.status;
  if (packedOnly && effective !== "packed" && effective !== "out-for-delivery") {
    const error = new Error("Only packed orders can be bulk dispatched.");
    error.response = { status: 409 };
    throw error;
  }
  const validation = validateOrderStatusTransition(previous, status);
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.response = { status: 409 };
    throw error;
  }
  const { data: order } = await wp.post(`/wp-json/mumbai-auth/v1/staff/orders/${id}/status`, {
    ...buildOrderStatusPayload(status),
    target_status: status,
    expected_status: previous.status,
    expected_delivery_status: effective,
    expected_modified: previous.date_modified_gmt || "",
  }, { timeout: 30000 });
  for (const prefix of ["employee:overview", "employee:orders_scan", "admin:analytics", "admin:customers"]) {
    serverCache.invalidatePrefix(prefix);
  }
  if (previous.customer_id) serverCache.invalidatePrefix(`customer:orders:${previous.customer_id}:`);
  await invalidateOrderDetailCache(id);
  void publishOrderEvent({ event: "ORDER_STATUS_UPDATED", orderId: id, status });
  return order;
}
