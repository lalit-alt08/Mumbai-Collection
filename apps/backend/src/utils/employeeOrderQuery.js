import { classifyDeliveryLocation } from "./locationClassifier.js";
import { isOnlineOrderUnpaid } from "./orderStatusTransition.js";

export const normalizeOrderSearchValue = (value) => String(value ?? "").trim().toLowerCase();

/** Match the employee order search contract across WooCommerce order fields. */
export const matchesEmployeeOrderSearch = (order, search) => {
  const query = normalizeOrderSearchValue(search);
  if (query.length < 2) return true;

  const billing = order?.billing || {};
  const shipping = order?.shipping || {};
  const name = [billing.first_name, billing.last_name, shipping.first_name, shipping.last_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const email = normalizeOrderSearchValue(billing.email || shipping.email);
  const orderNumber = normalizeOrderSearchValue(order?.number || order?.id);
  const phoneQuery = query.replace(/\D/g, "");
  const phones = [billing.phone, shipping.phone]
    .filter(Boolean)
    .map((value) => String(value).replace(/\D/g, ""));

  return (
    [orderNumber, name, email].some((value) => value.includes(query)) ||
    (phoneQuery.length >= 2 && phones.some((value) => value.includes(phoneQuery)))
  );
};

export const getEffectiveOrderStatus = (order) =>
  order?.meta_data?.find((meta) => meta.key === "_delivery_status")?.value || order?.status;

export const parseWooCommerceDate = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?(?:(Z)|([+-]\d{2}:?\d{2}))?$/i
  );
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];

  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  if (match[4]) {
    const [hour, min, sec] = [Number(match[4]), Number(match[5]), Number(match[6])];
    if (hour > 23 || min > 59 || sec > 59) return null;
  }

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getOrderTimestamp = (order) =>
  parseWooCommerceDate(order?.date_created_gmt || order?.date_created || order?.date)?.getTime() ?? 0;

export const compareOrdersDescending = (a, b) => {
  const diff = getOrderTimestamp(b) - getOrderTimestamp(a);
  return diff !== 0 ? diff : Number(b.id) - Number(a.id);
};

export const isOrderOlderThanCursor = (cursor, order) =>
  !cursor || compareOrdersDescending(cursor, order) < 0;

export const serializeOrderCursor = (order) => {
  if (!order?.id) return null;
  const date = parseWooCommerceDate(order.date_created_gmt || order.date_created || order.date);
  return date ? `${date.toISOString()}_${order.id}` : null;
};

export const parseOrderCursor = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const lastUnderscore = trimmed.lastIndexOf("_");
  if (lastUnderscore === -1) {
    if (!/^[1-9]\d*$/.test(trimmed)) return null;
    const num = Number(trimmed);
    return Number.isSafeInteger(num) && num > 0 ? { id: num, date: null, legacyPage: num } : null;
  }
  const dateStr = trimmed.slice(0, lastUnderscore);
  const idStr = trimmed.slice(lastUnderscore + 1).trim();
  if (!/^[1-9]\d*$/.test(idStr)) return null;
  const id = Number(idStr);
  const date = parseWooCommerceDate(dateStr);
  if (!Number.isSafeInteger(id) || id <= 0 || !date) return null;
  return { id, date: date.toISOString(), legacyPage: null };
};

export const isOrderNeedingPacking = (order) => {
  if (!order) return false;
  const rawStatus = String(order.status || "").trim().toLowerCase();
  if (
    ["trash", "cancelled", "failed", "refunded", "completed", "packed", "out-for-delivery", "dispatched"].includes(
      rawStatus
    )
  ) {
    return false;
  }
  const effectiveStatus = String(getEffectiveOrderStatus(order) || "").trim().toLowerCase();
  if (!["pending", "processing"].includes(effectiveStatus)) {
    return false;
  }
  if (
    ["packed", "out-for-delivery", "dispatched", "completed", "cancelled", "refunded", "failed", "trash"].includes(
      effectiveStatus
    )
  ) {
    return false;
  }
  return !isOnlineOrderUnpaid(order);
};

export const filterAndPaginateEmployeeOrders = (orders, { status, location, search, page, limit }) => {
  let filtered = Array.isArray(orders) ? orders.filter((order) => order.status !== "trash") : [];
  const effectiveStatus = status === "active" ? null : status;

  if (status === "active") {
    const activeStatuses = new Set([
      "pending",
      "processing",
      "on-hold",
      "packed",
      "out-for-delivery",
      "dispatched",
    ]);
    filtered = filtered.filter((order) => activeStatuses.has(getEffectiveOrderStatus(order)));
  } else if (["processing", "packed", "out-for-delivery", "dispatched"].includes(status)) {
    filtered = filtered.filter((order) => {
      const current = getEffectiveOrderStatus(order);
      return status === "processing"
        ? current === "processing"
        : status === "packed"
        ? current === "packed"
        : ["out-for-delivery", "dispatched"].includes(current);
    });
  } else if (effectiveStatus && effectiveStatus !== "all") {
    filtered = filtered.filter((order) => order.status === effectiveStatus);
  }

  const normalizedLocation = normalizeOrderSearchValue(location);
  if (normalizedLocation && normalizedLocation !== "all") {
    filtered = filtered.filter(
      (order) => classifyDeliveryLocation(order).location_key === normalizedLocation
    );
  }

  const normalizedSearch = normalizeOrderSearchValue(search);
  if (normalizedSearch.length >= 2) {
    filtered = filtered.filter((order) => matchesEmployeeOrderSearch(order, normalizedSearch));
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  return { orders: filtered.slice(start, start + limit), total, totalPages };
};
