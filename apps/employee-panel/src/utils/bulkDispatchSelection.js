/**
 * Bulk Dispatch Selection & Confirmation Helpers
 *
 * Provides safe selection, validation, and snapshot reconciliation
 * for counter order dispatch in the Employee Panel.
 */

/**
 * Checks whether an order is eligible for bulk dispatch.
 * Requirements:
 * - Effective status must be "packed"
 * - Neither unpaid online order nor status-locked (preserves COD orders)
 * - Must not have a status update currently in flight
 */
export const isOrderEligibleForDispatch = (order, updatingIds = new Set()) => {
  if (!order || !order.id) return false;
  const deliveryStatus = (
    order.meta_data?.find((m) => m?.key === "_delivery_status")?.value || ""
  ).toLowerCase();
  const rawStatus = String(order.status || "").toLowerCase();
  const effectiveStatus = deliveryStatus || rawStatus;

  const isPacked = effectiveStatus === "packed";
  const isUnpaid = Boolean(order.is_unpaid);
  const isStatusLocked = Boolean(order.is_status_locked);
  const isUpdating =
    updatingIds instanceof Set
      ? updatingIds.has(order.id)
      : Array.isArray(updatingIds)
      ? updatingIds.includes(order.id)
      : false;

  return isPacked && !isUnpaid && !isStatusLocked && !isUpdating;
};

/**
 * Derives the list of eligible orders on the current visible page.
 * Selection is completely unavailable while the current view is loading,
 * has an error, or the query key has not yet loaded.
 * Limits batch size to maxLimit (default 50).
 */
export const deriveEligibleOrders = (
  filteredOrders,
  updatingIds = new Set(),
  { isViewCurrentAndReady = true, maxLimit = 50 } = {}
) => {
  if (!isViewCurrentAndReady || !Array.isArray(filteredOrders)) return [];
  const eligible = filteredOrders.filter((order) =>
    isOrderEligibleForDispatch(order, updatingIds)
  );
  return eligible.slice(0, maxLimit);
};

/**
 * Computes the intersection of selected IDs and eligible orders.
 * Selections that leave the visible page or become ineligible are excluded.
 */
export const computeActiveSelection = (selectedIds, eligibleOrders = []) => {
  if (!selectedIds || !(selectedIds instanceof Set) || !Array.isArray(eligibleOrders)) {
    return new Set();
  }
  const eligibleIdSet = new Set(eligibleOrders.map((o) => o?.id).filter(Boolean));
  const active = new Set();
  for (const id of selectedIds) {
    if (eligibleIdSet.has(id)) {
      active.add(id);
    }
  }
  return active;
};

/**
 * Creates a snapshot of the current view, reviewed IDs, and delivery area groupings
 * at the moment staff opens the confirmation modal.
 */
export const createBulkConfirmSnapshot = ({
  queryKey,
  selectedIds,
  filteredOrders = [],
  getOrderLocationInfo,
}) => {
  if (!queryKey || !(selectedIds instanceof Set) || selectedIds.size === 0) {
    return null;
  }
  const eligibleOrders = deriveEligibleOrders(filteredOrders, new Set(), {
    isViewCurrentAndReady: true,
  });
  const activeIds = computeActiveSelection(selectedIds, eligibleOrders);
  if (activeIds.size === 0) return null;

  const reviewedIds = Array.from(activeIds);
  const orderMap = new Map(filteredOrders.map((o) => [o.id, o]));
  const groups = {};

  for (const id of reviewedIds) {
    const order = orderMap.get(id);
    let location = "Unassigned";
    if (getOrderLocationInfo && order) {
      location = getOrderLocationInfo(order)?.location || location;
    } else if (order?.delivery_location) {
      location = order.delivery_location;
    }
    groups[location] = (groups[location] || 0) + 1;
  }

  return {
    queryKey,
    reviewedIds,
    groups,
  };
};

/**
 * Validates the confirmation snapshot against the live view right before dispatch.
 * Checks:
 * 1. Current view and query key must match the snapshot.
 * 2. Every reviewed ID must still be visible and eligible.
 * 3. Delivery area grouping must not have changed.
 * Returns { valid: boolean, reason?: string }.
 */
export const validateBulkConfirmSnapshot = ({
  snapshot,
  currentQueryKey,
  ordersQueryKey,
  filteredOrders = [],
  updatingIds = new Set(),
  getOrderLocationInfo,
  isViewCurrentAndReady = true,
}) => {
  if (!snapshot || !Array.isArray(snapshot.reviewedIds) || snapshot.reviewedIds.length === 0) {
    return { valid: false, reason: "invalid_snapshot" };
  }

  // 1. Current view must match reviewed view and be fully loaded
  if (
    !isViewCurrentAndReady ||
    currentQueryKey !== snapshot.queryKey ||
    ordersQueryKey !== snapshot.queryKey
  ) {
    return { valid: false, reason: "view_changed" };
  }

  // 2. Each reviewed ID must still be visible and eligible
  const currentEligible = deriveEligibleOrders(filteredOrders, updatingIds, {
    isViewCurrentAndReady: true,
  });
  const currentEligibleMap = new Map(currentEligible.map((o) => [o.id, o]));

  const allStillEligible =
    snapshot.reviewedIds.length > 0 &&
    snapshot.reviewedIds.every((id) => currentEligibleMap.has(id));

  if (!allStillEligible) {
    return { valid: false, reason: "orders_changed" };
  }

  // 3. Delivery area groupings must match exactly
  const currentGroups = {};
  for (const id of snapshot.reviewedIds) {
    const order = currentEligibleMap.get(id);
    let location = "Unassigned";
    if (getOrderLocationInfo && order) {
      location = getOrderLocationInfo(order)?.location || location;
    } else if (order?.delivery_location) {
      location = order.delivery_location;
    }
    currentGroups[location] = (currentGroups[location] || 0) + 1;
  }

  const snapshotGroupKeys = Object.keys(snapshot.groups || {});
  const currentGroupKeys = Object.keys(currentGroups);
  if (snapshotGroupKeys.length !== currentGroupKeys.length) {
    return { valid: false, reason: "grouping_changed" };
  }

  for (const loc of snapshotGroupKeys) {
    if (snapshot.groups[loc] !== currentGroups[loc]) {
      return { valid: false, reason: "grouping_changed" };
    }
  }

  return { valid: true };
};

/**
 * Reconciles API dispatch results per order.
 * - Removes successes from selection.
 * - Succeeded IDs are returned for updating order status to out-for-delivery.
 * - If view changed while in-flight or after refresh (submissionQueryKey !== liveQueryKey),
 *   selections in another view are NEVER restored.
 * - If still in the same view, only failed IDs that remain visible and eligible after refresh
 *   are restored to selection.
 */
export const reconcileBulkDispatchResults = ({
  submissionQueryKey,
  liveQueryKey,
  currentQueryKey,
  results = [],
  currentSelectedIds = new Set(),
  refreshedEligibleOrders = null,
}) => {
  const effectiveLiveKey = liveQueryKey || currentQueryKey;
  const succeededIds = [];
  const failedResults = [];

  for (const row of results) {
    if (row && row.success) {
      succeededIds.push(row.id);
    } else if (row) {
      failedResults.push(row);
    }
  }

  // Late response must not restore selections in another view
  if (!submissionQueryKey || submissionQueryKey !== effectiveLiveKey) {
    return {
      nextSelectedIds: new Set(),
      succeededIds,
      failedResults,
    };
  }

  // Same view: keep failed orders selected only if they remain visible and eligible after refresh
  const nextSelectedIds = new Set();
  const failedIdSet = new Set(failedResults.map((r) => r.id));

  if (Array.isArray(refreshedEligibleOrders)) {
    const eligibleIdSet = new Set(refreshedEligibleOrders.map((o) => o?.id));
    for (const failedId of failedIdSet) {
      if (eligibleIdSet.has(failedId)) {
        nextSelectedIds.add(failedId);
      }
    }
  } else if (currentSelectedIds instanceof Set) {
    const succeededSet = new Set(succeededIds);
    for (const id of currentSelectedIds) {
      if (!succeededSet.has(id)) {
        nextSelectedIds.add(id);
      }
    }
  }

  return {
    nextSelectedIds,
    succeededIds,
    failedResults,
  };
};
