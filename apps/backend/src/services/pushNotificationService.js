import webpush from "web-push";
import { mkdir, readFile, writeFile, rename, unlink, copyFile } from "node:fs/promises";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";
import { getRedisClient, isRedisActive } from "../config/redis.js";
import wp from "./wordpress.js";

const VAR_DIR = resolve(fileURLToPath(new URL("../../var", import.meta.url)));
const VAPID_KEYS_FILE = join(VAR_DIR, "vapid_keys.json");
const SUBSCRIPTIONS_FILE = join(VAR_DIR, "push_subscriptions.json");
const OUTBOX_FILE = join(VAR_DIR, "push_outbox.json");

const REDIS_SUBS_HASH = "mumbai:push:subscriptions";
const REDIS_OUTBOX_JOBS = "mumbai:push:outbox:jobs";
const REDIS_OUTBOX_PENDING = "mumbai:push:outbox:pending";
const REDIS_OUTBOX_PROCESSING = "mumbai:push:outbox:processing";
const REDIS_OUTBOX_DELAYED = "mumbai:push:outbox:delayed";
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
 * Distributed VAPID initialization across multi-instance cluster.
 * 1. Prioritizes static VAPID environment variables.
 * 2. Checks authoritative Redis key for the winning keypair.
 * 3. If generating, uses Redis SETNX and reads back the winner so all cluster instances match.
 */
export const initVapidKeys = async () => {
  if (vapidKeys?.publicKey && vapidKeys?.privateKey) return vapidKeys;

  // 1. Static environment configuration (production mandatory)
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
    };
    const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:operations@mumbaicollection.in";
    webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);
    return vapidKeys;
  }

  if (process.env.NODE_ENV === "production") {
    logger.error(
      "[WebPush] CRITICAL: Production environment MUST configure static VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables to ensure zero-disk cluster consistency!"
    );
  }

  // 2. Check authoritative Redis key across cluster
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

  // 3. Fall back to local disk
  if (existsSync(VAPID_KEYS_FILE)) {
    try {
      vapidKeys = JSON.parse(readFileSync(VAPID_KEYS_FILE, "utf8"));
      if (vapidKeys?.publicKey && vapidKeys?.privateKey) {
        if (redis && isRedisActive()) {
          // Attempt to claim in Redis; if another instance beat us, adopt winner
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
      logger.warn({ err: err.message }, "[WebPush] Failed reading existing vapid_keys.json, generating new");
    }
  }

  // 4. Generate new keypair and synchronize via Redis distributed winner pattern
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
 * Initializes from memory, env, or disk if async initVapidKeys() has not yet run.
 */
export const getVapidKeys = () => {
  if (vapidKeys?.publicKey && vapidKeys?.privateKey) return vapidKeys;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
    };
  } else if (existsSync(VAPID_KEYS_FILE)) {
    try {
      vapidKeys = JSON.parse(readFileSync(VAPID_KEYS_FILE, "utf8"));
    } catch (_) {}
  }

  if (!vapidKeys || !vapidKeys.publicKey || !vapidKeys.privateKey) {
    vapidKeys = webpush.generateVAPIDKeys();
    atomicWriteJson(VAPID_KEYS_FILE, vapidKeys).catch(() => {});
  }

  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:operations@mumbaicollection.in";
  webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);

  // Trigger async cluster sync in background
  initVapidKeys().catch(() => {});

  return vapidKeys;
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
  }
};

/**
 * Checks whether an employee account is active before sending push notifications.
 * Fails closed: if employee status cannot be verified as active, returns false.
 */
export const isEmployeeActiveForPush = async (employeeId) => {
  if (!employeeId) return false;
  const cleanId = Number(employeeId);
  if (!cleanId || isNaN(cleanId)) return false;

  const now = Date.now();
  const cached = employeeStatusCache.get(cleanId);
  if (cached && now - cached.timestamp < EMPLOYEE_STATUS_CACHE_TTL) {
    return cached.active;
  }

  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      // Check if employee sessions were revoked
      const revTime = await redis.get(`sess:user_rev:${cleanId}`);
      if (revTime) {
        employeeStatusCache.set(cleanId, { active: false, timestamp: now });
        return false;
      }
    } catch (_) {}
  }

  // Verify against WordPress internal staff directory
  try {
    const response = await wp.get("/wp-json/mumbai-auth/v1/admin/employees", {
      params: { search: undefined },
    });
    const employees = response.data?.employees || [];
    for (const emp of employees) {
      const empId = Number(emp.id);
      const isActive = emp.status === "approved" || emp.status === "active";
      employeeStatusCache.set(empId, { active: isActive, timestamp: now });
    }
    const result = employeeStatusCache.get(cleanId);
    if (result !== undefined) {
      return result.active;
    }
  } catch (err) {
    logger.warn({ err: err.message, employeeId: cleanId }, "[WebPush] Employee status check failed");
  }

  // Fail closed: do not send push if active status cannot be confirmed
  return false;
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
      logger.warn({ err: redisErr.message }, "[WebPush] Redis subscription save failed; saving to disk");
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
      logger.warn({ err: redisErr.message }, "[WebPush] Redis unregister failed");
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
    try {
      const endpoints = toRemove.map((s) => s.endpoint);
      if (endpoints.length > 0) {
        await redis.hdel(REDIS_SUBS_HASH, ...endpoints);
        await redis.srem("mumbai:push:endpoints", ...endpoints).catch(() => {});
      }
    } catch (redisErr) {
      logger.warn({ err: redisErr.message }, "[WebPush] Redis employee subscriptions purge failed");
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
const loadOutbox = async () => {
  if (outboxCache) return outboxCache;

  try {
    if (existsSync(OUTBOX_FILE)) {
      const raw = await readFile(OUTBOX_FILE, "utf8");
      outboxCache = JSON.parse(raw);
      if (!Array.isArray(outboxCache)) outboxCache = [];
    } else {
      outboxCache = [];
    }
  } catch (err) {
    logger.warn({ err: err.message }, "[WebPush] Error reading outbox file; starting fresh");
    outboxCache = [];
  }

  return outboxCache;
};

/**
 * Saves outbox jobs atomically to disk (disk fallback).
 */
const saveOutboxToDisk = async (jobs) => {
  outboxCache = jobs;
  try {
    await atomicWriteJson(OUTBOX_FILE, jobs);
  } catch (err) {
    logger.error({ err: err.message }, "[WebPush] Failed saving outbox to disk");
  }
};

/**
 * Enqueues a push delivery task into the durable outbox.
 * Redis is authoritative when available (NEVER writes to both Redis and disk simultaneously).
 * Disk is strictly a fallback when Redis is inactive or enqueue fails.
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
    status: "pending",
  };

  const redis = getRedisClient();
  let enqueuedInRedis = false;

  if (redis && isRedisActive()) {
    try {
      const pipeline = redis.pipeline();
      pipeline.hset(REDIS_OUTBOX_JOBS, jobId, JSON.stringify(job));
      pipeline.rpush(REDIS_OUTBOX_PENDING, jobId);
      const results = await pipeline.exec();
      const hasError = results?.some(([err]) => Boolean(err));
      if (!hasError) {
        enqueuedInRedis = true;
      }
    } catch (redisErr) {
      logger.warn({ err: redisErr.message, orderId: cleanOrderId }, "[WebPush] Redis outbox enqueue failed; falling back to disk");
    }
  }

  // Strictly use disk outbox ONLY when Redis enqueue did not succeed
  if (!enqueuedInRedis) {
    const outbox = await loadOutbox();
    outbox.push(job);
    await saveOutboxToDisk(outbox);
    logger.info({ jobId, orderId: cleanOrderId }, "[WebPush] Enqueued push outbox job to disk fallback");
  } else {
    logger.info({ jobId, orderId: cleanOrderId }, "[WebPush] Enqueued durable push outbox job in Redis");
  }

  // Trigger immediate asynchronous drain without blocking caller
  setImmediate(() => {
    processPushOutbox().catch((err) => {
      logger.warn({ err: err.message }, "[WebPush] Outbox drain triggered error");
    });
  });

  return job;
};

/**
 * Processes and drains pending jobs from the durable push outbox.
 * Uses atomic lease (RPOPLPUSH pending -> processing), recovers expired leases on crashes,
 * and schedules persistent delayed retries via Redis Sorted Set.
 */
export const processPushOutbox = async () => {
  if (isProcessingOutbox) return;
  isProcessingOutbox = true;

  try {
    const redis = getRedisClient();
    if (redis && isRedisActive()) {
      const now = Date.now();

      // 1. Reclaim delayed retry jobs whose backoff time has elapsed
      try {
        const dueJobIds = await redis.zrangebyscore(REDIS_OUTBOX_DELAYED, "-inf", now);
        if (dueJobIds && dueJobIds.length > 0) {
          const pipeline = redis.pipeline();
          for (const jid of dueJobIds) {
            pipeline.zrem(REDIS_OUTBOX_DELAYED, jid);
            pipeline.rpush(REDIS_OUTBOX_PENDING, jid);
          }
          await pipeline.exec();
        }
      } catch (err) {
        logger.debug({ err: err.message }, "[WebPush] Failed checking delayed retry set");
      }

      // 2. Reclaim expired processing leases (worker crashed while processing)
      try {
        const processingIds = await redis.lrange(REDIS_OUTBOX_PROCESSING, 0, -1);
        if (processingIds && processingIds.length > 0) {
          for (const jid of processingIds) {
            const raw = await redis.hget(REDIS_OUTBOX_JOBS, jid);
            if (!raw) {
              await redis.lrem(REDIS_OUTBOX_PROCESSING, 0, jid);
            } else {
              try {
                const job = JSON.parse(raw);
                if (job.leaseExpiresAt && job.leaseExpiresAt < now) {
                  logger.warn({ jobId: jid, orderId: job.orderId }, "[WebPush] Reclaiming expired outbox processing lease");
                  await redis.lrem(REDIS_OUTBOX_PROCESSING, 0, jid);
                  await redis.rpush(REDIS_OUTBOX_PENDING, jid);
                }
              } catch (_) {}
            }
          }
        }
      } catch (err) {
        logger.debug({ err: err.message }, "[WebPush] Failed checking processing lease queue");
      }

      // 3. Atomically lease and process pending jobs one by one using RPOPLPUSH
      let jobId = null;
      try {
        jobId = await redis.rpoplpush(REDIS_OUTBOX_PENDING, REDIS_OUTBOX_PROCESSING);
      } catch (_) {
        jobId = null;
      }

      while (jobId) {
        const rawJob = await redis.hget(REDIS_OUTBOX_JOBS, jobId);
        if (rawJob) {
          let job;
          try {
            job = JSON.parse(rawJob);
          } catch (_) {
            await redis.lrem(REDIS_OUTBOX_PROCESSING, 0, jobId);
            await redis.hdel(REDIS_OUTBOX_JOBS, jobId);
            try {
              jobId = await redis.rpoplpush(REDIS_OUTBOX_PENDING, REDIS_OUTBOX_PROCESSING);
            } catch (_) {
              jobId = null;
            }
            continue;
          }

          // Assign 30-second lease
          job.leaseExpiresAt = Date.now() + 30000;
          await redis.hset(REDIS_OUTBOX_JOBS, jobId, JSON.stringify(job));

          try {
            await sendOrderCreatedPush({ orderId: job.orderId, total: job.total });
            // Succeeded: remove lease and delete job record
            const pipeline = redis.pipeline();
            pipeline.lrem(REDIS_OUTBOX_PROCESSING, 0, jobId);
            pipeline.hdel(REDIS_OUTBOX_JOBS, jobId);
            await pipeline.exec();
          } catch (jobErr) {
            job.attempts = (job.attempts || 0) + 1;
            job.lastAttemptAt = Date.now();
            if (job.attempts < (job.maxAttempts || 3)) {
              const backoffMs = Math.pow(2, job.attempts) * 5000; // 10s, 20s
              const nextRetryAt = Date.now() + backoffMs;
              job.nextRetryAt = nextRetryAt;
              job.leaseExpiresAt = null;

              const pipeline = redis.pipeline();
              pipeline.lrem(REDIS_OUTBOX_PROCESSING, 0, jobId);
              pipeline.hset(REDIS_OUTBOX_JOBS, jobId, JSON.stringify(job));
              pipeline.zadd(REDIS_OUTBOX_DELAYED, nextRetryAt, jobId);
              await pipeline.exec();
              logger.warn(
                { jobId, orderId: job.orderId, attempt: job.attempts, nextRetryInMs: backoffMs },
                "[WebPush] Push delivery failed; scheduled retry in Redis"
              );
            } else {
              logger.error(
                { jobId, orderId: job.orderId },
                "[WebPush] Outbox job exceeded max retry attempts, dropping to dead letter"
              );
              const pipeline = redis.pipeline();
              pipeline.lrem(REDIS_OUTBOX_PROCESSING, 0, jobId);
              pipeline.hdel(REDIS_OUTBOX_JOBS, jobId);
              await pipeline.exec();
            }
          }
        } else {
          await redis.lrem(REDIS_OUTBOX_PROCESSING, 0, jobId);
        }

        try {
          jobId = await redis.rpoplpush(REDIS_OUTBOX_PENDING, REDIS_OUTBOX_PROCESSING);
        } catch (_) {
          jobId = null;
        }
      }
    } else {
      // 4. Drain Local Disk Outbox ONLY when Redis is NOT active
      const diskJobs = await loadOutbox();
      if (diskJobs.length > 0) {
        const remainingJobs = [];
        for (const job of diskJobs) {
          try {
            await sendOrderCreatedPush({ orderId: job.orderId, total: job.total });
          } catch (jobErr) {
            job.attempts = (job.attempts || 0) + 1;
            job.lastAttemptAt = Date.now();
            if (job.attempts < (job.maxAttempts || 3)) {
              remainingJobs.push(job);
            } else {
              logger.error({ jobId: job.id, orderId: job.orderId }, "[WebPush] Disk outbox job exceeded max attempts");
            }
          }
        }
        await saveOutboxToDisk(remainingJobs);
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, "[WebPush] Outbox processing encountered warning");
  } finally {
    isProcessingOutbox = false;
  }
};

// Periodic background watchdog every 15 seconds to reclaim leases and process due retries
const outboxWatchdogTimer = setInterval(() => {
  processPushOutbox().catch(() => {});
}, 15000);
if (typeof outboxWatchdogTimer.unref === "function") {
  outboxWatchdogTimer.unref();
}

/**
 * Sends a high-priority background Web Push notification for a new confirmed order.
 * Strictly called ONLY for ORDER_CREATED (never for packing, dispatch, or delivery transitions).
 * Filters out deactivated/suspended employees and automatically purges dead endpoints.
 * Throws on transient delivery failures so the outbox caller can retry.
 *
 * @param {Object} params
 * @param {number|string} params.orderId
 * @param {number|string} [params.total]
 */
export const sendOrderCreatedPush = async ({ orderId, total } = {}) => {
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
  const revokedEmployeeIds = new Set();

  for (const sub of subs) {
    if (!sub.employeeId) {
      continue;
    }

    if (revokedEmployeeIds.has(sub.employeeId)) {
      continue;
    }

    const isActive = await isEmployeeActiveForPush(sub.employeeId);
    if (isActive) {
      activeSubs.push(sub);
    } else {
      revokedEmployeeIds.add(sub.employeeId);
    }
  }

  // Purge any subscriptions belonging to deactivated employees
  if (revokedEmployeeIds.size > 0) {
    for (const empId of revokedEmployeeIds) {
      await removeSubscriptionsForEmployee(empId);
    }
  }

  if (activeSubs.length === 0) {
    logger.debug({ orderId: cleanOrderId }, "[WebPush] No subscriptions for active employees");
    return { success: true, sentCount: 0 };
  }

  const payload = JSON.stringify({
    title: "🚨 New Mumbai Collection Order!",
    body: total
      ? `New Order #${cleanOrderId} received (₹${total}). Tap to pack & dispatch.`
      : `New Order #${cleanOrderId} received. Tap to pack & dispatch.`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: `new-order-${cleanOrderId}`,
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
  let sentCount = 0;
  let transientErrorCount = 0;

  await Promise.allSettled(
    activeSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payload,
          options
        );
        sentCount++;
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

  logger.info(
    { orderId: cleanOrderId, sentCount, deadCount: deadEndpoints.length, transientErrorCount },
    "[WebPush] Dispatched order created push notifications"
  );

  // If there were active subscriptions that failed with transient errors (and 0 succeeded), throw to trigger outbox retry!
  if (activeSubs.length > deadEndpoints.length && sentCount === 0 && transientErrorCount > 0) {
    throw new Error(`Push delivery failed with ${transientErrorCount} transient network failures (0 delivered)`);
  }

  return { success: true, sentCount, deadCount: deadEndpoints.length, transientErrorCount };
};

/** Testing Helpers */
export const _resetPushNotificationServiceForTesting = () => {
  vapidKeys = null;
  subscriptionsCache = null;
  outboxCache = null;
  isProcessingOutbox = false;
  employeeStatusCache.clear();
};
export const _getOutboxCount = async () => {
  const jobs = await loadOutbox();
  return jobs.length;
};
