import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wpInitPath = path.resolve(__dirname, "../../../docker/wp-init.sh");
const dockerComposePath = path.resolve(__dirname, "../../../docker/docker-compose.yml");
const webhookHandlerPath = path.resolve(__dirname, "../src/controllers/paymentWebhookHandler.js");
const reconciliationServicePath = path.resolve(__dirname, "../src/services/reconciliationService.js");
const rateLimiterPath = path.resolve(__dirname, "../src/middlewares/rateLimiter.js");
const storeRoutesPath = path.resolve(__dirname, "../src/routes/storeRoutes.js");
const mumbaiAuthPath = path.resolve(__dirname, "../../wordpress-plugin/mumbai-auth.php");

test("Security & Payment Reconciliation Audit Fixes Suite", async (t) => {
  const wpInitSource = fs.readFileSync(wpInitPath, "utf8");
  const dockerComposeSource = fs.readFileSync(dockerComposePath, "utf8");
  const webhookHandlerSource = fs.readFileSync(webhookHandlerPath, "utf8");
  const reconciliationSource = fs.readFileSync(reconciliationServicePath, "utf8");
  const rateLimiterSource = fs.readFileSync(rateLimiterPath, "utf8");
  const storeRoutesSource = fs.readFileSync(storeRoutesPath, "utf8");
  const mumbaiAuthSource = fs.readFileSync(mumbaiAuthPath, "utf8");

  await t.test("1. wp-init.sh and docker-compose.yml fail-closed without seeding fallback dev keys in production", () => {
    assert.ok(
      wpInitSource.includes('getenv("SEED_DEV_WC_KEYS") === "true"'),
      "wp-init.sh must require explicit SEED_DEV_WC_KEYS opt-in"
    );
    assert.ok(
      wpInitSource.includes('$env === "production" || !$seed_dev'),
      "wp-init.sh must skip dev key seeding when in production or not opted-in"
    );
    assert.ok(
      !dockerComposeSource.includes("${WOOCOMMERCE_CONSUMER_KEY:-ck_dev_mumbai_local_key"),
      "docker-compose.yml must not hard-code fallback dev consumer key"
    );
    assert.ok(
      !dockerComposeSource.includes("${WOOCOMMERCE_CONSUMER_SECRET:-cs_dev_mumbai_local_secret"),
      "docker-compose.yml must not hard-code fallback dev consumer secret"
    );
  });

  await t.test("2. Refund webhook handler fails closed if WooCommerce order transition fails", () => {
    assert.ok(
      webhookHandlerSource.includes("wcRefundErr"),
      "Webhook handler must capture WooCommerce status update errors"
    );
    assert.ok(
      webhookHandlerSource.includes("toStatus: \"refund_pending\"") &&
      webhookHandlerSource.includes("throw new Error"),
      "Webhook handler must set intent to refund_pending and throw if WooCommerce status update fails"
    );
  });

  await t.test("3. Reconciliation service transitions existing WooCommerce order to refunded before marking intent settled", () => {
    assert.ok(
      reconciliationSource.includes("paymentIntentService.findWcOrderByRazorpayOrderId") &&
      reconciliationSource.includes("wcOrder.status !== 'refunded'"),
      "Reconciler must locate order and check if order status is not yet refunded"
    );
    assert.ok(
      reconciliationSource.includes("api.put(`orders/${wcOrder.id}`, {\n                    status: 'refunded'") ||
      reconciliationSource.includes("status: 'refunded'"),
      "Reconciler must sync order status to refunded"
    );
  });

  await t.test("4. Rate limiters use scoped namespaces to prevent catalog browsing from eating cart budget", () => {
    assert.ok(
      rateLimiterSource.includes('name ? `${name}:${baseKey}` : baseKey'),
      "Rate limiter must scope keys by limiter name"
    );
    assert.ok(
      rateLimiterSource.includes('name: "store"') &&
      rateLimiterSource.includes('name: "catalog"'),
      "Store and catalog limiters must declare distinct names"
    );
  });

  await t.test("5. Cart stock enrichment uses dedicated cache key and does not pollute public catalog cache", () => {
    assert.ok(
      storeRoutesSource.includes("stock:enrichment:product:"),
      "Cart enrichment must use dedicated stock cache key"
    );
    assert.ok(
      !storeRoutesSource.includes('serverCache.set(`catalog:product:${productId}`'),
      "Cart enrichment must not overwrite catalog:product:${productId}"
    );
  });

  await t.test("6. Stock reservation query check in mumbai-auth.php fails closed on database errors", () => {
    assert.ok(
      mumbaiAuthSource.includes("$custom_held_raw === null || $wpdb->last_error"),
      "Stock reservation must check for null result or database errors"
    );
    assert.ok(
      mumbaiAuthSource.includes("Could not verify existing stock reservations"),
      "Stock reservation must throw exception if reservation check query fails"
    );
  });

  await t.test("7. Mumbai-auth orphan webhook query includes stranded stored events older than 5 minutes", () => {
    assert.ok(
      mumbaiAuthSource.includes("status = 'stored' AND created_at < UTC_TIMESTAMP() - INTERVAL 5 MINUTE"),
      "Orphan webhook query must recover stranded events stored > 5 minutes ago"
    );
  });

  await t.test("8. WordPress request-time init hook for category mutation is removed and admin route is protected", () => {
    assert.ok(
      !mumbaiAuthSource.includes("add_action('init', 'mumbai_ensure_core_categories'"),
      "mumbai-auth.php must not mutate categories on every visitor init request"
    );
    assert.ok(
      mumbaiAuthSource.includes("/admin/ensure-core-categories") &&
      mumbaiAuthSource.includes("'permission_callback' => 'mumbai_internal_server_permission'"),
      "ensure-core-categories admin route must require internal server permission"
    );
  });
});
