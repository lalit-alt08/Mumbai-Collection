import Redis from "ioredis";
import { logger, sanitizeError, getErrorMessage } from "../utils/logger.js";

let redisClient = null;
let isReady = false;
let redisWasUnavailable = false;

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_HOST;

const isTestEnv = process.env.NODE_ENV === "test" || process.execArgv.includes("--test");

const unrefClientStream = (client) => {
  if (isTestEnv && client?.stream && typeof client.stream.unref === "function") {
    try {
      client.stream.unref();
    } catch (_) {}
  }
};

if (REDIS_URL) {
  try {
    const options = {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false, // Fail fast to in-memory fallback if Redis is temporarily unreachable
      connectTimeout: 5000,
      commandTimeout: 3000,
      retryStrategy: (times) => {
        // Recover automatically with bounded backoff and jitter.
        return Math.min(500 * (2 ** Math.min(times - 1, 6)), 30000) + Math.floor(Math.random() * 250);
      },
    };

    redisClient = REDIS_URL.startsWith("redis://") || REDIS_URL.startsWith("rediss://")
      ? new Redis(REDIS_URL, options)
      : new Redis({
          host: process.env.REDIS_HOST || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          ...options,
        });

    redisClient.on("connect", () => {
      logger.info("[Redis] Connected successfully to Redis server");
      unrefClientStream(redisClient);
    });

    redisClient.on("ready", () => {
      isReady = true;
      logger.info("[Redis] Redis client is ready for operations");
      unrefClientStream(redisClient);
      if (redisWasUnavailable) {
        redisWasUnavailable = false;
        void import("../services/alertService.js").then(({ alertStaffAnomaly }) => alertStaffAnomaly({
          type: "REDIS_RECOVERED", severity: "info", message: "Redis connectivity has recovered; shared cache and event delivery are available again."
        })).catch(() => {});
      }
    });

    redisClient.on("error", (err) => {
      isReady = false;
      redisWasUnavailable = true;
      logger.warn({ err: sanitizeError(err) }, "[Redis] Redis error encountered; falling back to in-memory store");
      void import("../services/alertService.js").then(({ alertStaffAnomaly }) => alertStaffAnomaly({
        type: "REDIS_UNAVAILABLE", severity: "warning", message: "Redis is unavailable. Local fallback is active; cross-instance updates are degraded.",
        details: { code: err.code || err.name || "UNKNOWN", reason: getErrorMessage(err), connectionState: redisClient?.status || "unknown" }
      })).catch(() => {});
    });

    redisClient.on("close", () => {
      isReady = false;
      redisWasUnavailable = true;
      logger.debug("[Redis] Redis connection closed");
    });
  } catch (err) {
    logger.warn({ err: sanitizeError(err) }, "[Redis] Failed to initialize Redis client, falling back to in-memory cache");
    redisClient = null;
    isReady = false;
  }
} else {
  logger.info("[Redis] REDIS_URL not configured — using local high-performance in-memory cache driver");
}

let subscriberClient = null;
let isSubscriberReady = false;

export const getRedisClient = () => (isReady ? redisClient : null);
export const isRedisConfigured = () => Boolean(REDIS_URL);
export const isRedisActive = () => isReady;

/**
 * Returns a dedicated Redis client instance strictly for subscribing (Pub/Sub).
 * In Redis, clients in subscriber mode cannot execute regular data commands (GET, SET, etc.).
 */
export const getRedisSubscriber = () => {
  if (!REDIS_URL && !subscriberClient) return null;
  if (!subscriberClient && redisClient) {
    try {
      subscriberClient = redisClient.duplicate();
      subscriberClient.on("connect", () => {
        logger.info("[Redis Sub] Connected dedicated subscriber to Redis server");
      });
      subscriberClient.on("ready", () => {
        isSubscriberReady = true;
        logger.info("[Redis Sub] Dedicated subscriber client is ready");
        unrefClientStream(subscriberClient);
      });
      subscriberClient.on("error", (err) => {
        isSubscriberReady = false;
        logger.warn({ err: sanitizeError(err) }, "[Redis Sub] Dedicated subscriber connection error");
      });
      subscriberClient.on("close", () => {
        isSubscriberReady = false;
        logger.debug("[Redis Sub] Dedicated subscriber connection closed");
      });
    } catch (err) {
      logger.warn({ err: sanitizeError(err) }, "[Redis Sub] Failed to create subscriber duplicate, falling back to local bus");
      subscriberClient = null;
      isSubscriberReady = false;
    }
  }
  return isSubscriberReady ? subscriberClient : subscriberClient;
};

export const isRedisSubscriberActive = () => isSubscriberReady;

export const _setRedisClientForTesting = (mock) => {
  redisClient = mock;
  isReady = Boolean(mock);
};

export const _setRedisSubscriberForTesting = (mock) => {
  subscriberClient = mock;
  isSubscriberReady = Boolean(mock);
};

export const closeRedis = async () => {
  if (subscriberClient) {
    try {
      subscriberClient.removeAllListeners("error");
      subscriberClient.on("error", () => {});
      if (typeof subscriberClient.disconnect === "function") {
        subscriberClient.disconnect(false);
      } else if (typeof subscriberClient.quit === "function") {
        await subscriberClient.quit();
      }
    } catch (_) {}
    subscriberClient = null;
    isSubscriberReady = false;
  }
  if (redisClient) {
    try {
      redisClient.removeAllListeners("error");
      redisClient.on("error", () => {});
      if (typeof redisClient.disconnect === "function") {
        redisClient.disconnect(false);
      } else if (typeof redisClient.quit === "function") {
        await redisClient.quit();
      }
    } catch (_) {}
    isReady = false;
  }
};

export { redisClient };
export default redisClient;

// Auto-teardown for Node test runner to prevent hanging background sockets
if (process.env.NODE_ENV === "test" || process.argv.some((a) => typeof a === "string" && a.includes(".test."))) {
  import("node:test")
    .then(({ after }) => {
      if (typeof after === "function") {
        after(async () => {
          await closeRedis();
        });
      }
    })
    .catch(() => {});
}
