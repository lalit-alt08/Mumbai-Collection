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

    // Periodic cleanup of expired entries and stale generation metadata every 30 seconds
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
        // Clean up generation metadata once in-flight request settles
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
    return this.store.delete(key);
  }

  clear() {
    this.inFlight.clear();
    this.store.clear();
    this.generations.clear();
  }

  invalidatePrefix(prefix) {
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
  }
}

export const serverCache = new MemoryCache({ defaultTtlMs: 60000, maxSize: 500 });
