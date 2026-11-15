import api from "../config/woocommerce.js";
import wp from "./wordpress.js";
import { logger, logError } from "../utils/logger.js";
import { getAcknowledgedOrderIds } from "./orderNotificationService.js";
import {
  parseOrderCursor,
  compareOrdersDescending,
  serializeOrderCursor,
  isOrderOlderThanCursor,
  isOrderNeedingPacking,
  getEffectiveOrderStatus,
} from "../utils/employeeOrderQuery.js";

const parseAlarmRingingIds = (raw) => {
  const candidates = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  const ringingIds = [];
  const seen = new Set();
  for (const item of candidates) {
    const num = Number(item);
    if (Number.isSafeInteger(num) && num > 0 && !seen.has(num)) {
      seen.add(num);
      ringingIds.push(num);
      if (ringingIds.length >= 50) break;
    }
  }
  return ringingIds;
};

const hasKeysetCapability = (resp) => {
  const header = resp?.headers?.["x-mumbai-keyset-capability"] || resp?.headers?.["x-mumbai-alarm-keyset"];
  return header === "v1" || resp?.data?.keyset_capability === "v1";
};

const isMatchingWpOrigin = () => {
  try {
    const wpUrl = process.env.WORDPRESS_URL || "http://localhost";
    const wcUrl =
      process.env.WOOCOMMERCE_URL ||
      (process.env.NODE_ENV === "production" ? "" : "https://mumbai-collection.local");
    return Boolean(wcUrl && new URL(wpUrl).origin === new URL(wcUrl).origin);
  } catch {
    return false;
  }
};

const formatAlarmItem = (order, isAck = false) => ({
  id: order.id,
  status: getEffectiveOrderStatus(order) || order.status,
  is_acknowledged: isAck,
  date_created_gmt: order.date_created_gmt || order.date_created,
});

async function reconcileRingingOrders({
  ringingIds,
  allScannedCandidateMap,
  reconPos,
  pollAbortController,
  getRemainingPollMs,
}) {
  const acknowledgedRingingIds = [];
  const missingRingingIds = [];
  let nextReconciliationPosition = reconPos;

  if (ringingIds.length === 0) {
    return { acknowledgedRingingIds, nextReconciliationPosition };
  }

  const ringingAckSet = await getAcknowledgedOrderIds(ringingIds, {
    signal: pollAbortController.signal,
  });
  for (const rId of ringingIds) {
    if (ringingAckSet.has(rId)) {
      acknowledgedRingingIds.push(rId);
    } else if (allScannedCandidateMap.has(rId)) {
      const ord = allScannedCandidateMap.get(rId);
      if (!isOrderNeedingPacking(ord)) acknowledgedRingingIds.push(rId);
    } else {
      missingRingingIds.push(rId);
    }
  }

  if (missingRingingIds.length === 0) {
    return { acknowledgedRingingIds, nextReconciliationPosition };
  }

  const RECONCILIATION_BUDGET_MS = Math.min(2500, getRemainingPollMs());
  const reconStartTime = Date.now();
  const reconAbortController = new AbortController();
  const abortReconciliation = () => reconAbortController.abort();
  if (pollAbortController.signal.aborted || RECONCILIATION_BUDGET_MS <= 0) {
    reconAbortController.abort();
  } else {
    pollAbortController.signal.addEventListener("abort", abortReconciliation, { once: true });
  }
  const reconTimeoutId = setTimeout(() => {
    reconAbortController.abort();
  }, RECONCILIATION_BUDGET_MS);

  const getRemainingReconMs = () => {
    const elapsed = Date.now() - reconStartTime;
    return Math.max(0, Math.min(RECONCILIATION_BUDGET_MS - elapsed, getRemainingPollMs()));
  };

  let unresolvedIds = [...missingRingingIds];
  const reconOffset = reconPos % missingRingingIds.length;
  nextReconciliationPosition =
    (reconOffset + Math.min(6, missingRingingIds.length)) % missingRingingIds.length;

  try {
    try {
      const batchTimeoutMs = getRemainingReconMs();
      if (!reconAbortController.signal.aborted && batchTimeoutMs > 0) {
        const batchResp = await api.get(
          "orders",
          {
            include: missingRingingIds.join(","),
            per_page: Math.min(50, missingRingingIds.length),
            _fields:
              "id,status,meta_data,payment_method,payment_method_title,date_paid,transaction_id",
          },
          { signal: reconAbortController.signal, timeout: batchTimeoutMs }
        );
        const batchOrders = Array.isArray(batchResp.data) ? batchResp.data : [];
        const batchMap = new Map(batchOrders.map((o) => [Number(o.id), o]));

        for (const rId of missingRingingIds) {
          if (batchMap.has(rId)) {
            unresolvedIds = unresolvedIds.filter((id) => id !== rId);
            const ord = batchMap.get(rId);
            if (!isOrderNeedingPacking(ord)) acknowledgedRingingIds.push(rId);
          }
        }
      }
    } catch (batchErr) {
      logger.warn(
        { err: batchErr?.message },
        "[PackingAlarms] Batch lookup for ringing IDs failed; falling back to bounded concurrency"
      );
    }

    if (
      unresolvedIds.length > 0 &&
      !reconAbortController.signal.aborted &&
      getRemainingReconMs() > 0
    ) {
      const CONCURRENCY_LIMIT = 3;
      const MAX_INDIVIDUAL_LOOKUPS = 6;
      const offset = reconPos % unresolvedIds.length;
      const rotatedIds = [...unresolvedIds.slice(offset), ...unresolvedIds.slice(0, offset)];
      const idsToQuery = rotatedIds.slice(0, MAX_INDIVIDUAL_LOOKUPS);
      let currentIdx = 0;

      const workers = Array.from(
        { length: Math.min(CONCURRENCY_LIMIT, idsToQuery.length) },
        async () => {
          while (
            currentIdx < idsToQuery.length &&
            !reconAbortController.signal.aborted &&
            getRemainingReconMs() > 0
          ) {
            const rId = idsToQuery[currentIdx++];
            try {
              const lookupTimeoutMs = getRemainingReconMs();
              if (lookupTimeoutMs <= 0) break;
              const resp = await api.get(
                `orders/${rId}`,
                {
                  _fields:
                    "id,status,meta_data,payment_method,payment_method_title,date_paid,transaction_id",
                },
                { signal: reconAbortController.signal, timeout: lookupTimeoutMs }
              );
              const ord = resp.data;
              if (!ord || !isOrderNeedingPacking(ord)) acknowledgedRingingIds.push(rId);
            } catch (lookupErr) {
              if (lookupErr?.response?.status === 404) acknowledgedRingingIds.push(rId);
            }
          }
        }
      );
      await Promise.all(workers);
    }
  } finally {
    clearTimeout(reconTimeoutId);
    pollAbortController.signal.removeEventListener("abort", abortReconciliation);
  }

  return { acknowledgedRingingIds, nextReconciliationPosition };
}

const buildAlarmResponse = ({
  page1Failed,
  backlogFailed,
  alarms = [],
  acknowledgedRingingIds = [],
  nextCursor = null,
  validKeysetCursor = null,
  rawCursor = null,
  p1DerivedCursor = null,
  nextReconciliationPosition = 0,
  nextPage1Offset = 0,
}) => {
  const ackRingUnique = Array.from(new Set(acknowledgedRingingIds));
  if (page1Failed) {
    return {
      success: false,
      discovery_unavailable: true,
      message: "Order discovery temporarily unavailable. Retrying...",
      orders: [],
      acknowledged_ringing_ids: ackRingUnique,
      next_cursor: validKeysetCursor ? rawCursor : null,
      next_reconciliation_position: nextReconciliationPosition,
      next_page1_offset: nextPage1Offset,
    };
  }
  if (backlogFailed) {
    return {
      success: true,
      partial_discovery_failure: true,
      discovery_unavailable: true,
      message: "Backlog discovery temporarily unavailable. Retrying...",
      count: alarms.length,
      orders: alarms,
      acknowledged_ringing_ids: ackRingUnique,
      next_cursor: nextCursor || (validKeysetCursor ? rawCursor : p1DerivedCursor) || null,
      next_reconciliation_position: nextReconciliationPosition,
      next_page1_offset: nextPage1Offset,
    };
  }
  return {
    success: true,
    discovery_unavailable: false,
    partial_discovery_failure: false,
    count: alarms.length,
    orders: alarms,
    acknowledged_ringing_ids: ackRingUnique,
    next_cursor: nextCursor,
    next_reconciliation_position: nextReconciliationPosition,
    next_page1_offset: nextPage1Offset,
  };
};

/**
 * Lightweight endpoint for Employee Panel counter packing alarms.
 */
export const getEmployeePackingAlarms = async (req, res) => {
  const TOTAL_POLL_BUDGET_MS = 8500;
  const pollStartTime = Date.now();
  const pollAbortController = new AbortController();
  const pollTimeoutId = setTimeout(() => {
    pollAbortController.abort();
  }, TOTAL_POLL_BUDGET_MS);

  const getRemainingPollMs = () => Math.max(1, TOTAL_POLL_BUDGET_MS - (Date.now() - pollStartTime));

  const rawCursor = req.query?.cursor;
  const parsedCursor = parseOrderCursor(rawCursor);
  const isLegacyCursor = Boolean(parsedCursor?.legacyPage || (parsedCursor && !parsedCursor.date));
  const validKeysetCursor = parsedCursor && !isLegacyCursor ? parsedCursor : null;

  try {
    const ringingIds = parseAlarmRingingIds(req.query?.ringing_ids || req.query?.ringingIds);
    const unacknowledgedOrders = [];
    const acknowledgedScannedOrders = [];
    const allScannedCandidateMap = new Map();

    const PAGE_BUDGET = 2;
    const PER_PAGE = 50;
    const TOTAL_UNACK_CAP = 50;
    const NEWEST_UNACK_RESERVE = 25;

    let totalPages = 1;
    let budgetRemaining = PAGE_BUDGET;
    let nextCursor = null;

    const hasBacklogCursor = Boolean(validKeysetCursor);
    const rawPage1Offset = req.query?.page1_offset || req.query?.page1Offset;
    const page1Offset = Math.max(0, Number.parseInt(rawPage1Offset, 10) || 0);
    let nextPage1Offset = 0;

    const fallbackHeaders =
      isMatchingWpOrigin() && process.env.MUMBAI_INTERNAL_API_KEY
        ? { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY }
        : {};

    let useWpEndpoint = true;
    let page1Failed = false;
    let backlogFailed = false;
    let page1CandidateBatch = [];

    try {
      const wpResponse = await wp.get("/wp-json/mumbai-auth/v1/employee/orders", {
        params: { status: "processing", per_page: PER_PAGE, page: 1, mode: "packing_alarms" },
        signal: pollAbortController.signal,
        timeout: getRemainingPollMs(),
      });
      const payload = wpResponse.data || {};
      page1CandidateBatch = Array.isArray(payload.orders) ? payload.orders : [];
      totalPages = Number(payload.total_pages) || 1;
      budgetRemaining--;
    } catch (hposErr) {
      logger.warn(
        { err: hposErr?.message },
        "[PackingAlarms] HPOS employee endpoint query failed, falling back to WooCommerce REST"
      );
      useWpEndpoint = false;
    }

    if (!useWpEndpoint) {
      try {
        const wcResponse = await api.get(
          "orders",
          {
            status: "pending,processing",
            per_page: PER_PAGE,
            page: 1,
            orderby: "date",
            order: "desc",
            mode: "packing_alarms",
            _fields:
              "id,status,meta_data,payment_method,payment_method_title,date_paid,transaction_id,date_created,date_created_gmt",
          },
          { signal: pollAbortController.signal, timeout: getRemainingPollMs(), headers: fallbackHeaders }
        );
        page1CandidateBatch = Array.isArray(wcResponse.data) ? wcResponse.data : [];
        totalPages = Number(wcResponse.headers?.["x-wp-totalpages"]) || 1;
        budgetRemaining--;
      } catch (wcErr) {
        logger.error(
          { err: wcErr?.message },
          "[PackingAlarms] WooCommerce REST fallback query failed for page 1"
        );
        page1Failed = true;
      }
    }

    const remainingPage1Unack = [];
    const hasBacklog = hasBacklogCursor || isLegacyCursor || totalPages > 1;
    const newestUnackLimit = hasBacklog ? NEWEST_UNACK_RESERVE : TOTAL_UNACK_CAP;

    if (!page1Failed && page1CandidateBatch.length > 0) {
      page1CandidateBatch.sort(compareOrdersDescending);
      const page1Eligible = [];
      for (const order of page1CandidateBatch) {
        allScannedCandidateMap.set(Number(order.id), order);
        if (isOrderNeedingPacking(order)) page1Eligible.push(order);
      }

      if (page1Eligible.length > 0) {
        const page1Ids = page1Eligible.map((o) => o.id);
        const page1AckSet = await getAcknowledgedOrderIds(page1Ids, {
          signal: pollAbortController.signal,
        });
        const page1Unacknowledged = page1Eligible.filter(
          (order) => !page1AckSet.has(Number(order.id))
        );
        let page1Selection = page1Unacknowledged;

        if (page1Unacknowledged.length > newestUnackLimit && hasBacklog) {
          const anchor = page1Unacknowledged[0];
          const tail = page1Unacknowledged.slice(1);
          const windowSize = newestUnackLimit - 1;
          const start = tail.length ? page1Offset % tail.length : 0;
          const rotated = Array.from(
            { length: Math.min(windowSize, tail.length) },
            (_, index) => tail[(start + index) % tail.length]
          );
          page1Selection = [anchor, ...rotated];
          nextPage1Offset = tail.length > windowSize ? (start + windowSize) % tail.length : 0;
        }

        const selectedPage1Ids = new Set(page1Selection.map((order) => Number(order.id)));
        for (const order of page1Eligible) {
          const id = Number(order.id);
          const isAck = page1AckSet.has(id);
          const item = formatAlarmItem(order, isAck);
          if (!isAck) {
            if (
              selectedPage1Ids.has(id) &&
              !unacknowledgedOrders.some((o) => o.id === order.id) &&
              unacknowledgedOrders.length < newestUnackLimit
            ) {
              unacknowledgedOrders.push(item);
            } else {
              remainingPage1Unack.push(item);
            }
          } else if (!acknowledgedScannedOrders.some((o) => o.id === order.id)) {
            acknowledgedScannedOrders.push(item);
          }
        }
      }
    }

    let lastExaminedOrder = null;
    let hitCapHalfway = false;
    let backlogBatchEmpty = false;
    let cursorStalled = false;

    const sortedP1 = [...page1CandidateBatch].sort(compareOrdersDescending);
    const lastRawP1 = sortedP1.length > 0 ? sortedP1[sortedP1.length - 1] : null;
    const p1DerivedCursor = lastRawP1 ? serializeOrderCursor(lastRawP1) : null;
    const parsedP1DerivedCursor = p1DerivedCursor ? parseOrderCursor(p1DerivedCursor) : null;
    const activeBacklogCursor = validKeysetCursor || (totalPages > 1 ? parsedP1DerivedCursor : null);

    if (
      !page1Failed &&
      budgetRemaining > 0 &&
      activeBacklogCursor &&
      unacknowledgedOrders.length < TOTAL_UNACK_CAP
    ) {
      let backlogCandidateBatch = [];
      let backlogResp = null;

      try {
        if (useWpEndpoint) {
          backlogResp = await wp.get("/wp-json/mumbai-auth/v1/employee/orders", {
            params: {
              status: "processing",
              per_page: PER_PAGE,
              mode: "packing_alarms",
              cursor: `${activeBacklogCursor.date}_${activeBacklogCursor.id}`,
              cursor_date: activeBacklogCursor.date,
              cursor_id: activeBacklogCursor.id,
            },
            signal: pollAbortController.signal,
            timeout: getRemainingPollMs(),
          });
          const payload = backlogResp.data || {};
          backlogCandidateBatch = Array.isArray(payload.orders) ? payload.orders : [];
          totalPages = Number(payload.total_pages) || totalPages;
          budgetRemaining--;
        } else {
          backlogResp = await api.get(
            "orders",
            {
              status: "pending,processing",
              per_page: PER_PAGE,
              orderby: "date",
              order: "desc",
              mode: "packing_alarms",
              _fields:
                "id,status,meta_data,payment_method,payment_method_title,date_paid,transaction_id,date_created,date_created_gmt",
              cursor: `${activeBacklogCursor.date}_${activeBacklogCursor.id}`,
              cursor_date: activeBacklogCursor.date,
              cursor_id: activeBacklogCursor.id,
            },
            {
              headers: fallbackHeaders,
              signal: pollAbortController.signal,
              timeout: getRemainingPollMs(),
            }
          );
          backlogCandidateBatch = Array.isArray(backlogResp.data) ? backlogResp.data : [];
          totalPages = Number(backlogResp.headers?.["x-wp-totalpages"]) || totalPages;
          budgetRemaining--;
        }
      } catch (backlogErr) {
        logger.warn(
          { err: backlogErr?.message },
          "[PackingAlarms] Backlog page fetch encountered warning or failure"
        );
        backlogFailed = true;
      }

      if (!backlogFailed && !hasKeysetCapability(backlogResp)) {
        logger.warn(
          "[PackingAlarms] Keyset capability signal absent in backlog response; preserving retry cursor"
        );
        backlogFailed = true;
      }

      backlogCandidateBatch.sort(compareOrdersDescending);
      const backlogOrdersToExamine = backlogCandidateBatch.filter((o) =>
        isOrderOlderThanCursor(activeBacklogCursor, o)
      );

      if (!backlogFailed) {
        if (backlogCandidateBatch.length > 0 && backlogOrdersToExamine.length === 0) {
          cursorStalled = true;
          backlogFailed = true;
          logger.warn("[PackingAlarms] Keyset cursor stalled on identical or non-advancing rows");
        } else if (backlogOrdersToExamine.length === 0) {
          backlogBatchEmpty = true;
        } else {
          const backlogEligible = [];
          for (const order of backlogOrdersToExamine) {
            allScannedCandidateMap.set(Number(order.id), order);
            if (isOrderNeedingPacking(order)) backlogEligible.push(order);
          }

          const backlogEligibleIds = backlogEligible.map((o) => o.id);
          const backlogAckSet = await getAcknowledgedOrderIds(backlogEligibleIds, {
            signal: pollAbortController.signal,
          });

          for (const order of backlogOrdersToExamine) {
            lastExaminedOrder = order;
            if (isOrderNeedingPacking(order)) {
              const isAck = backlogAckSet.has(Number(order.id));
              const item = formatAlarmItem(order, isAck);
              if (!isAck) {
                if (!unacknowledgedOrders.some((o) => o.id === order.id)) {
                  unacknowledgedOrders.push(item);
                  if (unacknowledgedOrders.length >= TOTAL_UNACK_CAP) {
                    hitCapHalfway = true;
                    break;
                  }
                }
              } else if (!acknowledgedScannedOrders.some((o) => o.id === order.id)) {
                acknowledgedScannedOrders.push(item);
              }
            }
          }
        }
      }

      if (backlogFailed || cursorStalled) {
        nextCursor = validKeysetCursor ? rawCursor : p1DerivedCursor || null;
      } else if (hitCapHalfway && lastExaminedOrder) {
        nextCursor = serializeOrderCursor(lastExaminedOrder);
      } else if (
        lastExaminedOrder &&
        (backlogCandidateBatch.length >= PER_PAGE || totalPages > (validKeysetCursor ? 1 : 2))
      ) {
        nextCursor = serializeOrderCursor(lastExaminedOrder);
      } else if (backlogBatchEmpty || backlogCandidateBatch.length < PER_PAGE) {
        nextCursor = null;
      } else {
        nextCursor = null;
      }

      if (
        nextCursor === null &&
        !backlogFailed &&
        unacknowledgedOrders.length < TOTAL_UNACK_CAP &&
        remainingPage1Unack.length > 0
      ) {
        unacknowledgedOrders.push(
          ...remainingPage1Unack.slice(0, TOTAL_UNACK_CAP - unacknowledgedOrders.length)
        );
      }
    } else if (!page1Failed && !hasBacklogCursor && totalPages > 1) {
      nextCursor = p1DerivedCursor;
    } else if (validKeysetCursor && unacknowledgedOrders.length >= TOTAL_UNACK_CAP) {
      nextCursor = rawCursor;
    } else if (isLegacyCursor && totalPages > 1) {
      nextCursor = p1DerivedCursor;
    }

    const rawReconPos =
      req.query?.reconciliation_position ||
      req.query?.reconciliationPosition ||
      req.query?.ringing_offset;
    const reconPos = Math.max(0, Number.parseInt(rawReconPos, 10) || 0);

    const { acknowledgedRingingIds, nextReconciliationPosition } = await reconcileRingingOrders({
      ringingIds,
      allScannedCandidateMap,
      reconPos,
      pollAbortController,
      getRemainingPollMs,
    });

    if (typeof res.set === "function") {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    }

    const alarms = [...unacknowledgedOrders, ...acknowledgedScannedOrders.slice(0, 50)];
    return res.json(
      buildAlarmResponse({
        page1Failed,
        backlogFailed,
        alarms,
        acknowledgedRingingIds,
        nextCursor,
        validKeysetCursor,
        rawCursor,
        p1DerivedCursor,
        nextReconciliationPosition,
        nextPage1Offset,
      })
    );
  } catch (error) {
    logError(req, error, "Get employee packing alarms error");
    const timedOut = pollAbortController.signal.aborted;
    return res.status(timedOut ? 503 : 500).json({
      success: false,
      discovery_unavailable: true,
      message: timedOut ? "Order alarm check timed out. Retrying..." : undefined,
      orders: [],
      acknowledged_ringing_ids: [],
      next_cursor: validKeysetCursor ? rawCursor : null,
    });
  } finally {
    clearTimeout(pollTimeoutId);
  }
};
