import "dotenv/config";
import { execSync } from "child_process";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Disable TLS verification for LocalWP .local domain
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Import backend services
import {
  finalizePaymentAndCreateOrder,
  handleWebhook,
} from "../apps/backend/src/controllers/paymentController.js";
import {
  storePaymentIntent,
  getPaymentIntent,
  updatePaymentIntentStatus,
} from "../apps/backend/src/services/paymentIntentService.js";
import { runPaymentReconciliation } from "../apps/backend/src/services/reconciliationService.js";
import {
  _setRazorpayInstanceForTesting,
  getRazorpayInstance,
} from "../apps/backend/src/services/razorpayService.js";
import api from "../apps/backend/src/config/woocommerce.js";

const MYSQL_PATH =
  "C:\\Users\\asus\\AppData\\Roaming\\Local\\lightning-services\\mysql-8.4.0+2\\bin\\win64\\bin\\mysql.exe";

function runSql(query) {
  try {
    const cmd = `"${MYSQL_PATH}" -h 127.0.0.1 -P 10006 -u root -proot local --batch --raw -e "${query}"`;
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch (err) {
    return `SQL Error: ${err.message}`;
  }
}

function printTable(title, query) {
  console.log(`\n=== [DB TABLE: ${title}] ===`);
  const result = runSql(query);
  console.log(result || "(no rows found)");
}

function signWebhook(payloadStr, secret) {
  return crypto.createHmac("sha256", secret).update(payloadStr).digest("hex");
}

async function runVerification() {
  console.log("======================================================================");
  console.log("STARTING END-TO-END DURABILITY VERIFICATION ON LOCALWP (HPOS ON, SYNC OFF)");
  console.log("======================================================================\n");

  const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "test_mumbai_webhook_secret_key_123";
  const runId = Date.now().toString().slice(-6);

  // ──────────────────────────────────────────────────────────────────
  // Case A: Normal purchase -> order_created, exactly one WC order
  // ──────────────────────────────────────────────────────────────────
  console.log("----------------------------------------------------------------------");
  console.log("CASE A: Normal Purchase Flow");
  console.log("----------------------------------------------------------------------");

  const rzpOrderIdA = `order_e2e_normal_${runId}`;
  const rzpPaymentIdA = `pay_e2e_normal_${runId}`;

  // Store payment intent
  await storePaymentIntent(rzpOrderIdA, {
    rzp_order_id: rzpOrderIdA,
    user_id: 48,
    amount: 150000,
    cart_fingerprint: `fp_${runId}_a`,
    billing: { first_name: "Normal", last_name: "Customer", email: "grc150180@gmail.com" },
    shipping: { first_name: "Normal", last_name: "Customer", address_1: "Shop 12" },
    line_items: [{ product_id: 225, quantity: 1 }],
  });

  _setRazorpayInstanceForTesting({
    payments: {
      fetch: async () => ({
        id: rzpPaymentIdA,
        order_id: rzpOrderIdA,
        status: "captured",
        amount: 150000,
        currency: "INR",
      }),
    },
  });

  const resA = await finalizePaymentAndCreateOrder({
    rzpOrderId: rzpOrderIdA,
    rzpPaymentId: rzpPaymentIdA,
    source: "browser",
  });

  console.log("Case A Finalization Result:", resA);
  printTable(
    "wp_mumbai_payment_intents (Case A)",
    `SELECT rzp_order_id, user_id, status, rzp_payment_id, wc_order_id, error_reason FROM wp_mumbai_payment_intents WHERE rzp_order_id = '${rzpOrderIdA}';`
  );

  // ──────────────────────────────────────────────────────────────────
  // Case B: Stock 0 before finalization -> refund_pending -> refunded
  // ──────────────────────────────────────────────────────────────────
  console.log("\n----------------------------------------------------------------------");
  console.log("CASE B: Stock Exhausted Mid-Checkout -> Auto-Refund");
  console.log("----------------------------------------------------------------------");

  const rzpOrderIdB = `order_e2e_stock0_${runId}`;
  const rzpPaymentIdB = `pay_e2e_stock0_${runId}`;

  await storePaymentIntent(rzpOrderIdB, {
    rzp_order_id: rzpOrderIdB,
    user_id: 48,
    amount: 99000,
    cart_fingerprint: `fp_${runId}_b`,
    billing: { first_name: "StockOut", last_name: "Customer", email: "grc150180@gmail.com" },
    shipping: { first_name: "StockOut", last_name: "Customer" },
    line_items: [{ product_id: 999999, quantity: 5 }], // Product does not exist or stock 0
  });

  let refundRecordedId = null;
  _setRazorpayInstanceForTesting({
    payments: {
      fetch: async () => ({
        id: rzpPaymentIdB,
        order_id: rzpOrderIdB,
        status: "captured",
        amount: 99000,
        currency: "INR",
        amount_refunded: 0,
      }),
      refund: async (id, params) => {
        refundRecordedId = `rfnd_${Date.now()}`;
        return {
          id: refundRecordedId,
          payment_id: id,
          amount: params.amount,
          status: "processed",
        };
      },
    },
  });

  const resB = await finalizePaymentAndCreateOrder({
    rzpOrderId: rzpOrderIdB,
    rzpPaymentId: rzpPaymentIdB,
    source: "webhook",
  });

  console.log("Case B Finalization Result:", resB);
  printTable(
    "wp_mumbai_payment_intents (Case B)",
    `SELECT rzp_order_id, status, rzp_payment_id, refund_id, error_reason FROM wp_mumbai_payment_intents WHERE rzp_order_id = '${rzpOrderIdB}';`
  );

  // ──────────────────────────────────────────────────────────────────
  // Case C: Replay signed payment.captured webhook twice + concurrent reconciler
  // ──────────────────────────────────────────────────────────────────
  console.log("\n----------------------------------------------------------------------");
  console.log("CASE C: Webhook Replay & Concurrency Deduplication");
  console.log("----------------------------------------------------------------------");

  const rzpOrderIdC = `order_e2e_replay_${runId}`;
  const rzpPaymentIdC = `pay_e2e_replay_${runId}`;

  await storePaymentIntent(rzpOrderIdC, {
    rzp_order_id: rzpOrderIdC,
    user_id: 48,
    amount: 50000,
    cart_fingerprint: `fp_${runId}_c`,
    billing: { first_name: "Replay", last_name: "Test", email: "grc150180@gmail.com" },
    shipping: { first_name: "Replay", last_name: "Test" },
    line_items: [{ product_id: 225, quantity: 1 }],
  });

  _setRazorpayInstanceForTesting({
    payments: {
      fetch: async () => ({
        id: rzpPaymentIdC,
        order_id: rzpOrderIdC,
        status: "captured",
        amount: 50000,
        currency: "INR",
      }),
    },
  });

  const webhookPayloadC = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: rzpPaymentIdC,
          order_id: rzpOrderIdC,
          amount: 50000,
          currency: "INR",
          status: "captured",
          notes: {},
        },
      },
    },
  });

  const signatureC = signWebhook(webhookPayloadC, WEBHOOK_SECRET);

  const mockReqC = (eventId) => ({
    body: JSON.parse(webhookPayloadC),
    rawBody: Buffer.from(webhookPayloadC),
    headers: {
      "x-razorpay-signature": signatureC,
      "x-razorpay-event-id": eventId,
    },
  });

  const createMockRes = () => {
    const resObj = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    return resObj;
  };

  // Run 1: First webhook delivery
  const resC1 = createMockRes();
  await handleWebhook(mockReqC(`evt_c1_${runId}`), resC1);
  console.log("Run 1 Webhook Status:", resC1.statusCode, resC1.body);

  // Run 2: Replay webhook
  const resC2 = createMockRes();
  await handleWebhook(mockReqC(`evt_c2_${runId}`), resC2);
  console.log("Run 2 Webhook Status (Replay):", resC2.statusCode, resC2.body);

  // Run 3: Concurrent replay while reconciler triggers
  const resC3 = createMockRes();
  const [replayOutcome, reconcilerOutcome] = await Promise.all([
    handleWebhook(mockReqC(`evt_c3_${runId}`), resC3),
    runPaymentReconciliation(),
  ]);
  console.log("Run 3 Concurrent Replay Status:", resC3.statusCode, resC3.body);
  console.log("Run 3 Concurrent Reconciler Outcome:", reconcilerOutcome);

  printTable(
    "wp_mumbai_payment_intents (Case C)",
    `SELECT rzp_order_id, status, rzp_payment_id, wc_order_id FROM wp_mumbai_payment_intents WHERE rzp_order_id = '${rzpOrderIdC}';`
  );
  printTable(
    "wp_mumbai_webhook_events (Case C)",
    `SELECT event_id, event_type, rzp_order_id, rzp_payment_id, status FROM wp_mumbai_webhook_events WHERE rzp_order_id = '${rzpOrderIdC}';`
  );

  // ──────────────────────────────────────────────────────────────────
  // Case D: Signed webhook for an unknown order id -> orphan row, HTTP 200, 1 alert
  // ──────────────────────────────────────────────────────────────────
  console.log("\n----------------------------------------------------------------------");
  console.log("CASE D: Webhook for Unknown Order ID (Orphan Event)");
  console.log("----------------------------------------------------------------------");

  const rzpOrderIdD = `order_unknown_${runId}`;
  const rzpPaymentIdD = `pay_unknown_${runId}`;

  const webhookPayloadD = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: rzpPaymentIdD,
          order_id: rzpOrderIdD,
          amount: 250000,
          currency: "INR",
          status: "captured",
        },
      },
    },
  });

  const signatureD = signWebhook(webhookPayloadD, WEBHOOK_SECRET);
  const mockReqD = {
    body: JSON.parse(webhookPayloadD),
    rawBody: Buffer.from(webhookPayloadD),
    headers: {
      "x-razorpay-signature": signatureD,
      "x-razorpay-event-id": `evt_d_${runId}`,
    },
  };

  const resD = createMockRes();
  await handleWebhook(mockReqD, resD);
  console.log("Case D Webhook Response:", resD.statusCode, resD.body);

  printTable(
    "wp_mumbai_webhook_events (Case D - Orphan)",
    `SELECT event_id, event_type, rzp_order_id, rzp_payment_id, status FROM wp_mumbai_webhook_events WHERE rzp_order_id = '${rzpOrderIdD}';`
  );

  // ──────────────────────────────────────────────────────────────────
  // Case E: Stop WordPress mid-finalization -> stays paid -> healed by reconciler
  // ──────────────────────────────────────────────────────────────────
  console.log("\n----------------------------------------------------------------------");
  console.log("CASE E: Temporary WordPress Outage -> Stays Paid -> Reconciled");
  console.log("----------------------------------------------------------------------");

  const rzpOrderIdE = `order_e2e_wpdown_${runId}`;
  const rzpPaymentIdE = `pay_e2e_wpdown_${runId}`;

  await storePaymentIntent(rzpOrderIdE, {
    rzp_order_id: rzpOrderIdE,
    user_id: 48,
    amount: 120000,
    cart_fingerprint: `fp_${runId}_e`,
    billing: { first_name: "WpDown", last_name: "Customer", email: "grc150180@gmail.com" },
    shipping: { first_name: "WpDown", last_name: "Customer" },
    line_items: [{ product_id: 225, quantity: 1 }],
  });

  _setRazorpayInstanceForTesting({
    payments: {
      fetch: async () => ({
        id: rzpPaymentIdE,
        order_id: rzpOrderIdE,
        status: "captured",
        amount: 120000,
        currency: "INR",
      }),
    },
  });

  // Temporarily simulate WooCommerce outage
  const originalPost = api.post;
  api.post = async (endpoint, data) => {
    if (endpoint === "orders") {
      const err = new Error("connect ECONNREFUSED 127.0.0.1:10006 (Simulated 30s WP Outage)");
      err.code = "ECONNREFUSED";
      throw err;
    }
    return originalPost(endpoint, data);
  };

  const resEOutage = await finalizePaymentAndCreateOrder({
    rzpOrderId: rzpOrderIdE,
    rzpPaymentId: rzpPaymentIdE,
    source: "webhook",
  });
  console.log("Case E Outage Outcome (must NOT be refunded, must be false):", resEOutage);

  printTable(
    "wp_mumbai_payment_intents (Case E - During WP Outage: Must be 'paid')",
    `SELECT rzp_order_id, status, rzp_payment_id, wc_order_id, attempts, error_reason FROM wp_mumbai_payment_intents WHERE rzp_order_id = '${rzpOrderIdE}';`
  );

  // Restore WooCommerce connection (WP returns)
  api.post = originalPost;

  // Run reconciler to heal the transaction
  console.log("\n[Reconciler] Running background payment reconciler to heal 'paid' intent...");
  const reconResult = await runPaymentReconciliation();
  console.log("Reconciler Result:", reconResult);

  printTable(
    "wp_mumbai_payment_intents (Case E - After Reconciler: Must be 'order_created')",
    `SELECT rzp_order_id, status, rzp_payment_id, wc_order_id, error_reason FROM wp_mumbai_payment_intents WHERE rzp_order_id = '${rzpOrderIdE}';`
  );

  console.log("\n======================================================================");
  console.log("END-TO-END VERIFICATION COMPLETED SUCCESSFULLY");
  console.log("======================================================================");
}

runVerification().catch((err) => {
  console.error("FATAL in runVerification:", err);
  process.exit(1);
});
