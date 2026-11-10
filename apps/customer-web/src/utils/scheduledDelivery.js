const readMeta = (order, key) =>
  order?.meta_data?.find((entry) => entry?.key === key)?.value || "";

export const isScheduledFulfillmentOrder = (order) => Boolean(
  readMeta(order, "_order_placed_after_hours") === "yes" ||
  readMeta(order, "_order_placed_after_hours") === "true" ||
  readMeta(order, "_scheduled_delivery_date") ||
  readMeta(order, "_scheduled_delivery_label") ||
  order?.customer_note?.toLowerCase().includes("scheduled for fulfillment")
);

export const isPaymentAwaitingDeliveryReview = (order) =>
  readMeta(order, "_payment_captured_without_delivery_slot") === "yes";

/** Uses the persisted calendar date so order history never keeps saying “Tomorrow”. */
export const getScheduledFulfillmentLabel = (order) => {
  const dateValue = readMeta(order, "_scheduled_delivery_date");
  const sourceLabel = readMeta(order, "_scheduled_delivery_label");
  let dateLabel = "the next store opening";

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const [year, month, day] = dateValue.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(date.getTime())) {
      dateLabel = new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
    }
  }

  const timeMatch = sourceLabel.match(/\b(?:at|from)\s+(.+)$/i);
  const timeLabel = timeMatch?.[1]?.trim();
  return timeLabel ? `${dateLabel} from ${timeLabel}` : dateLabel;
};
