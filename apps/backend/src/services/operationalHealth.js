import { timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAlertQueueHealth, getAlertSpoolPath, configuredAlertChannels } from "./alertOutbox.js";
import { getRedisClient, isRedisActive, isRedisConfigured } from "../config/redis.js";
import { logger } from "../utils/logger.js";

let lastRun = null;
let lastSuccess = null;
const healthPath = () => join(getAlertSpoolPath(), "reconciliation-health.json");
const sharedHealth = async () => {
  const redis = getRedisClient();
  try {
    const stored = redis && await redis.get("mumbai:ops:reconciliation:v1");
    if (stored) return JSON.parse(stored);
  } catch { /* Use private disk state on a single VPS during a Redis outage. */ }
  try { return JSON.parse(await readFile(healthPath(), "utf8")); } catch { return { lastRun, lastSuccess }; }
};
export const recordReconciliationHealth = async (success) => {
  const previous = await sharedHealth();
  lastRun = Date.now();
  lastSuccess = success ? lastRun : previous.lastSuccess;
  const data = JSON.stringify({ lastRun, lastSuccess });
  try {
    await mkdir(getAlertSpoolPath(), { recursive: true, mode: 0o700 });
    const temporary = `${healthPath()}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, healthPath());
    await getRedisClient()?.set("mumbai:ops:reconciliation:v1", data, "EX", 86400);
  } catch (error) {
    logger.warn({ code: error.code }, "[Health] Could not persist shared reconciliation heartbeat; local state remains available");
  }
};

// Explicit secret keeps internal availability and queue details out of the public catalog API.
export const operationalHealth = async (req, res) => {
  res.set("Cache-Control", "no-store");
  const expected = process.env.OPS_HEALTH_TOKEN;
  const supplied = req.get("authorization") || "";
  const wanted = `Bearer ${expected}`;
  const suppliedBytes = Buffer.from(supplied);
  const wantedBytes = Buffer.from(wanted);
  if (!expected || suppliedBytes.length !== wantedBytes.length || !timingSafeEqual(suppliedBytes, wantedBytes)) {
    return res.status(401).json({ success: false });
  }
  try {
    const { fetchOrphanWebhookEvents } = await import("./paymentIntentService.js");
    let wordpress = false;
    try { await fetchOrphanWebhookEvents({ limit: 1 }); wordpress = true; } catch { /* Report failure, not zero. */ }
    const queue = await getAlertQueueHealth();
    const redis = isRedisConfigured() ? isRedisActive() : null;
    const state = await sharedHealth();
    const reconciler = { ...state, overdue: state.lastSuccess ? Date.now() - state.lastSuccess > 25 * 60 * 1000 : process.uptime() > 15 * 60 };
    const alertChannelsConfigured = configuredAlertChannels().length > 0;
    const healthy = wordpress && redis !== false && !reconciler.overdue && alertChannelsConfigured && queue.oldestPendingSeconds < 900 && queue.pending < 4500;
    return res.status(healthy ? 200 : 503).json({ healthy, wordpress, redis, reconciler, alerts: queue, alertChannelsConfigured });
  } catch {
    return res.status(503).json({ healthy: false, reason: "health_check_failed" });
  }
};
