/**
 * Hybrid L1 (In-Memory) + L2 (Redis) TTL Cache with Request Coalescing (Single-Flight)
 * 
 * - L1: In-Memory Map (0ms access latency on local Node process)
 * - L2: Redis (Distributed, shared across all clustered PM2/Docker instances)
 * - Single-Flight deduplication: Coalesces concurrent cold requests to protect upstream database
 * - Zero Setup Fallback: Operates flawlessly in pure in-memory mode when REDIS_URL is not set
 */
import { getRedisClient } from "../config/redis.js";
import { logger } from "./logger.js";

class MemoryCache {
  constructor({ defaultTtlMs = 60000, maxSize = 1000 } = {}) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxSize = maxSize;
    this.store = new Map();
    this.inFlight = new Map(); // Tracks concurrent in-flight Promises
    this.generations = new Map(); // Tracks per-key generation to prevent stale writes

    // Periodic cleanup of expired entries in L1 memory every 30 seconds
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (now > entry.expiresAt) {
          this.store.delete(key);
        }
      }
      for (const key of this.generations.keys()) {
        if (!this.inFlight.has(key)) {
          this.generations.delete(key);
        }
      }
    }, 30000).unref();
  }

  _bumpGeneration(key) {
    if (this.generations.size >= this.maxSize) {
      const firstKey = this.generations.keys().next().value;
      if (firstKey) this.generations.delete(firstKey);
    }
    this.generations.set(key, (this.generations.get(key) || 0) + 1);
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.data;
  }

  set(key, data, ttlMs = this.defaultTtlMs) {
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }

    // 1. Update L1 In-Memory Cache
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });

    // 2. Synchronize with L2 Redis if available (fire-and-forget async)
    const redis = getRedisClient();
    if (redis && data !== undefined) {
      try {
        const payload = JSON.stringify(data);
        redis.psetex(key, ttlMs, payload).catch((err) => {
          logger.debug({ key, err: err?.message }, "[Cache] Failed to write key to Redis");
        });
      } catch (_) {
        // Serialization error guard
      }
    }
  }

  /**
   * Request Coalescing (Single-Flight) Fetcher with L1/L2 Redis Read-Through
   * Checks L1 (RAM) -> L2 (Redis) -> Upstream fetchFn().
   */
  async getOrFetch(key, fetchFn, ttlMs = this.defaultTtlMs) {
    // 1. Fast L1 In-Memory Hit
    const cached = this.get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    // 2. Coalescing guard: If an identical request is currently in-flight on this process, await it
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const currentGen = this.generations.get(key) || 0;

    const promise = (async () => {
      try {
        // 3. Check L2 Redis if active
        const redis = getRedisClient();
        if (redis) {
          try {
            const redisVal = await redis.get(key);
            if (redisVal !== null && redisVal !== undefined) {
              const parsed = JSON.parse(redisVal);
              // Populate local L1 memory cache with a portion of TTL
              this.store.set(key, {
                data: parsed,
                expiresAt: Date.now() + Math.min(ttlMs, 30000),
              });
              return parsed;
            }
          } catch (redisErr) {
            logger.debug({ key, err: redisErr?.message }, "[Cache] Redis read blip, proceeding to fetchFn");
          }
        }

        // 4. Cache Miss on L1 & L2: Execute authoritative fetch function
        const result = await fetchFn();

        // Skip set() if the generation changed during the fetch (i.e. deleted/invalidated)
        if ((this.generations.get(key) || 0) === currentGen) {
          this.set(key, result, ttlMs);
        }
        return result;
      } finally {
        if (this.inFlight.get(key) === promise) {
          this.inFlight.delete(key);
        }
        if (!this.inFlight.has(key)) {
          this.generations.delete(key);
        }
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  delete(key) {
    if (this.inFlight.has(key)) {
      this._bumpGeneration(key);
      this.inFlight.delete(key);
    } else {
      this.generations.delete(key);
    }

    const deletedFromL1 = this.store.delete(key);

    const redis = getRedisClient();
    if (redis) {
      redis.del(key).catch((err) => {
        logger.debug({ key, err: err?.message }, "[Cache] Failed to delete key from Redis");
      });
    }

    return deletedFromL1;
  }

  clear() {
    this.inFlight.clear();
    this.store.clear();
    this.generations.clear();
  }

  invalidatePrefix(prefix) {
    // 1. Invalidate L1 In-Memory keys
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        if (this.inFlight.has(key)) {
          this._bumpGeneration(key);
          this.inFlight.delete(key);
        } else {
          this.generations.delete(key);
        }
        this.store.delete(key);
      }
    }
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) {
        this._bumpGeneration(key);
        this.inFlight.delete(key);
      }
    }

    // 2. Invalidate L2 Redis keys matching prefix using non-blocking SCAN
    const redis = getRedisClient();
    if (redis) {
      (async () => {
        try {
          const stream = redis.scanStream({ match: `${prefix}*`, count: 100 });
          stream.on("data", (keys) => {
            if (keys.length) {
              const pipeline = redis.pipeline();
              keys.forEach((k) => pipeline.del(k));
              pipeline.exec().catch(() => {});
            }
          });
          stream.on("error", () => {});
        } catch (err) {
          logger.debug({ prefix, err: err?.message }, "[Cache] Failed to scan and delete Redis prefix");
        }
      })();
    }
  }
}

export const serverCache = new MemoryCache({ defaultTtlMs: 60000, maxSize: 500 });
