import webpush from "web-push";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, copyFile, open, stat } from "node:fs/promises";
import { existsSync, readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";
import { getRedisClient, isRedisActive } from "../config/redis.js";
import wp from "./wordpress.js";

const VAR_DIR = resolve(fileURLToPath(new URL("../../var", import.meta.url)));
const VAPID_KEYS_FILE = join(VAR_DIR, "vapid_keys.json");
const SUBSCRIPTIONS_FILE = join(VAR_DIR, "push_subscriptions.json");
const OUTBOX_FILE = join(VAR_DIR, "push_outbox.json");
const OUTBOX_DLQ_FILE = join(VAR_DIR, "push_outbox_dlq.json");
const OUTBOX_LOCK_FILE = join(VAR_DIR, "push_outbox.lock");
const OUTBOX_MUTATION_LOCK_FILE = join(VAR_DIR, "push_outbox.write.lock");
const DISK_LOCK_TTL = 60000;
const DISK_LOCK_RENEW_INTERVAL = 10000;
const DISK_LOCK_RETRY_INTERVAL = 25;

const REDIS_SUBS_HASH = "mumbai:push:subscriptions";
const REDIS_OUTBOX_JOBS = "mumbai:push:outbox:jobs";
const REDIS_OUTBOX_PENDING = "mumbai:push:outbox:pending";
const REDIS_OUTBOX_PROCESSING = "mumbai:push:outbox:processing";
const REDIS_OUTBOX_DELAYED = "mumbai:push:outbox:delayed";
const REDIS_OUTBOX_DLQ_HASH = "mumbai:push:outbox:dead_letter";
const REDIS_OUTBOX_DLQ_LIST = "mumbai:push:outbox:dlq";
const REDIS_VAPID_KEY = "mumbai:push:vapid_keys";

// Ensure var directory exists synchronously upon module load
try {
  if (!existsSync(VAR_DIR)) {
    mkdirSync(VAR_DIR, { recursive: true });
  }
} catch (err) {
  logger.warn({ err: err.message }, "[WebPush] Failed ensuring var directory exists");
}

let vapidKeys = null;
let subscriptionsCache = null;
let outboxCache = null;
let isProcessingOutbox = false;
const pendingDrainHandles = new Set();

// 60-second in-memory cache for employee active status checks
const employeeStatusCache = new Map();
const EMPLOYEE_STATUS_CACHE_TTL = 60 * 1000;

/**
 * Safely writes JSON content atomically to disk via temporary file rename/copy
 * with retries to prevent corruption and handle Windows file locking.
 */
const atomicWriteJson = async (filePath, data) => {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  try {
    await mkdir(VAR_DIR, { recursive: true });
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");

    let written = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rename(tmpPath, filePath);
        written = true;
        break;
      } catch (renameErr) {
        if (["EPERM", "EBUSY", "EACCES"].includes(renameErr.code) && attempt < 4) {
          await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        } else {
          try {
            await copyFile(tmpPath, filePath);
            await unlink(tmpPath).catch(() => {});
            written = true;
            break;
          } catch (_) {
            if (attempt === 4) throw renameErr;
          }
        }
      }
    }
    if (!written) {
      await rename(tmpPath, filePath);
    }
  } catch (err) {
    logger.error({ err: err.message, filePath }, "[WebPush] Atomic write failed");
    try {
      if (existsSync(tmpPath)) await unlink(tmpPath);
    } catch (_) {}
    throw err;
  }
};

/**
 * Acquires an ownership-aware filesystem lease.
 * The long-lived process lease prevents duplicate disk drains. A separate short-lived
 * mutation lease serializes JSON read/modify/write operations without blocking enqueue
 * while push delivery is waiting on the network.
 */
const readDiskLock = async (lockPath) => {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch (_) {
    return null;
  }
};

const acquireDiskLock = async (
  lockPath = OUTBOX_LOCK_FILE,
  { waitMs = 0, ttlMs = DISK_LOCK_TTL } = {}
) => {
  const deadline = Date.now() + Math.max(0, waitMs);
  const token = randomUUID();

  while (true) {
    const now = Date.now();
    const lockRecord = {
      pid: process.pid,
      token,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };

    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify(lockRecord), "utf8");
      await handle.close();
      return { lockPath, token, ttlMs, expiresAt: lockRecord.expiresAt, lost: false };
    } catch (err) {
      if (err.code !== "EEXIST") return null;

      const existing = await readDiskLock(lockPath);
      if (existing?.expiresAt && Date.now() > Number(existing.expiresAt)) {
        // Re-read immediately before deletion so an old owner can never remove a
        // replacement lease merely because it observed a stale file earlier.
        const confirmed = await readDiskLock(lockPath);
        const existingToken = existing?.token || existing?.workerId;
        const confirmedToken = confirmed?.token || confirmed?.workerId;
        if (
          existingToken &&
          confirmedToken === existingToken &&
          Date.now() > Number(confirmed.expiresAt || 0)
        ) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } else if (!existing) {
        // A process can crash after O_EXCL creates the file but before JSON is
        // fully written. Recover only after the file itself has been stale for
        // a full lease period, never while another owner may still be writing it.
        try {
          const firstStat = await stat(lockPath);
          if (Date.now() - firstStat.mtimeMs > ttlMs) {
            const confirmedStat = await stat(lockPath);
            if (
              confirmedStat.mtimeMs === firstStat.mtimeMs &&
              confirmedStat.size === firstStat.size
            ) {
              await unlink(lockPath).catch(() => {});
              continue;
            }
          }
        } catch (_) {}
      }

      if (Date.now() >= deadline) return null;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, DISK_LOCK_RETRY_INTERVAL));
    }
  }
};

const renewDiskLock = async (lease) => {
  if (!lease || lease.lost) return false;
  const current = await readDiskLock(lease.lockPath);
  if (!current || (current.token || current.workerId) !== lease.token) {
    lease.lost = true;
    return false;
  }

  const renewed = {
    ...current,
    token: lease.token,
    expiresAt: Date.now() + lease.ttlMs,
  };
  try {
    await writeFile(lease.lockPath, JSON.stringify(renewed), "utf8");
    lease.expiresAt = renewed.expiresAt;
    return true;
  } catch (_) {
    lease.lost = true;
    return false;
  }
};

const startDiskLockHeartbeat = (lease) => {
  let renewalInFlight = false;
  const timer = setInterval(async () => {
    if (renewalInFlight || lease?.lost) return;
    renewalInFlight = true;
    try {
      await renewDiskLock(lease);
    } finally {
      renewalInFlight = false;
    }
  }, Math.min(DISK_LOCK_RENEW_INTERVAL, Math.max(1000, Math.floor(lease.ttlMs / 3))));
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
};

const releaseDiskLock = async (lease) => {
  if (!lease) return false;
  const current = await readDiskLock(lease.lockPath);
  if (!current || (current.token || current.workerId) !== lease.token) return false;
  try {
    await unlink(lease.lockPath);
    return true;
  } catch (_) {
    return false;
  }
};

const withDiskMutationLock = async (callback, { waitMs = 5000 } = {}) => {
  const lease = await acquireDiskLock(OUTBOX_MUTATION_LOCK_FILE, { waitMs, ttlMs: DISK_LOCK_TTL });
  if (!lease) {
    const error = new Error("Disk outbox mutation lock is busy");
    error.code = "DISK_OUTBOX_LOCK_BUSY";
    throw error;
  }
  const stopHeartbeat = startDiskLockHeartbeat(lease);
  try {
    const result = await callback(lease);
    if (lease.lost) {
      const error = new Error("Disk outbox mutation lease was lost");
      error.code = "DISK_OUTBOX_LOCK_LOST";
      throw error;
    }
    return result;
  } finally {
    stopHeartbeat();
    await releaseDiskLock(lease);
  }
};

/**
 * Distributed VAPID initialization across multi-instance cluster.
 * 1. Prioritizes static VAPID environment variables (mandatory in production).
 * 2. In non-production, checks authoritative Redis key for the winning cluster keypair.
 * 3. Uses Redis SETNX and reads back the winner so all cluster instances match.
 */
export const initVapidKeys = async () => {
  if (vapidKeys?.publicKey && vapidKeys?.privateKey) return vapidKeys;

  // 1. Static environment configuration
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
    };
    const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:operations@mumbaicollection.in";
    webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);
    return vapidKeys;
  }

  // 2. Production fail-fast guard
  if (process.env.NODE_ENV === "production") {
    const errorMsg = "CRITICAL: Production startup aborted: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables are mandatory.";
    logger.fatal(errorMsg);
    throw new Error(errorMsg);
  }

  // 3. Check authoritative Redis key across cluster in non-production
  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      const existingInRedis = await redis.get(REDIS_VAPID_KEY);
      if (existingInRedis) {
        vapidKeys = JSON.parse(existingInRedis);
        const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:operations@mumbaicollection.in";
        webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);
        atomicWriteJson(VAPID_KEYS_FILE, vapidKeys).catch(() => {});
        return vapidKeys;
      }
    } catch (redisErr) {
      logger.warn({ err: redisErr.message }, "[WebPush] Redis VAPID lookup failed; falling back to disk");
    }
  }

  // 4. Fall back to local disk
  if (existsSync(VAPID_KEYS_FILE)) {
    try {
      vapidKeys = JSON.parse(readFileSync(VAPID_KEYS_FILE, "utf8"));
      if (vapidKeys?.publicKey && vapidKeys?.privateKey) {
        if (redis && isRedisActive()) {
          await redis.set(REDIS_VAPID_KEY, JSON.stringify(vapidKeys), "NX").catch(() => {});
          const winning = await redis.get(REDIS_VAPID_KEY);
          if (winning) {
            try {
              vapidKeys = JSON.parse(winning);
            } catch (_) {}
          }
        }
        const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:operations@mumbaicollection.in";
        webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);
        return vapidKeys;
      }
    } catch (err) {
      logger.warn({ err: err.message }, "[WebPush] Failed reading existing vapid_keys.json");
    }
  }

  // 5. Generate new candidate keypair and synchronize via Redis winner read-back
  const candidateKeys = webpush.generateVAPIDKeys();
  if (redis && isRedisActive()) {
    try {
      await redis.set(REDIS_VAPID_KEY, JSON.stringify(candidateKeys), "NX");
      const winning = await redis.get(REDIS_VAPID_KEY);
      vapidKeys = winning ? JSON.parse(winning) : candidateKeys;
    } catch (_) {
      vapidKeys = candidateKeys;
    }
  } else {
    vapidKeys = candidateKeys;
  }

  atomicWriteJson(VAPID_KEYS_FILE, vapidKeys).catch(() => {});
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:operations@mumbaicollection.in";
  webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);

  return vapidKeys;
};

/**
 * Synchronous accessor for VAPID keys.
 * Returns initialized keys or reads static env / disk keypair.
 * Never silently generates divergent local keys.
 */
export const getVapidKeys = () => {
  if (vapidKeys?.publicKey && vapidKeys?.privateKey) return vapidKeys;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
    };
    const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:operations@mumbaicollection.in";
    webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);
    return vapidKeys;
  }

  // Never read disk or generate keys silently. The application must await initVapidKeys() during bootstrap.
  throw new Error("[WebPush] VAPID keys have not been initialized. Await initVapidKeys() during server bootstrap before accessing VAPID keys.");
};

/**
 * Returns the public VAPID key for frontend subscription.
 */
export const getVapidPublicKey = () => {
  const keys = getVapidKeys();
  return keys.publicKey;
};

/**
 * Loads all persistent subscriptions.
 * Authoritative: checks Redis Hash `mumbai:push:subscriptions` first.
 * An empty Redis hash is treated as an authoritative empty list (never resurrecting disk).
 * Local JSON file is ONLY used when Redis is inactive or unreachable.
 */
export const loadSubscriptions = async () => {
  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      const records = await redis.hgetall(REDIS_SUBS_HASH);
      // Redis hgetall returns an object (or {} when empty). This IS the authoritative state.
      if (records && typeof records === "object") {
        const subs = Object.values(records)
          .map((raw) => {
            try {
              return JSON.parse(raw);
            } catch (_) {
              return null;
            }
          })
          .filter(Boolean);
        subscriptionsCache = subs;
        // Keep disk cache mirror updated
        atomicWriteJson(SUBSCRIPTIONS_FILE, subs).catch(() => {});
        return subs;
      }
    } catch (redisErr) {
      logger.warn({ err: redisErr.message }, "[WebPush] Redis subscriptions read failed; falling back to disk");
    }
  }

  if (subscriptionsCache) return subscriptionsCache;

  try {
    if (existsSync(SUBSCRIPTIONS_FILE)) {
      const data = await readFile(SUBSCRIPTIONS_FILE, "utf8");
      subscriptionsCache = JSON.parse(data);
      if (!Array.isArray(subscriptionsCache)) subscriptionsCache = [];
    } else {
      subscriptionsCache = [];
    }
  } catch (err) {
    logger.warn({ err: err.message }, "[WebPush] Error loading subscriptions file; starting fresh");
    subscriptionsCache = [];
  }

  return subscriptionsCache;
};

/**
 * Persists subscriptions atomically to disk.
 */
const saveSubscriptionsToDisk = async (subs) => {
  subscriptionsCache = subs;
  try {
    await atomicWriteJson(SUBSCRIPTIONS_FILE, subs);
  } catch (err) {
    logger.error({ err: err.message }, "[WebPush] Failed saving subscriptions to disk");
    throw err;
  }
};

/**
 * Checks whether an employee account is active before sending push notifications.
 * Returns tri-state:
 * - { status: "ACTIVE" }: confirmed active in DB/cache.
 * - { status: "INACTIVE" }: confirmed inactive, deleted, or revoked (safe to purge subscription).
 * - { status: "UNKNOWN" }: upstream WordPress/network error (fail closed, but DO NOT purge subscription).
 */
export const isEmployeeActiveForPush = async (employeeId) => {
  if (!employeeId) return { status: "INACTIVE", reason: "missing_employee_id" };
  const cleanId = Number(employeeId);
  if (!cleanId || isNaN(cleanId)) return { status: "INACTIVE", reason: "invalid_employee_id" };

  const now = Date.now();
  const cached = employeeStatusCache.get(cleanId);
  if (cached && now - cached.timestamp < EMPLOYEE_STATUS_CACHE_TTL) {
    return { status: cached.active ? "ACTIVE" : "INACTIVE" };
  }

  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      const revTime = await redis.get(`sess:user_rev:${cleanId}`);
      if (revTime) {
        employeeStatusCache.set(cleanId, { active: false, timestamp: now });
        return { status: "INACTIVE", reason: "session_revoked" };
      }
    } catch (_) {}
  }

  // Verify against WordPress internal staff directory
  try {
    const response = await wp.get("/wp-json/mumbai-auth/v1/admin/employees", {
      params: { user_id: cleanId },
    });
    const employees = response.data?.employees || [];
    const emp = employees.find((e) => Number(e.id) === cleanId) || (employees.length === 1 ? employees[0] : null);
    if (emp && Number(emp.id) === cleanId) {
      const isActive = emp.status === "approved" || emp.status === "active";
      employeeStatusCache.set(cleanId, { active: isActive, timestamp: now });
      return { status: isActive ? "ACTIVE" : "INACTIVE" };
    }
    return { status: "INACTIVE", reason: "not_in_employee_directory" };
  } catch (err) {
    logger.warn({ err: err.message, employeeId: cleanId }, "[WebPush] Employee active status verification unreachable");
    // Fail-closed for delivery, but do NOT purge subscription (tri-state UNKNOWN)
    return { status: "UNKNOWN", reason: "upstream_unreachable", error: err.message };
  }
};

/**
 * Registers or updates an employee push subscription.
 * Strictly requires an authenticated employee user ID.
 *
 * @param {Object} params
 * @param {Object} params.subscription - Web Push Subscription object { endpoint, keys: { p256dh, auth } }
 * @param {number|string} params.employeeId - Authenticated employee user ID
 */
export const registerPushSubscription = async ({ subscription, employeeId }) => {
  const cleanEmployeeId = Number(employeeId);
  if (!cleanEmployeeId || isNaN(cleanEmployeeId)) {
    return { success: false, reason: "missing_authenticated_employee_id" };
  }

  if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return { success: false, reason: "invalid_subscription_payload" };
  }

  const endpoint = String(subscription.endpoint).trim();
  const now = Date.now();

  const record = {
    endpoint,
    keys: {
      p256dh: String(subscription.keys.p256dh),
      auth: String(subscription.keys.auth),
    },
    employeeId: cleanEmployeeId,
    updatedAt: now,
  };

  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      await redis.hset(REDIS_SUBS_HASH, endpoint, JSON.stringify(record));
      await redis.sadd("mumbai:push:endpoints", endpoint).catch(() => {});
    } catch (redisErr) {
      logger.error({ err: redisErr.message, employeeId: cleanEmployeeId }, "[WebPush] Redis subscription save failed");
      throw redisErr;
    }
  }

  // Update in-memory / disk cache
  const subs = await loadSubscriptions();
  const existingIdx = subs.findIndex((s) => s.endpoint === endpoint);
  if (existingIdx >= 0) {
    subs[existingIdx] = record;
  } else {
    subs.push(record);
  }
  await saveSubscriptionsToDisk(subs);

  logger.info({ employeeId: cleanEmployeeId, endpoint: endpoint.slice(0, 45) + "..." }, "[WebPush] Subscription registered");
  return { success: true };
};

/**
 * Removes an employee push subscription by endpoint.
 * Validates ownership: only the owner or an administrator can unsubscribe.
 *
 * @param {Object} params
 * @param {string} params.endpoint
 * @param {number|string} [params.employeeId]
 * @param {string[]} [params.userRoles]
 */
export const unregisterPushSubscription = async ({ endpoint, employeeId, userRoles = [] } = {}) => {
  if (!endpoint) return { success: false, reason: "missing_endpoint" };

  const cleanEndpoint = String(endpoint).trim();
  const subs = await loadSubscriptions();
  const existing = subs.find((s) => s.endpoint === cleanEndpoint);

  // Scoped authorization: if subscription exists and employeeId is supplied, ensure ownership or admin role
  if (existing && employeeId) {
    const cleanCallerId = Number(employeeId) || employeeId;
    const isOwner = existing.employeeId === cleanCallerId;
    const isAdmin = Array.isArray(userRoles) && userRoles.includes("administrator");
    if (!isOwner && !isAdmin) {
      logger.warn(
        { callerId: cleanCallerId, subOwnerId: existing.employeeId, endpoint: cleanEndpoint.slice(0, 45) },
        "[WebPush] Unauthorized push unsubscribe attempt"
      );
      return { success: false, reason: "forbidden" };
    }
  }

  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      await redis.hdel(REDIS_SUBS_HASH, cleanEndpoint);
      await redis.srem("mumbai:push:endpoints", cleanEndpoint).catch(() => {});
    } catch (redisErr) {
      logger.error({ err: redisErr.message, endpoint: cleanEndpoint.slice(0, 45) }, "[WebPush] Redis unregister failed");
      throw redisErr;
    }
  }

  const filtered = subs.filter((s) => s.endpoint !== cleanEndpoint);
  if (filtered.length !== subs.length) {
    await saveSubscriptionsToDisk(filtered);
  }

  logger.info({ endpoint: cleanEndpoint.slice(0, 45) + "..." }, "[WebPush] Push subscription removed");
  return { success: true };
};

/**
 * Purges all push subscriptions associated with a specific employee ID.
 * Called on account deactivation, logout, or session revocation.
 * Guaranteed: rethrows Redis errors so callers can detect failure.
 */
export const removeSubscriptionsForEmployee = async (employeeId) => {
  if (!employeeId) return { removedCount: 0 };
  const cleanId = Number(employeeId) || employeeId;

  // Invalidate cached status
  employeeStatusCache.delete(cleanId);

  const subs = await loadSubscriptions();
  const toRemove = subs.filter((s) => s.employeeId === cleanId);
  if (toRemove.length === 0) return { removedCount: 0 };

  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    const endpoints = toRemove.map((s) => s.endpoint);
    if (endpoints.length > 0) {
      try {
        await redis.hdel(REDIS_SUBS_HASH, ...endpoints);
        await redis.srem("mumbai:push:endpoints", ...endpoints).catch(() => {});
      } catch (redisErr) {
        logger.error({ err: redisErr.message, employeeId: cleanId }, "[WebPush] Redis employee subscriptions purge failed");
        throw redisErr;
      }
    }
  }

  const remaining = subs.filter((s) => s.employeeId !== cleanId);
  await saveSubscriptionsToDisk(remaining);

  logger.info({ employeeId: cleanId, removedCount: toRemove.length }, "[WebPush] Removed subscriptions for employee");
  return { removedCount: toRemove.length };
};

/**
 * Loads the persistent push outbox (disk fallback).
 */
const loadOutbox = async ({ fresh = false } = {}) => {
  if (!fresh && outboxCache) return outboxCache;

  try {
    if (existsSync(OUTBOX_FILE)) {
      const raw = await readFile(OUTBOX_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("Disk outbox must contain a JSON array");
      }
      outboxCache = parsed;
    } else {
      outboxCache = [];
    }
  } catch (err) {
    logger.error({ err: err.message }, "[WebPush] Error reading disk outbox");
    if (fresh) throw err;
    outboxCache = [];
  }

  return outboxCache;
};

/**
 * Saves outbox jobs atomically to disk (disk fallback).
 * Guaranteed: rethrows failure so enqueuePushOutboxJob detects persistence error.
 */

/**
 * Appends an exhausted job to the local disk Dead Letter Queue file.
 * Returns true on success, false on failure (does not suppress error from caller).
 */
const appendDiskDlq = async (deadJob, error) => {
  try {
    let dlq = [];
    if (existsSync(OUTBOX_DLQ_FILE)) {
      const raw = await readFile(OUTBOX_DLQ_FILE, "utf8");
      dlq = JSON.parse(raw);
      if (!Array.isArray(dlq)) {
        throw new Error("Disk push DLQ must contain a JSON array");
      }
    }
    const dlqEntry = {
      ...deadJob,
      status: "dead_letter",
      failedAt: Date.now(),
      lastError: error?.message || String(error),
    };
    dlq.push(dlqEntry);
    await atomicWriteJson(OUTBOX_DLQ_FILE, dlq);
    logger.warn({ jobId: deadJob.id, orderId: deadJob.orderId }, "[WebPush] Appended exhausted disk job to push_outbox_dlq.json");
    return true;
  } catch (err) {
    logger.error({ err: err.message, jobId: deadJob.id }, "[WebPush] Failed saving disk job to DLQ");
    return false;
  }
};

const saveOutboxToDisk = async (jobs) => {
  try {
    await atomicWriteJson(OUTBOX_FILE, jobs);
    outboxCache = jobs;
  } catch (err) {
    logger.error({ err: err.message }, "[WebPush] Failed saving outbox to disk");
    throw err;
  }
};

/**
 * Atomically migrates disk jobs into Redis when connectivity returns.
 * Deduplicates by job ID.
 */
export const migrateDiskJobsToRedis = async () => {
  const redis = getRedisClient();
  if (!redis || !isRedisActive()) return 0;

  try {
    // Only hold the filesystem mutation lease while taking and committing the
    // snapshot. Redis network calls run outside it so a new-order enqueue is not blocked.
    const diskJobs = await withDiskMutationLock(async () => {
      const currentJobs = await loadOutbox({ fresh: true });
      return currentJobs.map((job) => ({ ...job }));
    });
    if (diskJobs.length === 0) return 0;

    const migratedIds = new Set();
    for (const job of diskJobs) {
      try {
        if (typeof redis.eval === "function") {
          const res = await redis.eval(
            LUA_MIGRATE_DISK_JOB,
            5,
            REDIS_OUTBOX_JOBS,
            REDIS_OUTBOX_PENDING,
            REDIS_OUTBOX_PROCESSING,
            REDIS_OUTBOX_DELAYED,
            REDIS_OUTBOX_DLQ_HASH,
            job.id,
            JSON.stringify(job)
          );
          if (res === 1) migratedIds.add(job.id);
        } else {
          // Fallback for mock/test environments without eval
          const exists = await redis.hexists?.(REDIS_OUTBOX_JOBS, job.id);
          if (!exists) {
            const pipeline = redis.pipeline();
            pipeline.hset(REDIS_OUTBOX_JOBS, job.id, JSON.stringify(job));
            pipeline.rpush(REDIS_OUTBOX_PENDING, job.id);
            const results = await pipeline.exec();
            const hasError = results?.some(([err]) => Boolean(err));
            if (hasError) throw new Error("Mock pipeline failed");
          }
          migratedIds.add(job.id);
        }
      } catch (err) {
        logger.warn({ err: err.message, jobId: job.id }, "[WebPush] Failed migrating disk job to Redis");
      }
    }

    if (migratedIds.size > 0) {
      await withDiskMutationLock(async () => {
        const latestJobs = await loadOutbox({ fresh: true });
        await saveOutboxToDisk(latestJobs.filter((job) => !migratedIds.has(job.id)));
      });
      logger.info({ migratedCount: migratedIds.size }, "[WebPush] Migrated disk outbox jobs into Redis queue");
    }
    return migratedIds.size;
  } catch (err) {
    logger.warn({ err: err.message }, "[WebPush] Disk outbox migration deferred");
    return 0;
  }
};

// Redis Lua script for atomic job enqueue (HSET + RPUSH in one atomic evaluation)
const LUA_ENQUEUE_JOB = `
local jobs_hash = KEYS[1]
local pending_key = KEYS[2]
local jid = ARGV[1]
local job_json = ARGV[2]

redis.call('HSET', jobs_hash, jid, job_json)
redis.call('RPUSH', pending_key, jid)
return 1
`;

/**
 * Enqueues a push delivery task into the durable outbox.
 * Redis is authoritative when available (NEVER writes to both Redis and disk simultaneously).
 * Disk is strictly a fallback when Redis is inactive or enqueue fails.
 * Atomic: uses LUA_ENQUEUE_JOB so HSET and RPUSH succeed or fail together.
 * Guaranteed durable: rethrows if persistence fails.
 *
 * @param {Object} params
 * @param {number|string} params.orderId
 * @param {number|string} [params.total]
 */
export const enqueuePushOutboxJob = async ({ orderId, total }) => {
  const cleanOrderId = Number(orderId);
  if (!cleanOrderId) return null;

  const jobId = `push_order_${cleanOrderId}_${Date.now()}`;
  const job = {
    id: jobId,
    orderId: cleanOrderId,
    total: total || null,
    attempts: 0,
    maxAttempts: 3,
    createdAt: Date.now(),
    lastAttemptAt: null,
    leaseExpiresAt: null,
    nextRetryAt: null,
    deliveredEndpoints: [],
    status: "pending",
  };

  const redis = getRedisClient();
  let enqueuedInRedis = false;

  if (redis && isRedisActive()) {
    try {
      if (typeof redis.eval === "function") {
        await redis.eval(
          LUA_ENQUEUE_JOB,
          2,
          REDIS_OUTBOX_JOBS,
          REDIS_OUTBOX_PENDING,
          jobId,
          JSON.stringify(job)
        );
        enqueuedInRedis = true;
      } else {
        // Fallback for mock environments without eval
        const pipeline = typeof redis.pipeline === "function" ? redis.pipeline() : null;
        if (pipeline) {
          pipeline.hset(REDIS_OUTBOX_JOBS, jobId, JSON.stringify(job));
          pipeline.rpush(REDIS_OUTBOX_PENDING, jobId);
          const results = await pipeline.exec();
          const hasError = results?.some(([err]) => Boolean(err));
          if (!hasError) enqueuedInRedis = true;
        } else if (typeof redis.hset === "function" && typeof redis.rpush === "function") {
          await redis.hset(REDIS_OUTBOX_JOBS, jobId, JSON.stringify(job));
          await redis.rpush(REDIS_OUTBOX_PENDING, jobId);
          enqueuedInRedis = true;
        }
      }
    } catch (redisErr) {
      logger.warn({ err: redisErr.message, orderId: cleanOrderId }, "[WebPush] Redis outbox enqueue failed; falling back to disk");
    }
  }

  // Strictly use disk outbox ONLY when Redis enqueue did not succeed
  if (!enqueuedInRedis) {
    await withDiskMutationLock(async () => {
      const outbox = await loadOutbox({ fresh: true });
      if (!outbox.some((queuedJob) => queuedJob.id === job.id)) {
        outbox.push(job);
      }
      await saveOutboxToDisk(outbox); // Will re-throw if disk write fails
    });
    logger.info({ jobId, orderId: cleanOrderId }, "[WebPush] Enqueued push outbox job to disk fallback");
  } else {
    logger.info({ jobId, orderId: cleanOrderId }, "[WebPush] Enqueued durable push outbox job in Redis");
  }

  // Trigger immediate asynchronous drain without blocking caller
  const drainHandle = setImmediate(() => {
    pendingDrainHandles.delete(drainHandle);
    processPushOutbox().catch((err) => {
      logger.warn({ err: err.message }, "[WebPush] Outbox drain triggered error");
    });
  });
  pendingDrainHandles.add(drainHandle);

  return job;
};

// Redis Lua Scripts for atomic queue migration, worker lease, recovery, and DLQ operations
const LUA_MIGRATE_DISK_JOB = `
local jobs_hash = KEYS[1]
local pending_key = KEYS[2]
local processing_key = KEYS[3]
local delayed_key = KEYS[4]
local dlq_hash = KEYS[5]
local jid = ARGV[1]
local job_json = ARGV[2]

-- 1. Check if already in Dead Letter Queue
if redis.call('HEXISTS', dlq_hash, jid) == 1 then
  return 1
end

-- 2. Check if already in delayed retry zset
if redis.call('ZSCORE', delayed_key, jid) then
  -- Repair missing job hash record if needed before accepting membership
  if redis.call('HEXISTS', jobs_hash, jid) == 0 then
    redis.call('HSET', jobs_hash, jid, job_json)
  end
  return 1
end

-- 3. Check if in pending or processing queue
local in_pending = false
local sp, pos_p = pcall(redis.call, 'LPOS', pending_key, jid)
if sp and pos_p then
  in_pending = true
elseif not sp then
  local items = redis.call('LRANGE', pending_key, 0, -1)
  for _, item in ipairs(items) do
    if item == jid then in_pending = true break end
  end
end

local in_processing = false
local spr, pos_pr = pcall(redis.call, 'LPOS', processing_key, jid)
if spr and pos_pr then
  in_processing = true
elseif not spr then
  local items = redis.call('LRANGE', processing_key, 0, -1)
  for _, item in ipairs(items) do
    if item == jid then in_processing = true break end
  end
end

if in_pending or in_processing then
  -- Repair missing job hash record if needed before accepting queue membership
  if redis.call('HEXISTS', jobs_hash, jid) == 0 then
    redis.call('HSET', jobs_hash, jid, job_json)
  end
  return 1
end

-- 4. Not in any active queue: write to jobs hash and enqueue to pending
redis.call('HSET', jobs_hash, jid, job_json)
redis.call('RPUSH', pending_key, jid)
return 1
`;

const LUA_PROMOTE_DELAYED = `
local delayed_key = KEYS[1]
local pending_key = KEYS[2]
local now = tonumber(ARGV[1])

local due = redis.call('ZRANGEBYSCORE', delayed_key, '-inf', now)
if #due > 0 then
  for i, jid in ipairs(due) do
    redis.call('ZREM', delayed_key, jid)
    redis.call('RPUSH', pending_key, jid)
  end
  return #due
end
return 0
`;

const LUA_RECOVER_LEASES = `
local processing_key = KEYS[1]
local pending_key = KEYS[2]
local jobs_hash = KEYS[3]
local now = tonumber(ARGV[1])

local processing = redis.call('LRANGE', processing_key, 0, -1)
local recovered = 0
for i, jid in ipairs(processing) do
  local raw = redis.call('HGET', jobs_hash, jid)
  if not raw then
    redis.call('LREM', processing_key, 0, jid)
  else
    local job = cjson.decode(raw)
    if not job.leaseExpiresAt or tonumber(job.leaseExpiresAt) < now then
      redis.call('LREM', processing_key, 0, jid)
      job.workerId = nil
      job.leaseExpiresAt = nil
      redis.call('HSET', jobs_hash, jid, cjson.encode(job))
      redis.call('RPUSH', pending_key, jid)
      recovered = recovered + 1
    end
  end
end
return recovered
`;

const LUA_CLAIM_JOB = `
local pending_key = KEYS[1]
local processing_key = KEYS[2]
local jobs_hash = KEYS[3]
local lease_expiry = tonumber(ARGV[1])
local worker_id = ARGV[2]

local jid = redis.call('RPOPLPUSH', pending_key, processing_key)
if jid then
  local raw = redis.call('HGET', jobs_hash, jid)
  if raw then
    local job = cjson.decode(raw)
    job.workerId = worker_id
    job.leaseExpiresAt = lease_expiry
    local updated = cjson.encode(job)
    redis.call('HSET', jobs_hash, jid, updated)
    return updated
  else
    redis.call('LREM', processing_key, 0, jid)
    return nil
  end
end
return nil
`;

const LUA_RENEW_LEASE = `
local jobs_hash = KEYS[1]
local jid = ARGV[1]
local worker_id = ARGV[2]
local new_expiry = tonumber(ARGV[3])

local raw = redis.call('HGET', jobs_hash, jid)
if not raw then return 0 end
local job = cjson.decode(raw)
if job.workerId == worker_id then
  job.leaseExpiresAt = new_expiry
  redis.call('HSET', jobs_hash, jid, cjson.encode(job))
  return 1
end
return 0
`;

const LUA_COMPLETE_JOB = `
local processing_key = KEYS[1]
local jobs_hash = KEYS[2]
local jid = ARGV[1]
local worker_id = ARGV[2]

local raw = redis.call('HGET', jobs_hash, jid)
if not raw then
  redis.call('LREM', processing_key, 0, jid)
  return 1
end
local job = cjson.decode(raw)
if job.workerId == worker_id then
  redis.call('LREM', processing_key, 0, jid)
  redis.call('HDEL', jobs_hash, jid)
  return 1
end
return 0
`;

const LUA_RETRY_JOB = `
local processing_key = KEYS[1]
local jobs_hash = KEYS[2]
local delayed_key = KEYS[3]
local jid = ARGV[1]
local worker_id = ARGV[2]
local next_retry_at = tonumber(ARGV[3])
local updated_json = ARGV[4]

local raw = redis.call('HGET', jobs_hash, jid)
if not raw then return 0 end
local job = cjson.decode(raw)
if job.workerId == worker_id then
  redis.call('LREM', processing_key, 0, jid)
  redis.call('HSET', jobs_hash, jid, updated_json)
  redis.call('ZADD', delayed_key, next_retry_at, jid)
  return 1
end
return 0
`;

const LUA_DLQ_JOB = `
local processing_key = KEYS[1]
local jobs_hash = KEYS[2]
local dlq_hash = KEYS[3]
local dlq_list = KEYS[4]
local jid = ARGV[1]
local worker_id = ARGV[2]
local updated_json = ARGV[3]

local raw = redis.call('HGET', jobs_hash, jid)
if not raw then return 0 end
local job = cjson.decode(raw)
if job.workerId == worker_id then
  redis.call('LREM', processing_key, 0, jid)
  redis.call('HDEL', jobs_hash, jid)
  redis.call('HSET', dlq_hash, jid, updated_json)
  redis.call('RPUSH', dlq_list, jid)
  return 1
end
return 0
`;

/**
 * Processes and drains pending jobs from the durable push outbox.
 * Uses atomic Lua script leasing, worker-owned lease renewal, crash recovery, persistent delayed retries, and DLQ.
 */
export const processPushOutbox = async () => {
  if (isProcessingOutbox) return;
  isProcessingOutbox = true;

  try {
    const redis = getRedisClient();
    if (redis && isRedisActive()) {
      // 0. Migrate any leftover disk jobs from a past Redis outage atomically
      await migrateDiskJobsToRedis();

      const now = Date.now();

      // 1. Atomically promote due delayed jobs back to pending via Lua
      try {
        if (typeof redis.eval === "function") {
          await redis.eval(LUA_PROMOTE_DELAYED, 2, REDIS_OUTBOX_DELAYED, REDIS_OUTBOX_PENDING, now);
        }
      } catch (err) {
        logger.debug({ err: err.message }, "[WebPush] Failed promoting delayed retry set via Lua");
      }

      // 2. Atomically recover expired or unleased processing jobs via Lua
      try {
        if (typeof redis.eval === "function") {
          await redis.eval(LUA_RECOVER_LEASES, 3, REDIS_OUTBOX_PROCESSING, REDIS_OUTBOX_PENDING, REDIS_OUTBOX_JOBS, now);
        }
      } catch (err) {
        logger.debug({ err: err.message }, "[WebPush] Failed checking processing lease queue via Lua");
      }

      // 3. Atomically lease and process pending jobs one by one with worker ownership
      const workerId = randomUUID();
      const LEASE_DURATION_MS = 60000; // 60s generous lease to handle slow checks
      let rawJob = null;

      if (typeof redis.eval === "function") {
        try {
          rawJob = await redis.eval(
            LUA_CLAIM_JOB,
            3,
            REDIS_OUTBOX_PENDING,
            REDIS_OUTBOX_PROCESSING,
            REDIS_OUTBOX_JOBS,
            Date.now() + LEASE_DURATION_MS,
            workerId
          );
        } catch (_) {
          rawJob = null;
        }
      } else {
        // Fallback for mock/test environments
        const jobId = await redis.rpoplpush?.(REDIS_OUTBOX_PENDING, REDIS_OUTBOX_PROCESSING);
        if (jobId) {
          rawJob = await redis.hget?.(REDIS_OUTBOX_JOBS, jobId);
        }
      }

      while (rawJob) {
        let job;
        try {
          job = JSON.parse(rawJob);
        } catch (_) {
          job = null;
        }

        if (job && job.id) {
          const jobId = job.id;

          // Heartbeat interval to renew lease during lengthy push dispatch
          const renewTimer = setInterval(async () => {
            try {
              if (typeof redis.eval === "function") {
                await redis.eval(
                  LUA_RENEW_LEASE,
                  1,
                  REDIS_OUTBOX_JOBS,
                  jobId,
                  workerId,
                  Date.now() + LEASE_DURATION_MS
                );
              }
            } catch (_) {}
          }, 15000);
          if (renewTimer.unref) renewTimer.unref();

          try {
            await sendOrderCreatedPush({
              orderId: job.orderId,
              total: job.total,
              deliveredEndpoints: job.deliveredEndpoints || [],
            });

            // Succeeded: atomically remove lease and delete job record strictly if workerId matches
            if (typeof redis.eval === "function") {
              await redis.eval(
                LUA_COMPLETE_JOB,
                2,
                REDIS_OUTBOX_PROCESSING,
                REDIS_OUTBOX_JOBS,
                jobId,
                workerId
              );
            } else {
              const pipeline = redis.pipeline();
              pipeline.lrem(REDIS_OUTBOX_PROCESSING, 0, jobId);
              pipeline.hdel(REDIS_OUTBOX_JOBS, jobId);
              await pipeline.exec();
            }
          } catch (jobErr) {
            job.attempts = (job.attempts || 0) + 1;
            job.lastAttemptAt = Date.now();
            job.deliveredEndpoints = jobErr?.deliveredEndpoints || job.deliveredEndpoints || [];

            if (job.attempts < (job.maxAttempts || 3)) {
              const backoffMs = Math.pow(2, job.attempts) * 5000; // 10s, 20s
              const nextRetryAt = Date.now() + backoffMs;
              job.nextRetryAt = nextRetryAt;
              job.leaseExpiresAt = null;
              job.workerId = null;

              if (typeof redis.eval === "function") {
                await redis.eval(
                  LUA_RETRY_JOB,
                  3,
                  REDIS_OUTBOX_PROCESSING,
                  REDIS_OUTBOX_JOBS,
                  REDIS_OUTBOX_DELAYED,
                  jobId,
                  workerId,
                  nextRetryAt,
                  JSON.stringify(job)
                );
              } else {
                const pipeline = redis.pipeline();
                pipeline.lrem(REDIS_OUTBOX_PROCESSING, 0, jobId);
                pipeline.hset(REDIS_OUTBOX_JOBS, jobId, JSON.stringify(job));
                pipeline.zadd(REDIS_OUTBOX_DELAYED, nextRetryAt, jobId);
                await pipeline.exec();
              }
              logger.warn(
                { jobId, orderId: job.orderId, attempt: job.attempts, nextRetryInMs: backoffMs },
                "[WebPush] Push delivery failed; scheduled retry in Redis"
              );
            } else {
              // Exceeded max attempts: move to Dead Letter Queue (DLQ)
              logger.error(
                { jobId, orderId: job.orderId, attempts: job.attempts },
                "[WebPush] Outbox job exceeded max retries; moving to Dead Letter Queue"
              );
              job.status = "dead_letter";
              job.failedAt = Date.now();
              job.lastError = jobErr?.message || String(jobErr);
              job.workerId = null;
              job.leaseExpiresAt = null;

              if (typeof redis.eval === "function") {
                await redis.eval(
                  LUA_DLQ_JOB,
                  4,
                  REDIS_OUTBOX_PROCESSING,
                  REDIS_OUTBOX_JOBS,
                  REDIS_OUTBOX_DLQ_HASH,
                  REDIS_OUTBOX_DLQ_LIST,
                  jobId,
                  workerId,
                  JSON.stringify(job)
                );
              } else {
                const pipeline = redis.pipeline();
                pipeline.lrem(REDIS_OUTBOX_PROCESSING, 0, jobId);
                pipeline.hdel(REDIS_OUTBOX_JOBS, jobId);
                pipeline.hset(REDIS_OUTBOX_DLQ_HASH, jobId, JSON.stringify(job));
                pipeline.rpush(REDIS_OUTBOX_DLQ_LIST, jobId);
                await pipeline.exec();
              }
            }
          } finally {
            clearInterval(renewTimer);
          }
        }

        // Fetch next job with workerId
        if (typeof redis.eval === "function") {
          try {
            rawJob = await redis.eval(
              LUA_CLAIM_JOB,
              3,
              REDIS_OUTBOX_PENDING,
              REDIS_OUTBOX_PROCESSING,
              REDIS_OUTBOX_JOBS,
              Date.now() + LEASE_DURATION_MS,
              workerId
            );
          } catch (_) {
            rawJob = null;
          }
        } else {
          const jobId = await redis.rpoplpush?.(REDIS_OUTBOX_PENDING, REDIS_OUTBOX_PROCESSING);
          rawJob = jobId ? await redis.hget?.(REDIS_OUTBOX_JOBS, jobId) : null;
        }
      }
    } else {
      // 4. Drain Local Disk Outbox ONLY when Redis is NOT active
      const processLease = await acquireDiskLock(OUTBOX_LOCK_FILE, {
        waitMs: 0,
        ttlMs: DISK_LOCK_TTL,
      });
      if (!processLease) {
        // Another instance is holding the disk lock
        return;
      }
      const stopProcessLeaseHeartbeat = startDiskLockHeartbeat(processLease);
      try {
        // Take a stable snapshot under the short mutation lease, then release it
        // before network delivery so new orders can still be enqueued immediately.
        const diskJobs = await withDiskMutationLock(async () => {
          const currentJobs = await loadOutbox({ fresh: true });
          return currentJobs.map((job) => ({ ...job }));
        });

        if (diskJobs.length > 0) {
          const remainingJobs = [];
          const dlqCandidates = [];
          for (const job of diskJobs) {
            try {
              await sendOrderCreatedPush({
                orderId: job.orderId,
                total: job.total,
                deliveredEndpoints: job.deliveredEndpoints || [],
              });
            } catch (jobErr) {
              job.attempts = (job.attempts || 0) + 1;
              job.lastAttemptAt = Date.now();
              job.deliveredEndpoints = jobErr?.deliveredEndpoints || job.deliveredEndpoints || [];
              if (job.attempts < (job.maxAttempts || 3)) {
                remainingJobs.push(job);
              } else {
                logger.error({ jobId: job.id, orderId: job.orderId }, "[WebPush] Disk outbox job exceeded max attempts; moving to disk DLQ");
                dlqCandidates.push({ job, error: jobErr });
              }
            }
          }

          // A lost process lease must never commit results after another worker
          // has recovered the queue. Leaving the snapshot on disk is safely at-least-once.
          if (processLease.lost) {
            throw new Error("Disk outbox process lease was lost during delivery");
          }

          await withDiskMutationLock(async () => {
            const latestJobs = await loadOutbox({ fresh: true });
            const processedIds = new Set(diskJobs.map((job) => job.id));
            const mergedJobs = latestJobs.filter((job) => !processedIds.has(job.id));

            for (const { job, error } of dlqCandidates) {
              const dlqSuccess = await appendDiskDlq(job, error);
              if (!dlqSuccess) {
                // Keep the job active if the DLQ write failed so it is never lost.
                remainingJobs.push(job);
              }
            }

            for (const pendingJob of remainingJobs) {
              const existingIndex = mergedJobs.findIndex((job) => job.id === pendingJob.id);
              if (existingIndex >= 0) {
                mergedJobs[existingIndex] = pendingJob;
              } else {
                mergedJobs.push(pendingJob);
              }
            }

            await saveOutboxToDisk(mergedJobs);
          });
        }
      } finally {
        stopProcessLeaseHeartbeat();
        await releaseDiskLock(processLease);
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, "[WebPush] Outbox processing encountered warning");
  } finally {
    isProcessingOutbox = false;
  }
};

let outboxWatchdogTimer = null;

/**
 * Starts the periodic background watchdog (default 15 seconds)
 * to reclaim expired worker leases and process due retries.
 * Strictly gated behind bootstrap() after VAPID initialization completes.
 */
export const startOutboxWatchdog = (intervalMs = 15000) => {
  if (outboxWatchdogTimer) return outboxWatchdogTimer;
  outboxWatchdogTimer = setInterval(() => {
    processPushOutbox().catch(() => {});
  }, intervalMs);
  if (typeof outboxWatchdogTimer.unref === "function") {
    outboxWatchdogTimer.unref();
  }
  return outboxWatchdogTimer;
};

export const stopOutboxWatchdog = () => {
  if (outboxWatchdogTimer) {
    clearInterval(outboxWatchdogTimer);
    outboxWatchdogTimer = null;
  }
};

/**
 * Sends a high-priority background Web Push notification for a new confirmed order.
 * Strictly called ONLY for ORDER_CREATED (never for packing, dispatch, or delivery transitions).
 * Filters out deactivated/suspended employees and automatically purges dead endpoints.
 * Throws on transient delivery failures so the outbox caller can retry.
 * Supports partial delivery: skips endpoints already in deliveredEndpoints.
 *
 * @param {Object} params
 * @param {number|string} params.orderId
 * @param {number|string} [params.total]
 * @param {string[]} [params.deliveredEndpoints]
 */
export const sendOrderCreatedPush = async ({ orderId, total, deliveredEndpoints = [] } = {}) => {
  const cleanOrderId = Number(orderId);
  if (!cleanOrderId) return { success: false, reason: "invalid_order_id" };

  // Ensure VAPID is configured
  getVapidKeys();

  const subs = await loadSubscriptions();
  if (!subs || subs.length === 0) {
    logger.debug({ orderId: cleanOrderId }, "[WebPush] No push subscriptions found");
    return { success: true, sentCount: 0 };
  }

  // Filter subscriptions to ONLY active, authorized employees
  // Subscriptions lacking employeeId are strictly rejected (fails closed)
  const activeSubs = [];
  const confirmedInactiveEmployeeIds = new Set();
  let hasUnknownEmployees = false;

  for (const sub of subs) {
    if (!sub.employeeId) {
      continue;
    }

    if (confirmedInactiveEmployeeIds.has(sub.employeeId)) {
      continue;
    }

    const check = await isEmployeeActiveForPush(sub.employeeId);
    if (check.status === "ACTIVE") {
      activeSubs.push(sub);
    } else if (check.status === "INACTIVE") {
      confirmedInactiveEmployeeIds.add(sub.employeeId);
    } else if (check.status === "UNKNOWN") {
      hasUnknownEmployees = true;
      // Do NOT send to unknown, and DO NOT delete subscription (network blip)
    }
  }

  // Strictly ONLY purge confirmed inactive employees
  if (confirmedInactiveEmployeeIds.size > 0) {
    for (const empId of confirmedInactiveEmployeeIds) {
      try {
        await removeSubscriptionsForEmployee(empId);
      } catch (_) {}
    }
  }

  // If all subscriptions had unknown employee status (e.g. WordPress outage), retry via outbox
  if (activeSubs.length === 0 && hasUnknownEmployees) {
    throw new Error("[WebPush] Employee verification temporarily unavailable (status unknown); delaying push outbox job");
  }

  if (activeSubs.length === 0) {
    logger.debug({ orderId: cleanOrderId }, "[WebPush] No subscriptions for active employees");
    return { success: true, sentCount: 0 };
  }

  // Deduplicate against already-delivered endpoints to prevent repeated rings on partial retry
  const alreadyDeliveredSet = new Set(deliveredEndpoints || []);
  const pendingSubs = activeSubs.filter((s) => !alreadyDeliveredSet.has(s.endpoint));

  if (pendingSubs.length === 0) {
    logger.debug({ orderId: cleanOrderId }, "[WebPush] All active subscriptions were already delivered");
    return { success: true, sentCount: 0 };
  }

  const payload = JSON.stringify({
    title: "🚨 New Mumbai Collection Order!",
    body: total
      ? `New Order #${cleanOrderId} received (₹${total}). Tap to pack & dispatch.`
      : `New Order #${cleanOrderId} received. Tap to pack & dispatch.`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: `mumbai-order-${cleanOrderId}`,
    renotify: true,
    requireInteraction: true,
    data: {
      orderId: cleanOrderId,
      url: "/orders",
      timestamp: Date.now(),
    },
  });

  const options = {
    TTL: 1800, // 30 minutes expiration
    urgency: "high",
  };

  const deadEndpoints = [];
  const newlyDelivered = [];
  let transientErrorCount = 0;

  await Promise.allSettled(
    pendingSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payload,
          options
        );
        newlyDelivered.push(sub.endpoint);
      } catch (err) {
        // Permanent failure: HTTP 404 or 410 indicates subscription has expired or was unsubscribed
        if (err.statusCode === 404 || err.statusCode === 410) {
          deadEndpoints.push(sub.endpoint);
        } else {
          transientErrorCount++;
          logger.warn(
            { err: err.message, statusCode: err.statusCode, endpoint: sub.endpoint.slice(0, 45) },
            "[WebPush] Delivery failure (transient)"
          );
        }
      }
    })
  );

  // Clean up any dead/expired subscriptions
  if (deadEndpoints.length > 0) {
    for (const deadEndpoint of deadEndpoints) {
      await unregisterPushSubscription({ endpoint: deadEndpoint });
    }
    logger.info({ purgedCount: deadEndpoints.length }, "[WebPush] Purged expired subscriptions");
  }

  const allDelivered = [...alreadyDeliveredSet, ...newlyDelivered];

  logger.info(
    { orderId: cleanOrderId, sentCount: newlyDelivered.length, deadCount: deadEndpoints.length, transientErrorCount },
    "[WebPush] Dispatched order created push notifications"
  );

  // If there were pending subscriptions that failed with transient errors OR any unknown employees,
  // throw to trigger outbox retry and attach all delivered endpoints so they are not re-buzzed
  if (transientErrorCount > 0 || hasUnknownEmployees) {
    const error = new Error(
      `Push delivery incomplete (${newlyDelivered.length} newly delivered, ${transientErrorCount} transient failures, unknownEmployees: ${hasUnknownEmployees})`
    );
    error.deliveredEndpoints = allDelivered;
    throw error;
  }

  return { success: true, sentCount: newlyDelivered.length, deadCount: deadEndpoints.length, transientErrorCount };
};

/** Testing Helpers */
export const _resetPushNotificationServiceForTesting = () => {
  for (const drainHandle of pendingDrainHandles) clearImmediate(drainHandle);
  pendingDrainHandles.clear();
  vapidKeys = null;
  subscriptionsCache = null;
  outboxCache = null;
  isProcessingOutbox = false;
  employeeStatusCache.clear();
  stopOutboxWatchdog();
  try {
    for (const lockPath of [OUTBOX_LOCK_FILE, OUTBOX_MUTATION_LOCK_FILE]) {
      if (existsSync(lockPath)) unlinkSync(lockPath);
    }
  } catch (_) {}
};
export const _getOutboxCount = async () => {
  const jobs = await loadOutbox();
  return jobs.length;
};
export const _diskLockTesting = Object.freeze({
  acquire: acquireDiskLock,
  renew: renewDiskLock,
  release: releaseDiskLock,
});
