import EventEmitter from "events";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { getRedisClient, getRedisSubscriber, isRedisActive, isRedisSubscriberActive } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import { sendOrderCreatedPush, enqueuePushOutboxJob } from "./pushNotificationService.js";
import { alertStaffAnomaly } from "./alertService.js";
import { getSessionKeyHashes, checkDurableRevocation, checkDurableUserRevocation } from "../middlewares/authMiddleware.js";

export const ORDER_EVENTS_CHANNEL = "orders:events";

const localBus = new EventEmitter();
localBus.setMaxListeners(200);

// Active employee SSE response streams and user tracking
const employeeClients = new Set();
const userClientCounts = new Map();
const localAcknowledgedOrders = new Map();

export const _getLocalAcknowledgedOrders = () => localAcknowledgedOrders;

export const MAX_GLOBAL_SSE_CLIENTS = 100;
export const MAX_PER_USER_SSE_CLIENTS = 3;
const ACK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let isSubscriberInitialized = false;
let isSubscriberInitializing = false;
let isSubscriberMessageListenerAttached = false;

/**
 * Initializes the dedicated Redis subscriber for order events.
 * Idempotent and fails gracefully if Redis is unavailable.
 */
export const initRedisOrderSubscriber = () => {
  if (isSubscriberInitialized || isSubscriberInitializing) return;

  const subscriber = getRedisSubscriber();
  if (!subscriber) {
    logger.debug("[OrderNotification] Redis subscriber not available; using in-memory local bus");
    return;
  }

  if (!isSubscriberMessageListenerAttached) {
    subscriber.on("message", (channel, message) => {
      if (channel !== ORDER_EVENTS_CHANNEL) return;
      try {
        const payload = JSON.parse(message);
        broadcastToEmployeeClients(payload);
      } catch (parseErr) {
        logger.warn({ err: parseErr.message, message }, "[OrderNotification] Malformed order event message received");
      }
    });
    subscriber.on("close", () => { isSubscriberInitialized = false; });
    subscriber.on("ready", () => { void subscribeToOrderEvents(); });
    isSubscriberMessageListenerAttached = true;
  }

  isSubscriberInitializing = true;
  const subscribeToOrderEvents = async () => {
    try {
      const count = await subscriber.subscribe(ORDER_EVENTS_CHANNEL);
      isSubscriberInitialized = true;
      logger.info({ count }, "[OrderNotification] Subscribed to Redis order events channel");
    } catch (subErr) {
      logger.warn(
        { err: subErr?.message || subErr },
        "[OrderNotification] Redis subscription unavailable; using in-memory local bus"
      );
    } finally {
      isSubscriberInitializing = false;
    }
  };

  if (subscriber.status === "ready") {
    void subscribeToOrderEvents();
  }
};

/**
 * Broadcasts an order event to all connected employee SSE client streams.
 * @param {Object} payload - { event: string, orderId: number, status?: string, timestamp: number, employeeId?: number }
 */
export const broadcastToEmployeeClients = (payload) => {
  if (!payload || !payload.event || !payload.orderId) return;

  serverCache.invalidatePrefix("employee:orders_scan");
  serverCache.invalidatePrefix("employee:overview");

  const dataString = `event: order_event\ndata: ${JSON.stringify(payload)}\n\n`;
  const now = Date.now();

  for (const client of Array.from(employeeClients)) {
    // Strictly enforce session expiration deadline before delivering any order event
    if (client._sessionExpiresAt && now >= client._sessionExpiresAt) {
      try {
        client.write(`event: session_expired\ndata: ${JSON.stringify({ expired: true, reason: "SESSION_EXPIRED" })}\n\n`);
      } catch (_) {}
      if (typeof client._cleanupSSE === "function") {
        client._cleanupSSE();
      } else {
        employeeClients.delete(client);
      }
      try { client.end(); } catch (_) {}
      continue;
    }

    try {
      client.write(dataString);
    } catch (_) {
      if (typeof client._cleanupSSE === "function") {
        client._cleanupSSE();
      } else {
        employeeClients.delete(client);
      }
    }
  }
};

// Wire up local bus listener for in-memory / test / fallback scenarios
localBus.on("order_event", (payload) => {
  broadcastToEmployeeClients(payload);
});

/**
 * Publishes a minimal order event containing ONLY event type, numeric order ID, and optional status.
 * Never throws — guaranteed safe for checkout and order mutation flows.
 *
 * @param {Object} params
 * @param {'ORDER_CREATED' | 'ORDER_STATUS_UPDATED' | 'ORDER_ACKNOWLEDGED'} params.event
 * @param {number|string} params.orderId
 * @param {string} [params.status]
 * @param {number|string} [params.total]
 * @param {number|string} [params.employeeId]
 */
export const publishOrderEvent = async ({ event, orderId, status, total, employeeId } = {}) => {
  const cleanOrderId = Number(orderId);
  if (!cleanOrderId || isNaN(cleanOrderId) || !event) {
    logger.debug({ event, orderId }, "[OrderNotification] Ignored invalid order event parameters");
    return false;
  }

  const payload = {
    event: String(event),
    orderId: cleanOrderId,
    ...(status ? { status: String(status) } : {}),
    ...(employeeId ? { employeeId: Number(employeeId) || employeeId } : {}),
    timestamp: Date.now(),
  };

  // Dispatch high-priority Web Push strictly for ORDER_CREATED (never for packing/status updates)
  // Await durable outbox persistence before acknowledging event publication
  let pushEnqueued = true;
  let pushError = null;

  if (payload.event === "ORDER_CREATED") {
    try {
      await enqueuePushOutboxJob({ orderId: cleanOrderId, total: total || null });
    } catch (pushErr) {
      pushEnqueued = false;
      pushError = pushErr?.message || String(pushErr);
      logger.error({ err: pushErr?.message, orderId: cleanOrderId }, "[OrderNotification] Push outbox persistence failed");

      // Send critical operational alert: notify staff immediately of push failure while order succeeds
      void alertStaffAnomaly({
        type: "PUSH_OUTBOX_PERSISTENCE_FAILED",
        severity: "critical",
        message: `Durable push notification job could not be enqueued for order #${cleanOrderId}. Locked-screen push delivery may be delayed or missed.`,
        details: { orderId: cleanOrderId, total: total || null, error: pushError },
      }).catch(() => {});
    }
  }

  const buildResult = (published) => ({
    success: published,
    published,
    pushEnqueued,
    degraded: !pushEnqueued,
    ...(pushError ? { pushError } : {}),
  });

  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      await redis.publish(ORDER_EVENTS_CHANNEL, JSON.stringify(payload));
      if (!isRedisSubscriberActive() || !isSubscriberInitialized) broadcastToEmployeeClients(payload);
      return buildResult(true);
    } catch (err) {
      logger.warn({ err: err?.message, orderId: cleanOrderId }, "[OrderNotification] Redis publish failed, falling back to local bus");
      broadcastToEmployeeClients(payload);
      return buildResult(true);
    }
  }

  // In-memory bus fallback when Redis is inactive or not configured
  localBus.emit("order_event", payload);
  return buildResult(true);
};

/**
 * Acknowledges an incoming order alert across the counter / employee panel.
 * Stores acknowledgement record and broadcasts ORDER_ACKNOWLEDGED to silence alarms.
 *
 * @param {Object} params
 * @param {number|string} params.orderId
 * @param {number|string} [params.employeeId]
 */
export const acknowledgeOrderNotification = async ({ orderId, employeeId } = {}) => {
  const cleanOrderId = Number(orderId);
  if (!cleanOrderId || isNaN(cleanOrderId)) {
    return { success: false, reason: "invalid_order_id" };
  }

  const cleanEmployeeId = employeeId ? Number(employeeId) || employeeId : null;
  const ackRecord = {
    orderId: cleanOrderId,
    employeeId: cleanEmployeeId,
    acknowledgedAt: Date.now(),
  };

  // Always cache locally as immediate zero-latency backup and in-flight guard
  localAcknowledgedOrders.set(cleanOrderId, { ...ackRecord, expiresAt: Date.now() + ACK_TTL_MS });

  // Cache in Redis with 24-hour TTL if active
  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      await redis.set(`mumbai:order:ack:${cleanOrderId}`, JSON.stringify(ackRecord), "EX", 86400);
    } catch (err) {
      logger.warn({ err: err?.message, orderId: cleanOrderId }, "[OrderNotification] Redis ack set failed, fallback retained in local memory");
    }
  }

  // Broadcast to all connected panels so other phones stop ringing immediately
  await publishOrderEvent({
    event: "ORDER_ACKNOWLEDGED",
    orderId: cleanOrderId,
    employeeId: cleanEmployeeId,
  });

  return { success: true, orderId: cleanOrderId, employeeId: cleanEmployeeId };
};

/**
 * Checks if an order was acknowledged.
 *
 * Persistence semantics:
 * - Redis records survive backend restarts and are shared across all Node worker processes.
 * - Local memory entries are maintained per Node process during temporary Redis outages
 *   and reconcile back into Redis with their remaining TTL as soon as Redis is reachable.
 * - In-memory entries do NOT survive a Node process restart or sync to other workers if Redis
 *   remained unavailable throughout.
 */
export const isOrderAcknowledged = async (orderId) => {
  const cleanOrderId = Number(orderId);
  if (!cleanOrderId) return false;

  const redis = getRedisClient();
  let redisChecked = false;
  if (redis && isRedisActive()) {
    try {
      const raw = await redis.get(`mumbai:order:ack:${cleanOrderId}`);
      if (raw) return true;
      redisChecked = true;
    } catch (_) {
      // Fall through to local memory check
    }
  }

  const now = Date.now();
  const local = localAcknowledgedOrders.get(cleanOrderId);
  if (local) {
    if (local.expiresAt > now) {
      // If Redis was active but missed this key (e.g. key was written during Redis outage),
      // reconcile into Redis using remaining unexpired TTL so original expiry is preserved.
      if (redisChecked && redis && isRedisActive()) {
        const remainingTtlMs = local.expiresAt - now;
        if (remainingTtlMs > 0) {
          redis.set(`mumbai:order:ack:${cleanOrderId}`, JSON.stringify(local), "PX", remainingTtlMs, "NX").catch(() => {});
        }
      }
      return true;
    }
    localAcknowledgedOrders.delete(cleanOrderId);
  }
  return false;
};

/**
 * Checks a batch of order IDs for acknowledgement status in Redis/memory.
 * Returns a Set of acknowledged order IDs.
 *
 * Merges unexpired local memory entries for Redis misses and reconciles them into Redis
 * with their remaining TTL so original expiry times are preserved when Redis recovers.
 *
 * Persistence semantics:
 * - Redis records survive restarts and are shared across all Node worker processes.
 * - Local memory entries survive in the current process during a Redis outage and
 *   backfill to Redis on the next query after recovery.
 * - If the process restarts while Redis was down, local-only entries are lost.
 *
 * @param {Array<number|string>} orderIds
 * @returns {Promise<Set<number>>}
 */
const awaitWithAbortSignal = (promise, signal) => {
  if (!signal) return promise;
  if (signal.aborted) {
    const error = new Error("Operation aborted");
    error.name = "AbortError";
    error.code = "ERR_CANCELED";
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      const error = new Error("Operation aborted");
      error.name = "AbortError";
      error.code = "ERR_CANCELED";
      reject(error);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
};

export const getAcknowledgedOrderIds = async (orderIds, { signal } = {}) => {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return new Set();
  if (signal?.aborted) {
    const error = new Error("Operation aborted");
    error.name = "AbortError";
    error.code = "ERR_CANCELED";
    throw error;
  }
  const cleanIds = orderIds.map(Number).filter(Boolean);
  const ackSet = new Set();
  const unconfirmedIds = new Set(cleanIds);

  const redis = getRedisClient();
  let redisChecked = false;
  if (redis && isRedisActive() && cleanIds.length > 0) {
    try {
      const keys = cleanIds.map((id) => `mumbai:order:ack:${id}`);
      const values = await awaitWithAbortSignal(redis.mget(keys), signal);
      values.forEach((val, i) => {
        if (val) {
          ackSet.add(cleanIds[i]);
          unconfirmedIds.delete(cleanIds[i]);
        }
      });
      redisChecked = true;
    } catch (err) {
      if (signal?.aborted) throw err;
      logger.warn({ err: err?.message }, "[OrderNotification] Redis batch mget failed, falling back to local");
    }
  }

  // Check unconfirmed IDs in local memory (handles Redis misses after recovery or during Redis outage)
  const now = Date.now();
  for (const id of unconfirmedIds) {
    const local = localAcknowledgedOrders.get(id);
    if (local) {
      if (local.expiresAt > now) {
        ackSet.add(id);
        // If Redis is active, reconcile the unexpired record back into Redis
        if (redisChecked && redis && isRedisActive()) {
          const remainingTtlMs = local.expiresAt - now;
          if (remainingTtlMs > 0) {
            redis.set(`mumbai:order:ack:${id}`, JSON.stringify(local), "PX", remainingTtlMs, "NX").catch(() => {});
          }
        }
      } else {
        localAcknowledgedOrders.delete(id);
      }
    }
  }

  return ackSet;
};

/**
 * HTTP Handler for Employee Server-Sent Events (SSE) Stream.
 * Mounted at GET /api/employee/orders/stream
 */
export const handleEmployeeOrderStream = (req, res) => {
  // Connection limit checks
  if (employeeClients.size >= MAX_GLOBAL_SSE_CLIENTS) {
    logger.warn({ current: employeeClients.size }, "[OrderNotification] Global SSE connection limit reached");
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many active stream connections" }));
    return;
  }

  const userId = req.user?.id ? String(req.user.id) : null;
  const sessionExpiresAt = req.authExpiresAt || null;
  const validatedAt = req.authValidatedAt || Date.now();
  const authCookie = req.wpAuthCookie || null;
  if (userId) {
    const currentCount = userClientCounts.get(userId) || 0;
    if (currentCount >= MAX_PER_USER_SSE_CLIENTS) {
      logger.warn({ userId, currentCount }, "[OrderNotification] Per-user SSE connection limit reached");
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Too many active stream connections for this user" }));
      return;
    }
  }

  // 1. Establish SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // Instruct reverse proxies (Nginx) not to buffer streaming chunks
  });

  // 2. Ensure subscriber is initialized
  initRedisOrderSubscriber();

  // 3. Register client stream and track user connections
  employeeClients.add(res);
  if (userId) {
    userClientCounts.set(userId, (userClientCounts.get(userId) || 0) + 1);
  }

  // 4. Send initial connected event
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      status: "connected",
      userId: req.user?.id || null,
      timestamp: Date.now(),
    })}\n\n`
  );

  // 5. 15-second heartbeat:
  // - Sends comment ': ping\n\n' for proxy keep-alive
  // - Sends observable 'event: heartbeat\ndata: <timestamp>\n\n' for client watchdog
  let isCleanedUp = false;
  const cleanupClient = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    clearInterval(pingInterval);
    employeeClients.delete(res);
    if (userId) {
      const current = userClientCounts.get(userId) || 1;
      if (current <= 1) {
        userClientCounts.delete(userId);
      } else {
        userClientCounts.set(userId, current - 1);
      }
    }
  };
  res._cleanupSSE = cleanupClient;
  res._sessionExpiresAt = sessionExpiresAt;
  res._validatedAt = validatedAt;
  res._authCookie = authCookie;
  res._userId = userId;
  res._userVersion = req.userVersion || null;

  let consecutiveCheckFailures = 0;

  const pingInterval = setInterval(async () => {
    // 1. Session expiry verification on heartbeat
    if (res._sessionExpiresAt && Date.now() >= res._sessionExpiresAt) {
      try {
        res.write(`event: session_expired\ndata: ${JSON.stringify({ expired: true, reason: "SESSION_EXPIRED" })}\n\n`);
      } catch (_) {}
      cleanupClient();
      try { res.end(); } catch (_) {}
      return;
    }

    // 2. Revocation check on heartbeat across shared durable storage & Redis
    let checkedWithRedis = false;
    let isRevoked = false;

    // First check shared durable storage (survives Redis outages & backend restarts)
    if (authCookie) {
      const durableToken = checkDurableRevocation(authCookie);
      if (durableToken.revoked) {
        isRevoked = true;
      }
    }
    if (!isRevoked && userId) {
      const durableUser = checkDurableUserRevocation(userId, res._userVersion, validatedAt);
      if (durableUser.revoked) {
        isRevoked = true;
      }
    }

    const redis = getRedisClient();
    if (!isRevoked && redis && isRedisActive()) {
      try {
        const { allRevocationKeys } = getSessionKeyHashes(authCookie);
        const keysToCheck = (allRevocationKeys || []).map((k) => `sess:revoked:${k}`);
        if (userId) {
          keysToCheck.push(`sess:user_ver:${userId}`);
          keysToCheck.push(`sess:user_rev:${userId}`);
        }
        if (keysToCheck.length > 0) {
          const results = await redis.mget(...keysToCheck);
          for (let i = 0; i < (allRevocationKeys || []).length; i++) {
            if (results[i]) {
              isRevoked = true;
              break;
            }
          }
          if (userId && !isRevoked) {
            const verIndex = (allRevocationKeys || []).length;
            const revTimeIndex = verIndex + 1;
            const currentVerStr = results[verIndex];
            const currentVer = currentVerStr ? Number(currentVerStr) : null;
            const userRevTime = results[revTimeIndex];

            if (currentVer !== null && res._userVersion !== undefined && res._userVersion !== null) {
              if (Number(res._userVersion) < currentVer) {
                isRevoked = true;
              }
            }
            if (!isRevoked && userRevTime && Number(userRevTime) > validatedAt) {
              isRevoked = true;
            }
          }
        }
        checkedWithRedis = true;
        consecutiveCheckFailures = 0;
      } catch (checkErr) {
        logger.warn({ err: checkErr?.message }, "[OrderNotification] Heartbeat Redis check threw error");
      }
    }

    if (isRevoked) {
      try {
        res.write(`event: session_revoked\ndata: ${JSON.stringify({ revoked: true, reason: "SESSION_REVOKED" })}\n\n`);
      } catch (_) {}
      cleanupClient();
      try { res.end(); } catch (_) {}
      return;
    }

    // If Redis was unavailable or threw an error:
    if (!checkedWithRedis) {
      consecutiveCheckFailures++;
      logger.warn({ consecutiveCheckFailures }, "[OrderNotification] Heartbeat Redis check unavailable");

      // After 3 failed Redis checks (45 seconds), revalidate against WordPress primary authority!
      if (consecutiveCheckFailures >= 3 && authCookie) {
        try {
          const wpRes = await axios.get(
            `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
            {
              headers: { Cookie: authCookie },
              httpsAgent,
              timeout: 4000,
            }
          );
          const wpData = wpRes.data;
          const roles = Array.isArray(wpData?.roles) ? wpData.roles : [];
          const isAllowed = wpData?.logged_in && roles.some((r) => ["employee", "administrator"].includes(r));
          if (isAllowed) {
            // Employee verified as still authorized by WordPress authority
            consecutiveCheckFailures = 0;
            if (wpData.expires_at) {
              res._sessionExpiresAt = Number(wpData.expires_at) * 1000;
            }
          } else {
            // Upstream confirmed session is revoked, suspended, or expired
            try {
              res.write(`event: session_revoked\ndata: ${JSON.stringify({ revoked: true, reason: "SESSION_REVOKED_UPSTREAM" })}\n\n`);
            } catch (_) {}
            cleanupClient();
            try { res.end(); } catch (_) {}
            return;
          }
        } catch (wpErr) {
          // Both Redis and WordPress cannot verify authorization after 6 checks (90 seconds)
          if (consecutiveCheckFailures >= 6) {
            logger.error("[OrderNotification] Both Redis and WordPress unreachable for 90s; terminating unverified stream");
            try {
              res.write(`event: session_revoked\ndata: ${JSON.stringify({ revoked: true, reason: "REVOCATION_CHECK_UNAVAILABLE" })}\n\n`);
            } catch (_) {}
            cleanupClient();
            try { res.end(); } catch (_) {}
            return;
          }
        }
      }
    }

    try {
      res.write(`: ping\n\nevent: heartbeat\ndata: ${Date.now()}\n\n`);
    } catch (_) {
      cleanupClient();
    }
  }, 15000);
  if (typeof pingInterval.unref === "function") {
    pingInterval.unref();
  }

  // 6. Cleanup on client disconnect / errors
  req.on("close", cleanupClient);
  if (typeof res.on === "function") {
    res.on("close", cleanupClient);
    res.on("error", cleanupClient);
  }
};

/** Testing inspection helpers */
export const _getConnectedClientCount = () => employeeClients.size;
export const _getUserClientCount = (userId) => userClientCounts.get(String(userId)) || 0;
export const closeEmployeeOrderStreams = () => {
  for (const client of employeeClients) {
    try {
      client.end();
    } catch (_) {
      // Ignored: client socket already closed or terminated
    }
  }
  employeeClients.clear();
  userClientCounts.clear();
};
export const _resetNotificationServiceForTesting = () => {
  employeeClients.clear();
  userClientCounts.clear();
  localAcknowledgedOrders.clear();
  isSubscriberInitialized = false;
  localBus.removeAllListeners("order_event");
  localBus.on("order_event", (payload) => {
    const redis = getRedisClient();
    const subActive = isRedisSubscriberActive();
    if (redis && isRedisActive() && subActive) {
      return;
    }
    broadcastToEmployeeClients(payload);
  });
};
