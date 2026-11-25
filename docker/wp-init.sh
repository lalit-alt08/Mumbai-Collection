#!/usr/bin/env sh
set -eu

WP_PATH="/var/www/html"
WP_URL="${WP_SITE_URL:-http://localhost:8085}"
WP_TITLE="${WP_SITE_TITLE:-Mumbai Collection Local}"
WP_ADMIN_USER="${WP_ADMIN_USER:-admin}"
WP_ADMIN_PASSWORD="${WP_ADMIN_PASSWORD:-}"
WP_ADMIN_EMAIL="${WP_ADMIN_EMAIL:-admin@example.com}"
WC_KEY="${WOOCOMMERCE_CONSUMER_KEY:-}"
WC_SECRET="${WOOCOMMERCE_CONSUMER_SECRET:-}"
SEED_DEV_WC_KEYS="${SEED_DEV_WC_KEYS:-false}"

echo "[wp-init] Waiting for WordPress files and database connection..."
attempts=0
until [ -f "$WP_PATH/wp-config.php" ] && wp db query "SELECT 1;" --path="$WP_PATH" --allow-root >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 60 ]; then
    echo "[wp-init] ERROR: Database connection not ready in time."
    exit 1
  fi
  sleep 2
done

if ! wp core is-installed --path="$WP_PATH" --allow-root >/dev/null 2>&1; then
  if [ -z "$WP_ADMIN_PASSWORD" ]; then
    echo "[wp-init] ERROR: WP_ADMIN_PASSWORD must be explicitly set before installing WordPress." >&2
    exit 1
  fi
  echo "[wp-init] Installing WordPress core at $WP_URL..."
  wp core install \
    --path="$WP_PATH" \
    --url="$WP_URL" \
    --title="$WP_TITLE" \
    --admin_user="$WP_ADMIN_USER" \
    --admin_password="$WP_ADMIN_PASSWORD" \
    --admin_email="$WP_ADMIN_EMAIL" \
    --skip-email \
    --allow-root
else
  echo "[wp-init] WordPress core already installed."
fi

echo "[wp-init] Ensuring pretty permalinks (required for /wp-json REST API)..."
wp rewrite structure '/%postname%/' --hard --path="$WP_PATH" --allow-root
wp rewrite flush --hard --path="$WP_PATH" --allow-root

if ! wp plugin is-installed woocommerce --path="$WP_PATH" --allow-root >/dev/null 2>&1; then
  echo "[wp-init] Installing and activating latest patched WooCommerce..."
  wp plugin install woocommerce --version=10.4.3 --activate --path="$WP_PATH" --allow-root
else
  echo "[wp-init] Ensuring WooCommerce is active..."
  wp plugin activate woocommerce --path="$WP_PATH" --allow-root >/dev/null 2>&1 || true
fi

echo "[wp-init] Activating Mumbai Collection Auth plugin..."
wp plugin activate mumbai-auth --path="$WP_PATH" --allow-root >/dev/null 2>&1 || true

echo "[wp-init] Checking WooCommerce REST API key configuration..."
wp eval '
  global $wpdb;
  $ck = getenv("WOOCOMMERCE_CONSUMER_KEY");
  $cs = getenv("WOOCOMMERCE_CONSUMER_SECRET");
  $seed_dev = getenv("SEED_DEV_WC_KEYS") === "true";
  $env = getenv("NODE_ENV") ?: getenv("APP_ENV") ?: "development";

  if (!$ck || !$cs) {
    if ($env === "production" || !$seed_dev) {
      echo "[wp-init] Dev key seeding disabled or in production. Skipping automatic key generation.\n";
      exit(0);
    }
    // Only local development explicit opt-in
    $ck = "ck_dev_mumbai_local_key_000000000000000000";
    $cs = "cs_dev_mumbai_local_secret_000000000000000";
  }

  $admin = get_user_by("login", getenv("WP_ADMIN_USER") ?: "admin");
  if (!$admin || !function_exists("wc_api_hash")) {
    fwrite(STDERR, "[wp-init] Skipping WC key seed (admin or wc_api_hash unavailable)\n");
    exit(0);
  }
  $table = $wpdb->prefix . "woocommerce_api_keys";
  $hash = wc_api_hash($ck);
  $existing = $wpdb->get_var($wpdb->prepare("SELECT key_id FROM {$table} WHERE consumer_key = %s", $hash));
  if (!$existing) {
    $is_dev_key = ($ck === "ck_dev_mumbai_local_key_000000000000000000");
    $wpdb->insert($table, [
      "user_id"         => $admin->ID,
      "description"     => $is_dev_key ? "Mumbai Docker Dev (Auto-seeded)" : "Mumbai Backend API Key",
      "permissions"     => "read_write",
      "consumer_key"    => $hash,
      "consumer_secret" => $cs,
      "truncated_key"   => substr($ck, -7),
    ]);
    echo "[wp-init] Seeded WooCommerce REST API key (" . ($is_dev_key ? "dev fallback" : "configured key") . ").\n";
  } else {
    echo "[wp-init] WooCommerce REST API key already present.\n";
  }
' --path="$WP_PATH" --allow-root

echo "[wp-init] Bootstrap complete!"
