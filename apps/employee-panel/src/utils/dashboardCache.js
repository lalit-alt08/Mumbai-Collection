let entry = null;
export const getDashboardCache = (userId) => userId != null && entry?.userId === String(userId) ? entry.data : null;
export const setDashboardCache = (userId, data) => { entry = userId == null ? null : { userId: String(userId), data }; };
export const clearDashboardCache = () => { entry = null; };

export const mergeDegradedOverview = (previous, incoming) => {
  if (!incoming?.is_degraded || !previous) return incoming;
  const failed = new Set(incoming.unavailable_sections || []);
  const summary = { ...incoming.summary };
  const fields = {
    order_summary: ["ordersToPack", "ordersPacked", "ordersOutForDelivery", "activeOrders"],
    received_today: ["receivedToday", "totalOrders"],
    completed_today: ["completedToday", "completedOrders"],
    stock_counts: ["lowStockCount"],
  };
  for (const [section, names] of Object.entries(fields)) {
    if (failed.has(section)) for (const name of names) summary[name] = previous.summary?.[name] ?? null;
  }
  return {
    ...incoming,
    summary,
    ordersNeedingAction: failed.has("action_orders") ? previous.ordersNeedingAction : incoming.ordersNeedingAction,
    recentOrders: failed.has("recent_orders") ? previous.recentOrders : incoming.recentOrders,
    lowStockProducts: failed.has("low_stock_products") ? previous.lowStockProducts : incoming.lowStockProducts,
    has_stale_data: true,
  };
};
