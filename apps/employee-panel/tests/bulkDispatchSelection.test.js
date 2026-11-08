import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isOrderEligibleForDispatch,
  deriveEligibleOrders,
  computeActiveSelection,
  createBulkConfirmSnapshot,
  validateBulkConfirmSnapshot,
  reconcileBulkDispatchResults,
} from "../src/utils/bulkDispatchSelection.js";
import { buildOrdersQueryKey } from "../src/utils/ordersPipelineCoordinator.js";

describe("Employee Panel Orders: Safe Bulk Dispatch Selection & Confirmation Suite", () => {
  // Mock delivery location helper matching application logic
  const mockGetOrderLocationInfo = (order) => {
    const loc = order.delivery_location || "Vasai";
    return {
      location: loc,
      location_key: loc.toLowerCase().replace(/\s+/g, "-"),
    };
  };

  test("1. Zero eligible orders & mixed page: validates packed, unpaid, locked, hidden, in-flight, and COD orders", () => {
    const mixedOrders = [
      // 101: processing (not packed)
      { id: 101, status: "processing", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
      // 102: packed but unpaid online order
      { id: 102, status: "packed", is_unpaid: true, is_status_locked: false, delivery_location: "Vasai" },
      // 103: packed but status locked
      { id: 103, status: "packed", is_unpaid: false, is_status_locked: true, delivery_location: "Vasai" },
      // 104: packed COD order (is_unpaid is false for COD) -> ELIGIBLE
      { id: 104, status: "packed", is_unpaid: false, is_status_locked: false, payment_method: "cod", delivery_location: "Vasai" },
      // 105: packed online paid order -> ELIGIBLE
      { id: 105, status: "packed", is_unpaid: false, is_status_locked: false, payment_method: "razorpay", delivery_location: "Vasai" },
      // 106: effective status packed via meta_data _delivery_status -> ELIGIBLE
      { id: 106, status: "processing", meta_data: [{ key: "_delivery_status", value: "packed" }], is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
      // 107: packed order currently in-flight
      { id: 107, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
    ];

    const updatingIds = new Set([107]);

    // Check individual eligibility
    assert.equal(isOrderEligibleForDispatch(mixedOrders[0], updatingIds), false, "Processing order must not be eligible");
    assert.equal(isOrderEligibleForDispatch(mixedOrders[1], updatingIds), false, "Unpaid online order must not be eligible");
    assert.equal(isOrderEligibleForDispatch(mixedOrders[2], updatingIds), false, "Status-locked order must not be eligible");
    assert.equal(isOrderEligibleForDispatch(mixedOrders[3], updatingIds), true, "Packed COD order must be eligible");
    assert.equal(isOrderEligibleForDispatch(mixedOrders[4], updatingIds), true, "Packed paid online order must be eligible");
    assert.equal(isOrderEligibleForDispatch(mixedOrders[5], updatingIds), true, "Meta delivery_status packed must be eligible");
    assert.equal(isOrderEligibleForDispatch(mixedOrders[6], updatingIds), false, "In-flight order must not be eligible");

    // Hidden rows filtered by location:
    // If user filtered by location "Virar", Vasai orders are not in filteredOrders
    const filteredOrders = mixedOrders.filter((o) => o.delivery_location === "Vasai");
    const eligible = deriveEligibleOrders(filteredOrders, updatingIds, { isViewCurrentAndReady: true });
    assert.deepEqual(eligible.map((o) => o.id), [104, 105, 106]);

    // When view is loading or has error (isViewCurrentAndReady: false), eligible orders must be empty
    const notReadyEligible = deriveEligibleOrders(filteredOrders, updatingIds, { isViewCurrentAndReady: false });
    assert.deepEqual(notReadyEligible, [], "Eligible list must be empty when view is not ready/loading");

    // Zero eligible page
    const zeroEligiblePage = [mixedOrders[0], mixedOrders[1], mixedOrders[2]];
    const noneEligible = deriveEligibleOrders(zeroEligiblePage, updatingIds, { isViewCurrentAndReady: true });
    assert.deepEqual(noneEligible, [], "Page with no valid packed orders yields 0 eligible");

    // 50-ID cap
    const largeBatch = Array.from({ length: 65 }, (_, i) => ({
      id: 1000 + i,
      status: "packed",
      is_unpaid: false,
      is_status_locked: false,
    }));
    const capped = deriveEligibleOrders(largeBatch, new Set(), { isViewCurrentAndReady: true, maxLimit: 50 });
    assert.equal(capped.length, 50, "Batch must be strictly capped at 50 IDs");
  });

  test("2. Changing location, tab, or page after selecting orders or opening modal: old IDs never reach API", () => {
    const page1Orders = [
      { id: 201, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
      { id: 202, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Nallasopara" },
    ];

    const initialFilters = {
      activeTab: "active",
      debouncedSearch: "",
      locationFilter: "all",
      dateFilter: "today",
      page: 1,
    };
    const initialQueryKey = buildOrdersQueryKey(initialFilters);

    const selectedIds = new Set([201, 202]);

    // Snapshot taken on opening confirmation modal
    const snapshot = createBulkConfirmSnapshot({
      queryKey: initialQueryKey,
      selectedIds,
      filteredOrders: page1Orders,
      getOrderLocationInfo: mockGetOrderLocationInfo,
    });

    assert.ok(snapshot);
    assert.deepEqual(snapshot.reviewedIds, [201, 202]);
    assert.deepEqual(snapshot.groups, { Vasai: 1, Nallasopara: 1 });

    // Case A: Staff switches tab to 'dispatched'
    const changedTabQueryKey = buildOrdersQueryKey({ ...initialFilters, activeTab: "dispatched" });
    const tabValidation = validateBulkConfirmSnapshot({
      snapshot,
      currentQueryKey: changedTabQueryKey,
      ordersQueryKey: changedTabQueryKey,
      filteredOrders: page1Orders,
      updatingIds: new Set(),
      getOrderLocationInfo: mockGetOrderLocationInfo,
      isViewCurrentAndReady: true,
    });
    assert.equal(tabValidation.valid, false);
    assert.equal(tabValidation.reason, "view_changed", "Modal confirmation must be rejected when active tab changes");

    // Case B: Staff changes location filter to 'vasai'
    const changedLocQueryKey = buildOrdersQueryKey({ ...initialFilters, locationFilter: "vasai" });
    const locValidation = validateBulkConfirmSnapshot({
      snapshot,
      currentQueryKey: changedLocQueryKey,
      ordersQueryKey: changedLocQueryKey,
      filteredOrders: [page1Orders[0]],
      updatingIds: new Set(),
      getOrderLocationInfo: mockGetOrderLocationInfo,
      isViewCurrentAndReady: true,
    });
    assert.equal(locValidation.valid, false);
    assert.equal(locValidation.reason, "view_changed", "Modal confirmation must be rejected when location changes");

    // Case C: Staff navigates to page 2
    const changedPageQueryKey = buildOrdersQueryKey({ ...initialFilters, page: 2 });
    const pageValidation = validateBulkConfirmSnapshot({
      snapshot,
      currentQueryKey: changedPageQueryKey,
      ordersQueryKey: changedPageQueryKey,
      filteredOrders: [],
      updatingIds: new Set(),
      getOrderLocationInfo: mockGetOrderLocationInfo,
      isViewCurrentAndReady: true,
    });
    assert.equal(pageValidation.valid, false);
    assert.equal(pageValidation.reason, "view_changed", "Modal confirmation must be rejected when page changes");
  });

  test("3. Background refresh removing or changing an order before confirmation: modal recheck fails and asks staff to review", () => {
    const ordersBefore = [
      { id: 301, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
      { id: 302, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
    ];

    const queryKey = buildOrdersQueryKey({ activeTab: "active", page: 1 });

    const snapshot = createBulkConfirmSnapshot({
      queryKey,
      selectedIds: new Set([301, 302]),
      filteredOrders: ordersBefore,
      getOrderLocationInfo: mockGetOrderLocationInfo,
    });

    assert.ok(snapshot);

    // Scenario A: Background refresh marks order 302 as already out-for-delivery
    const ordersAfterStatusChange = [
      { id: 301, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
      { id: 302, status: "out-for-delivery", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
    ];
    const statusValidation = validateBulkConfirmSnapshot({
      snapshot,
      currentQueryKey: queryKey,
      ordersQueryKey: queryKey,
      filteredOrders: ordersAfterStatusChange,
      updatingIds: new Set(),
      getOrderLocationInfo: mockGetOrderLocationInfo,
      isViewCurrentAndReady: true,
    });
    assert.equal(statusValidation.valid, false);
    assert.equal(statusValidation.reason, "orders_changed", "Validation must fail when an order changes status during review");

    // Scenario B: Order 302 was completely removed from the page by refresh
    const ordersAfterRemoval = [
      { id: 301, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
    ];
    const removalValidation = validateBulkConfirmSnapshot({
      snapshot,
      currentQueryKey: queryKey,
      ordersQueryKey: queryKey,
      filteredOrders: ordersAfterRemoval,
      updatingIds: new Set(),
      getOrderLocationInfo: mockGetOrderLocationInfo,
      isViewCurrentAndReady: true,
    });
    assert.equal(removalValidation.valid, false);
    assert.equal(removalValidation.reason, "orders_changed", "Validation must fail when an order leaves visible page");

    // Scenario C: Order 302 delivery location was modified in background
    const ordersAfterLocationChange = [
      { id: 301, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
      { id: 302, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Virar" },
    ];
    const groupingValidation = validateBulkConfirmSnapshot({
      snapshot,
      currentQueryKey: queryKey,
      ordersQueryKey: queryKey,
      filteredOrders: ordersAfterLocationChange,
      updatingIds: new Set(),
      getOrderLocationInfo: mockGetOrderLocationInfo,
      isViewCurrentAndReady: true,
    });
    assert.equal(groupingValidation.valid, false);
    assert.equal(groupingValidation.reason, "grouping_changed", "Validation must fail when delivery area grouping shifts");
  });

  test("4. Partial failure and late response arriving after staff switch views: live view identifier prevents restoring selection in new view, and restores only failed IDs visible & eligible after refresh", () => {
    // Simulate activeFiltersRef tracking live view in Orders component
    const activeFiltersRef = {
      current: { activeTab: "active", page: 1, locationFilter: "all", dateFilter: "today" },
    };

    // View A: "To Pack & Deliver" (activeTab: "active")
    const viewAKey = buildOrdersQueryKey(activeFiltersRef.current);
    const submissionQueryKey = viewAKey;

    const apiResults = [
      { id: 401, success: true, message: "Dispatched" },
      { id: 402, success: false, message: "Order is locked by another staff member" },
      { id: 403, success: true, message: "Dispatched" },
    ];

    // Case A: Staff stays in View A (same view) and refresh finishes
    // After refresh, order 402 is still visible and eligible
    const refreshedEligibleInSameView = [
      { id: 402, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
      { id: 404, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
    ];

    const sameViewReconciliation = reconcileBulkDispatchResults({
      submissionQueryKey,
      liveQueryKey: buildOrdersQueryKey(activeFiltersRef.current),
      results: apiResults,
      refreshedEligibleOrders: refreshedEligibleInSameView,
    });

    assert.deepEqual(sameViewReconciliation.succeededIds, [401, 403]);
    assert.equal(sameViewReconciliation.failedResults.length, 1);
    assert.equal(sameViewReconciliation.failedResults[0].id, 402);
    // Successes are removed; failure 402 is confirmed still eligible and remains selected for staff review
    assert.deepEqual(Array.from(sameViewReconciliation.nextSelectedIds), [402]);

    // Case B: Same view, but order 402 is NO LONGER eligible after refresh (e.g. marked out-for-delivery or completed)
    const refreshedEligibleWithoutFailedOrder = [
      { id: 404, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
    ];

    const ineligibleAfterRefreshReconciliation = reconcileBulkDispatchResults({
      submissionQueryKey,
      liveQueryKey: buildOrdersQueryKey(activeFiltersRef.current),
      results: apiResults,
      refreshedEligibleOrders: refreshedEligibleWithoutFailedOrder,
    });

    assert.equal(
      ineligibleAfterRefreshReconciliation.nextSelectedIds.size,
      0,
      "Failed order must NOT be restored to selection if it is no longer eligible after refresh"
    );

    // Case C: While batch runs, staff switches from To Pack & Deliver to "Packed" tab (activeTab: "packed")
    // Staff switches view: activeFiltersRef updates to new view B
    activeFiltersRef.current = {
      ...activeFiltersRef.current,
      activeTab: "packed",
    };
    const liveKeyInNewView = buildOrdersQueryKey(activeFiltersRef.current);
    assert.notEqual(liveKeyInNewView, submissionQueryKey, "Live key must reflect user's new tab view");

    // Even if failed order 402 appears in the new "Packed" tab view:
    const newViewEligibleOrders = [
      { id: 402, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
    ];

    const switchedViewReconciliation = reconcileBulkDispatchResults({
      submissionQueryKey,
      liveQueryKey: liveKeyInNewView,
      results: apiResults,
      refreshedEligibleOrders: newViewEligibleOrders,
    });

    assert.deepEqual(switchedViewReconciliation.succeededIds, [401, 403]);
    // Next selected IDs must be EMPTY; late response NEVER restores selections into the new view!
    assert.equal(
      switchedViewReconciliation.nextSelectedIds.size,
      0,
      "Late response must never restore selections in another view, even if the order appears in that view"
    );
  });

  test("5. Single eligible order and batch dispatch with one employee session", () => {
    const orders = [
      { id: 501, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
      { id: 502, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Vasai" },
      { id: 503, status: "packed", is_unpaid: false, is_status_locked: false, delivery_location: "Virar" },
    ];
    const queryKey = buildOrdersQueryKey({ activeTab: "active", page: 1 });

    // Single order selection & confirmation
    const singleSelection = new Set([501]);
    const singleSnapshot = createBulkConfirmSnapshot({
      queryKey,
      selectedIds: singleSelection,
      filteredOrders: orders,
      getOrderLocationInfo: mockGetOrderLocationInfo,
    });
    assert.equal(singleSnapshot.reviewedIds.length, 1);
    assert.deepEqual(singleSnapshot.reviewedIds, [501]);
    assert.deepEqual(singleSnapshot.groups, { Vasai: 1 });

    const singleValidation = validateBulkConfirmSnapshot({
      snapshot: singleSnapshot,
      currentQueryKey: queryKey,
      ordersQueryKey: queryKey,
      filteredOrders: orders,
      updatingIds: new Set(),
      getOrderLocationInfo: mockGetOrderLocationInfo,
      isViewCurrentAndReady: true,
    });
    assert.equal(singleValidation.valid, true);

    const singleReconcile = reconcileBulkDispatchResults({
      submissionQueryKey: queryKey,
      liveQueryKey: queryKey,
      results: [{ id: 501, success: true }],
      currentSelectedIds: singleSelection,
    });
    assert.deepEqual(singleReconcile.succeededIds, [501]);
    assert.equal(singleReconcile.nextSelectedIds.size, 0, "Single order removed from selection upon success");

    // Batch order selection & confirmation (all 3)
    const batchSelection = new Set([501, 502, 503]);
    const batchSnapshot = createBulkConfirmSnapshot({
      queryKey,
      selectedIds: batchSelection,
      filteredOrders: orders,
      getOrderLocationInfo: mockGetOrderLocationInfo,
    });
    assert.equal(batchSnapshot.reviewedIds.length, 3);
    assert.deepEqual(batchSnapshot.groups, { Vasai: 2, Virar: 1 });

    const batchValidation = validateBulkConfirmSnapshot({
      snapshot: batchSnapshot,
      currentQueryKey: queryKey,
      ordersQueryKey: queryKey,
      filteredOrders: orders,
      updatingIds: new Set(),
      getOrderLocationInfo: mockGetOrderLocationInfo,
      isViewCurrentAndReady: true,
    });
    assert.equal(batchValidation.valid, true);

    const batchReconcile = reconcileBulkDispatchResults({
      submissionQueryKey: queryKey,
      liveQueryKey: queryKey,
      results: [
        { id: 501, success: true },
        { id: 502, success: true },
        { id: 503, success: true },
      ],
      currentSelectedIds: batchSelection,
    });
    assert.deepEqual(batchReconcile.succeededIds, [501, 502, 503]);
    assert.equal(batchReconcile.nextSelectedIds.size, 0, "All orders removed from selection upon batch success");
  });
});
