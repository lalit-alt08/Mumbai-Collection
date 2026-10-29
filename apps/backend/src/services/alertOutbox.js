import axios from "axios";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger, sanitizeLogValue } from "../utils/logger.js";

// Keep this directory on persistent, private storage shared by PM2 workers.
const spool = () => resolve(process.env.ALERT_SPOOL_DIR || fileURLToPath(new URL("../../var/alerts/", import.meta.url)));
export const getAlertSpoolPath = spool;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const DEDUP_MS = 15 * 60 * 1000;
const CLAIM_MS = 60 * 1000;
const MAX_RECORDS = 5000;
const recent = new Map();
let timer;
let running;
let redisPromise;

export const configuredAlertChannels = () => [
  ...(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim() ? ["telegram"] : []),
  ...(process.env.DISCORD_WEBHOOK_URL?.trim() ? ["discord"] : []),
];
const redisClient = async () => {
  redisPromise ||= import("../config/redis.js");
  return (await redisPromise).getRedisClient();
};
const directories = () => Promise.all(["pending", "working", "delivered"].map((name) => mkdir(join(spool(), name), { recursive: true, mode: 0o700 })));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const atomicWrite = async (path, value) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
};
const safeValue = (value) => {
  let text = JSON.stringify(sanitizeLogValue(value));
  // Do not store credentials even if an upstream error embedded them in its message.
  for (const key of ["TELEGRAM_BOT_TOKEN", "DISCORD_WEBHOOK_URL", "MUMBAI_INTERNAL_API_KEY", "GOOGLE_CLIENT_SECRET"]) {
    if (process.env[key]) text = text.split(process.env[key]).join("[REDACTED]");
  }
  return JSON.parse(text);
};

export const queueOperationalAlert = async (alert, { dedupKey, dedupMs = DEDUP_MS } = {}) => {
  try {
    const channels = configuredAlertChannels();
    if (!channels.length) return { success: false, queued: false, delivered: false, reason: "no_channels" };
    const key = dedupKey || `${alert.rzpPaymentId || alert.rzpOrderId || alert.details?.source || "system"}:${alert.type}`;
    const fingerprint = hash(key);
    const now = Date.now();
    if (recent.get(fingerprint) > now) return { success: true, suppressed: true, queued: false, delivered: false, reason: "recently_accepted", dedupKey: key };
    await directories();
    const entries = await readdir(join(spool(), "pending"));
    if (entries.length >= MAX_RECORDS) throw new Error("Alert spool is full; operator intervention required");
    const id = randomUUID();
    const record = { id, fingerprint, createdAt: now, dedupMs, alert: safeValue(alert), channels: channels.map((name) => ({ name, delivered: false, attempts: 0, nextAttemptAt: now })) };
    await atomicWrite(join(spool(), "pending", `${id}.json`), record);
    // Suppress duplicate enqueues only after a durable write. Delivery retries are independent.
    recent.set(fingerprint, now + dedupMs);
    for (const [entry, until] of recent) if (until <= now) recent.delete(entry);
    while (recent.size > 1000) recent.delete(recent.keys().next().value);
    return { success: true, queued: true, delivered: false, dedupKey: key };
  } catch (error) {
    logger.error({ code: error.code }, "[Alerts] Could not persist alert; delivery is NOT confirmed (check spool capacity and permissions)");
    return { success: false, queued: false, delivered: false, reason: "persistence_failed" };
  }
};

const messageText = (alert, limit) => {
  const lines = [`[${String(alert.severity).toUpperCase()}] ${alert.type}`, alert.message];
  if (alert.rzpOrderId) lines.push(`Razorpay order: ${alert.rzpOrderId}`);
  if (alert.rzpPaymentId) lines.push(`Payment: ${alert.rzpPaymentId}`);
  if (Object.keys(alert.details || {}).length) lines.push(JSON.stringify(alert.details, null, 2));
  // Plain text avoids HTML injection and cutting an HTML entity/tag at the limit.
  const text = lines.join("\n");
  return text.length > limit ? `${text.slice(0, limit - 20)}\n[details truncated]` : text;
};
const destination = (channel) => hash(channel === "telegram" ? `${process.env.TELEGRAM_BOT_TOKEN}:${process.env.TELEGRAM_CHAT_ID}` : String(process.env.DISCORD_WEBHOOK_URL));

const deliverChannel = async (record, channel) => {
  const key = `${record.fingerprint}:${channel.name}:${destination(channel.name)}`;
  const marker = join(spool(), "delivered", `${hash(key)}.json`);
  const cooldownPath = join(spool(), "delivered", `cooldown-${channel.name}-${destination(channel.name)}.json`);
  const sentKey = `mumbai:alerts:sent:v1:${key}`;
  const lockKey = `mumbai:alerts:lock:v1:${key}`;
  let redis;
  let lockToken;
  try {
    const local = await readJson(marker).catch(() => null);
    if (local?.until > Date.now()) return true;
    const cooldown = await readJson(cooldownPath).catch(() => null);
    if (cooldown?.until > Date.now()) {
      channel.nextAttemptAt = cooldown.until;
      return false;
    }
    try {
      redis = await redisClient();
      if (redis) {
        if (await redis.get(sentKey)) return true;
        lockToken = randomUUID();
        if (await redis.set(lockKey, lockToken, "PX", CLAIM_MS, "NX") !== "OK") return false;
      }
    } catch { redis = null; lockToken = null; } // Disk queue still works during a Redis outage.
    if (!configuredAlertChannels().includes(channel.name)) throw new Error("channel_not_configured");
    if (channel.name === "telegram") {
      const response = await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN.trim()}/sendMessage`, {
        chat_id: process.env.TELEGRAM_CHAT_ID.trim(), text: messageText({ ...record.alert, details: { occurredAt: new Date(record.createdAt).toISOString(), ...record.alert.details } }, 4000),
      }, { timeout: 5000 });
      if (response.data?.ok !== true) {
        const error = new Error("telegram_rejected");
        error.response = { status: response.data?.error_code, data: response.data };
        throw error;
      }
    } else {
      await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: messageText(record.alert, 1900), allowed_mentions: { parse: [] } }, { timeout: 5000 });
    }
    await atomicWrite(marker, { until: Date.now() + record.dedupMs });
    if (channel.name === "telegram") await atomicWrite(cooldownPath, { until: Date.now() + 1100 });
    if (redis) await redis.set(sentKey, "1", "PX", record.dedupMs).catch(() => {});
    return true;
  } catch (error) {
    channel.attempts++;
    const retryAfter = Number(error.response?.data?.parameters?.retry_after || error.response?.data?.retry_after || error.response?.headers?.["retry-after"]);
    const backoff = Math.min(3600000, 5000 * 2 ** Math.min(channel.attempts, 10));
    channel.nextAttemptAt = Date.now() + Math.max(backoff, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0) + Math.floor(Math.random() * 1000);
    if (Number(error.response?.status) === 429) {
      await atomicWrite(cooldownPath, { until: channel.nextAttemptAt }).catch(() => {});
    }
    // Axios errors can contain the bot token in their URL. Never log the error object/message.
    logger.warn({ channel: channel.name, status: error.response?.status, code: error.code, attempts: channel.attempts }, "[Alerts] Delivery failed; retained for retry");
    return false;
  } finally {
    if (redis && lockToken) await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, lockKey, lockToken).catch(() => {});
  }
};

const drain = async ({ budgetMs = 15000 } = {}) => {
  await directories();
  const started = Date.now();
  // A crashed worker's atomic claim is recovered after a minute; no alert is deleted on failure.
  for (const name of await readdir(join(spool(), "working"))) {
    if (!name.endsWith(".json")) continue;
    const path = join(spool(), "working", name);
    const info = await stat(path).catch(() => null);
    const claimTime = Number(name.split("-")[0]);
    if (info && Date.now() - Math.max(claimTime || 0, info.mtimeMs) > CLAIM_MS) {
      await rename(path, join(spool(), "pending", name.split("--")[1])).catch(() => {});
    }
  }
  let processed = 0;
  for (const name of await readdir(join(spool(), "pending"))) {
    if (!name.endsWith(".json")) continue;
    if (processed >= 20 || Date.now() - started >= budgetMs) break;
    const pending = join(spool(), "pending", name);
    const candidate = await readJson(pending).catch(() => null);
    if (candidate?.channels.every((c) => c.delivered)) {
      await unlink(pending).catch(() => {});
      continue;
    }
    if (!candidate || !candidate.channels.some((c) => !c.delivered && c.nextAttemptAt <= Date.now())) continue;
    const claimed = join(spool(), "working", `${Date.now()}-${randomUUID()}--${name}`);
    try { await rename(pending, claimed); } catch { continue; } // Exactly one worker claims this file.
    processed++;
    try {
      const snapshot = await readJson(claimed); // Re-read after claiming; another worker may have updated retry state.
      await atomicWrite(claimed, snapshot); // Starts the crash-recovery lease.
      for (const channel of snapshot.channels) {
        if (channel.delivered || channel.nextAttemptAt > Date.now()) continue;
        channel.delivered = await deliverChannel(snapshot, channel);
        await atomicWrite(claimed, snapshot); // Persist each channel independently.
      }
      if (snapshot.channels.every((c) => c.delivered)) {
        await unlink(claimed);
        logger.info({ type: snapshot.alert.type }, "[Alerts] All configured channels delivered");
      } else await rename(claimed, pending);
    } catch (error) {
      logger.error({ code: error.code }, "[Alerts] Spool processing failed; claim will be recovered");
    }
  }
  for (const name of await readdir(join(spool(), "delivered"))) {
    if (!name.endsWith(".json")) continue;
    const path = join(spool(), "delivered", name);
    const marker = await readJson(path).catch(() => null);
    if (marker && marker.until <= Date.now()) await unlink(path).catch(() => {});
  }
};

export const flushAlertQueue = (options) => {
  if (running) return running;
  running = drain(options).catch((error) => logger.error({ code: error.code }, "[Alerts] Queue worker failed")).finally(() => { running = null; });
  return running;
};
export const startAlertWorker = () => {
  if (timer) return;
  timer = setInterval(() => void flushAlertQueue(), 5000);
  timer.unref?.();
  void flushAlertQueue();
};
export const stopAlertWorker = async () => {
  clearInterval(timer);
  timer = null;
  if (running) await running;
};

export const getAlertQueueHealth = async () => {
  await directories();
  let pending = 0;
  let oldest = Date.now();
  for (const directory of ["pending", "working"]) {
    for (const name of await readdir(join(spool(), directory))) {
      if (!name.endsWith(".json")) continue;
      pending++;
      const record = await readJson(join(spool(), directory, name)).catch(() => null);
      if (record) oldest = Math.min(oldest, record.createdAt);
    }
  }
  return { pending, oldestPendingSeconds: pending ? Math.round((Date.now() - oldest) / 1000) : 0 };
};
