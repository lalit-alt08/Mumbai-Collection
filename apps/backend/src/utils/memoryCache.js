/**
 * Lightweight In-Memory TTL Cache Utility with Request Coalescing (Single-Flight)
 * Prevents cache stampedes (thundering herds) by coalescing concurrent in-flight requests.
 */
class MemoryCache {
  constructor({ defaultTtlMs = 60000, maxSize = 1000 } = {}) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxSize = maxSize;
    this.store = new Map();
    this.inFlight = new Map(); // Tracks concurrent in-flight Promises

    // Periodic cleanup of expired entries every 30 seconds
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (now > entry.expiresAt) {
          this.store.delete(key);
        }
      }
    }, 30000).unref();
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

    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Request Coalescing (Single-Flight) Fetcher
   * If multiple concurrent requests ask for the same cold cache key,
   * only ONE executes fetchFn; all other requests await the same Promise.
   */
  async getOrFetch(key, fetchFn, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    // If an identical request is currently in-flight, await its Promise
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        const result = await fetchFn();
        this.set(key, result, ttlMs);
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  delete(key) {
    this.inFlight.delete(key);
    return this.store.delete(key);
  }

  clear() {
    this.inFlight.clear();
    this.store.clear();
  }

  invalidatePrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) {
        this.inFlight.delete(key);
      }
    }
  }
}

export const serverCache = new MemoryCache({ defaultTtlMs: 60000, maxSize: 500 });
