import "./config/env.js";
import app from "./app.js";
import { logger, sanitizeError } from "./utils/logger.js";
import { checkAlertChannelsConfigured, sendDailyHealthAlert } from "./services/alertService.js";
import { runPaymentReconciliation } from "./services/reconciliationService.js";

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
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err: sanitizeError(err) }, "Uncaught exception");
  process.exit(1);
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server is running");
});

// Align keepAliveTimeout with reverse proxies (e.g. ALB, Cloudflare, Nginx)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Reconciler Background Worker (Runs every 10 minutes, plus initial run on boot)
const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000;
const DAILY_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;
let reconcilerTimer = null;
let dailyAlertTimer = null;

export const createReconcilerTimeoutCallback = (reconcileFn = runPaymentReconciliation) => {
  return async () => {
    try {
      logger.info("[Reconciler] Executing initial post-boot reconciliation run...");
      const res = await reconcileFn();
      logger.info({ res }, "[Reconciler] Initial run completed");
      return res;
    } catch (err) {
      logger.error({ err: err?.message || err }, "[Reconciler] Initial run failed");
      return null;
    }
  };
};

export const createReconcilerIntervalCallback = (reconcileFn = runPaymentReconciliation) => {
  return async () => {
    try {
      logger.info("[Reconciler] Executing periodic reconciliation run...");
      const res = await reconcileFn();
      logger.info({ res }, "[Reconciler] Periodic run completed");
      return res;
    } catch (err) {
      logger.error({ err: err?.message || err }, "[Reconciler] Periodic run failed");
      return null;
    }
  };
};

export const createDailyAlertCallback = (alertFn = sendDailyHealthAlert) => {
  return async () => {
    try {
      logger.info("[DailyAlert] Executing daily health alert check...");
      const res = await alertFn();
      logger.info({ res }, "[DailyAlert] Daily health alert check completed");
      return res;
    } catch (err) {
      logger.error({ err: err?.message || err }, "[DailyAlert] Daily health alert failed");
      return null;
    }
  };
};

const startBackgroundWorkers = () => {
  logger.info("[Workers] Background reconciliation & health alert workers registered");

  // Initial cycle after boot
  setTimeout(createReconcilerTimeoutCallback(), 5000);

  // Periodic reconciler
  reconcilerTimer = setInterval(createReconcilerIntervalCallback(), RECONCILIATION_INTERVAL_MS);
  if (reconcilerTimer.unref) reconcilerTimer.unref();

  // Daily operations health alert
  dailyAlertTimer = setInterval(createDailyAlertCallback(), DAILY_ALERT_INTERVAL_MS);
  if (dailyAlertTimer.unref) dailyAlertTimer.unref();
};

startBackgroundWorkers();

// Graceful shutdown
const gracefulShutdown = () => {
  logger.info("Received shutdown signal. Closing HTTP server");
  if (reconcilerTimer) clearInterval(reconcilerTimer);
  if (dailyAlertTimer) clearInterval(dailyAlertTimer);
  server.close(() => {
    logger.info("HTTP server closed. Exiting process");
    process.exit(0);
  });
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

