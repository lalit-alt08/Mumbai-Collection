/**
 * Safe Browser Storage Utility
 * Provides defensive wrappers around localStorage and sessionStorage with
 * in-memory fallback to prevent crashes in private browsing mode, disabled cookies,
 * or quota-exceeded situations.
 */

const memoryStore = new Map();
const sessionMemoryStore = new Map();

function isStorageAvailable(type) {
  try {
    if (typeof window === "undefined") return false;
    const storage = window[type];
    if (!storage) return false;
    const testKey = "__mc_test_storage__";
    storage.setItem(testKey, testKey);
    storage.removeItem(testKey);
    return true;
  } catch (_) {
    return false;
  }
}

export const safeStorage = {
  getItem(key) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (_) {}
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  },

  setItem(key, value) {
    const stringValue = String(value);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, stringValue);
        return;
      }
    } catch (_) {}
    memoryStore.set(key, stringValue);
  },

  removeItem(key) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (_) {}
    memoryStore.delete(key);
  },

  removeByPrefix(prefix) {
    if (!prefix || typeof prefix !== "string") return;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const keys = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(prefix)) {
            keys.push(k);
          }
        }
        keys.forEach((k) => window.localStorage.removeItem(k));
      }
    } catch (_) {}
    for (const key of Array.from(memoryStore.keys())) {
      if (key && key.startsWith(prefix)) {
        memoryStore.delete(key);
      }
    }
  },

  getJSON(key, defaultValue = null) {
    const raw = this.getItem(key);
    if (raw === null || raw === undefined || raw === "") {
      return defaultValue;
    }
    try {
      return JSON.parse(raw);
    } catch (_) {
      return defaultValue;
    }
  },

  setJSON(key, value) {
    try {
      this.setItem(key, JSON.stringify(value));
    } catch (_) {}
  },
};

export const safeSessionStorage = {
  getItem(key) {
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        return window.sessionStorage.getItem(key);
      }
    } catch (_) {}
    return sessionMemoryStore.has(key) ? sessionMemoryStore.get(key) : null;
  },

  setItem(key, value) {
    const stringValue = String(value);
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.setItem(key, stringValue);
        return;
      }
    } catch (_) {}
    sessionMemoryStore.set(key, stringValue);
  },

  removeItem(key) {
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.removeItem(key);
      }
    } catch (_) {}
    sessionMemoryStore.delete(key);
  },

  removeByPrefix(prefix) {
    if (!prefix || typeof prefix !== "string") return;
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        const keys = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k && k.startsWith(prefix)) {
            keys.push(k);
          }
        }
        keys.forEach((k) => window.sessionStorage.removeItem(k));
      }
    } catch (_) {}
    for (const key of Array.from(sessionMemoryStore.keys())) {
      if (key && key.startsWith(prefix)) {
        sessionMemoryStore.delete(key);
      }
    }
  },

  getJSON(key, defaultValue = null) {
    const raw = this.getItem(key);
    if (raw === null || raw === undefined || raw === "") {
      return defaultValue;
    }
    try {
      return JSON.parse(raw);
    } catch (_) {
      return defaultValue;
    }
  },

  setJSON(key, value) {
    try {
      this.setItem(key, JSON.stringify(value));
    } catch (_) {}
  },
};

export default safeStorage;
