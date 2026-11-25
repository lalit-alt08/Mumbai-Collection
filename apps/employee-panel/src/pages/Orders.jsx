import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useOutletContext } from "react-router-dom";
import {
  Search,
  Truck,
  CheckCircle2,
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
  BellRing,
  Volume2,
  VolumeX,
  Fan,
} from "lucide-react";
import {
  getOrders,
  bulkDispatchOrders,
  updateOrderStatus,
  confirmOrderDeliveryReview,
  sendOrderRefundEmail,
  getEmployeeOrderStreamUrl,
  acknowledgeOrder,
  getPackingAlarms,
} from "../services/employeeApi.js";
import {
  OrdersPipelineCoordinator,
  buildOrdersQueryKey,
} from "../utils/ordersPipelineCoordinator.js";
import {
  isOrderEligibleForDispatch,
  deriveEligibleOrders,
  computeActiveSelection,
  createBulkConfirmSnapshot,
  validateBulkConfirmSnapshot,
  reconcileBulkDispatchResults,
} from "../utils/bulkDispatchSelection.js";
import {
  triggerNewOrderNotification,
  requestNotificationPermission,
  armOrderAlarm,
  testOrderAlertSound,
  isAudioArmed,
  getAudioArmStatus,
  subscribeToAlarmState,
  acknowledgeOrderAlarm,
  restoreOrderAlarm,
  restoreOrderAlarms,
  muteAllOrderAlarms,
  isOrderAlarmQuietHours,
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
import { OrderDetailsModal } from "../components/orders/OrderDetailsModal.jsx";
import { OrderCustomDateModal } from "../components/orders/OrderCustomDateModal.jsx";
import { OrderMobileFiltersModal } from "../components/orders/OrderMobileFiltersModal.jsx";
import { OrderBulkModals } from "../components/orders/OrderBulkModals.jsx";

export { resolveTabFromStatusParam, getOrderDateIST, getOrderTimestampDate, getCleanCustomerName };

const STATUS_OPTIONS = [
  { value: "processing", label: "Processing / To Pack", shortLabel: "To Pack", dot: "bg-amber-400" },
  { value: "packed", label: "Packed", shortLabel: "Packed", dot: "bg-purple-500" },
  { value: "out-for-delivery", label: "Out for Delivery (Rider)", shortLabel: "Out for Delivery", dot: "bg-blue-500" },
  { value: "completed", label: "Delivered (Completed)", shortLabel: "Delivered", dot: "bg-emerald-500" },
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

const getScheduledOrderMeta = (order) => {
  const meta = order?.meta_data || [];
  const scheduledDate = meta.find((entry) => entry.key === "_scheduled_delivery_date")?.value;
  const scheduledLabel = meta.find((entry) => entry.key === "_scheduled_delivery_label")?.value;
  if (meta.some((entry) => entry.key === "_payment_captured_without_delivery_slot" && entry.value === "yes")) {
    return { review: true, date: null, label: "Payment captured; delivery slot needs confirmation" };
  }
  const isScheduled = meta.some((entry) => entry.key === "_order_placed_after_hours" && ["yes", "true"].includes(String(entry.value).toLowerCase())) || Boolean(scheduledDate || scheduledLabel);
  return isScheduled ? { review: false, date: scheduledDate, label: scheduledLabel } : null;
};

export const isOrderDeliveredLocked = (order, now = Date.now()) => {
  if (!order) return false;
  const deliveryMeta = order.meta_data?.find((m) => m.key === "_delivery_status");
  const effectiveStatus = deliveryMeta?.value || order.status;
  if (effectiveStatus !== "completed") return false;
  if (order.is_status_locked === true) return true;

  let timestamp = null;
  const deliveryCompletedAt =
    order.delivery_completed_at ||
    order.meta_data?.find((m) => m.key === "_delivery_completed_at")?.value ||
    order.meta_data?.find((m) => m.key === "_delivered_at")?.value;

  if (deliveryCompletedAt) {
    const t = new Date(deliveryCompletedAt).getTime();
    if (!isNaN(t) && t > 0) timestamp = t;
  }
  const parseTs = (raw, isGmt) => {
    if (!raw) return null;
    const s = isGmt ? (raw.endsWith("Z") ? raw : `${raw}Z`) : (/(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}+05:30`);
    const t = new Date(s).getTime();
    return !isNaN(t) && t > 0 ? t : null;
  };

  timestamp = timestamp || parseTs(order.date_completed_gmt, true) ||
    parseTs(order.date_completed, false) ||
    parseTs(order.date_created_gmt, true) ||
    parseTs(order.date_created, false);

  if (timestamp) {
    return (now - timestamp) >= 72 * 60 * 60 * 1000;
  }
  return true;
};

function Orders() {
  const [searchParams, setSearchParams] = useSearchParams();
  const outletContext = useOutletContext();
  const setPageRefresh = outletContext?.setPageRefresh;
  const [orders, setOrders] = useState([]);
  const liveOrdersRef = useRef(orders);
  liveOrdersRef.current = orders;
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkBusyRef = useRef(false);
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [alarmDegraded, setAlarmDegraded] = useState(false);
  const [lastAlarmCheck, setLastAlarmCheck] = useState(null);
  const [bulkResults, setBulkResults] = useState([]);
  const [ordersQueryKey, setOrdersQueryKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastOrderRefresh, setLastOrderRefresh] = useState(null);
  const [activeTab, setActiveTab] = useState(() =>
    resolveTabFromStatusParam(searchParams.get("status"))
  );
  const [dateFilter, setDateFilter] = useState(() => ["today", "yesterday", "7days", "all"].includes(searchParams.get("date")) ? searchParams.get("date") : "today");
  const [dateBasis, setDateBasis] = useState(() => searchParams.get("date_basis") === "completed" && searchParams.get("status") === "completed" ? "completed" : "created");
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

  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("search") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("search") || "");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [cancelConfirmPending, setCancelConfirmPending] = useState(false);
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
    const requestedDate = searchParams.get("date");
    if (["today", "yesterday", "7days", "all"].includes(requestedDate)) setDateFilter(requestedDate);
    setDateBasis(searchParams.get("date_basis") === "completed" && tabFromUrl === "completed" ? "completed" : "created");
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
          setCancelConfirmPending(false);

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

  const pageRef = useRef(page);
  pageRef.current = page;

  const currentOrdersQueryKey = buildOrdersQueryKey({
    activeTab,
    debouncedSearch,
    locationFilter,
    dateFilter,
    dateBasis,
    customDateRange: dateFilter === "custom" ? customDateRange : null,
    page,
  });
  const hasCurrentOrders = ordersQueryKey === currentOrdersQueryKey;

  // Debounce search input by 400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      const normalized = searchQuery.trim();
      setDebouncedSearch(normalized.length >= 2 ? normalized : "");
      setPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Alarm state subscription
  const [alarmState, setAlarmState] = useState(() => {
    const status = getAudioArmStatus();
    return {
      unacknowledgedOrders: [],
      isAlarming: false,
      isArmed: Boolean(status.armed),
      voiceArmed: Boolean(status.voiceArmed),
      chimeArmed: Boolean(status.chimeArmed),
    };
  });
  const [ackError, setAckError] = useState(null);

  useEffect(() => {
    return subscribeToAlarmState(setAlarmState);
  }, []);

  const alarmStateRef = useRef(alarmState);
  useEffect(() => {
    alarmStateRef.current = alarmState;
  }, [alarmState]);

  const activeFiltersRef = useRef({
    activeTab,
    debouncedSearch,
    locationFilter,
    dateFilter,
    dateBasis,
    customDateRange: dateFilter === "custom" ? customDateRange : null,
    page,
  });
  activeFiltersRef.current = {
    activeTab,
    debouncedSearch,
    locationFilter,
    dateFilter,
    dateBasis,
    customDateRange: dateFilter === "custom" ? customDateRange : null,
    page,
  };

  const handleStateUpdate = useCallback(
    ({ orders: newOrders, queryKey, totalOrders: newTotal, totalPages: newPages }) => {
      const calculatedPages = Math.ceil((Number(newTotal) || 0) / perPage) || 1;
      const validTotalPages = Math.max(
        1,
        Number.isFinite(Number(newPages)) ? Math.min(Number(newPages), calculatedPages) : calculatedPages
      );
      const currentPage = pageRef.current || activeFiltersRef.current?.page || 1;

      // When a successful refresh reports fewer pages than the current page number
      // (e.g. staff dispatched the only order on the last page), move to the last
      // valid page and fetch it instead of showing an empty page without controls.
      if (currentPage > validTotalPages) {
        pageRef.current = validTotalPages;
        activeFiltersRef.current = {
          ...activeFiltersRef.current,
          page: validTotalPages,
        };
        setLoading(true);
        setTotalOrders(newTotal);
        setTotalPages(validTotalPages);
        setPage(validTotalPages);
        return;
      }

      setError("");
      setOrders(newOrders);
      setLastOrderRefresh(Date.now());
      setOrdersQueryKey(queryKey);
      setTotalOrders(newTotal);
      setTotalPages(newPages);
    },
    [perPage]
  );

  const handleError = useCallback((errorMsg) => {
    setError(errorMsg);
  }, []);

  const handleLoadingChange = useCallback((loadingState) => {
    setLoading(loadingState);
  }, []);

  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new OrdersPipelineCoordinator({
      getOrders,
      getPackingAlarms,
      getRingingIds: () => alarmStateRef.current?.unacknowledgedOrders || [],
      onStateUpdate: handleStateUpdate,
      onError: handleError,
      onLoadingChange: handleLoadingChange,
      onAlarmTrigger: triggerNewOrderNotification,
      onAlarmAcknowledge: acknowledgeOrderAlarm,
    });
  }
  coordinatorRef.current.onStateUpdate = handleStateUpdate;
  coordinatorRef.current.onError = handleError;
  coordinatorRef.current.onLoadingChange = handleLoadingChange;

  const fetchOrderList = useCallback(
    (isBackground = false) => {
      const isBg = isBackground === true;
      if (!coordinatorRef.current) return Promise.resolve({ status: "skipped" });
      return coordinatorRef.current.fetchOrderList({
        isBackground: isBg,
        activeFilters: activeFiltersRef.current,
        perPage,
        hasUpdatingIds: updatingIdsRef.current.size > 0,
      });
    },
    [perPage]
  );

  // Counter packing alarm background checker
  const runAlarmCheck = useCallback(async () => {
    if (!coordinatorRef.current) return;
    const res = await coordinatorRef.current.checkActivePackingAlarms({ isHidden: document.hidden });
    if (res?.status === "skipped" || res?.status === "in_flight") return;
    if (res?.discovery_unavailable || res?.partial_discovery_failure || res?.status === "error") {
      setAlarmDegraded(true);
    } else if (res?.status === "success" && !res?.discovery_unavailable && !res?.partial_discovery_failure) {
      setAlarmDegraded(false);
      setLastAlarmCheck(Date.now());
    }
  }, []);

  const handleMuteAllAlarms = async () => {
    const orderIds = [...alarmState.unacknowledgedOrders];
    if (orderIds.length === 0) return;
    muteAllOrderAlarms(orderIds);
    setAckError(null);
    const results = await Promise.allSettled(orderIds.map((id) => acknowledgeOrder(id)));
    const failedIds = [];
    const localOnlyIds = [];
    results.forEach((res, index) => {
      if (res.status === "rejected" || !res.value?.success) {
        failedIds.push(orderIds[index]);
      } else if (res.value.shared === false) {
        localOnlyIds.push(orderIds[index]);
      }
    });
    if (failedIds.length > 0) restoreOrderAlarms(failedIds);
    if (failedIds.length > 0 || localOnlyIds.length > 0) {
      setAckError({
        failedIds: [...failedIds, ...localOnlyIds],
        message: [
          failedIds.length && `Could not acknowledge ${failedIds.map((id) => `#${id}`).join(", ")}; their alarms were restored.`,
          localOnlyIds.length && `Acknowledgement for ${localOnlyIds.map((id) => `#${id}`).join(", ")} is local only; other devices may still ring. Retry when the store network is available.`,
        ].filter(Boolean).join(" "),
      });
    }
  };

  const handleAcknowledgeSingleOrder = async (orderId) => {
    acknowledgeOrderAlarm(orderId);
    setAckError(null);
    try {
      const result = await acknowledgeOrder(orderId);
      if (!result?.success) throw new Error("Acknowledgement failed.");
      if (result.shared === false) {
        setAckError({
          failedIds: [orderId],
          message: `Order #${orderId} was acknowledged locally only; other devices may still ring. Retry when the store network is available.`,
        });
      }
    } catch (_) {
      restoreOrderAlarm(orderId);
      setAckError({
        failedIds: [orderId],
        message: `Failed to acknowledge Order #${orderId} with server. Alarm restored.`,
      });
    }
  };

  // 1. Fetch order list whenever user modifies filters, search, or pagination
  useEffect(() => {
    fetchOrderList(false);
  }, [activeTab, debouncedSearch, locationFilter, dateFilter, dateBasis, customDateRange, page]);

  // 2. Persistent SSE connection with 45s heartbeat watchdog & direct event notifications
  useEffect(() => {
    let eventSource = null;
    let isReconnecting = false;
    let watchdogTimer = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let isDisposed = false;

    const resetWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      // 45 seconds watchdog: if neither heartbeat nor event arrives within 45s, reconnect
      watchdogTimer = setTimeout(() => {
        if (!isDisposed) {
          reconnectStream(true);
        }
      }, 45000);
    };

    const scheduleEventRefresh = () => {
      if (eventRefreshTimerRef.current) {
        clearTimeout(eventRefreshTimerRef.current);
      }
      eventRefreshTimerRef.current = setTimeout(() => {
        eventRefreshTimerRef.current = null;
        fetchOrderList(true);
      }, 700);
    };

    const cleanupCurrentStream = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
      if (eventSource) {
        try {
          eventSource.close();
        } catch (_) {}
        eventSource = null;
      }
    };

    const reconnectStream = (immediate = false) => {
      if (isDisposed) return;
      cleanupCurrentStream();

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      isReconnecting = true;
      const delay = immediate ? 0 : Math.min(1000 * Math.pow(1.5, reconnectAttempts), 15000) + Math.random() * 500;
      reconnectAttempts = immediate ? 0 : reconnectAttempts + 1;

      reconnectTimer = setTimeout(() => {
        if (!isDisposed) setupEventSource();
      }, delay);
    };

    const setupEventSource = () => {
      if (isDisposed) return;
      cleanupCurrentStream();

      try {
        const streamUrl = getEmployeeOrderStreamUrl();
        eventSource = new EventSource(streamUrl, { withCredentials: true });

        eventSource.onopen = () => {
          reconnectAttempts = 0;
          resetWatchdog();
          if (isReconnecting) {
            fetchOrderList(true);
            isReconnecting = false;
          }
        };

        // Server heartbeat event (emitted every 15s by backend)
        eventSource.addEventListener("heartbeat", () => {
          resetWatchdog();
        });

        // Connected event
        eventSource.addEventListener("connected", () => {
          resetWatchdog();
        });

        // Order event: direct notification from payload
        eventSource.addEventListener("order_event", (event) => {
          resetWatchdog();
          try {
            const data = JSON.parse(event.data);
            if (data?.event === "ORDER_CREATED") {
              // Check the authoritative packing queue before sounding an alarm.
              runAlarmCheck();
              scheduleEventRefresh();
            } else if (data?.event === "ORDER_ACKNOWLEDGED") {
              // Cross-device sync: staff acknowledged on another phone
              acknowledgeOrderAlarm(data.orderId);
            } else if (data?.event === "ORDER_STATUS_UPDATED") {
              const status = (data?.status || "").toLowerCase();
              if (["packed", "ready_for_dispatch", "dispatched", "completed", "cancelled", "refunded", "failed"].includes(status)) {
                acknowledgeOrderAlarm(data.orderId);
              }
              scheduleEventRefresh();
            }
          } catch (_) {
            scheduleEventRefresh();
          }
        });

        eventSource.onerror = () => {
          reconnectStream(false);
        };
      } catch (_) {
        reconnectStream(false);
      }
    };

    setupEventSource();

    // Foreground resume & network recovery listeners
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        runAlarmCheck();
        fetchOrderList(true);
        if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
          reconnectStream(true);
        }
      }
    };

    const handleOnline = () => {
      runAlarmCheck();
      fetchOrderList(true);
      reconnectStream(true);
    };

    const handlePageShow = (event) => {
      if (event?.persisted && !document.hidden) {
        runAlarmCheck();
        fetchOrderList(true);
        if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
          reconnectStream(true);
        }
      }
    };

    setPageRefresh?.(() => () => fetchOrderList(false));
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("online", handleOnline);

    // 8-second fallback polling for rapid auto-detection of incoming counter orders
    let listPollTicks = 0;
    const pollInterval = setInterval(() => {
      if (!document.hidden) {
        runAlarmCheck();
        listPollTicks += 1;
        if (!eventSource || eventSource.readyState !== EventSource.OPEN || listPollTicks % 4 === 0) {
          fetchOrderList(true);
        }
      }
    }, 8000);

    return () => {
      isDisposed = true;
      cleanupCurrentStream();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventRefreshTimerRef.current) clearTimeout(eventRefreshTimerRef.current);
      clearInterval(pollInterval);
      setPageRefresh?.(null);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    if (newTab !== "completed") setDateBasis("created");
    setPage(1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (newTab === "active") {
          next.delete("status");
        } else {
          next.set("status", newTab);
        }
        if (newTab !== "completed") next.delete("date_basis");
        return next;
      },
      { replace: true }
    );
  };

  const handleDateFilterSelect = (filterId) => {
    setIsDateDropdownOpen(false);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("date");
      return next;
    }, { replace: true });
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
    if (error) {
      showToast("Refresh the order list before updating an order.", "error");
      return;
    }
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

      // Successfully packed/progressed: immediately silence local alarm and sync acknowledgement to other devices
      const normalizedStatus = String(newStatus).toLowerCase();
      if (["packed", "ready_for_dispatch", "dispatched", "completed", "cancelled", "refunded", "failed"].includes(normalizedStatus)) {
        acknowledgeOrderAlarm(orderId);
        acknowledgeOrder(orderId).catch(() => {});
      }

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

  const handleConfirmDeliveryReview = async (orderId) => {
    if (updatingIdsRef.current.has(orderId)) return;
    if (!window.confirm("Have you confirmed delivery arrangements with the customer?")) return;
    updatingIdsRef.current.add(orderId);
    setUpdatingIds(new Set(updatingIdsRef.current));
    try {
      await confirmOrderDeliveryReview(orderId);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                meta_data: [
                  ...(o.meta_data || []).filter(
                    (m) => m.key !== "_payment_captured_without_delivery_slot"
                  ),
                  { key: "_payment_captured_without_delivery_slot", value: "no" },
                  { key: "_delivery_review_confirmed_at", value: new Date().toISOString() },
                ],
              }
            : o
        )
      );
      setSelectedOrder((prev) =>
        prev && prev.id === orderId
          ? {
              ...prev,
              meta_data: [
                ...(prev.meta_data || []).filter(
                  (m) => m.key !== "_payment_captured_without_delivery_slot"
                ),
                { key: "_payment_captured_without_delivery_slot", value: "no" },
                { key: "_delivery_review_confirmed_at", value: new Date().toISOString() },
              ],
            }
          : prev
      );
      showToast("Delivery arrangements confirmed.");
      await fetchOrderList(false);
    } catch (err) {
      showToast(err.response?.data?.message || "Could not confirm delivery arrangements.", "error");
    } finally {
      updatingIdsRef.current.delete(orderId);
      setUpdatingIds(new Set(updatingIdsRef.current));
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

  const STATUS_BADGE_CONFIG = {
    completed: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500", label: "Delivered" },
    processing: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500 animate-pulse", label: "To Pack" },
    packed: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500", label: "Packed" },
    "out-for-delivery": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500", label: "Out for Delivery" },
    dispatched: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500", label: "Out for Delivery" },
    cancelled: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", dot: "bg-rose-500", label: "Cancelled" },
    "on-hold": { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500", label: "On Hold" },
    refunded: { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", dot: "bg-gray-500", label: "Refunded" },
    failed: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500", label: "Failed" },
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
    const cfg = STATUS_BADGE_CONFIG[status] || {
      bg: "bg-gray-100", text: "text-gray-700", border: "border-gray-200", dot: "bg-gray-400", label: status || "Unknown",
    };
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full ${cfg.bg} px-2.5 py-1 text-[11px] font-bold ${cfg.text} border ${cfg.border}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} shrink-0`} />
        {cfg.label}
      </span>
    );
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

  const isViewCurrentAndReady = hasCurrentOrders && !loading && !Boolean(error);

  const eligibleOrders = deriveEligibleOrders(filteredOrders, updatingIds, {
    isViewCurrentAndReady,
    maxLimit: 50,
  });

  const activeSelectedIds = computeActiveSelection(selectedIds, eligibleOrders);

  // Remove selections that leave the visible page or become ineligible
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      if (!isViewCurrentAndReady) return new Set();
      const active = computeActiveSelection(current, eligibleOrders);
      if (active.size === current.size && Array.from(current).every((id) => active.has(id))) {
        return current;
      }
      return active;
    });
  }, [eligibleOrders, isViewCurrentAndReady]);

  // Clear selection and confirmation when active filters or page change
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkConfirm(null);
    setBulkResults([]);
  }, [activeTab, debouncedSearch, locationFilter, dateFilter, dateBasis, customDateRange, page]);

  // Keep select-all checkbox indeterminate state in sync with partial selection
  const selectAllCheckboxRef = useRef(null);
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      const isIndeterminate =
        activeSelectedIds.size > 0 && activeSelectedIds.size < eligibleOrders.length;
      selectAllCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [activeSelectedIds.size, eligibleOrders.length]);

  const toggleDispatch = (id) => {
    if (bulkBusyRef.current || !isViewCurrentAndReady) return;
    const target = filteredOrders.find((o) => o.id === id);
    if (!target || !isOrderEligibleForDispatch(target, updatingIds)) {
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 50) {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllToggle = (event) => {
    if (bulkBusyRef.current || !isViewCurrentAndReady || eligibleOrders.length === 0) return;
    if (event.target.checked) {
      setSelectedIds(new Set(eligibleOrders.map((o) => o.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleOpenBulkConfirm = () => {
    if (bulkBusyRef.current || !isViewCurrentAndReady || activeSelectedIds.size === 0) return;
    const snapshot = createBulkConfirmSnapshot({
      queryKey: currentOrdersQueryKey,
      selectedIds: activeSelectedIds,
      filteredOrders,
      getOrderLocationInfo,
    });
    if (!snapshot) return;
    setBulkConfirm(snapshot);
  };

  const handleConfirmDispatch = async () => {
    if (bulkBusyRef.current || !bulkConfirm) return;

    const validation = validateBulkConfirmSnapshot({
      snapshot: bulkConfirm,
      currentQueryKey: buildOrdersQueryKey(activeFiltersRef.current),
      ordersQueryKey,
      filteredOrders,
      updatingIds: updatingIdsRef.current,
      getOrderLocationInfo,
      isViewCurrentAndReady: hasCurrentOrders && !loading && !Boolean(error),
    });

    if (!validation.valid) {
      setBulkConfirm(null);
      showToast("Order list changed during review. Please review and select again.", "error");
      return;
    }

    const reviewedIds = [...bulkConfirm.reviewedIds];
    if (reviewedIds.length === 0) {
      setBulkConfirm(null);
      return;
    }

    bulkBusyRef.current = true;
    setBulkBusy(true);
    const submissionQueryKey = bulkConfirm.queryKey;
    setBulkConfirm(null);
    setBulkResults([]);

    reviewedIds.forEach((id) => updatingIdsRef.current.add(id));
    setUpdatingIds(new Set(updatingIdsRef.current));

    let rawResults = [];

    try {
      const result = await bulkDispatchOrders(reviewedIds, bulkConfirm.locationKeysById);
      rawResults = result?.results || [];

      // Live view identifier check immediately after dispatch resolves
      const liveKeyAfterDispatch = buildOrdersQueryKey(activeFiltersRef.current);

      const succeeded = rawResults.filter((row) => row?.success).map((row) => row.id);
      const failed = rawResults.filter((row) => row && !row.success);
      setBulkResults(liveKeyAfterDispatch === submissionQueryKey ? failed : []);

      // Optimistically update memory only if still on the same view
      if (succeeded.length > 0 && liveKeyAfterDispatch === submissionQueryKey) {
        const succSet = new Set(succeeded);
        setOrders((current) =>
          current.map((order) =>
            succSet.has(order.id)
              ? {
                  ...order,
                  status: "out-for-delivery",
                  meta_data: [
                    ...(order.meta_data || []).filter((m) => m.key !== "_delivery_status"),
                    { key: "_delivery_status", value: "out-for-delivery" },
                  ],
                }
              : order
          )
        );
      }

      if (failed.length === 0) {
        showToast(
          succeeded.length === 1
            ? "1 order dispatched successfully."
            : `${succeeded.length} orders dispatched successfully.`
        );
      } else {
        showToast(
          `${succeeded.length} dispatched; ${failed.length} failed. Please review remaining orders.`,
          "error"
        );
      }
    } catch (err) {
      showToast(
        err.response?.data?.message ||
          "Dispatch request was interrupted. Refreshing orders; please review before retrying.",
        "error"
      );
    } finally {
      reviewedIds.forEach((id) => updatingIdsRef.current.delete(id));
      setUpdatingIds(new Set(updatingIdsRef.current));
      bulkBusyRef.current = false;
      setBulkBusy(false);

      // Refresh order list and wait for authoritative state
      // Use a foreground read so an identical scheduled poll cannot coalesce this
      // post-dispatch refresh and leave selection reconciliation on stale data.
      const refreshResult = await fetchOrderList(false);

      // Re-evaluate live view identifier after refresh resolves
      const liveKeyAfterRefresh = buildOrdersQueryKey(activeFiltersRef.current);

      if (liveKeyAfterRefresh !== submissionQueryKey) {
        // Staff switched view/filters/page: NEVER restore selections in the new view
        setSelectedIds(new Set());
      } else {
        // Same view: restore ONLY failed IDs that are still visible and eligible after refresh
        const refreshedOrders = Array.isArray(refreshResult?.orders)
          ? refreshResult.orders
          : liveOrdersRef.current;
        const currentTab = activeFiltersRef.current.activeTab;
        const currentLoc = activeFiltersRef.current.locationFilter;

        const refreshedFiltered = refreshedOrders.filter((order) => {
          if (currentTab === "active" && (order.status === "completed" || order.status === "cancelled")) {
            return false;
          }
          if (currentLoc !== "all") {
            const loc = getOrderLocationInfo(order);
            if (loc.location_key !== currentLoc) {
              return false;
            }
          }
          return true;
        });

        const refreshedEligible = deriveEligibleOrders(refreshedFiltered, updatingIdsRef.current, {
          isViewCurrentAndReady: true,
        });

        const { nextSelectedIds } = reconcileBulkDispatchResults({
          submissionQueryKey,
          liveQueryKey: liveKeyAfterRefresh,
          results: rawResults,
          refreshedEligibleOrders: refreshedEligible,
        });

        setSelectedIds(nextSelectedIds);
      }
    }
  };

  const formatDateLabel = (isoDate) => {
    if (!isoDate) return "";
    const parts = isoDate.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}`;
    }
    return isoDate;
  };

  const getActiveDateLabel = () => {
    const prefix = dateBasis === "completed" ? "Delivered: " : "";
    if (dateFilter === "today") return `${prefix}Today (${formatDateLabel(todayDateString)})`;
    if (dateFilter === "yesterday") return `${prefix}Yesterday (${formatDateLabel(yesterdayDateString)})`;
    if (dateFilter === "7days") return `${prefix}Last 7 Days`;
    if (dateFilter === "all") return "All Time";
    if (dateFilter === "custom" && customDateRange.start && customDateRange.end) {
      return `${prefix}${formatDateLabel(customDateRange.start)} - ${formatDateLabel(customDateRange.end)}`;
    }
    return `Today (${formatDateLabel(todayDateString)})`;
  };

  const tabs = [
    { id: "active", label: "To Pack & Deliver" },
    { id: "processing", label: "To Pack" },
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

    if (getScheduledOrderMeta(order)?.review) return renderDetailsButton(order, isMobile);

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

    if (order.status === "processing" || order.status === "packed") {
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
      {error && hasCurrentOrders && (
        <div role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
          {error} {lastOrderRefresh && <span>Last updated {new Date(lastOrderRefresh).toLocaleTimeString()}.</span>}
          <button type="button" onClick={() => fetchOrderList(false)} className="ml-3 underline">Retry</button>
        </div>
      )}
      {alarmDegraded && (
        <div role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
          Order alerts are temporarily unavailable. Check your connection and retry.
          {lastAlarmCheck && <span> Last successful check: {new Date(lastAlarmCheck).toLocaleTimeString()}.</span>}
          <button type="button" onClick={runAlarmCheck} className="ml-3 underline">Retry</button>
        </div>
      )}
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

      {/* Audio Alert Status & Controls Banner (Compact Single-Line Strip) */}
      {!alarmState.isArmed ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-1.5 text-amber-950 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <BellRing size={14} className="text-amber-600 shrink-0" />
            <p className="text-xs font-bold text-amber-950 truncate">
              Counter Sound Inactive <span className="hidden sm:inline font-normal text-amber-800 text-[11px]">— tap to enable order sirens</span>
            </p>
          </div>
          <button
            onClick={async () => {
              await armOrderAlarm({ playTestSound: true });
            }}
            className="shrink-0 rounded-lg bg-amber-500 hover:bg-amber-600 active:scale-95 px-2.5 py-1 text-[11px] font-black text-white shadow-2xs transition cursor-pointer"
          >
            Enable Sound 🔊
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-emerald-950 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <Volume2 size={14} className="text-emerald-600 shrink-0" />
            <p className="text-xs font-semibold text-emerald-950 truncate">
              Sound Active <span className="hidden sm:inline font-normal text-emerald-800 text-[11px]">({alarmState.voiceArmed ? "Voice Alert" : "Chime"})</span>
            </p>
          </div>
          <button
            onClick={testOrderAlertSound}
            className="shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs transition cursor-pointer"
          >
            Test Sound 🔊
          </button>
        </div>
      )}

      {/* Acknowledgement Failure Alert with Retry */}
      {ackError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rose-950 border border-rose-700/60 p-3.5 text-rose-100 shadow-md">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-600 text-white font-bold shadow-xs">
              <AlertCircle size={18} />
            </div>
            <div>
              <p className="font-bold text-xs sm:text-sm text-white">Acknowledgement Network Sync Failed</p>
              <p className="text-[11px] text-rose-200">{ackError.message}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (ackError.failedIds?.length === 1) {
                  handleAcknowledgeSingleOrder(ackError.failedIds[0]);
                } else {
                  handleMuteAllAlarms();
                }
              }}
              className="rounded-xl bg-rose-600 hover:bg-rose-500 px-3 py-1.5 text-xs font-black text-white shadow-xs transition cursor-pointer"
            >
              Retry Sync
            </button>
            <button
              onClick={() => setAckError(null)}
              className="rounded-xl bg-rose-900/80 hover:bg-rose-800 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Active Alarm Siren Banner */}
      {alarmState.isAlarming && !isOrderAlarmQuietHours() && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rose-600 p-4 text-white shadow-lg animate-pulse">
          <div className="flex items-center gap-3">
            <span className="text-2xl animate-bounce">🚨</span>
            <div>
              <p className="text-sm sm:text-base font-black tracking-tight text-white">
                {alarmState.unacknowledgedOrders.length === 1
                  ? `NEW ORDER #${alarmState.unacknowledgedOrders[0]} RECEIVED!`
                  : `${alarmState.unacknowledgedOrders.length} NEW ORDERS (${alarmState.unacknowledgedOrders.map((id) => `#${id}`).join(", ")})!`}
              </p>
              <p className="text-xs text-rose-100 font-semibold">
                {isOrderAlarmQuietHours()
                  ? "Orders remain queued for the next opening. The overnight siren is muted."
                  : "Orders need packing. The repeating alarm will sound until acknowledged."}
              </p>
            </div>
          </div>
          <button
            onClick={handleMuteAllAlarms}
            className="rounded-xl bg-white hover:bg-rose-50 px-4 py-2 text-xs font-black text-rose-700 shadow-md transition cursor-pointer"
          >
            Acknowledge & Silence Siren
          </button>
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
              aria-label="Search orders by number, customer name, or phone"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Order #, Name, Phone..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50/60 py-2 pl-9 pr-8 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
            />
            {searchQuery && (
              <button
                aria-label="Clear order search"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <button
            aria-label="Refresh orders"
            onClick={() => fetchOrderList(false)}
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
        <div className="border-b border-gray-100 p-4 space-y-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 select-none">
            <input
              ref={selectAllCheckboxRef}
              type="checkbox"
              disabled={
                bulkBusy ||
                loading ||
                !hasCurrentOrders ||
                Boolean(error) ||
                eligibleOrders.length === 0
              }
              checked={
                eligibleOrders.length > 0 &&
                activeSelectedIds.size === eligibleOrders.length
              }
              onChange={handleSelectAllToggle}
            />
            {hasCurrentOrders && !loading && !error && eligibleOrders.length === 0
              ? "No packed orders ready to dispatch on this page"
              : `Select packed orders on this page${
                  eligibleOrders.length > 0 ? ` (${eligibleOrders.length})` : ""
                }`}
          </label>
          {activeSelectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold text-gray-700">
                {activeSelectedIds.size} selected
              </span>
              <button
                type="button"
                disabled={bulkBusy || activeSelectedIds.size === 0}
                onClick={handleOpenBulkConfirm}
                className="rounded-full bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
              >
                {bulkBusy ? "Dispatching…" : "Dispatch selected"}
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setSelectedIds(new Set())}
                className="text-gray-500 hover:text-gray-800 transition cursor-pointer"
              >
                Clear selection
              </button>
            </div>
          )}
          <OrderBulkModals
            bulkConfirm={bulkConfirm}
            onCloseConfirm={() => setBulkConfirm(null)}
            onConfirmDispatch={handleConfirmDispatch}
            bulkBusy={bulkBusy}
            bulkResults={bulkResults}
          />
        </div>
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
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-xs">
                <Fan size={26} className="text-emerald-500 animate-spin" style={{ animationDuration: "1s" }} />
              </div>
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
                        <input aria-label={"Select order " + order.id} type="checkbox" disabled={bulkBusy || !isOrderEligibleForDispatch(order, updatingIds)} checked={activeSelectedIds.has(order.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleDispatch(order.id)} />
                        <span className="font-extrabold text-gray-900 text-sm">#{order.id}</span>
                        {getScheduledOrderMeta(order) && (
                          <span
                            className={getScheduledOrderMeta(order).review ? "inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800" : "inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700"}
                            title={`Scheduled fulfillment: ${getScheduledOrderMeta(order).label || getScheduledOrderMeta(order).date || "next store opening"}`}
                          >
                            {getScheduledOrderMeta(order).review ? "⚠ Delivery review" : `🌙 Scheduled${getScheduledOrderMeta(order).date ? ` · ${getScheduledOrderMeta(order).date}` : ""}`}
                          </span>
                        )}
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
                          <input aria-label={"Select order " + order.id} type="checkbox" className="mr-2" disabled={bulkBusy || !isOrderEligibleForDispatch(order, updatingIds)} checked={activeSelectedIds.has(order.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleDispatch(order.id)} />
                          <span className="font-extrabold text-gray-900">#{order.id}</span>
                          {getScheduledOrderMeta(order) && (
                            <span
                              className={getScheduledOrderMeta(order).review ? "ml-2 inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800" : "ml-2 inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700"}
                              title={`Scheduled fulfillment: ${getScheduledOrderMeta(order).label || getScheduledOrderMeta(order).date || "next store opening"}`}
                            >
                              {getScheduledOrderMeta(order).review ? "⚠ Delivery review" : `🌙 Scheduled${getScheduledOrderMeta(order).date ? ` · ${getScheduledOrderMeta(order).date}` : ""}`}
                            </span>
                          )}
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
        {(orders.length > 0 || !loading) && (totalPages > 1 || page > 1) && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/50 px-4 py-3 sm:px-6 sm:py-3.5">
            <p className="text-xs text-gray-500 font-medium text-center sm:text-left">
              Showing{" "}
              <span className="font-bold text-gray-900">
                {totalOrders === 0 ? 0 : Math.min((page - 1) * perPage + 1, totalOrders)}
              </span>{" "}
              to{" "}
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
                Page {page} of {Math.max(page, totalPages)}
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
      <OrderMobileFiltersModal
        isOpen={isMobileFiltersOpen}
        onClose={() => setIsMobileFiltersOpen(false)}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        dateFilters={DATE_FILTERS}
        dateFilter={dateFilter}
        onDateFilterSelect={handleDateFilterSelect}
        locationOptions={LOCATION_OPTIONS}
        locationFilter={locationFilter}
        setLocationFilter={setLocationFilter}
        setPage={setPage}
        onResetAll={() => {
          setActiveTab("all");
          setDateFilter("today");
          setDateBasis("created");
          setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("date"); next.delete("date_basis"); next.set("status", "all"); return next; }, { replace: true });
          setLocationFilter("all");
          setPage(1);
          setIsMobileFiltersOpen(false);
        }}
      />

      {/* CUSTOM DATE RANGE MODAL */}
      <OrderCustomDateModal
        isOpen={isCustomModalOpen}
        onClose={() => setIsCustomModalOpen(false)}
        tempDateRange={tempDateRange}
        setTempDateRange={setTempDateRange}
        onApply={handleApplyCustomRange}
        setPresetRange={setPresetRange}
        setMonthPreset={setMonthPreset}
      />

      {/* Order Details Drawer / Modal */}
      <OrderDetailsModal
        order={selectedOrder}
        onClose={() => {
          setCancelConfirmPending(false);
          setSelectedOrder(null);
        }}
        onStatusUpdate={handleStatusUpdate}
        onConfirmDeliveryReview={handleConfirmDeliveryReview}
        onSendRefundEmail={handleSendRefundEmail}
        updatingIds={updatingIds}
        isStatusDropdownOpen={isStatusDropdownOpen}
        setIsStatusDropdownOpen={setIsStatusDropdownOpen}
        statusDropdownRef={statusDropdownRef}
        cancelConfirmPending={cancelConfirmPending}
        setCancelConfirmPending={setCancelConfirmPending}
        statusOptions={STATUS_OPTIONS}
        allStatusBadges={ALL_STATUS_BADGES}
        getStatusBadge={getStatusBadge}
        isOrderDeliveredLocked={isOrderDeliveredLocked}
      />
    </div>
  );
}

export default Orders;
