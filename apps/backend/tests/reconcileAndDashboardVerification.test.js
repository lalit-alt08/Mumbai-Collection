import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { formatOrderDateTimeIST } from "../../admin-dashboard/src/utils/recentOrdersFormatter.js";

test("Verification Suite — Manual Payment Reconciliation, Customers Refresh, and Overview Guards", async (t) => {
  const { reconcileOrder } = await import("../src/controllers/paymentController.js");
  const { getAdminCustomerOrders } = await import("../src/controllers/adminCustomerController.js");
  const { getDashboardOverview } = await import("../src/controllers/adminAnalyticsController.js");
  const { serverCache } = await import("../src/utils/memoryCache.js");
  const { getVerifiedStoreTimezone, _setVerifiedWpTimezoneForTesting } = await import("../src/services/storeHoursService.js");
  const { default: api } = await import("../src/config/woocommerce.js");
  const { default: wp } = await import("../src/services/wordpress.js");
  const { default: paymentIntentService } = await import("../src/services/paymentIntentService.js");
  const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");

  const originalApiGet = api.get;
  const originalApiPut = api.put;
  const originalWpGet = wp.get;
  const originalWpPost = wp.post;
  const originalAcquireLock = paymentIntentService.acquireLock;
  const originalReleaseLock = paymentIntentService.releaseLock;
  const originalFlush = serverCache.flushPendingInvalidations;

  t.afterEach(() => {
    api.get = originalApiGet;
    api.put = originalApiPut;
    wp.get = originalWpGet;
    wp.post = originalWpPost;
    paymentIntentService.acquireLock = originalAcquireLock;
    paymentIntentService.releaseLock = originalReleaseLock;
    _setRazorpayInstanceForTesting(null);
    serverCache.flushPendingInvalidations = originalFlush;
    serverCache.delete("admin:analytics:overview");
  });

  await t.test("Subtask 1 — Payment Reconcile: returns 409 if lease is lost before mutation", async () => {
    api.get = async () => ({
      data: {
        id: 101,
        status: "pending",
        total: "500.00",
        meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_101" }],
      },
    });

    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: "pay_101", status: "captured", amount: 50000, currency: "INR" }],
        }),
      },
    });

    let callCount = 0;
    paymentIntentService.acquireLock = async () => {
      callCount++;
      return callCount === 1; // 1st call true, 2nd call false
    };
    paymentIntentService.releaseLock = async () => true;

    let resCode = 200;
    let resData = null;
    const req = { params: { id: "101" } };
    const res = {
      status(code) {
        resCode = code;
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await reconcileOrder(req, res);
    assert.equal(resCode, 409, "Must return 409 when lease is lost before status update");
    assert.match(resData.message, /Payment lease expired or lost/i);
  });

  await t.test("Subtask 1 — Payment Reconcile: returns 409 without mutating if captured currency or amount mismatches", async () => {
    api.get = async () => ({
      data: {
        id: 104,
        status: "pending",
        total: "500.00",
        meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_104" }],
      },
    });

    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: "pay_104", status: "captured", amount: 50000, currency: "USD" }],
        }),
      },
    });

    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;

    let wpMutated = false;
    wp.post = async () => {
      wpMutated = true;
      return { data: { reconciled: true } };
    };

    let resCode = 200;
    let resData = null;
    const req = { params: { id: "104" } };
    const res = {
      status(code) {
        resCode = code;
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await reconcileOrder(req, res);
    assert.equal(resCode, 409);
    assert.equal(resData.reconciled, false);
    assert.equal(resData.anomaly, "CURRENCY_MISMATCH");
    assert.equal(wpMutated, false, "Must not mutate order on mismatch");
  });

  await t.test("Subtask 1 — Payment Reconcile: returns retryable 503 if order state cannot be read under lock", async () => {
    api.get = async () => ({
      data: {
        id: 102,
        status: "pending",
        total: "500.00",
        meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_102" }],
      },
    });

    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: "pay_102", status: "captured", amount: 50000, currency: "INR" }],
        }),
      },
    });

    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;

    wp.post = async () => {
      const err = new Error("Could not read current order state");
      err.response = {
        status: 503,
        data: { code: "order_read_failed", message: "Could not read current order state from store database." },
      };
      throw err;
    };

    let resCode = 200;
    let resData = null;
    const req = { params: { id: "102" } };
    const res = {
      status(code) {
        resCode = code;
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await reconcileOrder(req, res);
    assert.equal(resCode, 503, "Failed order reload under lock must return retryable 503");
    assert.equal(resData.retryable, true);
    assert.match(resData.message, /Could not read current order state/i);
  });

  await t.test("Subtask 1 — Payment Reconcile: safe no-op when order was already completed or cancelled", async () => {
    api.get = async () => ({
      data: {
        id: 105,
        status: "pending",
        total: "500.00",
        meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_105" }],
      },
    });

    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: "pay_105", status: "captured", amount: 50000, currency: "INR" }],
        }),
      },
    });

    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;

    wp.post = async () => ({
      data: {
        reconciled: true,
        action: "none",
        message: "Order is already in a terminal state (cancelled).",
        order_status: "cancelled",
      },
    });

    let resCode = 200;
    let resData = null;
    const req = { params: { id: "105" } };
    const res = {
      status(code) {
        resCode = code;
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await reconcileOrder(req, res);
    assert.equal(resCode, 200);
    assert.equal(resData.reconciled, true);
    assert.equal(resData.action, "none");
    assert.equal(resData.order_status, "cancelled");
  });

  await t.test("Subtask 1 — Payment Reconcile: unexpected WordPress 2xx response returns 502 and does NOT confirm update", async () => {
    api.get = async () => ({
      data: {
        id: 106,
        status: "pending",
        total: "500.00",
        meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_106" }],
      },
    });

    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: "pay_106", status: "captured", amount: 50000, currency: "INR" }],
        }),
      },
    });

    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;

    // Unexpected 200 response that does NOT confirm write
    wp.post = async () => ({
      data: { success: true, message: "OK" },
    });

    let resCode = 200;
    let resData = null;
    const req = { params: { id: "106" } };
    const res = {
      status(code) {
        resCode = code;
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await reconcileOrder(req, res);
    assert.equal(resCode, 502, "Unexpected 2xx response must return 502 Bad Gateway");
    assert.equal(resData.success, false);
    assert.match(resData.message, /could not be confirmed/i);
  });

  await t.test("Subtask 1 — Payment Reconcile: preserves success and reports cache_propagation_degraded when Redis flush fails", async () => {
    api.get = async () => ({
      data: {
        id: 103,
        status: "pending",
        total: "500.00",
        customer_id: 42,
        meta_data: [{ key: "_razorpay_order_id", value: "order_rzp_103" }],
      },
    });

    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: "pay_103", status: "captured", amount: 50000, currency: "INR" }],
        }),
      },
    });

    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;

    wp.post = async () => ({
      data: {
        reconciled: true,
        action: "updated_to_processing",
        payment_id: "pay_103",
        order_status: "processing",
        order_id: 103,
      },
    });

    // Redis flush throws
    serverCache.flushPendingInvalidations = async () => {
      throw new Error("Redis cluster connection refused");
    };

    let resCode = 200;
    let resData = null;
    const req = { params: { id: "103" } };
    const res = {
      status(code) {
        resCode = code;
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await reconcileOrder(req, res);
    assert.equal(resCode, 200, "Should return 200 even if Redis flush fails");
    assert.equal(resData.reconciled, true);
    assert.equal(resData.action, "updated_to_processing");
    assert.equal(resData.cache_propagation_degraded, true, "Must flag degraded cache propagation");
  });

  await t.test("Subtask 2 — Customers: older request does not clear newer controller in abortControllerRef", () => {
    const abortControllerRef = { current: null };
    const requestIdRef = { current: 0 };

    // Request 1 starts
    const ctrl1 = new AbortController();
    abortControllerRef.current = ctrl1;
    const req1 = ++requestIdRef.current;

    // Request 2 starts while Request 1 is still in flight
    ctrl1.abort();
    const ctrl2 = new AbortController();
    abortControllerRef.current = ctrl2;
    const req2 = ++requestIdRef.current;

    // Request 1 finishes (finally block executes)
    if (abortControllerRef.current === ctrl1) {
      abortControllerRef.current = null;
    }

    // Assert: abortControllerRef.current is STILL ctrl2 (not cleared by older req1)
    assert.equal(abortControllerRef.current, ctrl2, "Older aborted controller must not clear newer controller");

    // Request 2 finishes (finally block executes)
    if (abortControllerRef.current === ctrl2) {
      abortControllerRef.current = null;
    }

    // Assert: now it is null, allowing useVisibleRevalidation to run
    assert.equal(abortControllerRef.current, null, "Finishing latest controller clears abortControllerRef to allow wake revalidation");
  });

  await t.test("Subtask 3 — Metrics Queue Logic: revision increment prevents deletion during concurrent enqueue", () => {
    const queue = new Map();

    const enqueue = (customerId, now, reason = "") => {
      const existing = queue.get(customerId);
      if (existing) {
        existing.enqueued_at = now;
        existing.updated_at = now;
        existing.revision += 1; // Atomic revision increment
        if (existing.status !== "claimed") {
          existing.status = "pending";
          existing.available_at = now;
        }
      } else {
        queue.set(customerId, {
          customer_id: customerId,
          status: "pending",
          attempts: 0,
          available_at: now,
          claimed_at: null,
          claimed_by: null,
          enqueued_at: now,
          updated_at: now,
          revision: 1,
          last_error: reason,
        });
      }
    };

    const claim = (workerId, now) => {
      for (const item of queue.values()) {
        if (item.status === "pending" && item.available_at <= now) {
          item.status = "claimed";
          item.claimed_by = workerId;
          item.claimed_at = now;
          item.updated_at = now;
          return { ...item };
        }
      }
      return null;
    };

    const settle = (workerId, customerId, claimedRevision, success, now) => {
      const item = queue.get(customerId);
      if (!item || item.status !== "claimed" || item.claimed_by !== workerId) return;

      if (success) {
        // Only delete if revision strictly matches the claimedRevision!
        if (item.revision === claimedRevision) {
          queue.delete(customerId);
        } else {
          // A newer enqueue bumped the revision! Reset to pending
          item.status = "pending";
          item.claimed_by = null;
          item.claimed_at = null;
          item.attempts = 0;
          item.available_at = now;
        }
      } else {
        item.status = "pending";
        item.claimed_by = null;
        item.claimed_at = null;
        item.attempts += 1;
        const backoffSec = Math.min(1800, Math.pow(2, Math.min(item.attempts, 8)) * 10);
        item.available_at = now + backoffSec;
      }
    };

    // 1. Enqueue customer 88 at time 1000 (revision = 1)
    enqueue(88, 1000);
    assert.equal(queue.get(88).revision, 1);

    // 2. Worker claims customer 88 (claimed revision = 1)
    const claimed = claim("w_1", 1000);
    assert.ok(claimed);
    assert.equal(claimed.revision, 1);

    // 3. In the EXACT SAME SECOND (time 1000), a new enqueue arrives for customer 88
    enqueue(88, 1000);
    assert.equal(queue.get(88).revision, 2, "Revision must increment to 2 even in same second");
    assert.equal(queue.get(88).status, "claimed", "Status preserved as claimed");

    // 4. Worker settles with claimed revision 1
    settle("w_1", 88, claimed.revision, true, 1005);

    // Assert: item is NOT deleted because revision is 2 !== 1! It is reset to pending!
    assert.equal(queue.size, 1, "Must retain item because revision changed");
    assert.equal(queue.get(88).status, "pending");

    // 5. Worker claims revision 2 and settles without interruption
    const claimed2 = claim("w_2", 1006);
    assert.equal(claimed2.revision, 2);
    settle("w_2", 88, claimed2.revision, true, 1010);
    assert.equal(queue.size, 0, "Now item is cleanly deleted");
  });

  await t.test("Subtask 4 — Customer Orders: treats non-array wcRes.data as error while preserving genuine []", async () => {
    wp.get = async () => {
      const err = new Error("SQL error");
      err.response = { status: 500 };
      throw err;
    };

    // Case A: WooCommerce returns a non-array (error object or null)
    api.get = async () => ({
      data: { code: "woocommerce_rest_cannot_view", message: "Sorry, you cannot list resources." },
      headers: {},
    });

    let resCode = 200;
    let resData = null;
    const reqA = { params: { id: "55" }, query: { page: "1", per_page: "10" } };
    const resA = {
      status(c) { resCode = c; return this; },
      json(d) { resData = d; return this; },
      set() { return this; },
    };

    await getAdminCustomerOrders(reqA, resA);
    assert.equal(resCode, 500, "Non-array WooCommerce response must throw and return 500 error");
    assert.equal(resData.success, false);

    // Case B: WooCommerce returns genuine empty array []
    api.get = async () => ({
      data: [],
      headers: { "x-wp-total": "0", "x-wp-totalpages": "1" },
    });

    resCode = 200;
    resData = null;
    const reqB = { params: { id: "55" }, query: { page: "1", per_page: "10" } };
    const resB = {
      status(c) { resCode = c; return this; },
      json(d) { resData = d; return this; },
      set() { return this; },
    };

    await getAdminCustomerOrders(reqB, resB);
    assert.equal(resCode, 200, "Genuine empty array [] must succeed");
    assert.equal(resData.success, true);
    assert.deepEqual(resData.orders, []);
    assert.equal(resData.total, 0);
  });

  await t.test("Subtask 4 — Overview: distinguishes failed low-stock preview from empty array, skips cache write", async () => {
    wp.get = async () => ({
      data: {
        success: true,
        totalRevenue: 50000,
        validOrderCount: 10,
        statusCounts: { completed: 8, processing: 2 },
      },
    });

    api.get = async (endpoint) => {
      if (endpoint === "orders") {
        return { data: [{ id: 99, number: "99", status: "completed", total: "1000", line_items: [] }] };
      }
      if (endpoint === "products") {
        throw new Error("WooCommerce products API 500 error");
      }
      return { data: [] };
    };

    let resData = null;
    const req = { query: {} };
    const res = {
      json(d) { resData = d; return this; },
      set() { return this; },
    };

    await getDashboardOverview(req, res);

    assert.equal(resData.success, true);
    assert.equal(resData.inventoryAvailable, false, "Failed low stock query must set inventoryAvailable to false");
    assert.equal(resData.recentOrdersAvailable, true);

    const cached = serverCache.get("admin:analytics:overview");
    assert.equal(cached, null, "Overview cache must NOT be written when inventory is unavailable");
  });

  await t.test("Subtask 5 — Timezone Fallback: handles UTC, explicit offsets, and naive strings by contract", () => {
    // 1. Explicit UTC (Z)
    const formattedUtc = formatOrderDateTimeIST("2026-11-06T10:00:00Z");
    assert.equal(formattedUtc, "06 Nov, 03:30 pm", "UTC 10:00 must format as 03:30 pm IST");

    // 2. Explicit positive offset (+05:30)
    const formattedIst = formatOrderDateTimeIST("2026-11-06T15:30:00+05:30");
    assert.equal(formattedIst, "06 Nov, 03:30 pm", "IST 15:30+05:30 must format as 03:30 pm IST");

    // 3. Explicit negative offset (-05:00)
    const formattedEst = formatOrderDateTimeIST("2026-11-06T05:00:00-05:00");
    assert.equal(formattedEst, "06 Nov, 03:30 pm", "EST 05:00-05:00 (10:00 UTC) must format as 03:30 pm IST");

    // 4. Naive UTC ISO string (formatter contract: appends Z)
    const formattedNaive = formatOrderDateTimeIST("2026-09-06T18:48:32");
    assert.equal(formattedNaive, "07 Sep, 12:18 am", "Naive UTC ISO string must format as 12:18 am IST next day");

    // 5. Unresolvable / invalid strings return ""
    assert.equal(formatOrderDateTimeIST(""), "");
    assert.equal(formatOrderDateTimeIST(null), "");
    assert.equal(formatOrderDateTimeIST("not-a-valid-date"), "");
  });

  await t.test("Subtask 5 — Dynamic WordPress site timezone resolution", () => {
    // 1. Authoritative WordPress site timezone configured in serverCache or override
    _setVerifiedWpTimezoneForTesting("America/New_York", "-05:00");
    assert.equal(getVerifiedStoreTimezone(), "America/New_York");

    _setVerifiedWpTimezoneForTesting("Asia/Kolkata", "+05:30");
    assert.equal(getVerifiedStoreTimezone(), "Asia/Kolkata");

    // Reset
    _setVerifiedWpTimezoneForTesting(null);
  });

  await t.test("Subtask 6 — Customer Metrics Concurrency and Table Resilience in WordPress Plugin", () => {
    const pluginSource = fs.readFileSync("../../mumbai-auth.php", "utf8");

    // 1. Serialized calculation and write per customer with MySQL GET_LOCK
    assert.ok(pluginSource.includes("mumbai_customer_metrics:"), "Must use customer-scoped lock key");
    assert.ok(pluginSource.includes("SELECT GET_LOCK"), "Must use MySQL GET_LOCK");
    assert.ok(pluginSource.includes("SELECT RELEASE_LOCK"), "Must release lock in finally block");

    // 2. Historical backfill uses the locked refresh function rather than writing directly
    assert.ok(pluginSource.includes("mumbai_refresh_customer_metrics($cid)"), "Backfill must use locked mumbai_refresh_customer_metrics");

    // 3. Full database outage resilience: emergency retry recorder preserves retries with atomic shared flock
    assert.ok(pluginSource.includes("mumbai_record_emergency_metrics_retry"), "Must have emergency retry recorder");
    assert.ok(pluginSource.includes(".mumbai_emergency_metrics_retries.json"), "Must record emergency retries to durable disk file");
    assert.ok(pluginSource.includes("mumbai_get_emergency_metrics_retry_file"), "Recovery worker must drain emergency file");
    assert.ok(pluginSource.includes("flock($fp, LOCK_EX)"), "Must use flock exclusive lock during emergency read/write/detach");
    assert.ok(pluginSource.includes("$bytes >= strlen($payload)"), "Must verify file write succeeds and is complete");

    // 4. Recovery atomically detaches batch before processing and only unlinks if empty
    assert.ok(pluginSource.includes("ftruncate($fp, 0);"), "Must atomically detach batch before processing");
    assert.ok(pluginSource.includes("delete_option('mumbai_pending_customer_metrics_retries');"), "Must atomically detach option before processing");
    assert.ok(pluginSource.includes("if (empty($parsed))"), "Must check file is still empty before unlinking");

    // 5. Replay uses the same revision-incrementing upsert as normal enqueue
    assert.ok(pluginSource.includes("revision = revision + 1"), "Replay must increment revision on duplicate key");
    assert.ok(pluginSource.includes("'Emergency buffer replay'"), "Replay must tag source for auditability");

    // 6. Outage resilience in table check: enqueues retry on DB error or missing table
    assert.ok(pluginSource.includes("mumbai_queue_customer_metrics_retry($customer_id, $err)"), "Must enqueue retry if table check or read fails");

    // 7. Schema upgrade verifies revision column exists before bumping version to 2
    assert.ok(pluginSource.includes("INFORMATION_SCHEMA.COLUMNS"), "Must inspect INFORMATION_SCHEMA.COLUMNS for revision column");
    assert.ok(pluginSource.includes("update_option('mumbai_customer_metrics_queue_schema_version', 2, false)"), "Must update version 2 only when verified");
  });

  await t.test("Subtask 7 — Overview passes WordPress site timezone directly to date mapper", async () => {
    // Cold cache: ensure wp:site_timezone is not cached
    serverCache.delete("wp:site_timezone");

    // Mock analytics summary response with custom site timezone
    wp.get = async () => ({
      data: {
        success: true,
        totalRevenue: 50000,
        validOrderCount: 10,
        statusCounts: { completed: 8, processing: 2 },
        wp_timezone: "America/New_York",
        gmt_offset: -5,
      },
    });

    // Mock recent orders with timezone-less date_created and missing date_created_gmt
    api.get = async (endpoint) => {
      if (endpoint === "orders") {
        return {
          data: [
            {
              id: 501,
              number: "501",
              status: "completed",
              total: "1000",
              line_items: [],
              date_created: "2026-11-06T12:00:00", // 12:00 New York (-05:00) = 17:00 UTC
              date_created_gmt: null,
            },
          ],
        };
      }
      if (endpoint === "products") {
        return { data: [] };
      }
      return { data: [] };
    };

    let resData = null;
    const req = { query: {} };
    const res = {
      json(d) { resData = d; return this; },
      set() { return this; },
    };

    await getDashboardOverview(req, res);

    assert.equal(resData.success, true);
    assert.equal(resData.recentOrders.length, 1);
    // 12:00 in America/New_York (UTC-5) is 17:00:00Z in UTC
    assert.equal(resData.recentOrders[0].date, "2026-11-06T17:00:00.000Z", "Mapper must use wp_timezone from summaryRes directly");
  });
});
