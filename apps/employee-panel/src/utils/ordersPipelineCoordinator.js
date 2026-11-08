/**
 * Orders Pipeline Coordinator
 *
 * Coordinates foreground vs background request lifecycles, race conditions,
 * query key synchronization, and decoupled counter alarm detection for the
 * Employee Panel Orders & Dispatch view.
 */

export const buildOrdersQueryKey = (params = {}) =>
  JSON.stringify({
    activeTab: params.activeTab ?? "active",
    debouncedSearch: params.debouncedSearch ?? "",
    locationFilter: params.locationFilter ?? "all",
    dateFilter: params.dateFilter ?? "today",
    customDateRange: params.dateFilter === "custom" ? params.customDateRange : null,
    page: params.page ?? 1,
  });

export const shouldDisplayOrdersPipelineSpinner = ({
  hasCurrentOrders,
  loading,
  ordersLength,
  error,
}) => {
  if (!hasCurrentOrders && error) return false;
  if (!hasCurrentOrders || (loading && ordersLength === 0)) return true;
  return false;
};

export class OrdersPipelineCoordinator {
  constructor({
    getOrders,
    getPackingAlarms,
    getRingingIds,
    onStateUpdate,
    onError,
    onLoadingChange,
    onAlarmTrigger,
    onAlarmAcknowledge,
  } = {}) {
    this.getOrders = getOrders;
    this.getPackingAlarms = getPackingAlarms;
    this.getRingingIds = getRingingIds || (() => []);
    this.onStateUpdate = onStateUpdate || (() => {});
    this.onError = onError || (() => {});
    this.onLoadingChange = onLoadingChange || (() => {});
    this.onAlarmTrigger = onAlarmTrigger || (() => {});
    this.onAlarmAcknowledge = onAlarmAcknowledge || (() => {});

    this.foregroundRequestId = 0;
    this.backgroundRequestId = 0;
    this.foregroundAbortController = null;
    this.backgroundAbortController = null;
    this.backgroundInFlightKey = null;
    this.alarmAbortController = null;
    this.isAlarmCheckInFlight = false;
    this.alarmCursor = null;
    this.reconciliationPosition = 0;
    this.page1Offset = 0;

    this.knownAlarmOrderIds = new Set();
    this.isLoading = true;
  }

  setLoading(value) {
    this.isLoading = Boolean(value);
    this.onLoadingChange(this.isLoading);
  }

  /**
   * Execute an order list fetch.
   * Foreground requests increment foregroundRequestId and abort in-flight foreground fetches.
   * Background requests abort prior in-flight background fetches and increment backgroundRequestId.
   *
   * Note: The list fetch intentionally does NOT mutate knownAlarmOrderIds so browsing/refreshing
   * the list never swallows alarms for newly arrived counter orders.
   */
  async fetchOrderList({
    isBackground = false,
    activeFilters = {},
    perPage = 20,
    hasUpdatingIds = false,
  } = {}) {
    const isBg = Boolean(isBackground);

    const requestQueryKey = buildOrdersQueryKey(activeFilters);

    // Suppress background requests while user is actively loading a new filter or updating items
    if (isBg && (this.isLoading || hasUpdatingIds)) {
      return { status: "skipped" };
    }

    // Coalesce scheduled background reads: if an ongoing background request for the identical query
    // is already in flight, let it complete rather than aborting it on slow network connections
    if (isBg && this.backgroundInFlightKey === requestQueryKey) {
      return { status: "coalesced" };
    }

    let controller = null;
    let requestId = 0;
    const currentForegroundId = this.foregroundRequestId;

    if (!isBg) {
      this.foregroundAbortController?.abort();
      controller = new AbortController();
      this.foregroundAbortController = controller;
      requestId = ++this.foregroundRequestId;
      this.setLoading(true);
      this.onError("");
    } else {
      this.backgroundAbortController?.abort();
      controller = new AbortController();
      this.backgroundAbortController = controller;
      this.backgroundInFlightKey = requestQueryKey;
      requestId = ++this.backgroundRequestId;
    }

    try {
      const res = await this.getOrders(
        {
          status: activeFilters.activeTab !== "all" ? activeFilters.activeTab : undefined,
          search: activeFilters.debouncedSearch || undefined,
          location: activeFilters.locationFilter !== "all" ? activeFilters.locationFilter : undefined,
          date_filter: activeFilters.dateFilter !== "all" ? activeFilters.dateFilter : undefined,
          date_from: activeFilters.dateFilter === "custom" ? activeFilters.customDateRange?.start || undefined : undefined,
          date_to: activeFilters.dateFilter === "custom" ? activeFilters.customDateRange?.end || undefined : undefined,
          page: activeFilters.page || 1,
          per_page: perPage,
        },
        controller ? { signal: controller.signal } : {}
      );

      if (res && res.success) {
        // Discard if newer foreground request was triggered
        if (!isBg && requestId !== this.foregroundRequestId) {
          return { status: "superseded" };
        }
        // Discard background if superseded by newer background, or if foreground filter is loading
        if (isBg) {
          if (requestId !== this.backgroundRequestId) return { status: "superseded" };
          if (currentForegroundId !== this.foregroundRequestId || this.isLoading) {
            return { status: "superseded" };
          }
        }

        const incomingOrders = Array.isArray(res.orders) ? res.orders : [];

        // Acknowledge completed/dispatched/cancelled orders
        incomingOrders.forEach((o) => {
          const rawStatus = (o.status || "").toLowerCase();
          const deliveryStatus = (o.meta_data?.find((m) => m.key === "_delivery_status")?.value || "").toLowerCase();
          const effectiveStatus = deliveryStatus || rawStatus;
          if (["packed", "ready_for_dispatch", "dispatched", "completed", "cancelled", "refunded", "failed"].includes(effectiveStatus)) {
            this.onAlarmAcknowledge(o.id);
          }
        });

        const totalOrders = res.total || incomingOrders.length || 0;
        const totalPages = res.totalPages || Math.ceil((res.total || 1) / perPage) || 1;

        this.onStateUpdate({
          orders: incomingOrders,
          queryKey: requestQueryKey,
          totalOrders,
          totalPages,
        });
        // A successful response for the active query also clears a prior
        // foreground error, allowing selection to resume after connectivity returns.
        this.onError("");

        return {
          status: "success",
          orders: incomingOrders,
          queryKey: requestQueryKey,
          total: totalOrders,
          totalPages,
        };
      } else {
        // Explicitly handle failure responses (e.g. { success: false, message: ... })
        if (!isBg) {
          if (requestId !== this.foregroundRequestId) return { status: "superseded" };
          const errorMsg = res?.message || "Failed to load orders from server.";
          this.onError(errorMsg);
          return { status: "error", message: errorMsg };
        }
        return { status: "error", message: res?.message };
      }
    } catch (err) {
      if (
        controller?.signal?.aborted ||
        err.name === "CanceledError" ||
        err.code === "ERR_CANCELED" ||
        err.message?.toLowerCase().includes("canceled") ||
        err.message?.toLowerCase().includes("aborted")
      ) {
        return { status: "aborted" };
      }
      if (!isBg) {
        if (requestId !== this.foregroundRequestId) return { status: "superseded" };
        const errorMsg = err.response?.data?.message || err.message || "Failed to load orders from server.";
        this.onError(errorMsg);
        return { status: "error", message: errorMsg, error: err };
      }
      return { status: "error", error: err };
    } finally {
      if (!isBg) {
        if (requestId === this.foregroundRequestId && !controller?.signal?.aborted) {
          this.setLoading(false);
        }
      } else {
        if (this.backgroundAbortController === controller) {
          this.backgroundAbortController = null;
          if (this.backgroundInFlightKey === requestQueryKey) {
            this.backgroundInFlightKey = null;
          }
        }
      }
    }
  }

  /**
   * Independent fallback alarm polling for active orders needing packing.
   * Keeps exactly ONE check in flight (never aborts ongoing slow responses).
   *
   * Responsibilities:
   * 1. Sends currently ringing order IDs (`ringing_ids`) to authoritatively reconcile
   *    active alarms when another staff member acknowledges on a different device or
   *    moves the order past packing.
   * 2. Checks authoritative server acknowledgement status to prevent already-acknowledged orders
   *    from re-ringing upon reopening the tab or recovering from background.
   * 3. Triggers alarms only for unacknowledged orders genuinely needing packing.
   */
  async checkActivePackingAlarms({ isHidden = false, ringingIds } = {}) {
    if (isHidden) return { status: "skipped" };
    if (this.isAlarmCheckInFlight) return { status: "in_flight" };

    this.isAlarmCheckInFlight = true;
    const controller = new AbortController();
    this.alarmAbortController = controller;

    try {
      const activeRinging = Array.isArray(ringingIds)
        ? ringingIds
        : typeof this.getRingingIds === "function"
          ? this.getRingingIds() || []
          : [];

      const cleanRinging = activeRinging.map(Number).filter((id) => !isNaN(id) && id > 0);

      const queryParams = {};
      if (cleanRinging.length > 0) {
        queryParams.ringing_ids = cleanRinging.join(",");
        if (this.reconciliationPosition > 0) {
          queryParams.reconciliation_position = this.reconciliationPosition;
        }
      }
      if (this.alarmCursor) {
        queryParams.cursor = this.alarmCursor;
      }
      if (this.page1Offset > 0) {
        queryParams.page1_offset = this.page1Offset;
      }

      const fetchFn = this.getPackingAlarms || this.getOrders;
      const res = await (this.getPackingAlarms
        ? fetchFn({
            params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
            signal: controller.signal,
          })
        : fetchFn({ status: "processing", per_page: 50 }, { signal: controller.signal }));

      const silencedIds = [];

      // Authoritatively silence ringing IDs confirmed acknowledged or left packing queue on another device
      // 1. Process confirmed acknowledgements for ringing IDs (even on failure or partial response)
      const ackRingingIds = Array.isArray(res?.acknowledged_ringing_ids) ? res.acknowledged_ringing_ids : [];
      ackRingingIds.forEach((id) => {
        const numId = Number(id);
        this.knownAlarmOrderIds.add(numId);
        this.onAlarmAcknowledge(numId);
        if (!silencedIds.includes(numId)) {
          silencedIds.push(numId);
        }
      });

      if (res?.next_reconciliation_position !== undefined) {
        this.reconciliationPosition = res.next_reconciliation_position;
      }
      if (res?.next_page1_offset !== undefined) {
        this.page1Offset = res.next_page1_offset;
      }

      // 2. Entirely failed response: must NOT trigger new alarms; preserve retry cursor
      if (!res?.success) {
        if (res?.next_cursor !== undefined) {
          this.alarmCursor = res.next_cursor;
        }
        return {
          status: "error",
          discovery_unavailable: true,
          partial_discovery_failure: false,
          message: res?.message || "Order discovery temporarily unavailable.",
          silencedIds,
          newlyAlarmed: [],
          next_cursor: this.alarmCursor,
        };
      }

      // 3. Successful response (healthy or partial): preserve/update cursor and process valid newest orders
      if (res.next_cursor !== undefined) {
        this.alarmCursor = res.next_cursor || null;
      }

      const packingOrders = Array.isArray(res.orders) ? res.orders : [];
      const newlyAlarmed = [];

      packingOrders.forEach((o) => {
        const isAck = Boolean(o.is_acknowledged);
        if (isAck) {
          this.knownAlarmOrderIds.add(o.id);
          this.onAlarmAcknowledge(o.id);
          if (!silencedIds.includes(o.id)) {
            silencedIds.push(o.id);
          }
        } else if (!this.knownAlarmOrderIds.has(o.id)) {
          this.knownAlarmOrderIds.add(o.id);
          newlyAlarmed.push(o.id);
          this.onAlarmTrigger({ orderId: o.id });
        }
      });

      const isDegraded = Boolean(res?.discovery_unavailable || res?.partial_discovery_failure);

      return {
        status: "success",
        discovery_unavailable: isDegraded,
        partial_discovery_failure: Boolean(res?.partial_discovery_failure),
        count: packingOrders.length,
        alarms: packingOrders,
        newlyAlarmed,
        silencedIds,
        next_cursor: this.alarmCursor,
      };
    } catch (err) {
      if (controller.signal.aborted) return { status: "aborted" };
      const resData = err.response?.data;
      if (resData && Array.isArray(resData.acknowledged_ringing_ids)) {
        resData.acknowledged_ringing_ids.forEach((id) => {
          const numId = Number(id);
          this.knownAlarmOrderIds.add(numId);
          this.onAlarmAcknowledge(numId);
        });
      }
      return { status: "error", error: err, discovery_unavailable: true };
    } finally {
      this.isAlarmCheckInFlight = false;
      if (this.alarmAbortController === controller) {
        this.alarmAbortController = null;
      }
    }
  }
}
