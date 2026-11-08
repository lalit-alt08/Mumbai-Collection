/**
 * TTL cache with local single-flight and versioned Redis entries. Invalidations
 * advance a two-tier shared epoch:
 * 1. Global generation (mumbai:cache:global_gen:v3): Bumped on clear() and Redis
 *    reconnect to safely invalidate all entries across all namespaces without hardcoding.
 * 2. Namespace generation (mumbai:cache:ns_gen:v3:<ns>): Bumped on targeted invalidation
 *    (e.g. invalidatePrefix("catalog:")) so catalog updates do not touch unrelated
 *    caches (orders, employee, reviews, admin, etc.).
 */
import { getRedisClient, getRedisSubscriber, isRedisConfigured, isRedisActive } from "../config/redis.js";
import { logger } from "./logger.js";
import { randomUUID } from "node:crypto";

const CHANNEL = "mumbai:cache:invalidate:v3";
const GLOBAL_GEN_KEY = "mumbai:cache:global_gen:v3";

const getNamespace = (str = "") => {
  if (!str) return "global";
  const idx = str.indexOf(":");
  return idx > 0 ? str.slice(0, idx).toLowerCase() : (str.toLowerCase() || "global");
};

const getNsGenKey = (namespace) => `mumbai:cache:ns_gen:v3:${namespace}`;

const getRedisGenerations = async (redis, ns) => {
  if (!redis) return ["0", "0"];
  const [globalGen, nsGen] = await redis.mget(GLOBAL_GEN_KEY, getNsGenKey(ns));
  return [globalGen || "0", nsGen || "0"];
};

const makeRedisKey = (globalGen, ns, nsGen, key) =>
  `mumbai:cache:v3:g${globalGen}:${ns}:n${nsGen}:${key}`;

export class InvalidationBatch {
  constructor(cache) {
    this.cache = cache;
    this.operations = [];
    this.errors = [];
    this.settled = false;
  }

  delete(key) {
    this.cache._invalidate("key", key, this);
    return this;
  }

  invalidatePrefix(prefix) {
    this.cache._invalidate("prefix", prefix, this);
    return this;
  }

  clear() {
    this.cache._invalidate("clear", "", this);
    return this;
  }

  async flush() {
    if (this.settled) {
      throw new Error("InvalidationBatch has already been flushed");
    }
    this.settled = true;
    await Promise.all(this.operations.map((p) => p.catch(() => {})));

    const redisConfigured = isRedisConfigured();
    const redisActive = isRedisActive();

    if (this.errors.length > 0) {
      const firstError = this.errors[0];
      const count = this.errors.length;
      const err = new Error(
        `Distributed cache invalidation failed for ${count} operation(s): ${firstError.message}`
      );
      err.cause = firstError;
      err.localInvalidated = true;
      err.distributedInvalidated = false;
      err.degraded = true;
      throw err;
    }

    return {
      localInvalidated: true,
      distributedInvalidated: redisConfigured && redisActive,
      degraded: false,
    };
  }
}

export class MemoryCache {
  constructor({
    defaultTtlMs = 60000,
    maxSize = 1000,
    redisProvider = getRedisClient,
    subscriberProvider = getRedisSubscriber,
    redisConfiguredCheck = isRedisConfigured,
    redisActiveCheck = isRedisActive,
    generationReader = getRedisGenerations,
  } = {}) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxSize = maxSize;
    this.redisProvider = redisProvider;
    this.redisConfiguredCheck = redisConfiguredCheck;
    this.redisActiveCheck = redisActiveCheck;
    this.generationReader = generationReader;
    this.store = new Map();
    this.inFlight = new Map();
    this.source = randomUUID();
    this.revision = 0;
    this.pendingInvalidations = Promise.resolve();
    this.pendingInvalidationErrors = [];

    const sub = subscriberProvider();
    if (sub) {
      const subscribe = async () => {
        try {
          await sub.subscribe(CHANNEL);
          sub.on("message", (channel, message) => {
            if (channel !== CHANNEL) return;
            try {
              const { source, type, value } = JSON.parse(message);
              if (source === this.source) return;
              this._invalidateLocal(type, value);
            } catch (err) {
              logger.warn({ err: err.message }, "Error processing cache invalidation message");
            }
          });
        } catch (err) {
          logger.warn({ err: err.message }, "Cache subscription unavailable");
        }
      };
      sub.on("ready", subscribe);
      if (sub.status === "ready") void subscribe();
    }
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) if (entry.expiresAt <= now) this.store.delete(key);
    }, 30000).unref();
  }

  _invalidateLocal(type, value) {
    this.revision++;
    for (const key of new Set([...this.store.keys(), ...this.inFlight.keys()])) {
      if (type === "clear" || (type === "key" ? key === value : key.startsWith(value))) {
        this.store.delete(key);
        this.inFlight.delete(key);
      }
    }
  }

  _putLocal(key, value, ttlMs) {
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    const capturedRevision = this.revision;
    this._putLocal(key, value, ttlMs);
    const redis = this.redisProvider();
    if (redis && value !== undefined) {
      const ns = getNamespace(key);
      void (async () => {
        try {
          const [globalGen, nsGen] = await this.generationReader(redis, ns);
          if (this.revision !== capturedRevision) return;
          const [checkGlobal, checkNs] = await this.generationReader(redis, ns);
          if (checkGlobal !== globalGen || checkNs !== nsGen || this.revision !== capturedRevision) {
            return;
          }
          await redis.psetex(makeRedisKey(globalGen, ns, nsGen, key), ttlMs, JSON.stringify(value));
        } catch (_) {}
      })();
    }
  }

  async createFence(key) {
    const revision = this.revision;
    const redis = this.redisProvider();
    let globalGen = null;
    let nsGen = null;
    if (redis) {
      try {
        const ns = getNamespace(key);
        [globalGen, nsGen] = await this.generationReader(redis, ns);
      } catch (_) {}
    }
    return { revision, globalGen, nsGen, key };
  }

  async setFenced(key, value, ttlMs = this.defaultTtlMs, fence) {
    if (!fence || fence.revision !== this.revision) {
      return false;
    }
    const redis = this.redisProvider();
    if (redis && value !== undefined) {
      try {
        const ns = getNamespace(key);
        const [currentGlobal, currentNs] = await this.generationReader(redis, ns);
        // Reject if Redis generations advanced or local revision changed while fetching
        if (
          fence.globalGen !== null &&
          (currentGlobal !== fence.globalGen || currentNs !== fence.nsGen)
        ) {
          return false;
        }
        if (fence.revision !== this.revision) {
          return false;
        }
        this._putLocal(key, value, ttlMs);
        await redis.psetex(
          makeRedisKey(currentGlobal, ns, currentNs, key),
          ttlMs,
          JSON.stringify(value)
        );
        return true;
      } catch (err) {
        logger.debug({ err: err.message }, "setFenced Redis write unavailable");
      }
    }
    if (fence.revision === this.revision) {
      this._putLocal(key, value, ttlMs);
      return true;
    }
    return false;
  }

  async getOrFetch(key, fetchFn, ttlMs = this.defaultTtlMs) {
    const local = this.get(key);
    if (local !== null) return local;

    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const ns = getNamespace(key);
    const redis = this.redisProvider();
    const revision = this.revision;
    let capturedGlobal = null;
    let capturedNs = null;

    const promise = (async () => {
      if (redis) {
        try {
          const [globalGen, nsGen] = await this.generationReader(redis, ns);
          capturedGlobal = globalGen;
          capturedNs = nsGen;
          const cached = await redis.get(makeRedisKey(globalGen, ns, nsGen, key));
          if (cached !== null) {
            const parsed = JSON.parse(cached);
            const [currentGlobal, currentNs] = await this.generationReader(redis, ns);
            // Redis generations can advance before this process receives Pub/Sub.
            // Recheck both the shared generations and local revision after every await
            // before restoring a Redis hit into RAM or returning it to the caller.
            if (
              revision === this.revision &&
              currentGlobal === globalGen &&
              currentNs === nsGen
            ) {
              this._putLocal(key, parsed, ttlMs);
              return parsed;
            }
            capturedGlobal = currentGlobal;
            capturedNs = currentNs;
          }
        } catch (err) { logger.debug({ err: err.message }, "Cache read unavailable"); }
      }
      const fetchRevision = this.revision;
      const result = await fetchFn();
      if (fetchRevision === this.revision && result !== undefined) {
        let generationsStable = true;
        let canWriteRedis = Boolean(redis && capturedGlobal !== null);
        let currentGlobal = capturedGlobal;
        let currentNs = capturedNs;
        if (canWriteRedis) {
          try {
            [currentGlobal, currentNs] = await this.generationReader(redis, ns);
            generationsStable = currentGlobal === capturedGlobal && currentNs === capturedNs;
          } catch (err) {
            // Preserve single-process availability during Redis outages, but do
            // not publish under generations that could not be verified.
            canWriteRedis = false;
            logger.debug({ err: err.message }, "Cache generation recheck unavailable");
          }
        }
        if (fetchRevision === this.revision && generationsStable) {
          this._putLocal(key, result, ttlMs);
          if (canWriteRedis && currentGlobal !== null) {
            void redis.psetex(makeRedisKey(currentGlobal, ns, currentNs, key), ttlMs, JSON.stringify(result)).catch(() => {});
          }
        }
      }
      return result;
    })();
    this.inFlight.set(key, promise);
    try { return await promise; }
    finally { if (this.inFlight.get(key) === promise) this.inFlight.delete(key); }
  }

  createInvalidationBatch() {
    return new InvalidationBatch(this);
  }

  _invalidate(type, value = "", batch = null) {
    this._invalidateLocal(type, value);

    const redisConfigured = this.redisConfiguredCheck();
    const redis = this.redisProvider();

    // 1. Single-process local development without Redis configured:
    // Local invalidation is sufficient; no cluster propagation expected.
    if (!redisConfigured) {
      return;
    }

    // 2. Redis is configured in environment, but disconnected or unavailable:
    // Record degradation so flushPendingInvalidations() reflects that cluster propagation failed.
    if (!redis || !this.redisActiveCheck()) {
      const degradedError = new Error("Redis is configured but unavailable; distributed cache invalidation degraded");
      degradedError.code = "REDIS_UNAVAILABLE";
      degradedError.degraded = true;
      if (batch) {
        batch.errors.push(degradedError);
      } else {
        this.pendingInvalidationErrors.push(degradedError);
      }
      return;
    }

    // 3. Redis is configured and active: perform generation bump and pub/sub broadcast.
    const task = (async () => {
      try {
        if (type === "clear") {
          // Bump the single global generation to invalidate all Redis entries across all namespaces
          await redis.incr(GLOBAL_GEN_KEY);
        } else {
          // Targeted invalidation bumps only this specific namespace generation
          const ns = getNamespace(value);
          await redis.incr(getNsGenKey(ns));
        }
        await redis.publish(CHANNEL, JSON.stringify({ source: this.source, type, value }));
      } catch (err) {
        if (batch) {
          batch.errors.push(err);
        } else {
          this.pendingInvalidationErrors.push(err);
        }
        logger.warn({ err: err.message }, "Shared cache invalidation unavailable; TTL fallback active");
        throw err;
      }
    })();

    if (batch) {
      batch.operations.push(task);
    } else {
      this.pendingInvalidations = this.pendingInvalidations
        .catch(() => {})
        .then(() => task)
        .catch(() => {});
    }
  }

  delete(key, batch = null) {
    const existed = this.store.has(key);
    this._invalidate("key", key, batch);
    return existed;
  }

  invalidatePrefix(prefix, batch = null) {
    this._invalidate("prefix", prefix, batch);
  }

  clear(batch = null) {
    this.inFlight.clear();
    this.store.clear();
    if (!batch) {
      this.pendingInvalidationErrors = [];
    }
    this._invalidate("clear", "", batch);
  }

  async flushPendingInvalidations() {
    await this.pendingInvalidations;
    const redisConfigured = isRedisConfigured();
    const redisActive = isRedisActive();

    if (this.pendingInvalidationErrors.length > 0) {
      const firstError = this.pendingInvalidationErrors[0];
      const count = this.pendingInvalidationErrors.length;
      this.pendingInvalidationErrors = [];
      const err = new Error(
        `Distributed cache invalidation failed for ${count} operation(s): ${firstError.message}`
      );
      err.cause = firstError;
      err.localInvalidated = true;
      err.distributedInvalidated = false;
      err.degraded = true;
      throw err;
    }

    return {
      localInvalidated: true,
      distributedInvalidated: redisConfigured && redisActive,
      degraded: false,
    };
  }
}

export const serverCache = new MemoryCache({ defaultTtlMs: 60000, maxSize: 500 });
