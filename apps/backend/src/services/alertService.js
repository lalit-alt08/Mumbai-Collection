import axios from "axios";
import { logger } from "../utils/logger.js";
import { fetchOrphanWebhookEvents } from "./paymentIntentService.js";

// In-memory deduplication set to avoid alert storming
const recentAlerts = new Map();
const DEDUP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Dispatches an operational alert for anomaly states (payment without order, auto-refunds, reconciler actions).
 * Supports DISCORD_WEBHOOK_URL or TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID if configured.
 *
 * @param {Object} alert
 * @param {string} alert.type - Anomaly type (e.g. "ORPHAN_PAYMENT", "AUTO_REFUND", "RECONCILIATION_ACTION")
 * @param {string} alert.severity - "critical" | "warning" | "info"
 * @param {string} [alert.rzpOrderId]
 * @param {string} [alert.rzpPaymentId]
 * @param {string} alert.message
 * @param {Object} [alert.details]
 */
export const alertStaffAnomaly = async ({
  type,
  severity = "critical",
  rzpOrderId,
  rzpPaymentId,
  message,
  details = {},
}) => {
  try {
    const targetId = rzpPaymentId || rzpOrderId || "system";
    const dedupKey = `${targetId}:${type}`;
    const now = Date.now();
    const lastAlert = recentAlerts.get(dedupKey);

    if (lastAlert && now - lastAlert < DEDUP_WINDOW_MS) {
      logger.debug({ dedupKey }, "[AlertService] Alert suppressed by deduplication window");
      return { suppressed: true, dedupKey };
    }

    recentAlerts.set(dedupKey, now);

    // Evict old entries from map
    if (recentAlerts.size > 500) {
      for (const [k, ts] of recentAlerts.entries()) {
        if (now - ts > DEDUP_WINDOW_MS) recentAlerts.delete(k);
      }
    }

    // Always log authoritatively
    logger.error(
      { type, severity, rzpOrderId, rzpPaymentId, details },
      `[STAFF ALERT: ${severity.toUpperCase()}] ${message}`
    );

    const discordUrl = process.env.DISCORD_WEBHOOK_URL;
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    const content = `🚨 **[${severity.toUpperCase()}] ${type}**\n` +
      `**Message**: ${message}\n` +
      (rzpOrderId ? `**Razorpay Order**: \`${rzpOrderId}\`\n` : "") +
      (rzpPaymentId ? `**Payment ID**: \`${rzpPaymentId}\`\n` : "") +
      (Object.keys(details).length ? `**Details**: \`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\`` : "");

    // 1. Dispatch to Discord if configured
    if (discordUrl) {
      try {
        await axios.post(discordUrl, { content }, { timeout: 5000 });
      } catch (err) {
        logger.warn({ err: err.message }, "[AlertService] Failed to dispatch Discord alert");
      }
    }

    // 2. Dispatch to Telegram if configured
    if (telegramBotToken && telegramChatId) {
      try {
        const tgUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
        await axios.post(
          tgUrl,
          {
            chat_id: telegramChatId,
            text: content,
            parse_mode: "Markdown",
          },
          { timeout: 5000 }
        );
      } catch (err) {
        logger.warn({ err: err.message }, "[AlertService] Failed to dispatch Telegram alert");
      }
    }

    return { success: true, dedupKey };
  } catch (outerErr) {
    logger.warn({ err: outerErr.message }, "[AlertService] Unexpected error in alertStaffAnomaly; caught to protect payment flow");
    return { success: false, error: outerErr.message };
  }
};

/**
 * Checks whether at least one operational alerting channel is configured.
 */
export const checkAlertChannelsConfigured = () => {
  const hasDiscord = Boolean(process.env.DISCORD_WEBHOOK_URL);
  const hasTelegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  return hasDiscord || hasTelegram;
};

/**
 * Dispatches a daily operational summary alert including the orphan webhook events count.
 */
export const sendDailyHealthAlert = async () => {
  try {
    const orphanData = await fetchOrphanWebhookEvents({ limit: 10 });
    const orphanCount = orphanData?.count || 0;

    const message = `Daily Operations Summary: System healthy. Orphan webhook events: ${orphanCount}.`;
    const severity = orphanCount > 0 ? "warning" : "info";

    logger.info({ orphanCount }, "[AlertService] Dispatching daily operational health alert");

    await alertStaffAnomaly({
      type: "DAILY_OPERATIONAL_SUMMARY",
      severity,
      message,
      details: {
        orphan_events_count: orphanCount,
        sample_orphans: orphanData?.orphans || [],
        timestamp: new Date().toISOString(),
      },
    });

    return { success: true, orphanCount };
  } catch (err) {
    logger.warn({ err: err.message }, "[AlertService] Failed to send daily health alert");
    return { success: false, error: err.message };
  }
};

export default { alertStaffAnomaly, checkAlertChannelsConfigured, sendDailyHealthAlert };

