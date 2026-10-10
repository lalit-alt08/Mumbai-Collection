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
    this.generations = new Map(); // Tracks per-key generation to prevent stale writes

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
   * Discards stale writes if the key generation changed during the fetch.
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

    const currentGen = this.generations.get(key) || 0;

    const promise = (async () => {
      try {
        const result = await fetchFn();
        // Skip set() if the generation changed during the fetch (i.e. deleted/invalidated)
        if ((this.generations.get(key) || 0) === currentGen) {
          this.set(key, result, ttlMs);
        }
        return result;
      } finally {
        // Remove the in-flight entry only if it is still the one this call created
        if (this.inFlight.get(key) === promise) {
          this.inFlight.delete(key);
        }
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  delete(key) {
    this.generations.set(key, (this.generations.get(key) || 0) + 1);
    this.inFlight.delete(key);
    return this.store.delete(key);
  }

  clear() {
    for (const key of this.store.keys()) {
      this.generations.set(key, (this.generations.get(key) || 0) + 1);
    }
    for (const key of this.inFlight.keys()) {
      this.generations.set(key, (this.generations.get(key) || 0) + 1);
    }
    this.inFlight.clear();
    this.store.clear();
  }

  invalidatePrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.generations.set(key, (this.generations.get(key) || 0) + 1);
        this.store.delete(key);
      }
    }
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) {
        this.generations.set(key, (this.generations.get(key) || 0) + 1);
        this.inFlight.delete(key);
      }
    }
  }
}

export const serverCache = new MemoryCache({ defaultTtlMs: 60000, maxSize: 500 });
