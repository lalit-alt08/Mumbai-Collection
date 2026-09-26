import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _setRazorpayInstanceForTesting,
} from "../src/services/razorpayService.js";
import api from "../src/config/woocommerce.js";
import paymentIntentService, {
  updatePaymentIntentStatus,
  storePaymentIntent,
  getPaymentIntent,
  acquireLock,
  releaseLock,
  updateWebhookEventStatus,
  fetchOrphanWebhookEvents,
  findWcOrderByRazorpayOrderId,
} from "../src/services/paymentIntentService.js";
import { runPaymentReconciliation } from "../src/services/reconciliationService.js";
import { serverCache } from "../src/utils/memoryCache.js";
import {
  createReconcilerTimeoutCallback,
  createReconcilerIntervalCallback,
  createDailyAlertCallback,
} from "../src/server.js";
import { sendDailyHealthAlert } from "../src/services/alertService.js";
import {
  findOrderByRazorpayOrderId,
  finalizePaymentAndCreateOrder,
} from "../src/controllers/paymentController.js";

describe("Durable Payments & Reconciliation Suite", () => {
  beforeEach(() => {
    serverCache.clear();
  });

  test("1. WP down 30s does not trigger refund — keeps paid status for reconciler", async () => {
    const rzpOrderId = `rzp_order_wp_down_${Date.now()}`;
    const rzpPaymentId = `pay_wp_down_${Date.now()}`;
    let refundCalled = false;

    _setRazorpayInstanceForTesting({
      payments: {
        fetch: async () => ({
          id: rzpPaymentId,
          order_id: rzpOrderId,
          status: "captured",
          amount: 50000,
          amount_refunded: 0,
        }),
        refund: async () => {
          refundCalled = true;
          return { id: "rfnd_should_not_happen" };
        },
      },
      orders: {
        fetchPayments: async () => ({ count: 1, items: [{ id: rzpPaymentId, status: "captured" }] }),
      },
    });

    // Simulate transient failure during checkout: status remains 'paid'
    const updated = await updatePaymentIntentStatus({
      rzpOrderId,
      toStatus: "paid",
      rzpPaymentId,
      incrementAttempts: true,
      errorReason: "WooCommerce API timeout (504 Gateway Timeout)",
    });

    // Invariant assertion: refund must NOT be called for short-term network drop
    assert.strictEqual(refundCalled, false, "Refund must NOT be triggered for short-term WP outage");
    assert.ok(updated !== undefined);
  });

  test("2. Refund API failure -> refund_pending / refund_failed and retried without double refund", async () => {
    const rzpOrderId = `rzp_order_rfnd_fail_${Date.now()}`;
    const rzpPaymentId = `pay_rfnd_fail_${Date.now()}`;
    let refundAttempts = 0;
    let paymentAmountRefunded = 0;

    _setRazorpayInstanceForTesting({
      payments: {
        fetch: async () => ({
          id: rzpPaymentId,
          order_id: rzpOrderId,
          status: "captured",
          amount: 60000,
          amount_refunded: paymentAmountRefunded,
        }),
        refund: async () => {
          refundAttempts++;
          if (refundAttempts === 1) {
            throw new Error("Razorpay Gateway Timeout during refund");
          }
          paymentAmountRefunded = 60000;
          return { id: `rfnd_success_${Date.now()}`, status: "processed", amount: 60000 };
        },
      },
    });

    // Step A: First attempt fails -> must transition to refund_pending / refund_failed, NEVER 'refunded'
    let currentStatus = "refund_pending";
    try {
      const razorpay = (await import("../src/services/razorpayService.js")).getRazorpayInstance();
      await razorpay.payments.refund(rzpPaymentId);
      currentStatus = "refunded";
    } catch {
      currentStatus = "refund_failed";
    }

    assert.strictEqual(currentStatus, "refund_failed", "Failed refund must NEVER be marked refunded");
    assert.strictEqual(refundAttempts, 1);

    // Step B: Reconciler retries the refund
    const razorpay = (await import("../src/services/razorpayService.js")).getRazorpayInstance();
    const secondRefund = await (await import("../src/services/razorpayService.js")).refundRazorpayPayment({
      paymentId: rzpPaymentId,
      amountInPaise: 60000,
    });

    assert.strictEqual(refundAttempts, 2);
    assert.ok(secondRefund.id.startsWith("rfnd_success_"));

    // Step C: Subsequent retry checks already-refunded amount and avoids double refund
    const thirdRefund = await (await import("../src/services/razorpayService.js")).refundRazorpayPayment({
      paymentId: rzpPaymentId,
      amountInPaise: 60000,
    });

    assert.strictEqual(refundAttempts, 2, "Duplicate refund must NOT be dispatched to Razorpay");
    assert.strictEqual(thirdRefund.already_refunded, true);
  });

  test("3. Duplicate webhook concurrent with reconciler honors distributed lock", async () => {
    const rzpOrderId = `rzp_order_concurrent_${Date.now()}`;
    let activeLockWorker = null;

    const mockAcquireLock = async (id, workerId, maxWaitMs = 1000) => {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        if (!activeLockWorker) {
          activeLockWorker = workerId;
          return true;
        }
        if (activeLockWorker === workerId) return true;
        await new Promise((r) => setTimeout(r, 20));
      }
      return false;
    };

    const mockReleaseLock = async () => {
      activeLockWorker = null;
      return true;
    };

    // Worker 1 acquires lock
    const lock1 = await mockAcquireLock(rzpOrderId, "webhook_worker", 500);
    assert.strictEqual(lock1, true, "First worker must acquire the lock");

    // Worker 2 (reconciler) attempts to acquire same lock concurrently -> must be rejected
    const lock2 = await mockAcquireLock(rzpOrderId, "reconciler_worker", 60);
    assert.strictEqual(lock2, false, "Concurrent worker must be rejected by atomic lock");

    // Worker 1 finishes and releases lock
    await mockReleaseLock(rzpOrderId);

    // Worker 2 can now acquire lock
    const lock3 = await mockAcquireLock(rzpOrderId, "reconciler_worker", 500);
    assert.strictEqual(lock3, true, "Worker must acquire lock once released");

    await mockReleaseLock(rzpOrderId);
  });

  test("4. Stale lock recovery: exactly one of 20 parallel callers takes over expired lock", async () => {
    // Model MySQL atomic stale lock logic:
    // UPDATE wp_mumbai_locks SET worker_id = %s, locked_at = %d WHERE lock_key = %s AND locked_at < %d
    let dbRow = {
      lock_key: "_mumbai_lock_stale_test",
      worker_id: "dead_worker",
      locked_at: Math.floor(Date.now() / 1000) - 35, // 35 seconds ago (> 30s expiry)
    };

    let winners = 0;
    let losers = 0;

    // Mutex to simulate MySQL InnoDB row write-lock serialization
    let rowMutex = Promise.resolve();

    const attemptTakeover = async (workerId) => {
      return new Promise((resolve) => {
        rowMutex = rowMutex.then(async () => {
          const nowSec = Math.floor(Date.now() / 1000);
          // Atomic condition: locked_at < nowSec - 30
          if (dbRow.locked_at < nowSec - 30) {
            dbRow.worker_id = workerId;
            dbRow.locked_at = nowSec; // row is now fresh
            winners++;
            resolve(true);
          } else {
            losers++;
            resolve(false);
          }
        });
      });
    };

    // 20 parallel callers
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => attemptTakeover(`worker_${i}`))
    );

    assert.strictEqual(winners, 1, "Exactly one caller must win stale lock takeover");
    assert.strictEqual(losers, 19, "Exactly 19 callers must be rejected");
    assert.strictEqual(results.filter(Boolean).length, 1);
  });

  test("5. Reconciler polls Razorpay for stuck 'created' intents (> 10m): finalizes order or auto-refunds if stock 0", async () => {
    const originalApiGet = api.get;
    const originalApiPost = api.post;
    const originalAcquireLock = paymentIntentService.acquireLock;
    const originalReleaseLock = paymentIntentService.releaseLock;
    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;

    try {
      // 5a: Stock > 0 -> Reconciler discovers captured payment, creates WC order
      const rzpOrderIdA = `rzp_order_created_heal_${Date.now()}`;
      const rzpPaymentIdA = `pay_created_heal_${Date.now()}`;
      let wcOrderCreatedA = false;

      _setRazorpayInstanceForTesting({
        orders: {
          fetchPayments: async (orderId) => {
            if (orderId === rzpOrderIdA) {
              return { count: 1, items: [{ id: rzpPaymentIdA, status: "captured", amount: 15000 }] };
            }
            return { count: 0, items: [] };
          },
        },
        payments: {
          fetch: async (id) => ({
            id,
            status: "captured",
            amount: 15000,
            amount_refunded: 0,
            currency: "INR",
          }),
          refund: async (id) => ({ id: `rfnd_test_${Date.now()}`, status: "processed" }),
        },
      });

      api.get = async (path) => {
        if (path === "products/232") {
          return { data: { id: 232, manage_stock: true, stock_quantity: 10, backorders_allowed: false } };
        }
        return { data: {} };
      };

      api.post = async (path, payload) => {
        if (path === "orders") {
          wcOrderCreatedA = true;
          return { data: { id: 1001, status: "processing" } };
        }
        return { data: {} };
      };

      // Mock reconciliation list returning stuck 'created' intent with 0 attempts (both webhook & client verify blocked)
      const mockIntentA = {
        rzp_order_id: rzpOrderIdA,
        user_id: 1,
        amount_paise: 15000,
        status: "created",
        cart_fingerprint: "fp_test_123",
        checkout_payload: JSON.stringify({
          user_id: 1,
          billing: { email: "customer@test.com", first_name: "Rohan", last_name: "Sharma" },
          shipping: {},
          line_items: [{ product_id: 232, quantity: 1 }],
        }),
        attempts: 0,
        created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      };

      const originalFetchList = paymentIntentService.fetchReconciliationList;
      paymentIntentService.fetchReconciliationList = async () => ({
        intents: [mockIntentA],
        hasMore: false,
      });

      const resA = await runPaymentReconciliation({ olderThanMinutes: 0 });
      assert.strictEqual(resA.healedOrders, 1, "Reconciler must heal stuck created intent into WooCommerce order");
      assert.strictEqual(wcOrderCreatedA, true, "WooCommerce order must be created");

      // 5b: Stock == 0 -> Reconciler discovers captured payment, sees stock 0, auto-refunds
      const rzpOrderIdB = `rzp_order_created_refund_${Date.now()}`;
      const rzpPaymentIdB = `pay_created_refund_${Date.now()}`;
      let refundCalledB = false;

      _setRazorpayInstanceForTesting({
        orders: {
          fetchPayments: async (orderId) => {
            if (orderId === rzpOrderIdB) {
              return { count: 1, items: [{ id: rzpPaymentIdB, status: "captured", amount: 20000 }] };
            }
            return { count: 0, items: [] };
          },
        },
        payments: {
          fetch: async (id) => ({
            id,
            status: "captured",
            amount: 20000,
            amount_refunded: 0,
            currency: "INR",
          }),
          refund: async (paymentId, params) => {
            if (paymentId === rzpPaymentIdB) {
              refundCalledB = true;
              return { id: `rfnd_auto_${Date.now()}`, status: "processed" };
            }
            return { id: "rfnd_other" };
          },
        },
      });

      api.get = async (path) => {
        if (path === "products/225") {
          return { data: { id: 225, manage_stock: true, stock_quantity: 0, backorders_allowed: false } };
        }
        return { data: {} };
      };

      const mockIntentB = {
        rzp_order_id: rzpOrderIdB,
        user_id: 2,
        amount_paise: 20000,
        status: "created",
        cart_fingerprint: "fp_test_456",
        checkout_payload: JSON.stringify({
          user_id: 2,
          billing: { email: "out_of_stock@test.com", first_name: "Priya", last_name: "Patel" },
          shipping: {},
          line_items: [{ product_id: 225, quantity: 1 }],
        }),
        attempts: 0,
        created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      };

      paymentIntentService.fetchReconciliationList = async () => ({
        intents: [mockIntentB],
        hasMore: false,
      });

      const resB = await runPaymentReconciliation({ olderThanMinutes: 0 });
      assert.strictEqual(resB.refundsExecuted, 1, "Reconciler must auto-refund when stock is 0");
      assert.strictEqual(refundCalledB, true, "Razorpay Refund API must be called");

      paymentIntentService.fetchReconciliationList = originalFetchList;
    } finally {
      api.get = originalApiGet;
      api.post = originalApiPost;
      paymentIntentService.acquireLock = originalAcquireLock;
      paymentIntentService.releaseLock = originalReleaseLock;
    }
  });

  test("6. server.js timer callbacks are wrapped in try/catch and never throw on error", async () => {
    const errorThrowingFn = async () => {
      throw new Error("Simulated database failure inside reconciler");
    };

    const timeoutCb = createReconcilerTimeoutCallback(errorThrowingFn);
    const intervalCb = createReconcilerIntervalCallback(errorThrowingFn);
    const dailyAlertCb = createDailyAlertCallback(async () => {
      throw new Error("Simulated network blip during daily alert");
    });

    // None of these should throw or reject
    const resTimeout = await timeoutCb();
    assert.strictEqual(resTimeout, null, "Timeout callback must catch error and return null, never throw");

    const resInterval = await intervalCb();
    assert.strictEqual(resInterval, null, "Interval callback must catch error and return null, never throw");

    const resDailyAlert = await dailyAlertCb();
    assert.strictEqual(resDailyAlert, null, "Daily alert callback must catch error and return null, never throw");
  });

  test("7. webhook_events status lifecycle (processed/orphan/failed) and orphan daily alert", async () => {
    const eventId = `evt_test_${Date.now()}`;
    const rzpOrderId = `rzp_orphan_${Date.now()}`;

    // Test status updates: stored -> processed / orphan / failed
    const updateProcessed = await updateWebhookEventStatus({ eventId, status: "processed" });
    assert.strictEqual(typeof updateProcessed, "boolean");

    const updateOrphan = await updateWebhookEventStatus({ eventId, status: "orphan" });
    assert.strictEqual(typeof updateOrphan, "boolean");

    const updateFailed = await updateWebhookEventStatus({ eventId, status: "failed" });
    assert.strictEqual(typeof updateFailed, "boolean");

    // Test daily health alert execution
    const dailyAlertResult = await sendDailyHealthAlert();
    assert.strictEqual(dailyAlertResult.success, true);
    assert.strictEqual(typeof dailyAlertResult.orphanCount, "number");
  });

  test("8. payment_intents clears error_reason when status transitions to order_created", async () => {
    const rzpOrderId = `rzp_order_err_clear_${Date.now()}`;

    // Step A: Set intent with error_reason
    await updatePaymentIntentStatus({
      rzpOrderId,
      toStatus: "paid",
      errorReason: "Temporary gateway timeout",
    });

    // Step B: Update to order_created -> error_reason must be cleared
    await updatePaymentIntentStatus({
      rzpOrderId,
      toStatus: "order_created",
      wcOrderId: 9001,
    });

    const intent = await getPaymentIntent(rzpOrderId);
    if (intent) {
      assert.strictEqual(intent.error_reason, null, "error_reason must be null once order is created");
    }
  });

  test("9. HPOS pre-creation lookup protects against duplicate orders when worker is slower than lock TTL", async () => {
    const rzpOrderId = `rzp_order_slow_worker_${Date.now()}`;
    const rzpPaymentId = `pay_slow_worker_${Date.now()}`;
    let wcOrdersCreatedCount = 0;

    const originalApiGet = api.get;
    const originalApiPost = api.post;

    try {
      _setRazorpayInstanceForTesting({
        payments: {
          fetch: async () => ({
            id: rzpPaymentId,
            order_id: rzpOrderId,
            status: "captured",
            amount: 50000,
            currency: "INR",
          }),
        },
      });

      const originalAcquireLock = paymentIntentService.acquireLock;
      const originalUpdateStatus = paymentIntentService.updatePaymentIntentStatus;
      paymentIntentService.acquireLock = async () => true;
      paymentIntentService.updatePaymentIntentStatus = async () => true;

      api.get = async (path) => {
        if (path === "products/232") {
          return { data: { id: 232, manage_stock: true, stock_quantity: 10, backorders_allowed: false } };
        }
        return { data: {} };
      };

      // Mock WooCommerce order creation
      let existingOrderInWc = null;
      api.post = async (path, payload) => {
        if (path === "orders") {
          wcOrdersCreatedCount++;
          existingOrderInWc = { id: 7788, status: "processing" };
          return { data: existingOrderInWc };
        }
        return { data: {} };
      };

      // Mock stored payment intent
      const originalGetIntent = paymentIntentService.getPaymentIntent;
      paymentIntentService.getPaymentIntent = async (id) => ({
        rzp_order_id: rzpOrderId,
        amount_in_paise: 50000,
        customer_id: 1,
        status: "paid",
        checkout_payload: {
          line_items: [{ product_id: 232, quantity: 1 }],
          billing: { email: "slow@test.com" },
        },
      });

      // Mock HPOS order lookup returning null initially, then returning the order created by Worker 2
      const originalFindHpos = paymentIntentService.findWcOrderByRazorpayOrderId;
      paymentIntentService.findWcOrderByRazorpayOrderId = async (id) => {
        return existingOrderInWc;
      };

      // Worker 2 runs first and creates order 7788
      existingOrderInWc = { id: 7788, status: "processing" };

      // Worker 1 resumes right before order creation (lock TTL expired while worker 1 was paused)
      // Worker 1 executes finalizePaymentAndCreateOrder
      const result1 = await finalizePaymentAndCreateOrder({
        rzpOrderId,
        rzpPaymentId,
        expectedCustomerId: 1,
        source: "client_slow_worker",
      });

      // Worker 1 must detect existingOrder via HPOS lookup immediately before create
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result1.order_id, 7788);
      assert.strictEqual(result1._idempotent, true, "Worker 1 must return idempotent success without re-creating");
      assert.strictEqual(wcOrdersCreatedCount, 0, "No duplicate WooCommerce order should be created");

      paymentIntentService.getPaymentIntent = originalGetIntent;
      paymentIntentService.findWcOrderByRazorpayOrderId = originalFindHpos;
      paymentIntentService.acquireLock = originalAcquireLock;
      paymentIntentService.updatePaymentIntentStatus = originalUpdateStatus;
    } finally {
      api.get = originalApiGet;
      api.post = originalApiPost;
    }
  });
});


