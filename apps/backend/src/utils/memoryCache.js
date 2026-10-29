/**
 * TTL cache with local single-flight and versioned Redis entries. Invalidations
 * advance a shared epoch so an old write cannot resurrect invalidated data.
 */
import { getRedisClient, getRedisSubscriber } from "../config/redis.js";
import { logger } from "./logger.js";
import { randomUUID } from "node:crypto";

const CHANNEL = "mumbai:cache:invalidate:v2";
const EPOCH = "mumbai:cache:epoch:v2";

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
        try { await sub.subscribe(CHANNEL); }
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
      const epoch = await redis.get(EPOCH) || "0";
      if (revision === this.revision) await redis.psetex("cache:v2:" + epoch + ":" + key, ttlMs, JSON.stringify(data));
    })().catch((err) => logger.debug({ err: err.message }, "Cache write unavailable"));
  }

  async getOrFetch(key, fetchFn, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== null && cached !== undefined) return cached;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const revision = this.revision;
    const promise = (async () => {
      const redis = getRedisClient();
      let epoch = null;
      if (redis) {
        try {
          await this.pendingInvalidations;
          epoch = await redis.get(EPOCH) || "0";
          const value = await redis.get("cache:v2:" + epoch + ":" + key);
          if (value !== null) {
            const data = JSON.parse(value);
            if (revision === this.revision && epoch === (await redis.get(EPOCH) || "0")) this._putLocal(key, data, Math.min(ttlMs, 5000));
            else return fetchFn();
            return data;
          }
        } catch (err) { logger.debug({ err: err.message }, "Cache read unavailable"); }
      }
      const result = await fetchFn();
      if (revision === this.revision) {
        this._putLocal(key, result, ttlMs);
        if (redis && epoch !== null && result !== undefined) {
          // Keep the namespace observed before fetching: late writes remain unreachable.
          void redis.psetex("cache:v2:" + epoch + ":" + key, ttlMs, JSON.stringify(result)).catch(() => {});
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
      await redis.incr(EPOCH);
      await redis.publish(CHANNEL, JSON.stringify({ source: this.source, type, value }));
    }).catch((err) => logger.warn({ err: err.message }, "Shared cache invalidation unavailable; TTL fallback active"));
  }

  delete(key) { const existed = this.store.has(key); this._invalidate("key", key); return existed; }
  invalidatePrefix(prefix) { this._invalidate("prefix", prefix); }
  clear() { this._invalidate("clear"); }
}

export const serverCache = new MemoryCache({ defaultTtlMs: 60000, maxSize: 500 });
