# Production recovery and operations

## Before enabling staff mutations

Deploy the matching `mumbai-auth.php` plugin before restarting Node. Staff order
and stock mutations deliberately fail if the protected PHP endpoints are absent.
Enable authoritative WooCommerce HPOS storage. Reporting requires it and excludes
pending, cancelled, failed, refunded, on-hold and draft sales; revenue is net of
recorded WooCommerce refunds. Product-filtered revenue excludes shipping/tax.
Refunds issued outside WooCommerce must also be recorded against the order.
Schedule WordPress cron from the host (for example WP-CLI `wp cron event run
--due-now` every minute) so historical location/customer index batches complete
even when there are no storefront visits. Confirm indexing has completed before
depending on location filters.

## Backups on the VPS

Install WP-CLI, gzip, tar and flock. Run as the WordPress service account:

```sh
WP_ROOT=/srv/wordpress BACKUP_ROOT=/srv/private-backups bash scripts/production-backup.sh
```

Schedule this command using a systemd timer or cron after setting the actual
paths. It produces a consistent InnoDB SQL snapshot, wp-content archive, version
information and checksums; only one backup runs at a time. Media writes can occur
during the archive, so a deployment/maintenance window is preferable for a full
point-in-time snapshot. Keep separate encrypted copies of wp-config.php, backend
environment configuration and the deployed application revision.

Copy successful snapshots to private encrypted storage outside the VPS. Configure
retention there (for example daily and monthly snapshots). Neither an off-server
destination nor backup scheduling is configured by this repository change.

## Restore exercise

1. Use an isolated staging WordPress/database with no live payment webhooks,
   workers, email delivery or checkout access. Preserve its current data first.
2. Verify `sha256sum -c SHA256SUMS` inside the snapshot directory.
3. Install the recorded WordPress version and supply private staging configuration.
4. Extract wp-content into the staging installation. Import the decompressed SQL
   with WP-CLI `wp db import`, using the staging database only.
5. Adjust URLs for staging with WP-CLI search-replace. Flush caches and permalinks.
6. Verify product counts, stock, customer history, order/refund totals and media.
7. Record duration, backup timestamp, results and the recovery point achieved.

For actual disaster recovery stop public writes and workers, preserve the damaged
database/media, restore the verified snapshot, then reconcile Razorpay captures
and refunds since the backup timestamp before reopening checkout. Do not replay
payments or refund calls from an old snapshot blindly.

## Alerts and process recovery

Set DISCORD_WEBHOOK_URL or TELEGRAM_BOT_TOKEN plus TELEGRAM_CHAT_ID on the server.
Unhandled API failures, process crashes and Redis connectivity failures emit
deduplicated alerts. Confirm receipt in the chosen channel after deployment.
Run Node under a process supervisor with automatic restart and startup on boot.
Use an external uptime check: a stopped server cannot alert on its own behalf.
Monitor backup completion independently, including a missing-snapshot alarm.

### Durable Telegram/Discord delivery

Alerts are written to a private disk outbox before returning to checkout code.
`success: true, queued: true, delivered: false` acknowledges persistence, not a
Telegram delivery. The background worker runs every five seconds and records each
channel's acknowledgement separately. Failed sends remain on disk with exponential
backoff (up to one hour); Telegram `retry_after` can delay retries longer. Text is
bounded to channel limits, sent without executable HTML or Discord mentions, and
credentials are excluded from delivery error logs. Successful delivery markers
suppress repeats for 15 minutes (daily summaries use an IST calendar-day key).

Set `ALERT_SPOOL_DIR` to private persistent storage, such as
`/srv/private/mumbai-alerts`, owned by the backend service account with directory
permissions 0700. All PM2 workers and the monitor on this VPS must share this path
and user. Keep it outside the web root and preserve it across deployments. Do not
use an ephemeral/serverless filesystem. A crashed worker's claim is retried after
60 seconds. The pending queue is bounded to approximately 5,000 records; delivery
failure, queue capacity, and filesystem permission errors are logged explicitly.
Unsent records are not discarded automatically: inspect prolonged failures and
disk usage. Successful delivery markers expire and are cleaned up.

Redis coordinates delivery locks and deduplication across healthy instances.
During a Redis outage local spools continue delivering; separate records/workers
or separate VPS hosts can send duplicates. A lost Telegram acknowledgement can
also produce a duplicate after retry. Telegram does not offer an idempotency key
for sendMessage, so this is at-least-once delivery, not exactly-once delivery.
Loss of the VPS disk can lose queued alerts. Use an independent external monitor
for whole-host/network outages; a local queue cannot detect or report its own
host being powered off. No administrative bot commands are enabled.

Daily summaries run shortly after startup and are checked hourly, deduplicated
by IST date. They report WordPress/orphan-query availability and Redis/alert-queue
state, never a blanket assurance that all production services are healthy.
Reconciler failures and Redis recovery now emit operational alerts as well.

### Payment recovery failures and test-data isolation

Gateway lookup failures now count toward the three-attempt recovery limit,
including failures that happen before a refund call can be reached. Exhausted
refund recoveries enter `refund_escalated`; exhausted payment discovery enters
`reconciliation_escalated`. Both are paused for staff review and are excluded
from automatic retry selection. Pausing does not prove a payment failed and
does not refund funds or release inventory. Review the Razorpay transaction and
WooCommerce order before manually resuming or resolving a case. Escalated
payment recovery blocks a replacement checkout for the same customer/cart and
automatic cancellation/finalization. Temporary order-creation failures continue
using the existing paid-payment recovery/deadline path.

Alerts include a bounded sample of order IDs and safe failure descriptions.
Razorpay SDK errors are normalized from `error.description`; raw response payloads
and credentials must not be posted to Telegram. Redis warnings include a safe
reason and connection state so future connection errors can be diagnosed.

Unit tests are prohibited from using the real payment-storage HTTP client: inject
`_setWpClientForTesting` mocks. Integration tests must use a separate disposable
WordPress/database and payment account. Do not run integration fixtures against
the database that will be promoted to production.

The one-time `apps/backend/scripts/archive-confirmed-payment-fixtures.js` archives
only the 12 owner-confirmed historical mock IDs and the exact
`evt_decoupled_paid_001` webhook fixture defined in `paymentWebhook.test.js`.
It defaults to a read-only preview,
requires a local development WordPress host and Razorpay test keys, and applies
only with `--apply`. It checks for linked orders, obtains recovery/payment locks,
saves a private snapshot, and changes those intents to `test_archived`. It never
deletes records, creates orders, issues refunds or releases stock. The archived
fixtures are excluded from future recovery. Retain the private snapshot for
traceability; never publish its checkout/customer payloads.

### Independent VPS monitor (activation required)

Create a private environment file (chmod 0600) with the Telegram values above,
the same `ALERT_SPOOL_DIR`, a strong random `OPS_HEALTH_TOKEN` (also set in the
API environment), and:

```dotenv
MONITOR_HEALTH_URL=https://your-api.example/api/ops/health
MONITOR_INSTANCE_ID=mumbai-vps
MONITOR_DISK_PATH=/
BACKUP_ROOT=/srv/private-backups
OFFSITE_BACKUP_MARKER=/srv/private/offsite-backup-last-success
```

The bearer-authenticated health endpoint checks WordPress/DB reachability, Redis,
reconciliation progress and alert backlog. It is not a payment-gateway probe or
a backup/restore certification. The separate monitor additionally checks free
memory, five-minute CPU load per core, free disk space, and local/offsite backup
freshness. Defaults are 10% free memory, load below 1.5 per core, 15% free disk,
and backups no older than 26 hours. Thresholds can be configured using the
`MONITOR_*` settings in the script. A missing backup marker is a failed check.
Use an independent instance ID for each monitor host.

First run without `--apply` to print checks without sending alerts:

```sh
MONITOR_ENV_FILE=/srv/private/monitor.env node /srv/mumbai/apps/backend/scripts/production-monitor.js
```

After reviewing the checks, schedule the following every minute in cron or a
systemd timer, independently of the API supervisor. Use flock (same service user)
to prevent overlapping monitor executions. Install Node/backend dependencies:

```sh
flock -n /srv/private/monitor.lock env MONITOR_ENV_FILE=/srv/private/monitor.env node /srv/mumbai/apps/backend/scripts/production-monitor.js --apply
```

An unhealthy check queues an alert with 15-minute delivery deduplication; a
transition back to healthy queues a recovery alert. The monitor can drain the
same outbox while the API process is stopped. It never restarts services or
executes refunds. Exit status is nonzero for failed checks, including missing
alert channels. Monitor the monitor's execution using an external uptime service.

The backup script writes `BACKUP_ROOT/last-success` only after checksum validation
completes, and records `last-failure` when a backup attempt fails. The monitor
flags a failure newer than the last success without waiting for the freshness
deadline. `OFFSITE_BACKUP_MARKER` must contain Unix epoch seconds and must be
updated by your upload job ONLY after a verified successful off-server upload.
Do not copy the local backup marker before upload or you will hide upload failures.
This repository does not configure cron, off-server storage, an external uptime
provider, or the actual production VPS. Complete those deployment steps before
relying on these alerts.

Redis reconnects with capped backoff. During outages L1 caches and employee polling
continue; cross-instance messaging is unavailable until recovery. Reconnect clears
local caches to catch changes missed while disconnected. Local TTLs bound staleness.
