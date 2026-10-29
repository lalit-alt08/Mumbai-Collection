// One-time, narrowly scoped cleanup of fixtures confirmed by the store owner.
// Archives payment-intent metadata only. Never creates orders, refunds, or releases stock.
import dotenv from "dotenv";
import axios from "axios";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
const ids = [
  "order_e2e_replay_552422", "order_e2e_replay_772960", "order_rzp_should_not_be_created",
  "order_wc_fail_1790663483078_20da0fe6", "order_wc_fail_1791356078701_2b151bcc",
  "order_wc_fail_1791540109952_98cafc23", "order_wc_fail_1791818179729_a5c29fbd",
  "order_wc_fail_1791828974790_7d32b255", "order_wc_fail_1791829665704_9dcf6397",
  "order_wc_fail_1791829752410_dae6c4c7", "order_wc_fail_1791831364834_0f9e910d",
  "order_wc_fail_1791898650119_c73bbe0b",
];
const apply = process.argv.includes("--apply");
const wpUrl = new URL(process.env.WORDPRESS_URL);
if (process.env.NODE_ENV === "production" || !process.env.RAZORPAY_KEY_ID?.startsWith("rzp_test_") ||
    !["localhost", "127.0.0.1", "[::1]"].includes(wpUrl.hostname) && !wpUrl.hostname.endsWith(".local")) {
  throw new Error("Fixture archival is restricted to a local development database with Razorpay test credentials");
}
const wp = axios.create({ baseURL: wpUrl.href, timeout: 8000,
  headers: { "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY },
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});
const worker = `fixture_archive_${randomUUID()}`;
const held = new Set();
const lock = async (id) => {
  const result = await wp.post("/wp-json/mumbai-auth/v1/payment-intent/lock", { rzp_order_id: id, worker_id: worker });
  if (result.data?.acquired !== true) throw new Error(`Payment lock busy: ${id}; retry after the active worker finishes`);
  held.add(id);
};
const unlock = async (id) => {
  await wp.post("/wp-json/mumbai-auth/v1/payment-intent/unlock", { rzp_order_id: id, worker_id: worker });
  held.delete(id);
};
try {
  if (apply) await lock("cron_reconciler_worker");
  const records = [];
  for (const id of ids) {
    if (apply) { await lock("cron_reconciler_worker"); await lock(id); }
    const result = await wp.post("/wp-json/mumbai-auth/v1/payment-intent/get", { rzp_order_id: id, fresh: true });
    const row = result.data?.raw_row;
    if (!row) throw new Error(`Expected fixture missing: ${id}; refusing a partial cleanup`);
    if (row.rzp_order_id !== id || Number(row.wc_order_id || 0) > 0) throw new Error(`Fixture identity/order safety check failed: ${id}`);
    const order = await wp.get("/wp-json/mumbai-auth/v1/orders/by-razorpay-order-id", { params: { rzp_order_id: id } });
    if (order.data?.order?.id) throw new Error(`WooCommerce order exists for ${id}; manual inspection required`);
    records.push(row);
  }
  // This exact orphan event is defined by paymentWebhook.test.js; it is not a customer payment.
  const orphanResponse = await wp.get("/wp-json/mumbai-auth/v1/webhook-events/orphans", { params: { limit: 100, page: 1 } });
  const webhookFixtures = (orphanResponse.data?.orphans || []).filter(row => row.event_id === "evt_decoupled_paid_001");
  for (const event of webhookFixtures) {
    if (event.rzp_order_id !== "order_rzp_decoupled_001" || event.rzp_payment_id !== "pay_decoupled_001") throw new Error("Webhook fixture identity check failed");
    const order = await wp.get("/wp-json/mumbai-auth/v1/orders/by-razorpay-order-id", { params: { rzp_order_id: event.rzp_order_id } });
    if (order.data?.order?.id) throw new Error("Webhook fixture is linked to a WooCommerce order; manual review required");
    if (apply) await lock(event.rzp_order_id);
  }
  console.log(JSON.stringify({ apply, fixtures: records.map(r => ({ id: r.rzp_order_id, status: r.status })), count: records.length, webhookFixtures: webhookFixtures.map(row => row.event_id) }));
  if (apply) {
    const directory = resolve(process.env.ALERT_SPOOL_DIR || fileURLToPath(new URL("../var/alerts/", import.meta.url)), "fixture-archives");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const snapshot = join(directory, `payment-fixtures-${Date.now()}-${randomUUID()}.json`);
    const file = await open(snapshot, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ archivedAt: new Date().toISOString(), reason: "Owner-confirmed test payments and exact repository webhook fixture", records, webhookFixtures }, null, 2));
      await file.sync();
    } finally { await file.close(); }
    let archived = 0;
    for (const row of records) {
      await lock("cron_reconciler_worker");
      await lock(row.rzp_order_id);
      if (row.status !== "test_archived") {
        const result = await wp.post("/wp-json/mumbai-auth/v1/payment-intent/update-status", {
          rzp_order_id: row.rzp_order_id, from_status: row.status, to_status: "test_archived",
          error_reason: "TEST_FIXTURE_ARCHIVED: owner-confirmed mock payment; excluded from live recovery. Original state preserved in the private fixture snapshot.",
        });
        if (result.data?.updated !== true) throw new Error(`Fixture changed concurrently: ${row.rzp_order_id}; review the saved snapshot`);
      }
      const verified = await wp.post("/wp-json/mumbai-auth/v1/payment-intent/get", { rzp_order_id: row.rzp_order_id, fresh: true });
      if (verified.data?.raw_row?.status !== "test_archived") throw new Error(`Archive verification failed: ${row.rzp_order_id}`);
      archived++;
      await unlock(row.rzp_order_id);
    }
    for (const event of webhookFixtures) {
      const result = await wp.post("/wp-json/mumbai-auth/v1/webhook-event/update-status", { event_id: event.event_id, status: "test_archived" });
      if (result.data?.updated !== true) throw new Error("Could not archive the confirmed test webhook");
    }
    const remaining = await wp.post("/wp-json/mumbai-auth/v1/payment-intent/reconciliation-list", { limit: 50, older_than_minutes: 0 });
    const orphanCheck = await wp.get("/wp-json/mumbai-auth/v1/webhook-events/orphans", { params: { limit: 100, page: 1 } });
    if ((orphanCheck.data?.orphans || []).some(row => row.event_id === "evt_decoupled_paid_001")) throw new Error("Test webhook still appears in orphan alerts");
    if ((remaining.data?.intents || []).some(r => ids.includes(r.rzp_order_id))) throw new Error("Archived fixture still appears in reconciliation");
    console.log(JSON.stringify({ archived, webhookFixturesArchived: webhookFixtures.length, remainingOrphanWebhooks: orphanCheck.data?.count, snapshot, remaining: (remaining.data?.intents || []).map(r => ({ id: r.rzp_order_id, status: r.status })), hasMore: remaining.data?.has_more }));
  }
} catch (error) {
  // Never print Axios config, request headers, or raw payloads (they contain credentials/PII).
  console.error(JSON.stringify({ failed: true, code: error.code, status: error.response?.status, message: error.isAxiosError ? "WordPress request failed" : error.message }));
  process.exitCode = 1;
} finally {
  for (const id of [...held].reverse()) await unlock(id).catch(() => {});
}
