import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Package,
  Search,
  Truck,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  Eye,
  X,
  MapPin,
  Phone,
  Mail,
  Receipt,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Loader2,
  Calendar,
  Lock,
  Filter,
  SlidersHorizontal,
  ArrowRight,
  MoreVertical,
} from "lucide-react";
import { getOrders, updateOrderStatus, sendOrderRefundEmail, getEmployeeOrderStreamUrl } from "../services/employeeApi.js";
import {
  triggerNewOrderNotification,
  requestNotificationPermission,
} from "../utils/orderNotification.js";
import {
  resolveTabFromStatusParam,
  getISTDateString,
  shiftDateOnly,
  getOrderDateIST,
  getOrderTimestampDate,
  getCleanCustomerName,
} from "../utils/orderDate.js";
import {
  LOCATION_OPTIONS,
  getOrderLocationInfo,
  getLocationBadgeClass,
} from "../utils/orderLocation.js";

export { resolveTabFromStatusParam, getOrderDateIST, getOrderTimestampDate, getCleanCustomerName };

const STATUS_OPTIONS = [
  { value: "processing", label: "Processing / To Pack", shortLabel: "To Pack", dot: "bg-amber-400" },
  { value: "packed", label: "Packed (Ready for Dispatch)", shortLabel: "Packed", dot: "bg-purple-500" },
  { value: "out-for-delivery", label: "Out for Delivery (Rider)", shortLabel: "Out for Delivery", dot: "bg-blue-500" },
  { value: "completed", label: "Delivered (Completed)", shortLabel: "Delivered", dot: "bg-emerald-500" },
  { value: "cancelled", label: "Cancelled", shortLabel: "Cancelled", dot: "bg-rose-500" },
];

const ALL_STATUS_BADGES = [
  ...STATUS_OPTIONS,
  { value: "on-hold", label: "On Hold", shortLabel: "On Hold", dot: "bg-orange-400" },
  { value: "refunded", label: "Refunded", shortLabel: "Refunded", dot: "bg-gray-400" },
  { value: "failed", label: "Failed", shortLabel: "Failed", dot: "bg-red-400" },
  { value: "pending", label: "Pending", shortLabel: "Pending", dot: "bg-yellow-400" },
];

const DATE_FILTERS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7days", label: "Last 7 Days" },
  { id: "all", label: "All Time" },
  { id: "custom", label: "Custom Range..." },
];

/**
 * Determines whether a delivered order's fulfillment status change is locked.
 * Rule:
 * - Once an order reaches "completed" (Delivered), status changes are allowed for <24h only.
 * - At >= 24h from actual delivery/completion timestamp, the control is locked.
 * - Non-completed orders are never locked.
 * Priority:
 * 1. _delivery_completed_at / delivery_completed_at
 * 2. date_completed_gmt
 * 3. date_completed
 * 4. date_created_gmt
 * 5. date_created
 * Fail-closed:
 * - If status is completed/delivered and is_status_locked is true, lock immediately.
 * - If status is completed/delivered and no valid timestamp exists, fail closed (lock).
 * (date_modified is NOT used as unrelated edits affect it).
 */
export const isOrderDeliveredLocked = (order, now = Date.now()) => {
  if (!order) return false;
  const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
  const effectiveStatus = deliveryMeta?.value || order.status;
  const isDelivered = effectiveStatus === "completed";
  if (!isDelivered) return false;

  // If server explicitly marked it as locked, lock immediately
  if (order.is_status_locked === true) {
    return true;
  }

  let timestamp = null;

  // 1. _delivery_completed_at / delivery_completed_at
  const deliveryCompletedAt =
    order.delivery_completed_at ||
    order.meta_data?.find((m) => m.key === "_delivery_completed_at")?.value ||
    order.meta_data?.find((m) => m.key === "_delivered_at")?.value;

  if (deliveryCompletedAt) {
    const t = new Date(deliveryCompletedAt).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  // 2. date_completed_gmt
  if (!timestamp && order.date_completed_gmt) {
    const s = order.date_completed_gmt.endsWith("Z")
      ? order.date_completed_gmt
      : `${order.date_completed_gmt}Z`;
    const t = new Date(s).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  // 3. date_completed
  if (!timestamp && order.date_completed) {
    const s = order.date_completed.endsWith("Z")
      ? order.date_completed
      : `${order.date_completed}Z`;
    const t = new Date(s).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  // 4. date_created_gmt
  if (!timestamp && order.date_created_gmt) {
    const s = order.date_created_gmt.endsWith("Z")
      ? order.date_created_gmt
      : `${order.date_created_gmt}Z`;
    const t = new Date(s).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  // 5. date_created
  if (!timestamp && order.date_created) {
    const s = order.date_created.endsWith("Z")
      ? order.date_created
      : `${order.date_created}Z`;
    const t = new Date(s).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }

  if (timestamp) {
    const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
    return (now - timestamp) >= SEVENTY_TWO_HOURS_MS;
  }

  // Fail closed: completed order with no usable timestamps is locked
  return true;
};

function Orders() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [ordersQueryKey, setOrdersQueryKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState(() =>
    resolveTabFromStatusParam(searchParams.get("status"))
  );
  const [dateFilter, setDateFilter] = useState("today");
  const [locationFilter, setLocationFilter] = useState("all");
  const [customDateRange, setCustomDateRange] = useState({ start: "", end: "" });
  const [tempDateRange, setTempDateRange] = useState({ start: "", end: "" });
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const mobileDateDropdownRef = useRef(null);
  const desktopDateDropdownRef = useRef(null);
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);
  const locationDropdownRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const requestIdRef = useRef(0);
  const pollTimerRef = useRef(null);
  const eventRefreshTimerRef = useRef(null);
  const updatingIdsRef = useRef(new Set());
  const knownOrderIdsRef = useRef(null);
  const [updatingIds, setUpdatingIds] = useState(() => new Set());
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const statusDropdownRef = useRef(null);

  // Toast notification state
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Sync activeTab when URL searchParams change
  useEffect(() => {
    const tabFromUrl = resolveTabFromStatusParam(searchParams.get("status"));
    setActiveTab(tabFromUrl);
  }, [searchParams]);

  // Close status dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target)) {
        setIsStatusDropdownOpen(false);
      }
      const clickedInsideDate =
        (mobileDateDropdownRef.current && mobileDateDropdownRef.current.contains(event.target)) ||
        (desktopDateDropdownRef.current && desktopDateDropdownRef.current.contains(event.target));
      if (!clickedInsideDate) {
        setIsDateDropdownOpen(false);
      }
      if (locationDropdownRef.current && !locationDropdownRef.current.contains(event.target)) {
        setIsLocationDropdownOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (isStatusDropdownOpen) {
          setIsStatusDropdownOpen(false);
        } else if (selectedOrder) {
          setSelectedOrder(null);
        }
        setIsDateDropdownOpen(false);
        setIsLocationDropdownOpen(false);
      }
    };
    if (isStatusDropdownOpen || isDateDropdownOpen || isLocationDropdownOpen || selectedOrder) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isStatusDropdownOpen, isDateDropdownOpen, isLocationDropdownOpen, selectedOrder]);

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const perPage = 20;

  const currentOrdersQueryKey = JSON.stringify({
    activeTab,
    debouncedSearch,
    locationFilter,
    dateFilter,
    customDateRange: dateFilter === "custom" ? customDateRange : null,
    page,
  });
  const hasCurrentOrders = ordersQueryKey === currentOrdersQueryKey;

  const abortControllerRef = useRef(null);

  // Debounce search input by 400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      const normalized = searchQuery.trim();
      setDebouncedSearch(normalized.length >= 2 ? normalized : "");
      setPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchOrderList = async (isBackground = false) => {
    let controller = null;
    if (!isBackground) {
      abortControllerRef.current?.abort();
      controller = new AbortController();
      abortControllerRef.current = controller;
    }
    const requestId = ++requestIdRef.current;
    try {
      if (!isBackground) {
        setLoading(true);
        setError("");
      }
      const res = await getOrders(
        {
          status: activeTab !== "all" ? activeTab : undefined,
          search: debouncedSearch || undefined,
          location: locationFilter !== "all" ? locationFilter : undefined,
          date_filter: dateFilter !== "all" ? dateFilter : undefined,
          date_from: dateFilter === "custom" ? customDateRange.start || undefined : undefined,
          date_to: dateFilter === "custom" ? customDateRange.end || undefined : undefined,
          page,
          per_page: perPage,
        },
        controller ? { signal: controller.signal } : {}
      );
      if (res.success) {
        if (requestId !== requestIdRef.current) return;
        const incomingOrders = res.orders || [];
        if (knownOrderIdsRef.current !== null) {
          const hasNewIncoming = incomingOrders.some(
            (o) => !knownOrderIdsRef.current.has(o.id)
          );
          if (hasNewIncoming) {
            const newest = incomingOrders.find((o) => !knownOrderIdsRef.current.has(o.id));
            triggerNewOrderNotification({ orderId: newest?.id });
          }
        }
        knownOrderIdsRef.current = new Set(incomingOrders.map((o) => o.id));
        setOrders(incomingOrders);
        setOrdersQueryKey(currentOrdersQueryKey);
        setTotalOrders(res.total || incomingOrders.length || 0);
        setTotalPages(res.totalPages || Math.ceil((res.total || 1) / perPage) || 1);
        if (!isBackground) setError("");
      }
    } catch (err) {
      if (
        controller?.signal?.aborted ||
        err.name === "CanceledError" ||
        err.code === "ERR_CANCELED" ||
        err.message?.toLowerCase().includes("canceled") ||
        err.message?.toLowerCase().includes("aborted")
      ) {
        return;
      }
      if (requestId !== requestIdRef.current) return;
      if (!isBackground) {
        setError(err.response?.data?.message || err.message || "Failed to load orders from server.");
      }
    } finally {
      if (requestId === requestIdRef.current && !controller?.signal?.aborted && !isBackground) {
        setLoading(false);
      }
    }
  };

  // Request browser notification permissions on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    fetchOrderList(false);

    let eventSource = null;
    let isReconnecting = false;
    const scheduleEventRefresh = () => {
      // Coalesce bursts of order events into one list request instead of
      // asking WooCommerce for the full list once per rapid status change.
      if (eventRefreshTimerRef.current) {
        clearTimeout(eventRefreshTimerRef.current);
      }
      eventRefreshTimerRef.current = setTimeout(() => {
        eventRefreshTimerRef.current = null;
        fetchOrderList(true);
      }, 700);
    };

    // Connect to real-time Server-Sent Events stream for instantaneous order notifications
    const setupEventSource = () => {
      try {
        const streamUrl = getEmployeeOrderStreamUrl();
        eventSource = new EventSource(streamUrl, { withCredentials: true });

        eventSource.onopen = () => {
          // If reconnected after network blip or server restart, immediately refetch to catch missed events
          if (isReconnecting) {
            fetchOrderList(true);
            isReconnecting = false;
          }
        };

        eventSource.addEventListener("order_event", (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data?.event === "ORDER_CREATED" || data?.event === "ORDER_STATUS_UPDATED") {
              scheduleEventRefresh();
            }
          } catch (_) {
            scheduleEventRefresh();
          }
        });

        eventSource.onerror = () => {
          // Flag reconnection so that upon next onopen, we pull fresh state
          isReconnecting = true;
        };
      } catch (err) {
        // Fallback to polling if EventSource initialization is unsupported or blocked
        isReconnecting = true;
      }
    };

    setupEventSource();

    // Slower safety-net polling fallback (45 seconds) to handle sleeping tabs or missed events
    const startPolling = () => {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(() => {
          fetchOrderList(true);
        }, 45000);
      }
    };

    const stopPolling = () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Tab brought to foreground: immediately sync latest diff
        fetchOrderList(true);
      }
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      abortControllerRef.current?.abort();
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (eventRefreshTimerRef.current) {
        clearTimeout(eventRefreshTimerRef.current);
        eventRefreshTimerRef.current = null;
      }
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeTab, debouncedSearch, locationFilter, dateFilter, customDateRange, page]);

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    setPage(1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (newTab === "active") {
          next.delete("status");
        } else {
          next.set("status", newTab);
        }
        return next;
      },
      { replace: true }
    );
  };

  const handleDateFilterSelect = (filterId) => {
    setIsDateDropdownOpen(false);
    if (filterId === "custom") {
      setTempDateRange(customDateRange.start ? customDateRange : {
        start: shiftDateOnly(getISTDateString(), -6),
        end: getISTDateString(),
      });
      setIsCustomModalOpen(true);
      return;
    }

    if (filterId !== dateFilter) {
      setDateFilter(filterId);
      setPage(1);
    }
  };

  const handleApplyCustomRange = () => {
    if (tempDateRange.start && tempDateRange.end) {
      setCustomDateRange(tempDateRange);
      setDateFilter("custom");
      setIsCustomModalOpen(false);
      setPage(1);
    }
  };

  const setPresetRange = (days) => {
    const end = getISTDateString();
    const start = shiftDateOnly(end, -(days - 1));
    setTempDateRange({ start, end });
  };

  const setMonthPreset = () => {
    const end = getISTDateString();
    const start = `${end.slice(0, 7)}-01`;
    setTempDateRange({ start, end });
  };

  const handleStatusUpdate = async (orderId, newStatus) => {
    // Prevent duplicate concurrent requests on the same order
    if (updatingIdsRef.current.has(orderId)) return;
    // A ref locks synchronously; React state alone may not update before a
    // second rapid click in the same render.
    updatingIdsRef.current.add(orderId);

    // Snapshot previous state for precise rollback on failure
    const previousOrder = orders.find((o) => o.id === orderId);
    const previousSelectedOrder =
      selectedOrder && selectedOrder.id === orderId ? selectedOrder : null;

    const optimisticDeliveryCompletedAt =
      newStatus === "completed" ? new Date().toISOString() : undefined;

    // Optimistically update local orders state immediately (0ms feedback)
    setOrders((prev) =>
      prev.map((ord) => {
        if (ord.id === orderId) {
          return {
            ...ord,
            status: newStatus,
            ...(optimisticDeliveryCompletedAt
              ? {
                  delivery_completed_at: ord.delivery_completed_at || optimisticDeliveryCompletedAt,
                  date_completed: ord.date_completed || optimisticDeliveryCompletedAt,
                }
              : {}),
            is_status_locked: false,
          };
        }
        return ord;
      })
    );

    if (selectedOrder && selectedOrder.id === orderId) {
      setSelectedOrder((prev) => {
        if (!prev || prev.id !== orderId) return prev;
        return {
          ...prev,
          status: newStatus,
          ...(optimisticDeliveryCompletedAt
            ? {
                delivery_completed_at: prev.delivery_completed_at || optimisticDeliveryCompletedAt,
                date_completed: prev.date_completed || optimisticDeliveryCompletedAt,
              }
            : {}),
          is_status_locked: false,
        };
      });
    }

    // Mark this order as in-flight (React-safe Set update)
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.add(orderId);
      return next;
    });

    try {
      const res = await updateOrderStatus(orderId, newStatus);

      // Merge authoritative server response into local orders state without re-fetching entire list
      if (res?.order) {
        const serverOrder = res.order;
        const deliveryMeta = serverOrder.meta_data?.find(
          (m) => m.key === "_delivery_status"
        );
        const effectiveStatus = deliveryMeta?.value || serverOrder.status || newStatus;
        const deliveryCompletedAt =
          serverOrder.delivery_completed_at ||
          serverOrder.meta_data?.find((m) => m.key === "_delivery_completed_at")?.value ||
          (newStatus === "completed" ? new Date().toISOString() : undefined);

        setOrders((prev) =>
          prev.map((ord) => {
            if (ord.id === orderId) {
              return {
                ...ord,
                ...serverOrder,
                status: effectiveStatus,
                ...(deliveryCompletedAt ? { delivery_completed_at: deliveryCompletedAt } : {}),
                ...(serverOrder.date_completed ? { date_completed: serverOrder.date_completed } : {}),
                ...(serverOrder.date_completed_gmt ? { date_completed_gmt: serverOrder.date_completed_gmt } : {}),
                is_status_locked: false,
              };
            }
            return ord;
          })
        );

        if (selectedOrder && selectedOrder.id === orderId) {
          setSelectedOrder((prev) => {
            if (!prev || prev.id !== orderId) return prev;
            return {
              ...prev,
              ...serverOrder,
              status: effectiveStatus,
              delivery_completed_at:
                deliveryCompletedAt || prev.delivery_completed_at,
              date_completed: serverOrder.date_completed || prev.date_completed,
              date_completed_gmt: serverOrder.date_completed_gmt || prev.date_completed_gmt,
              is_status_locked: false,
            };
          });
        }
      }
    } catch (err) {
      // Roll back only the affected order to its saved previous state
      if (previousOrder) {
        setOrders((prev) =>
          prev.map((ord) => (ord.id === orderId ? previousOrder : ord))
        );
      }
      if (previousSelectedOrder) {
        setSelectedOrder((prev) =>
          prev && prev.id === orderId ? previousSelectedOrder : prev
        );
      }
      showToast(
        "Failed to update status: " + (err.response?.data?.message || err.message),
        "error"
      );
    } finally {
      updatingIdsRef.current.delete(orderId);
      // React-safe Set update to remove in-flight status
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const handleSendRefundEmail = async (order) => {
    if (!order || updatingIds.has(order.id)) return;
    const alreadySent = order.manual_refund_email_sent_at ||
      order.meta_data?.find((meta) => meta.key === "_manual_refund_email_sent_at")?.value;
    if (alreadySent) {
      showToast("A refund email has already been sent for this order.", "error");
      return;
    }
    const confirmed = window.confirm(
      "Send a refund email to this customer? This only sends the email; process the actual refund separately first."
    );
    if (!confirmed) return;

    setIsStatusDropdownOpen(false);
    setUpdatingIds((prev) => new Set(prev).add(order.id));
    try {
      const result = await sendOrderRefundEmail(order.id);
      const sentAt = result?.sent_at || new Date().toISOString();
      const meta = { key: "_manual_refund_email_sent_at", value: sentAt };
      setOrders((prev) => prev.map((item) => item.id === order.id
        ? { ...item, manual_refund_email_sent_at: sentAt, meta_data: [...(item.meta_data || []).filter((entry) => entry.key !== meta.key), meta] }
        : item));
      setSelectedOrder((prev) => prev?.id === order.id
        ? { ...prev, manual_refund_email_sent_at: sentAt, meta_data: [...(prev.meta_data || []).filter((entry) => entry.key !== meta.key), meta] }
        : prev);
      showToast(result?.message || "Refund email sent.");
    } catch (err) {
      showToast(err.response?.data?.message || err.message || "Could not send refund email.", "error");
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    }
  };

  const getStatusBadge = (status, isUnpaid = false) => {
    if (isUnpaid) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 border border-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
          Awaiting Payment
        </span>
      );
    }

    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
            Delivered
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 border border-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse" />
            To Pack
          </span>
        );
      case "packed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-700 border border-purple-200">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
            Packed
          </span>
        );
      case "out-for-delivery":
      case "dispatched":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 border border-blue-200">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
            Out for Delivery
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 border border-rose-200">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-700 capitalize">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
            {status}
          </span>
        );
    }
  };

  // Date Filtering Engine (Store Timezone Asia/Kolkata)
  const todayDateString = getISTDateString();
  const yesterdayDateString = shiftDateOnly(todayDateString, -1);

  const filteredOrders = orders.filter((order) => {
    if (activeTab === "active" && (order.status === "completed" || order.status === "cancelled")) {
      return false;
    }
    if (locationFilter !== "all") {
      const loc = getOrderLocationInfo(order);
      if (loc.location_key !== locationFilter) {
        return false;
      }
    }
    return true;
  });

  const formatDateLabel = (isoDate) => {
    if (!isoDate) return "";
    const parts = isoDate.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}`;
    }
    return isoDate;
  };

  const getActiveDateLabel = () => {
    if (dateFilter === "today") return `Today (${formatDateLabel(todayDateString)})`;
    if (dateFilter === "yesterday") return `Yesterday (${formatDateLabel(yesterdayDateString)})`;
    if (dateFilter === "7days") return "Last 7 Days";
    if (dateFilter === "all") return "All Time";
    if (dateFilter === "custom" && customDateRange.start && customDateRange.end) {
      return `${formatDateLabel(customDateRange.start)} - ${formatDateLabel(customDateRange.end)}`;
    }
    return `Today (${formatDateLabel(todayDateString)})`;
  };

  const tabs = [
    { id: "active", label: "To Pack & Deliver" },
    { id: "packed", label: "Packed" },
    { id: "out-for-delivery", label: "Out for Delivery" },
    { id: "completed", label: "Delivered" },
    { id: "cancelled", label: "Cancelled" },
    { id: "all", label: "All Orders" },
  ];

  const hasActiveFilters = activeTab !== "active" || dateFilter !== "today" || locationFilter !== "all";

  const renderDetailsButton = (order, isMobile = false) => {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedOrder(order);
        }}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white font-bold text-gray-700 hover:bg-gray-50 active:scale-95 transition cursor-pointer shadow-2xs ${
          isMobile ? "w-full py-2.5 text-xs" : "px-3 py-1.5 text-xs"
        }`}
      >
        <Eye size={13} className="shrink-0 text-gray-500" />
        <span>Details</span>
      </button>
    );
  };

  const renderPrimaryAction = (order, isMobile = false) => {
    const isUpdating = updatingIds.has(order.id);

    if (order.is_unpaid) {
      return (
        <span
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 font-bold text-amber-700 shadow-2xs ${
            isMobile ? "w-full py-2.5 text-xs" : "px-3 py-1.5 text-xs"
          }`}
        >
          <AlertCircle size={13} className="shrink-0 text-amber-600" />
          <span>Awaiting Payment</span>
        </span>
      );
    }

    if (order.status === "processing") {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleStatusUpdate(order.id, "packed");
          }}
          disabled={isUpdating}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 font-bold text-white shadow-xs hover:bg-purple-500 active:scale-95 transition cursor-pointer disabled:opacity-50 ${
            isMobile ? "w-full py-2.5 text-xs" : "px-3 py-1.5 text-xs"
          }`}
        >
          {isUpdating ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <Package size={13} className="shrink-0" />}
          <span>{isUpdating ? "Updating..." : "Pack"}</span>
        </button>
      );
    }

    if (order.status === "packed") {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleStatusUpdate(order.id, "out-for-delivery");
          }}
          disabled={isUpdating}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 font-bold text-white shadow-xs hover:bg-blue-500 active:scale-95 transition cursor-pointer disabled:opacity-50 ${
            isMobile ? "w-full py-2.5 text-xs" : "px-3 py-1.5 text-xs"
          }`}
        >
          {isUpdating ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <Truck size={13} className="shrink-0" />}
          <span>{isUpdating ? "Updating..." : "Dispatch"}</span>
        </button>
      );
    }

    if (order.status === "out-for-delivery" || order.status === "dispatched") {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleStatusUpdate(order.id, "completed");
          }}
          disabled={isUpdating}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 font-bold text-white shadow-xs hover:bg-emerald-500 active:scale-95 transition cursor-pointer disabled:opacity-50 ${
            isMobile ? "w-full py-2.5 text-xs" : "px-3 py-1.5 text-xs"
          }`}
        >
          {isUpdating ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <CheckCircle2 size={13} className="shrink-0" />}
          <span>{isUpdating ? "Updating..." : "Mark Delivered"}</span>
        </button>
      );
    }

    // Default for completed, cancelled, on-hold
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setSelectedOrder(order);
        }}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white font-bold text-gray-700 hover:bg-gray-50 active:scale-95 transition cursor-pointer shadow-2xs ${
          isMobile ? "w-full py-2.5 text-xs" : "px-3 py-1.5 text-xs"
        }`}
      >
        <Eye size={13} className="shrink-0 text-gray-500" />
        <span>Details</span>
      </button>
    );
  };

  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-2xl px-4 py-3 text-xs font-extrabold text-white shadow-xl animate-in slide-in-from-top duration-200 ${
            toast.type === "error"
              ? "bg-rose-600 shadow-rose-600/30"
              : "bg-emerald-600 shadow-emerald-600/30"
          }`}
        >
          {toast.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* COMPACT TOP CONTROLS */}
      <div className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4 shadow-xs space-y-3">
        {/* Row 1: Search Bar + Refresh (Mobile & Desktop) */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Order #, Name, Phone..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50/60 py-2 pl-9 pr-8 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <button
            onClick={fetchOrderList}
            disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 shadow-2xs transition cursor-pointer disabled:opacity-50 shrink-0"
            title="Refresh Order Pipeline"
          >
            <RotateCcw size={14} className={loading ? "animate-spin text-emerald-600" : ""} />
          </button>
        </div>

        {/* Row 2: Mobile Filter Controls (<640px) */}
        <div className="flex sm:hidden items-center gap-2">
          {/* 1. Date Dropdown Trigger */}
          <div className="relative flex-1" ref={mobileDateDropdownRef}>
            <button
              type="button"
              onClick={() => setIsDateDropdownOpen((prev) => !prev)}
              className="w-full flex items-center justify-between gap-1.5 rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 text-xs font-bold text-gray-800 outline-none hover:bg-gray-100 transition shadow-2xs cursor-pointer"
            >
              <div className="flex items-center gap-1.5 truncate">
                <Calendar size={13} className="text-emerald-600 shrink-0" />
                <span className="truncate">{getActiveDateLabel()}</span>
              </div>
              <ChevronDown
                size={14}
                className={`text-gray-400 transition-transform duration-150 shrink-0 ${
                  isDateDropdownOpen ? "rotate-180 text-emerald-600" : ""
                }`}
              />
            </button>

            {/* Mobile Date Dropdown Menu */}
            {isDateDropdownOpen && (
              <div className="absolute top-full left-0 right-0 z-40 mt-1 rounded-xl bg-white border border-gray-200 shadow-xl overflow-hidden py-1 max-h-56 overflow-y-auto animate-in fade-in zoom-in-95 duration-100 divide-y divide-gray-50">
                {DATE_FILTERS.map((f) => {
                  const isSelected = dateFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => handleDateFilterSelect(f.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition cursor-pointer text-left ${
                        isSelected
                          ? "bg-emerald-50 text-emerald-900 font-extrabold"
                          : "text-gray-700 font-medium hover:bg-gray-50"
                      }`}
                    >
                      <span>
                        {f.id === "today"
                          ? `Today (${formatDateLabel(todayDateString)})`
                          : f.id === "yesterday"
                          ? `Yesterday (${formatDateLabel(yesterdayDateString)})`
                          : f.label}
                      </span>
                      {isSelected && <Check size={13} className="text-emerald-600 shrink-0 ml-1" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Mobile Filters Button (Triggers Bottom-Sheet) */}
          <button
            type="button"
            onClick={() => setIsMobileFiltersOpen(true)}
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold shadow-2xs transition cursor-pointer shrink-0 ${
              hasActiveFilters
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-gray-200 bg-gray-50/80 text-gray-700 hover:bg-gray-100"
            }`}
          >
            <SlidersHorizontal size={13} className={hasActiveFilters ? "text-emerald-600" : "text-gray-500"} />
            <span>Filters</span>
          </button>
        </div>

        {/* Row 2: Desktop Filter Bar (>=640px) */}
        <div className="hidden sm:flex sm:items-center sm:justify-between gap-3 pt-1 border-t border-gray-100">
          {/* Status Selectors */}
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((tab) => {
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer active:scale-95 ${
                    isSelected
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-2xs"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Filters (Desktop): Location + Date */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Location Selector Dropdown (Desktop) */}
            <div className="relative" ref={locationDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  setIsLocationDropdownOpen((open) => !open);
                  setIsDateDropdownOpen(false);
                }}
                aria-haspopup="listbox"
                aria-expanded={isLocationDropdownOpen}
                aria-label={`Delivery location: ${LOCATION_OPTIONS.find((loc) => loc.id === locationFilter)?.label || "All Locations"}`}
                className={`inline-flex min-w-[158px] items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-bold outline-none transition cursor-pointer shadow-2xs ${
                  locationFilter !== "all"
                    ? "border-purple-300 bg-purple-50 text-purple-800"
                    : "border-gray-200 bg-gray-50/80 text-gray-800 hover:bg-gray-100"
                } ${isLocationDropdownOpen ? "ring-2 ring-purple-500/15 border-purple-400" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MapPin size={14} className={locationFilter !== "all" ? "text-purple-600" : "text-gray-400"} />
                  <span className="truncate">{LOCATION_OPTIONS.find((loc) => loc.id === locationFilter)?.label || "All Locations"}</span>
                </span>
                <ChevronDown size={14} className={`shrink-0 text-gray-400 transition-transform ${isLocationDropdownOpen ? "rotate-180 text-purple-600" : ""}`} />
              </button>
              {isLocationDropdownOpen && (
                <div
                  role="listbox"
                  aria-label="Delivery location"
                  className="absolute right-0 top-full z-50 mt-1.5 max-h-72 w-56 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl animate-in fade-in zoom-in-95 duration-100"
                >
                  {LOCATION_OPTIONS.map((loc) => {
                    const selected = locationFilter === loc.id;
                    return (
                      <button
                        key={loc.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setLocationFilter(loc.id);
                          setPage(1);
                          setIsLocationDropdownOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-xs transition cursor-pointer ${
                          selected ? "bg-purple-50 font-extrabold text-purple-900" : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${loc.dot}`} />
                          <span className="truncate">{loc.label}</span>
                        </span>
                        {selected && <Check size={14} className="shrink-0 text-purple-600" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Date Selector Dropdown (Desktop) */}
            <div className="relative" ref={desktopDateDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  setIsDateDropdownOpen((open) => !open);
                  setIsLocationDropdownOpen(false);
                }}
                aria-haspopup="listbox"
                aria-expanded={isDateDropdownOpen}
                aria-label={`Date filter: ${getActiveDateLabel()}`}
                className={`inline-flex min-w-[174px] items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-bold text-gray-800 outline-none transition cursor-pointer shadow-2xs ${
                  isDateDropdownOpen ? "border-emerald-400 ring-2 ring-emerald-500/15" : "border-gray-200 bg-gray-50/80 hover:bg-gray-100"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Calendar size={14} className="shrink-0 text-emerald-600" />
                  <span className="truncate">{getActiveDateLabel()}</span>
                </span>
                <ChevronDown size={14} className={`shrink-0 text-gray-400 transition-transform ${isDateDropdownOpen ? "rotate-180 text-emerald-600" : ""}`} />
              </button>
              {isDateDropdownOpen && (
                <div
                  role="listbox"
                  aria-label="Date filter"
                  className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl animate-in fade-in zoom-in-95 duration-100"
                >
                  {DATE_FILTERS.map((filter) => {
                    const selected = dateFilter === filter.id;
                    const label = filter.id === "today"
                      ? `Today (${formatDateLabel(todayDateString)})`
                      : filter.id === "yesterday"
                      ? `Yesterday (${formatDateLabel(yesterdayDateString)})`
                      : filter.id === "custom" && customDateRange.start && customDateRange.end
                      ? `Custom: ${formatDateLabel(customDateRange.start)} - ${formatDateLabel(customDateRange.end)}`
                      : filter.label;
                    return (
                      <button
                        key={filter.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => handleDateFilterSelect(filter.id)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-xs transition cursor-pointer ${
                          selected ? "bg-emerald-50 font-extrabold text-emerald-900" : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <span className="truncate">{label}</span>
                        {selected && <Check size={14} className="shrink-0 text-emerald-600" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ORDERS PRESENTATION (MOBILE STACKED CARDS / DESKTOP CLEAN TABLE) */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-xs overflow-hidden">
        {!hasCurrentOrders && error ? (
          <div className="p-8 text-center text-rose-600">
            <p className="text-sm font-bold">{error}</p>
            <button
              onClick={() => fetchOrderList(false)}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition cursor-pointer"
            >
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        ) : !hasCurrentOrders || (loading && orders.length === 0) ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={24} className="animate-spin text-emerald-600" />
              <p className="text-xs font-bold text-gray-400">Loading order pipeline...</p>
            </div>
          </div>
        ) : error && orders.length === 0 ? (
          <div className="p-8 text-center text-rose-600">
            <p className="text-sm font-bold">{error}</p>
            <button
              onClick={() => fetchOrderList(false)}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition cursor-pointer"
            >
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-16 text-center text-xs font-medium text-gray-400">
            No orders found for the selected {dateFilter !== "all" ? `date (${dateFilter})` : ""} criteria.
          </div>
        ) : (
          <>
            {/* 1. MOBILE VIEW (<640px): Stacked Order Cards (Zero Horizontal Scroll) */}
            <div className="block sm:hidden divide-y divide-gray-100 p-2 space-y-2">
              {filteredOrders.map((order) => {
                const orderDateObj = getOrderTimestampDate(order);
                const formattedTime = orderDateObj
                  ? orderDateObj.toLocaleTimeString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";
                const formattedDate = orderDateObj
                  ? orderDateObj.toLocaleDateString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                    })
                  : "";

                const customerName = getCleanCustomerName(
                  order.customer_name,
                  order.billing?.first_name,
                  order.billing?.last_name,
                  "Customer"
                );
                const customerPhone = order.phone || order.billing?.phone;
                const locationInfo = getOrderLocationInfo(order);

                return (
                  <div
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                    className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-3 shadow-2xs hover:border-gray-200 transition active:bg-gray-50/50 cursor-pointer"
                  >
                    {/* Card Header: Order # + Date + Location + Status */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <span className="font-extrabold text-gray-900 text-sm">#{order.id}</span>
                        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${getLocationBadgeClass(locationInfo.location_key)}`}>
                          <MapPin size={10} className="shrink-0" />
                          <span>{locationInfo.location}</span>
                        </span>
                        <span className="text-[11px] text-gray-400">
                          {formattedDate} {formattedTime && `• ${formattedTime}`}
                        </span>
                      </div>
                      <div>{getStatusBadge(order.status, order.is_unpaid)}</div>
                    </div>

                    {/* Card Body: Customer Details & Financials */}
                    <div className="flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-bold text-gray-800 truncate">{customerName}</p>
                        {customerPhone && (
                          <p className="text-[11px] text-gray-500 flex items-center gap-1 truncate">
                            <Phone size={10} className="text-gray-400 shrink-0" />
                            <span>{customerPhone}</span>
                          </p>
                        )}
                        <p className="text-[11px] text-gray-400 truncate">
                          {order.items_count || order.items?.length || 1} item(s) • {order.payment_method_title || order.payment_method || "COD"}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-sm font-black text-gray-900">₹{order.total || 0}</p>
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/60 uppercase">
                          {order.payment_method_title || order.payment_method || "COD"}
                        </span>
                      </div>
                    </div>

                    {/* Card Action Row: 1 Primary Next Action Button */}
                    <div className="pt-1 flex items-center gap-2">
                      <div className="flex-1">
                        {renderPrimaryAction(order, true)}
                      </div>
                      {["processing", "packed", "out-for-delivery", "dispatched"].includes(order.status) ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOrder(order);
                          }}
                          className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50 shadow-2xs transition shrink-0"
                          title="View Details"
                        >
                          <Eye size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 2. DESKTOP VIEW (>=640px): Clean Table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-gray-100 bg-gray-50/75 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-5 py-3.5">Order # & Time</th>
                    <th className="px-5 py-3.5">Customer Details</th>
                    <th className="px-5 py-3.5">Items</th>
                    <th className="px-5 py-3.5">Amount</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Next Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                  {filteredOrders.map((order) => {
                    const locationInfo = getOrderLocationInfo(order);

                    return (
                      <tr
                        key={order.id}
                        onClick={() => setSelectedOrder(order)}
                        className="hover:bg-gray-50/80 transition cursor-pointer"
                      >
                        {/* Order # and Date */}
                        <td className="px-5 py-3.5">
                          <span className="font-extrabold text-gray-900">#{order.id}</span>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {(() => {
                              const d = getOrderTimestampDate(order);
                              return d
                                ? d.toLocaleDateString("en-IN", {
                                    timeZone: "Asia/Kolkata",
                                    day: "numeric",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "N/A";
                            })()}
                          </p>
                        </td>

                        {/* Customer Name, Location & Phone */}
                        <td className="px-5 py-3.5">
                          <p className="font-bold text-gray-900 truncate max-w-[160px]">
                            {getCleanCustomerName(order.customer_name, order.billing?.first_name, order.billing?.last_name, "Guest Customer")}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold ${getLocationBadgeClass(locationInfo.location_key)}`}>
                              <MapPin size={9} className="shrink-0" />
                              <span>{locationInfo.location}</span>
                            </span>
                            <span className="text-[11px] text-gray-500 flex items-center gap-1">
                              <Phone size={10} className="text-gray-400" />
                              {order.phone || order.billing?.phone || "No phone"}
                            </span>
                          </div>
                        </td>

                        {/* Items Preview */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-2 overflow-hidden">
                              {order.items?.slice(0, 3).map((item, idx) => (
                                <img
                                  key={idx}
                                  src={item.image || "https://placehold.co/40x40?text=Item"}
                                  alt={item.name}
                                  className="inline-block h-7 w-7 rounded-lg object-cover ring-2 ring-white bg-gray-100"
                                />
                              ))}
                            </div>
                            <span className="text-xs font-semibold text-gray-600">
                              {order.items_count || order.items?.length || 1} item(s)
                            </span>
                          </div>
                        </td>

                        {/* Total & Payment */}
                        <td className="px-5 py-3.5">
                          <p className="font-bold text-gray-900">₹{order.total || 0}</p>
                          <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 uppercase mt-0.5">
                            {order.payment_method_title || order.payment_method || "COD"}
                          </span>
                        </td>

                        {/* Status Badge */}
                        <td className="px-5 py-3.5">{getStatusBadge(order.status, order.is_unpaid)}</td>

                        {/* Next Action Column */}
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {renderPrimaryAction(order, false)}
                            {order.status === "processing" && !order.is_unpaid && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStatusUpdate(order.id, "out-for-delivery");
                                }}
                                disabled={updatingIds.has(order.id)}
                                className="inline-flex items-center gap-1 rounded-xl bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 border border-blue-200 transition cursor-pointer disabled:opacity-50"
                                title="Quick Dispatch"
                              >
                                <Truck size={12} />
                                <span>Dispatch</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Server Pagination Controls */}
        {(orders.length > 0 || !loading) && totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/50 px-4 py-3 sm:px-6 sm:py-3.5">
            <p className="text-xs text-gray-500 font-medium text-center sm:text-left">
              Showing <span className="font-bold text-gray-900">{(page - 1) * perPage + 1}</span> to{" "}
              <span className="font-bold text-gray-900">
                {Math.min(page * perPage, totalOrders)}
              </span>{" "}
              of <span className="font-bold text-gray-900">{totalOrders}</span> orders
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer shadow-2xs"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="text-xs font-bold text-gray-700 px-2">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer shadow-2xs"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MOBILE FILTERS BOTTOM SHEET / DRAWER */}
      {isMobileFiltersOpen && (
        <div
          onClick={() => setIsMobileFiltersOpen(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:hidden animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-h-[85vh] bg-white rounded-t-[28px] p-5 shadow-2xl space-y-4 overflow-y-auto animate-in slide-in-from-bottom duration-200"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-emerald-600" />
                <h3 className="text-base font-black text-gray-900">Order Filters</h3>
              </div>
              <button
                onClick={() => setIsMobileFiltersOpen(false)}
                className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
              >
                <X size={16} />
              </button>
            </div>

            {/* Status Filters */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Fulfillment Status
              </label>
              <div className="grid grid-cols-2 gap-2">
                {tabs.map((tab) => {
                  const isSelected = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        handleTabChange(tab.id);
                      }}
                      className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-bold transition text-left cursor-pointer border ${
                        isSelected
                          ? "bg-emerald-50 text-emerald-900 border-emerald-300 shadow-2xs"
                          : "bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100"
                      }`}
                    >
                      <span className="truncate">{tab.label}</span>
                      {isSelected && <Check size={13} className="text-emerald-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date Filters in Bottom Sheet */}
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Date Window
              </label>
              <div className="grid grid-cols-2 gap-2">
                {DATE_FILTERS.map((f) => {
                  const isSelected = dateFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        handleDateFilterSelect(f.id);
                      }}
                      className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-bold transition text-left cursor-pointer border ${
                        isSelected
                          ? "bg-emerald-50 text-emerald-900 border-emerald-300 shadow-2xs"
                          : "bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100"
                      }`}
                    >
                      <span className="truncate">{f.label}</span>
                      {isSelected && <Check size={13} className="text-emerald-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Location Filters in Bottom Sheet */}
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Delivery Location
              </label>
              <div className="grid grid-cols-2 gap-2">
                {LOCATION_OPTIONS.map((loc) => {
                  const isSelected = locationFilter === loc.id;
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => {
                        setLocationFilter(loc.id);
                        setPage(1);
                      }}
                      className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-bold transition text-left cursor-pointer border ${
                        isSelected
                          ? "bg-purple-50 text-purple-900 border-purple-300 shadow-2xs"
                          : "bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${loc.dot}`} />
                        <span className="truncate">{loc.label}</span>
                      </div>
                      {isSelected && <Check size={13} className="text-purple-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("all");
                  setDateFilter("today");
                  setLocationFilter("all");
                  setPage(1);
                  setIsMobileFiltersOpen(false);
                }}
                className="text-xs font-bold text-gray-500 hover:text-gray-900 underline px-2 py-2"
              >
                Reset All
              </button>
              <button
                type="button"
                onClick={() => setIsMobileFiltersOpen(false)}
                className="flex-1 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-500 active:scale-95 transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM DATE RANGE MODAL */}
      {isCustomModalOpen && (
        <div
          onClick={() => setIsCustomModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 space-y-5 animate-in zoom-in-95 duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-date-title"
          >
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-emerald-600" />
                <h3 id="custom-date-title" className="text-base font-black text-gray-900">
                  Custom Date Window
                </h3>
              </div>
              <button
                onClick={() => setIsCustomModalOpen(false)}
                className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Quick Shortcuts
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPresetRange(14)}
                  className="rounded-xl bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 text-xs font-bold text-slate-700 transition active:scale-95 cursor-pointer"
                >
                  Last 14 Days
                </button>
                <button
                  type="button"
                  onClick={() => setPresetRange(30)}
                  className="rounded-xl bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 text-xs font-bold text-slate-700 transition active:scale-95 cursor-pointer"
                >
                  Last 30 Days
                </button>
                <button
                  type="button"
                  onClick={() => setMonthPreset()}
                  className="rounded-xl bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 text-xs font-bold text-slate-700 transition active:scale-95 cursor-pointer"
                >
                  This Month
                </button>
              </div>
            </div>

            {/* Date Pickers */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500 uppercase">
                  From Date
                </label>
                <input
                  type="date"
                  value={tempDateRange.start}
                  onChange={(e) => setTempDateRange((prev) => ({ ...prev, start: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 text-xs font-semibold text-gray-800 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500 uppercase">
                  To Date
                </label>
                <input
                  type="date"
                  value={tempDateRange.end}
                  onChange={(e) => setTempDateRange((prev) => ({ ...prev, end: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 text-xs font-semibold text-gray-800 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsCustomModalOpen(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyCustomRange}
                disabled={!tempDateRange.start || !tempDateRange.end}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-500 active:scale-95 transition disabled:opacity-40 cursor-pointer"
              >
                Apply Range
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Details Drawer / Modal */}
      {selectedOrder && (
        <div
          onClick={() => setSelectedOrder(null)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] sm:max-h-[95vh] h-full w-full max-w-full sm:max-w-xl flex-col bg-white shadow-2xl rounded-t-[28px] sm:rounded-3xl border border-gray-100 overflow-hidden"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 p-4 sm:p-6 shrink-0 bg-white">
              <div className="min-w-0 flex-1 pr-3">
                <h3 className="text-base sm:text-lg font-black text-gray-900 truncate">
                  Order #{selectedOrder.id}
                </h3>
                <p className="text-[11px] sm:text-xs text-gray-500 truncate mt-0.5">
                  Placed on{" "}
                  {(() => {
                    const d = getOrderTimestampDate(selectedOrder);
                    return d
                      ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                      : "N/A";
                  })()}
                </p>
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="rounded-xl border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700 cursor-pointer shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Scroll Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* Status Selector Card */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] sm:text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Current Fulfillment Status
                  </span>
                  {getStatusBadge(selectedOrder.status, selectedOrder.is_unpaid)}
                </div>

                {isOrderDeliveredLocked(selectedOrder) ? (
                  <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-xs space-y-1.5 shadow-2xs">
                    <div className="flex items-center gap-2 font-bold text-gray-800">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                      <span>Delivered (Completed)</span>
                    </div>
                    <p className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5">
                      <Lock size={12} className="text-gray-400 shrink-0" />
                      <span>Status changes are locked after 72 hours (3 days).</span>
                    </p>
                  </div>
                ) : selectedOrder.is_unpaid ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3 text-xs space-y-1.5 shadow-2xs">
                    <div className="flex items-center gap-2 font-bold text-amber-900">
                      <AlertCircle size={15} className="text-amber-600 shrink-0" />
                      <span>Awaiting Online Payment</span>
                    </div>
                    <p className="text-[11px] font-medium text-amber-700">
                      Online payment has not been received. Orders cannot be packed or delivered until payment is captured.
                    </p>
                  </div>
                ) : (
                  <div className="relative w-full" ref={statusDropdownRef}>
                    <button
                      type="button"
                      disabled={updatingIds.has(selectedOrder.id)}
                      onClick={() => setIsStatusDropdownOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-xs font-bold text-gray-800 outline-none hover:border-emerald-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition shadow-2xs cursor-pointer disabled:opacity-60"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            ALL_STATUS_BADGES.find((o) => o.value === selectedOrder.status)?.dot || "bg-gray-400"
                          }`}
                        />
                        <span className="truncate">
                          {ALL_STATUS_BADGES.find((o) => o.value === selectedOrder.status)?.label || selectedOrder.status}
                        </span>
                      </div>
                      <ChevronDown
                        size={15}
                        className={`text-gray-500 transition-transform duration-200 shrink-0 ml-2 ${
                          isStatusDropdownOpen ? "rotate-180 text-emerald-600" : ""
                        }`}
                      />
                    </button>

                    {/* Custom In-DOM Dropdown Menu */}
                    {isStatusDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 z-40 mt-1.5 w-full rounded-xl bg-white border border-gray-200 shadow-xl overflow-hidden py-1 max-h-72 overflow-y-auto divide-y divide-gray-50 animate-in fade-in zoom-in-95 duration-150">
                        {STATUS_OPTIONS.map((option) => {
                          const isSelected = selectedOrder.status === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setIsStatusDropdownOpen(false);
                                if (!isSelected) {
                                  handleStatusUpdate(selectedOrder.id, option.value);
                                }
                              }}
                              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition cursor-pointer text-left ${
                                isSelected
                                  ? "bg-emerald-50/80 text-emerald-900 font-extrabold"
                                  : "text-gray-700 font-semibold hover:bg-gray-50"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${option.dot}`} />
                                <span className="truncate">{option.label}</span>
                              </div>
                              {isSelected && (
                                <Check size={14} className="text-emerald-600 shrink-0 ml-2" />
                              )}
                            </button>
                          );
                        })}
                        {(() => {
                          const refundEmailSent = selectedOrder.manual_refund_email_sent_at ||
                            selectedOrder.meta_data?.find((meta) => meta.key === "_manual_refund_email_sent_at")?.value;
                          const refundEmailLabel = String(refundEmailSent || "").startsWith("sending:")
                            ? "Refund email pending"
                            : "Refund email sent";
                          return (
                            <button
                              type="button"
                              disabled={updatingIds.has(selectedOrder.id) || Boolean(refundEmailSent)}
                              onClick={() => handleSendRefundEmail(selectedOrder)}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-left font-semibold text-rose-700 transition hover:bg-rose-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Mail size={14} className="shrink-0" />
                              <span>{refundEmailSent ? refundEmailLabel : "Send refund email"}</span>
                              {refundEmailSent && <Check size={14} className="ml-auto text-emerald-600" />}
                            </button>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Delivery Address & Customer Info */}
              <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                    <MapPin size={14} className="text-emerald-600 shrink-0" />
                    <span>Delivery & Contact Information</span>
                  </h4>
                  {(() => {
                    const selLoc = getOrderLocationInfo(selectedOrder);
                    return (
                      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${getLocationBadgeClass(selLoc.location_key)}`}>
                        <MapPin size={11} className="shrink-0" />
                        <span>{selLoc.location}</span>
                      </span>
                    );
                  })()}
                </div>

                <div className="space-y-1.5 text-xs text-gray-700 font-medium">
                  <p className="font-bold text-gray-900 text-sm">
                    {getCleanCustomerName(selectedOrder.customer_name, selectedOrder.billing?.first_name, selectedOrder.billing?.last_name, "Customer")}
                  </p>
                  <p className="text-gray-600 break-words">
                    {selectedOrder.shipping?.address_1 || selectedOrder.billing?.address_1 || "No street address provided"}
                    {(selectedOrder.shipping?.address_2 || selectedOrder.billing?.address_2) && `, ${selectedOrder.shipping?.address_2 || selectedOrder.billing?.address_2}`}
                  </p>
                  <p className="text-gray-600 break-words font-semibold">
                    {[
                      selectedOrder.shipping?.city || selectedOrder.billing?.city,
                      selectedOrder.shipping?.state || selectedOrder.billing?.state,
                      selectedOrder.shipping?.postcode || selectedOrder.billing?.postcode,
                    ]
                      .filter(Boolean)
                      .join(", ") || "Vasai, Maharashtra"}
                  </p>
                  <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
                    <a
                      href={`tel:${selectedOrder.phone || selectedOrder.billing?.phone}`}
                      className="inline-flex items-center gap-1 text-emerald-600 font-bold hover:underline"
                    >
                      <Phone size={12} /> {selectedOrder.phone || selectedOrder.billing?.phone || "No Phone"}
                    </a>
                    {selectedOrder.billing?.email && (
                      <a
                        href={`mailto:${selectedOrder.billing.email}`}
                        className="inline-flex items-center gap-1 text-gray-500 hover:underline truncate max-w-[200px]"
                      >
                        <Mail size={12} /> {selectedOrder.billing.email}
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <Boxes size={14} className="text-emerald-600 shrink-0" />
                  <span>Order Items ({selectedOrder.items?.length || 0})</span>
                </h4>

                <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white overflow-hidden">
                  {selectedOrder.items?.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3.5 sm:p-4 gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <img
                          src={item.image || "https://placehold.co/40x40?text=Item"}
                          alt={item.name}
                          className="h-10 w-10 rounded-lg object-cover bg-gray-100 border border-gray-200 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-gray-900 line-clamp-2 leading-tight">{item.name}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            Qty: {item.quantity} × ₹{item.price || (item.total && item.quantity ? Math.round(item.total / item.quantity) : 0)}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-gray-900 shrink-0">
                        ₹{item.total || 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Customer Delivery Instructions (if provided) */}
              {Boolean(selectedOrder.customer_note && String(selectedOrder.customer_note).trim()) && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/75 p-3.5 sm:p-4 space-y-1.5 shadow-2xs">
                  <h4 className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                    <Receipt size={14} className="text-amber-600 shrink-0" />
                    <span>Customer Delivery Instructions</span>
                  </h4>
                  <p className="text-xs text-amber-950 font-medium whitespace-pre-wrap leading-relaxed">
                    "{String(selectedOrder.customer_note).trim()}"
                  </p>
                </div>
              )}

              {/* Order Financials */}
              {(() => {
                const itemsSubtotal = (selectedOrder.items || []).reduce(
                  (sum, item) => sum + (Number(item.total) || 0),
                  0
                );
                const discountTotal = Number(selectedOrder.discount_total) || 0;
                const shippingTotal = Number(selectedOrder.shipping_total) || 0;
                const taxTotal = Number(selectedOrder.total_tax) || 0;
                const feeTotal = Number(selectedOrder.fee_total) || 0;
                const orderTotal = Number(selectedOrder.total) || 0;
                const calculatedSubtotal =
                  itemsSubtotal > 0
                    ? itemsSubtotal
                    : Math.max(0, orderTotal - shippingTotal - taxTotal - feeTotal + discountTotal);

                return (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/75 p-4 space-y-2 text-xs">
                    <div className="flex justify-between text-gray-600">
                      <span>Payment Method:</span>
                      <span className="font-bold text-gray-900 uppercase">
                        {selectedOrder.payment_method_title || selectedOrder.payment_method || "COD"}
                      </span>
                    </div>

                    <div className="border-t border-gray-200/60 my-1" />

                    <div className="flex justify-between text-gray-600">
                      <span>Items Subtotal:</span>
                      <span className="font-semibold text-gray-900">
                        ₹{calculatedSubtotal.toFixed(2)}
                      </span>
                    </div>

                    {discountTotal > 0 && (
                      <div className="flex justify-between text-emerald-700 font-semibold">
                        <span>Discount / Coupon:</span>
                        <span>-₹{discountTotal.toFixed(2)}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-gray-600">
                      <span>Delivery / Shipping:</span>
                      <span className="font-semibold text-gray-900">
                        {shippingTotal > 0 ? `₹${shippingTotal.toFixed(2)}` : "Free Delivery"}
                      </span>
                    </div>

                    {taxTotal > 0 && (
                      <div className="flex justify-between text-gray-600">
                        <span>Taxes:</span>
                        <span className="font-semibold text-gray-900">₹{taxTotal.toFixed(2)}</span>
                      </div>
                    )}

                    {feeTotal > 0 && (
                      <div className="flex justify-between text-gray-600">
                        <span>Additional Fees:</span>
                        <span className="font-semibold text-gray-900">₹{feeTotal.toFixed(2)}</span>
                      </div>
                    )}

                    <div className="flex justify-between border-t border-gray-200 pt-2 text-sm font-black text-gray-900">
                      <span>Total Amount:</span>
                      <span className="text-emerald-600">₹{selectedOrder.total || "0.00"}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer Quick Dispatch */}
            <div className="border-t border-gray-100 p-3.5 sm:p-4 bg-white flex flex-wrap gap-2 shrink-0">
              <button
                onClick={() => setSelectedOrder(null)}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                Close
              </button>

              {/* Cancellation button where permitted */}
              {["processing", "packed"].includes(selectedOrder.status) && (
                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to cancel this order?")) {
                      handleStatusUpdate(selectedOrder.id, "cancelled");
                    }
                  }}
                  disabled={updatingIds.has(selectedOrder.id)}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer disabled:opacity-50"
                >
                  Cancel Order
                </button>
              )}

              {selectedOrder.status === "processing" && (
                <>
                  <button
                    onClick={() => handleStatusUpdate(selectedOrder.id, "packed")}
                    disabled={updatingIds.has(selectedOrder.id)}
                    className="flex-1 min-w-[120px] rounded-xl bg-purple-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-purple-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Package size={14} />
                    <span>Mark Packed</span>
                  </button>
                  <button
                    onClick={() => handleStatusUpdate(selectedOrder.id, "out-for-delivery")}
                    disabled={updatingIds.has(selectedOrder.id)}
                    className="flex-1 min-w-[120px] rounded-xl bg-blue-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Truck size={14} />
                    <span>Dispatch Rider</span>
                  </button>
                </>
              )}

              {selectedOrder.status === "packed" && (
                <button
                  onClick={() => handleStatusUpdate(selectedOrder.id, "out-for-delivery")}
                  disabled={updatingIds.has(selectedOrder.id)}
                  className="flex-1 rounded-xl bg-blue-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Truck size={14} />
                  <span>Dispatch Rider Now</span>
                </button>
              )}

              {(selectedOrder.status === "out-for-delivery" || selectedOrder.status === "dispatched") && (
                <button
                  onClick={() => handleStatusUpdate(selectedOrder.id, "completed")}
                  disabled={updatingIds.has(selectedOrder.id)}
                  className="flex-1 rounded-xl bg-emerald-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 size={14} />
                  <span>Mark Delivered</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Orders;
