import { logger, sanitizeLogValue } from "../utils/logger.js";
import { configuredAlertChannels, queueOperationalAlert, getAlertQueueHealth } from "./alertOutbox.js";

/**
 * Dispatches an operational alert for anomaly states (payment without order, auto-refunds, reconciler actions).
 * Supports DISCORD_WEBHOOK_URL or TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID if configured.
 * Success means durably queued; only the worker records confirmed channel delivery.
 */
let customAnomalyHandler = null;
export const _setAnomalyHandlerForTesting = (handler) => { customAnomalyHandler = handler; };

export const alertStaffAnomaly = async ({ type, severity = "critical", rzpOrderId, rzpPaymentId, message, details = {}, dedupKey, dedupMs }) => {
  if (customAnomalyHandler) return customAnomalyHandler({ type, severity, rzpOrderId, rzpPaymentId, message, details });
  try {
    logger[severity === "info" ? "info" : severity === "warning" ? "warn" : "error"](
      { type, severity, rzpOrderId, rzpPaymentId, details: sanitizeLogValue(details) },
      `[STAFF ALERT: ${severity.toUpperCase()}] ${message}`
    );
    return await queueOperationalAlert({ type, severity, rzpOrderId, rzpPaymentId, message, details }, { dedupKey, dedupMs });
  } catch {
    logger.error("[Alerts] Failed to queue operational alert; caught to protect payment flow");
    return { success: false, queued: false, delivered: false };
  }
};

/** Checks whether at least one operational alerting channel is configured. */
export const checkAlertChannelsConfigured = () => configuredAlertChannels().length > 0;

/** Dispatches a daily operational summary including the orphan webhook events count. */
export const sendDailyHealthAlert = async () => {
  const { fetchOrphanWebhookEvents } = await import("./paymentIntentService.js");
  const { isRedisActive, isRedisConfigured } = await import("../config/redis.js");
  let orphanCount = null;
  let wordpressAvailable = false;
  try {
    const data = await fetchOrphanWebhookEvents({ limit: 1 });
    orphanCount = data.count;
    wordpressAvailable = true;
  } catch { /* An unavailable check must never be reported as zero orphan events. */ }
  const redisAvailable = isRedisConfigured() ? isRedisActive() : null;
  const queue = await getAlertQueueHealth().catch(() => ({ unavailable: true }));
  const degraded = !wordpressAvailable || redisAvailable === false || orphanCount > 0 || queue.unavailable || queue.oldestPendingSeconds > 900;
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return alertStaffAnomaly({
    type: "DAILY_OPERATIONAL_SUMMARY", severity: degraded ? "warning" : "info",
    dedupKey: `daily-operations:${day}`, dedupMs: 48 * 60 * 60 * 1000,
    message: `Daily checks: WordPress ${wordpressAvailable ? "reachable" : "UNAVAILABLE"}; Redis ${redisAvailable === null ? "not configured" : redisAvailable ? "connected" : "UNAVAILABLE"}; orphan webhooks ${orphanCount ?? "unknown"}. This is not a full production health certification.`,
    details: { wordpressAvailable, redisAvailable, orphanCount, alertQueue: queue, timestamp: new Date().toISOString() },
  });
};

export default { alertStaffAnomaly, checkAlertChannelsConfigured, sendDailyHealthAlert };
