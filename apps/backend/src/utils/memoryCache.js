/**
 * TTL cache with local single-flight and versioned Redis entries. Invalidations
 * advance a two-tier shared epoch:
 * 1. Global generation (mumbai:cache:global_gen:v3): Bumped on clear() and Redis
 *    reconnect to safely invalidate all entries across all namespaces without hardcoding.
 * 2. Namespace generation (mumbai:cache:ns_gen:v3:<ns>): Bumped on targeted invalidation
 *    (e.g. invalidatePrefix("catalog:")) so catalog updates do not touch unrelated
 *    caches (orders, employee, reviews, admin, etc.).
 */
import { getRedisClient, getRedisSubscriber } from "../config/redis.js";
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
  `cache:v3:${globalGen}:${ns}:${nsGen}:${key}`;

export class MemoryCache {
  constructor({ defaultTtlMs = 60000, maxSize = 1000 } = {}) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxSize = maxSize;
    this.store = new Map();
    this.inFlight = new Map();
    this.revision = 0;
    this.source = randomUUID();
    this.pendingInvalidations = Promise.resolve();
    const sub = getRedisSubscriber();
    if (sub) {
      sub.on("message", (channel, raw) => {
        if (channel !== CHANNEL) return;
        try {
          const event = JSON.parse(raw);
          if (event.source !== this.source) this._invalidateLocal(event.type, event.value);
        } catch { /* Ignore malformed messages. */ }
      });
      const subscribe = async () => {
        this._invalidateLocal("clear");
        try {
          await sub.subscribe(CHANNEL);
          const redis = getRedisClient();
          if (redis) {
            // Advancing the single global generation cleanly invalidates ALL Redis
            // namespaces after an outage/reconnect without hardcoding namespace names.
            await redis.incr(GLOBAL_GEN_KEY).catch(() => {});
          }
        }
        catch (err) { logger.warn({ err: err.message }, "Cache subscription unavailable"); }
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

  _putLocal(key, data, ttlMs) {
    if (!this.store.has(key) && this.store.size >= this.maxSize) this.store.delete(this.store.keys().next().value);
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) { this.store.delete(key); return null; }
    return entry.data;
  }

  set(key, data, ttlMs = this.defaultTtlMs) {
    this._putLocal(key, data, ttlMs);
    const revision = this.revision;
    const redis = getRedisClient();
    if (redis && data !== undefined) void (async () => {
      await this.pendingInvalidations;
      const ns = getNamespace(key);
      const [globalGen, nsGen] = await getRedisGenerations(redis, ns);
      if (revision === this.revision) {
        await redis.psetex(makeRedisKey(globalGen, ns, nsGen, key), ttlMs, JSON.stringify(data));
      }
    })().catch((err) => logger.debug({ err: err.message }, "Cache write unavailable"));
  }

  async getOrFetch(key, fetchFn, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== null && cached !== undefined) return cached;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const revision = this.revision;
    const ns = getNamespace(key);

    const promise = (async () => {
      const redis = getRedisClient();
      let capturedGlobal = null;
      let capturedNs = null;
      if (redis) {
        try {
          await this.pendingInvalidations;
          const [globalGen, nsGen] = await getRedisGenerations(redis, ns);
          capturedGlobal = globalGen;
          capturedNs = nsGen;
          const redisKey = makeRedisKey(globalGen, ns, nsGen, key);
          const value = await redis.get(redisKey);
          if (value !== null) {
            const data = JSON.parse(value);
            const [currentGlobal, currentNs] = await getRedisGenerations(redis, ns);
            if (revision === this.revision && currentGlobal === capturedGlobal && currentNs === capturedNs) {
              this._putLocal(key, data, Math.min(ttlMs, 5000));
            } else {
              return fetchFn();
            }
            return data;
          }
        } catch (err) { logger.debug({ err: err.message }, "Cache read unavailable"); }
      }
      const result = await fetchFn();
      if (revision === this.revision) {
        this._putLocal(key, result, ttlMs);
        if (redis && capturedGlobal !== null && result !== undefined) {
          const [currentGlobal, currentNs] = await getRedisGenerations(redis, ns);
          if (currentGlobal === capturedGlobal && currentNs === capturedNs) {
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

  _invalidate(type, value = "") {
    this._invalidateLocal(type, value);
    const redis = getRedisClient();
    if (!redis) return;
    this.pendingInvalidations = this.pendingInvalidations.then(async () => {
      if (type === "clear") {
        // Bump the single global generation to invalidate all Redis entries across all namespaces
        await redis.incr(GLOBAL_GEN_KEY).catch(() => {});
      } else {
        // Targeted invalidation bumps only this specific namespace generation
        const ns = getNamespace(value);
        await redis.incr(getNsGenKey(ns)).catch(() => {});
      }
      await redis.publish(CHANNEL, JSON.stringify({ source: this.source, type, value }));
    }).catch((err) => logger.warn({ err: err.message }, "Shared cache invalidation unavailable; TTL fallback active"));
  }

  delete(key) { const existed = this.store.has(key); this._invalidate("key", key); return existed; }
  invalidatePrefix(prefix) { this._invalidate("prefix", prefix); }
  clear() { this._invalidate("clear"); }
}

export const serverCache = new MemoryCache({ defaultTtlMs: 60000, maxSize: 500 });
