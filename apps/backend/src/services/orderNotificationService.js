import EventEmitter from "events";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { getRedisClient, getRedisSubscriber, isRedisActive, isRedisSubscriberActive } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import { enqueuePushOutboxJob } from "./pushNotificationService.js";
import { alertStaffAnomaly } from "./alertService.js";
import { getSessionKeyHashes, checkDurableRevocation, checkDurableUserRevocation } from "../middlewares/authMiddleware.js";

export const ORDER_EVENTS_CHANNEL = "orders:events";

const localBus = new EventEmitter();
localBus.setMaxListeners(200);

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
        broadcastToEmployeeClients(JSON.parse(message));
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
      logger.warn({ err: subErr?.message || subErr }, "[OrderNotification] Redis subscription unavailable; using in-memory local bus");
    } finally {
      isSubscriberInitializing = false;
    }
  };

  if (subscriber.status === "ready") {
    void subscribeToOrderEvents();
  }
};

const evictClient = (client) => {
  if (typeof client._cleanupSSE === "function") {
    client._cleanupSSE();
  } else {
    employeeClients.delete(client);
  }
};

const terminateClient = (client, event, data) => {
  try {
    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {}
  evictClient(client);
  try { client.end(); } catch (_) {}
};

/**
 * Broadcasts an order event to all connected employee SSE client streams.
 */
export const broadcastToEmployeeClients = (payload) => {
  if (!payload?.event || !payload?.orderId) return;

  serverCache.invalidatePrefix("employee:orders_scan");
  serverCache.invalidatePrefix("employee:overview");

  const dataString = `event: order_event\ndata: ${JSON.stringify(payload)}\n\n`;
  const now = Date.now();

  for (const client of Array.from(employeeClients)) {
    if (client._sessionExpiresAt && now >= client._sessionExpiresAt) {
      terminateClient(client, "session_expired", { expired: true, reason: "SESSION_EXPIRED" });
      continue;
    }
    try {
      client.write(dataString);
    } catch (_) {
      evictClient(client);
    }
  }
};

localBus.on("order_event", (payload) => {
  broadcastToEmployeeClients(payload);
});

/**
 * Publishes a minimal order event containing ONLY event type, numeric order ID, and optional status.
 */
export const publishOrderEvent = async ({ event, orderId, status, total, employeeId, suppressPush = false } = {}) => {
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

  let pushEnqueued = true;
  let pushError = null;

  if (payload.event === "ORDER_CREATED" && !suppressPush) {
    try {
      await enqueuePushOutboxJob({ orderId: cleanOrderId, total: total || null });
    } catch (pushErr) {
      pushEnqueued = false;
      pushError = pushErr?.message || String(pushErr);
      logger.error({ err: pushErr?.message, orderId: cleanOrderId }, "[OrderNotification] Push outbox persistence failed");
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
    } catch (err) {
      logger.warn({ err: err?.message, orderId: cleanOrderId }, "[OrderNotification] Redis publish failed, falling back to local bus");
      broadcastToEmployeeClients(payload);
    }
  } else {
    localBus.emit("order_event", payload);
  }

  return buildResult(true);
};

/**
 * Acknowledges an incoming order alert across the counter / employee panel.
 */
export const acknowledgeOrderNotification = async ({ orderId, employeeId } = {}) => {
  const cleanOrderId = Number(orderId);
  if (!cleanOrderId || isNaN(cleanOrderId)) return { success: false, reason: "invalid_order_id" };

  const cleanEmployeeId = employeeId ? Number(employeeId) || employeeId : null;
  const ackRecord = { orderId: cleanOrderId, employeeId: cleanEmployeeId, acknowledgedAt: Date.now() };

  localAcknowledgedOrders.set(cleanOrderId, { ...ackRecord, expiresAt: Date.now() + ACK_TTL_MS });

  const redis = getRedisClient();
  let shared = false;
  if (redis && isRedisActive()) {
    try {
      await redis.set(`mumbai:order:ack:${cleanOrderId}`, JSON.stringify(ackRecord), "EX", 86400);
      shared = true;
    } catch (err) {
      logger.warn({ err: err?.message, orderId: cleanOrderId }, "[OrderNotification] Redis ack set failed, fallback retained in local memory");
    }
  }

  await publishOrderEvent({ event: "ORDER_ACKNOWLEDGED", orderId: cleanOrderId, employeeId: cleanEmployeeId });
  return { success: true, shared, orderId: cleanOrderId, employeeId: cleanEmployeeId };
};

const reconcileLocalAckToRedis = (redis, id, local, now) => {
  if (redis && isRedisActive()) {
    const remainingTtlMs = local.expiresAt - now;
    if (remainingTtlMs > 0) {
      redis.set(`mumbai:order:ack:${id}`, JSON.stringify(local), "PX", remainingTtlMs, "NX").catch(() => {});
    }
  }
};

const getValidLocalAck = (id, now, redis = null, redisChecked = false) => {
  const local = localAcknowledgedOrders.get(id);
  if (!local) return null;
  if (local.expiresAt > now) {
    if (redisChecked) reconcileLocalAckToRedis(redis, id, local, now);
    return local;
  }
  localAcknowledgedOrders.delete(id);
  return null;
};

/**
 * Checks if an order was acknowledged.
 */
export const isOrderAcknowledged = async (orderId) => {
  const cleanOrderId = Number(orderId);
  if (!cleanOrderId) return false;

  const redis = getRedisClient();
  let redisChecked = false;
  if (redis && isRedisActive()) {
    try {
      if (await redis.get(`mumbai:order:ack:${cleanOrderId}`)) return true;
      redisChecked = true;
    } catch (_) {}
  }

  return Boolean(getValidLocalAck(cleanOrderId, Date.now(), redis, redisChecked));
};

const awaitWithAbortSignal = (promise, signal) => {
  if (!signal) return promise;
  if (signal.aborted) {
    const error = new Error("Operation aborted");
    error.name = "AbortError";
    error.code = "ERR_CANCELED";
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const error = new Error("Operation aborted");
      error.name = "AbortError";
      error.code = "ERR_CANCELED";
      reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (val) => { signal.removeEventListener("abort", onAbort); resolve(val); },
      (err) => { signal.removeEventListener("abort", onAbort); reject(err); }
    );
  });
};

/**
 * Checks a batch of order IDs for acknowledgement status in Redis/memory.
 */
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

  const now = Date.now();
  for (const id of unconfirmedIds) {
    if (getValidLocalAck(id, now, redis, redisChecked)) {
      ackSet.add(id);
    }
  }

  return ackSet;
};

const checkClientRevocation = async (res) => {
  const { _authCookie: authCookie, _userId: userId, _validatedAt: validatedAt, _userVersion: userVersion } = res;
  if (authCookie && checkDurableRevocation(authCookie).revoked) return { isRevoked: true };
  if (userId && checkDurableUserRevocation(userId, userVersion, validatedAt).revoked) return { isRevoked: true };

  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      const { allRevocationKeys } = getSessionKeyHashes(authCookie);
      const keys = (allRevocationKeys || []).map((k) => `sess:revoked:${k}`);
      if (userId) keys.push(`sess:user_ver:${userId}`, `sess:user_rev:${userId}`);

      if (keys.length > 0) {
        const results = await redis.mget(...keys);
        const count = (allRevocationKeys || []).length;
        if (results.slice(0, count).some(Boolean)) return { isRevoked: true, checkedWithRedis: true };

        if (userId) {
          const currentVer = results[count] ? Number(results[count]) : null;
          const userRevTime = results[count + 1];
          if (currentVer !== null && userVersion !== undefined && userVersion !== null && Number(userVersion) < currentVer) {
            return { isRevoked: true, checkedWithRedis: true };
          }
          if (userRevTime && Number(userRevTime) > validatedAt) {
            return { isRevoked: true, checkedWithRedis: true };
          }
        }
      }
      return { isRevoked: false, checkedWithRedis: true };
    } catch (checkErr) {
      logger.warn({ err: checkErr?.message }, "[OrderNotification] Heartbeat Redis check threw error");
    }
  }

  return { isRevoked: false, checkedWithRedis: false };
};

/**
 * HTTP Handler for Employee Server-Sent Events (SSE) Stream.
 */
export const handleEmployeeOrderStream = (req, res) => {
  if (employeeClients.size >= MAX_GLOBAL_SSE_CLIENTS) {
    logger.warn({ current: employeeClients.size }, "[OrderNotification] Global SSE connection limit reached");
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Too many active stream connections" }));
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
      return res.end(JSON.stringify({ error: "Too many active stream connections for this user" }));
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  initRedisOrderSubscriber();

  employeeClients.add(res);
  if (userId) userClientCounts.set(userId, (userClientCounts.get(userId) || 0) + 1);

  res.write(`event: connected\ndata: ${JSON.stringify({ status: "connected", userId: req.user?.id || null, timestamp: Date.now() })}\n\n`);

  let isCleanedUp = false;
  const cleanupClient = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    clearInterval(pingInterval);
    employeeClients.delete(res);
    if (userId) {
      const current = userClientCounts.get(userId) || 1;
      if (current <= 1) userClientCounts.delete(userId);
      else userClientCounts.set(userId, current - 1);
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
    if (res._sessionExpiresAt && Date.now() >= res._sessionExpiresAt) {
      return terminateClient(res, "session_expired", { expired: true, reason: "SESSION_EXPIRED" });
    }

    const { isRevoked, checkedWithRedis } = await checkClientRevocation(res);
    if (isRevoked) {
      return terminateClient(res, "session_revoked", { revoked: true, reason: "SESSION_REVOKED" });
    }

    if (!checkedWithRedis) {
      consecutiveCheckFailures++;
      logger.warn({ consecutiveCheckFailures }, "[OrderNotification] Heartbeat Redis check unavailable");

      if (consecutiveCheckFailures >= 3 && authCookie) {
        try {
          const wpRes = await axios.get(`${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`, {
            headers: { Cookie: authCookie },
            httpsAgent,
            timeout: 4000,
          });
          const roles = Array.isArray(wpRes.data?.roles) ? wpRes.data.roles : [];
          if (wpRes.data?.logged_in && roles.some((r) => ["employee", "administrator"].includes(r))) {
            consecutiveCheckFailures = 0;
            if (wpRes.data.expires_at) res._sessionExpiresAt = Number(wpRes.data.expires_at) * 1000;
          } else {
            return terminateClient(res, "session_revoked", { revoked: true, reason: "SESSION_REVOKED_UPSTREAM" });
          }
        } catch (_) {
          if (consecutiveCheckFailures >= 6) {
            logger.error("[OrderNotification] Both Redis and WordPress unreachable for 90s; terminating unverified stream");
            return terminateClient(res, "session_revoked", { revoked: true, reason: "REVOCATION_CHECK_UNAVAILABLE" });
          }
        }
      }
    } else {
      consecutiveCheckFailures = 0;
    }

    try {
      res.write(`: ping\n\nevent: heartbeat\ndata: ${Date.now()}\n\n`);
    } catch (_) {
      cleanupClient();
    }
  }, 15000);

  if (typeof pingInterval.unref === "function") pingInterval.unref();

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
    try { client.end(); } catch (_) {}
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
    if (redis && isRedisActive() && isRedisSubscriberActive()) return;
    broadcastToEmployeeClients(payload);
  });
};
