import EventEmitter from "events";
import { getRedisClient, getRedisSubscriber, isRedisActive, isRedisSubscriberActive } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";

export const ORDER_EVENTS_CHANNEL = "orders:events";

const localBus = new EventEmitter();
localBus.setMaxListeners(200);

// Active employee SSE response streams
const employeeClients = new Set();

let isSubscriberInitialized = false;

/**
 * Initializes the dedicated Redis subscriber for order events.
 * Idempotent and fails gracefully if Redis is unavailable.
 */
export const initRedisOrderSubscriber = () => {
  if (isSubscriberInitialized) return;

  const subscriber = getRedisSubscriber();
  if (!subscriber) {
    logger.debug("[OrderNotification] Redis subscriber not available; using in-memory local bus");
    return;
  }

  try {
    subscriber.subscribe(ORDER_EVENTS_CHANNEL, (err, count) => {
      if (err) {
        logger.warn({ err: err.message }, "[OrderNotification] Failed to subscribe to orders channel");
        return;
      }
      isSubscriberInitialized = true;
      logger.info({ count }, "[OrderNotification] Subscribed to Redis order events channel");
    });

    subscriber.on("message", (channel, message) => {
      if (channel !== ORDER_EVENTS_CHANNEL) return;
      try {
        const payload = JSON.parse(message);
        broadcastToEmployeeClients(payload);
      } catch (parseErr) {
        logger.warn({ err: parseErr.message, message }, "[OrderNotification] Malformed order event message received");
      }
    });
  } catch (subErr) {
    logger.warn({ err: subErr.message }, "[OrderNotification] Error setting up Redis subscriber listener");
  }
};

/**
 * Broadcasts an order event to all connected employee SSE client streams.
 * @param {Object} payload - { event: string, orderId: number, status?: string, timestamp: number }
 */
export const broadcastToEmployeeClients = (payload) => {
  if (!payload || !payload.event || !payload.orderId) return;

  serverCache.invalidatePrefix("employee:orders_scan");
  serverCache.invalidatePrefix("employee:overview");

  const dataString = `event: order_event\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of employeeClients) {
    try {
      client.write(dataString);
    } catch (_) {
      employeeClients.delete(client);
    }
  }
};

// Wire up local bus listener for in-memory / test / fallback scenarios
localBus.on("order_event", (payload) => {
  // If Redis subscriber is active, Redis will handle message distribution to avoid local duplicate
  const redis = getRedisClient();
  const subActive = isRedisSubscriberActive();
  if (redis && isRedisActive() && subActive) {
    return;
  }
  broadcastToEmployeeClients(payload);
});

/**
 * Publishes a minimal order event containing ONLY event type, numeric order ID, and optional status.
 * Never throws — guaranteed safe for checkout and order mutation flows.
 *
 * @param {Object} params
 * @param {'ORDER_CREATED' | 'ORDER_STATUS_UPDATED'} params.event
 * @param {number|string} params.orderId
 * @param {string} [params.status]
 */
export const publishOrderEvent = async ({ event, orderId, status } = {}) => {
  const cleanOrderId = Number(orderId);
  if (!cleanOrderId || isNaN(cleanOrderId) || !event) {
    logger.debug({ event, orderId }, "[OrderNotification] Ignored invalid order event parameters");
    return false;
  }

  const payload = {
    event: String(event),
    orderId: cleanOrderId,
    ...(status ? { status: String(status) } : {}),
    timestamp: Date.now(),
  };

  const redis = getRedisClient();
  if (redis && isRedisActive()) {
    try {
      await redis.publish(ORDER_EVENTS_CHANNEL, JSON.stringify(payload));
      return true;
    } catch (err) {
      logger.warn({ err: err?.message, orderId: cleanOrderId }, "[OrderNotification] Redis publish failed, falling back to local bus");
      localBus.emit("order_event", payload);
      return true;
    }
  }

  // In-memory bus fallback when Redis is inactive or not configured
  localBus.emit("order_event", payload);
  return true;
};

/**
 * HTTP Handler for Employee Server-Sent Events (SSE) Stream.
 * Mounted at GET /api/employee/orders/stream
 */
export const handleEmployeeOrderStream = (req, res) => {
  // 1. Establish SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // Instruct reverse proxies (Nginx) not to buffer streaming chunks
  });

  // 2. Ensure subscriber is initialized
  initRedisOrderSubscriber();

  // 3. Register client stream
  employeeClients.add(res);

  // 4. Send initial connected event
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      status: "connected",
      userId: req.user?.id || null,
      timestamp: Date.now(),
    })}\n\n`
  );

  // 5. 15-second heartbeat ping to prevent proxy/tunnel idle timeouts
  const pingInterval = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch (_) {
      clearInterval(pingInterval);
      employeeClients.delete(res);
    }
  }, 15000);

  // 6. Cleanup on client disconnect
  req.on("close", () => {
    clearInterval(pingInterval);
    employeeClients.delete(res);
  });
};

/** Testing inspection helpers */
export const _getConnectedClientCount = () => employeeClients.size;
export const _resetNotificationServiceForTesting = () => {
  employeeClients.clear();
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
