import "./config/env.js";
import app from "./app.js";
import { logger, sanitizeError, getErrorMessage } from "./utils/logger.js";
import { checkAlertChannelsConfigured, sendDailyHealthAlert, alertStaffAnomaly } from "./services/alertService.js";
import { closeEmployeeOrderStreams } from "./services/orderNotificationService.js";
import { runPaymentReconciliation } from "./services/reconciliationService.js";
import { closeRedis } from "./config/redis.js";
import { startAlertWorker, stopAlertWorker, flushAlertQueue } from "./services/alertOutbox.js";
import { recordReconciliationHealth } from "./services/operationalHealth.js";

const PORT = process.env.PORT || 5000;

// Startup safety check for production configuration
if (process.env.NODE_ENV === "production") {
  const wpUrl = process.env.WORDPRESS_URL || "";
  const wooUrl = process.env.WOOCOMMERCE_URL || "";

  if (wpUrl.includes(".local") || wooUrl.includes(".local")) {
    logger.error({ wordpressUrl: wpUrl, woocommerceUrl: wooUrl }, "Production environment must not use local service URLs");
  }

  if (!process.env.ADMIN_ORIGIN || !process.env.EMPLOYEE_ORIGIN) {
    logger.warn("Production configuration missing ADMIN_ORIGIN or EMPLOYEE_ORIGIN");
  }

  if (!checkAlertChannelsConfigured()) {
    logger.warn("Production configuration missing operational alert channels (neither DISCORD_WEBHOOK_URL nor TELEGRAM_BOT_TOKEN/CHAT_ID is set). Critical staff alerts will log locally only.");
  }
}

// Process safety crash guards
process.on("unhandledRejection", (reason) => {
  logger.error({ err: sanitizeError(reason) }, "Unhandled promise rejection");
  void alertStaffAnomaly({ type: "UNHANDLED_REJECTION", severity: "critical", message: "Backend encountered an unhandled rejection. Inspect server logs." });
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err: sanitizeError(err) }, "Uncaught exception");
  const deadline = setTimeout(() => process.exit(1), 7000);
  void alertStaffAnomaly({ type: "BACKEND_CRASH", severity: "critical", message: "Backend is exiting after an uncaught exception. Inspect server logs." })
    .then(() => flushAlertQueue({ budgetMs: 5000 }))
    .finally(() => { clearTimeout(deadline); process.exit(1); });
});

// Listen on 0.0.0.0 to support both IPv4 (127.0.0.1) and IPv6 (::1/localhost) on Windows
const HOST = process.env.HOST || "0.0.0.0";
const server = app.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST }, "Server is running");
});

// Keep the origin socket open slightly longer than Cloudflare Tunnel's default
// 90s origin idle pool. Override when the deployed proxy has a different timeout.
const configuredKeepAliveTimeout = Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS);
server.keepAliveTimeout =
  Number.isFinite(configuredKeepAliveTimeout) && configuredKeepAliveTimeout > 0
    ? configuredKeepAliveTimeout
    : 95000;
server.headersTimeout = 66000;

// Reconciler Background Worker (Runs every 10 minutes, plus initial run on boot)
const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000;
const DAILY_ALERT_INTERVAL_MS = 60 * 60 * 1000; // Calendar-day delivery deduplication survives restarts.
let initialBootTimer = null;
let reconcilerTimer = null;
let dailyAlertTimer = null;
let initialHealthTimer = null;

const reportReconciliation = async (result, error) => {
  if (result?.skipped) return;
  const failed = Boolean(error || result?.errors?.length);
  await recordReconciliationHealth(!failed);
  if (failed) await alertStaffAnomaly({
    type: "RECONCILIATION_FAILURE", severity: "critical",
    message: "Payment reconciliation could not complete cleanly. Review pending payments and server logs.",
    details: {
      failedPayments: result?.errorCount ?? result?.errors?.length ?? 0,
      escalatedPayments: result?.escalated || 0,
      sampleFailures: (result?.errors || []).slice(0, 3),
      ...(error ? { reason: getErrorMessage(error) } : {}),
    },
  });
};

export const createReconcilerTimeoutCallback = (reconcileFn = runPaymentReconciliation) => {
  return async () => {
    try {
      logger.info("[Reconciler] Executing initial post-boot reconciliation run...");
      const res = await reconcileFn();
      await reportReconciliation(res);
      logger.info({ res }, "[Reconciler] Initial run completed");
      return res;
    } catch (err) {
      logger.error({ err: err?.message || err }, "[Reconciler] Initial run failed");
      await reportReconciliation(null, err);
      return null;
    }
  };
};

export const createReconcilerIntervalCallback = (reconcileFn = runPaymentReconciliation) => {
  return async () => {
    try {
      logger.info("[Reconciler] Executing periodic reconciliation run...");
      const res = await reconcileFn();
      await reportReconciliation(res);
      logger.info({ res }, "[Reconciler] Periodic run completed");
      return res;
    } catch (err) {
      logger.error({ err: err?.message || err }, "[Reconciler] Periodic run failed");
      await reportReconciliation(null, err);
      return null;
    }
  };
};

export const createDailyAlertCallback = (alertFn = sendDailyHealthAlert) => {
  return async () => {
    try {
      logger.info("[DailyAlert] Executing daily health alert check...");
      const res = await alertFn();
      logger[res?.success ? "info" : "warn"]({ res }, "[DailyAlert] Daily health alert queue result (delivery is asynchronous)");
      return res;
    } catch (err) {
      logger.error({ err: err?.message || err }, "[DailyAlert] Daily health alert failed");
      return null;
    }
  };
};

export const startBackgroundWorkers = () => {
  if (reconcilerTimer) return;
  startAlertWorker();
  logger.info("[Workers] Background reconciliation & health alert workers registered");

  // Initial cycle after boot
  initialBootTimer = setTimeout(createReconcilerTimeoutCallback(), 5000);
  if (initialBootTimer.unref) initialBootTimer.unref();

  // Periodic reconciler
  reconcilerTimer = setInterval(createReconcilerIntervalCallback(), RECONCILIATION_INTERVAL_MS);
  if (reconcilerTimer.unref) reconcilerTimer.unref();

  // Daily operations health alert
  initialHealthTimer = setTimeout(createDailyAlertCallback(), 15000);
  initialHealthTimer.unref?.();
  dailyAlertTimer = setInterval(createDailyAlertCallback(), DAILY_ALERT_INTERVAL_MS);
  if (dailyAlertTimer.unref) dailyAlertTimer.unref();
};

export const stopBackgroundWorkers = () => {
  clearTimeout(initialHealthTimer);
  initialHealthTimer = null;
  if (initialBootTimer) {
    clearTimeout(initialBootTimer);
    initialBootTimer = null;
  }
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
  if (dailyAlertTimer) {
    clearInterval(dailyAlertTimer);
    dailyAlertTimer = null;
  }
};

const isTestEnv =
  process.env.NODE_ENV === "test" ||
  process.argv.some((arg) => arg.includes("--test") || arg.includes(".test.")) ||
  process.execArgv.some((arg) => arg.includes("--test"));

if (!isTestEnv) {
  startBackgroundWorkers();
}

// Graceful shutdown
let shuttingDown = false;
const gracefulShutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceKillTimer = setTimeout(() => {
    logger.error("Graceful shutdown exceeded timeout limit. Forcing exit.");
    process.exit(1);
  }, 10000);
  if (forceKillTimer.unref) forceKillTimer.unref();

  logger.info("Received shutdown signal. Closing HTTP server");
  stopBackgroundWorkers();
  closeEmployeeOrderStreams();

  server.close(async () => {
    await stopAlertWorker(); // Anything not delivered remains in the durable spool for restart.
    await closeRedis();
    clearTimeout(forceKillTimer);
    logger.info("HTTP server closed. Exiting process");
    process.exit(0);
  });

  server.closeIdleConnections?.();

  const forceCloseTimer = setTimeout(() => {
    if (typeof server.closeAllConnections === "function") {
      logger.warn("Closing lingering active connections after 5s grace period");
      server.closeAllConnections();
    }
  }, 5000);
  if (forceCloseTimer.unref) forceCloseTimer.unref();
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);


