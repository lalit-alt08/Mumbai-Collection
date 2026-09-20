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

const hasLocalStorage = isStorageAvailable("localStorage");
const hasSessionStorage = isStorageAvailable("sessionStorage");

export const safeStorage = {
  getItem(key) {
    try {
      if (hasLocalStorage && typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (_) {}
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  },

  setItem(key, value) {
    const stringValue = String(value);
    try {
      if (hasLocalStorage && typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, stringValue);
        return;
      }
    } catch (_) {}
    memoryStore.set(key, stringValue);
  },

  removeItem(key) {
    try {
      if (hasLocalStorage && typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (_) {}
    memoryStore.delete(key);
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
      if (hasSessionStorage && typeof window !== "undefined" && window.sessionStorage) {
        return window.sessionStorage.getItem(key);
      }
    } catch (_) {}
    return sessionMemoryStore.has(key) ? sessionMemoryStore.get(key) : null;
  },

  setItem(key, value) {
    const stringValue = String(value);
    try {
      if (hasSessionStorage && typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.setItem(key, stringValue);
        return;
      }
    } catch (_) {}
    sessionMemoryStore.set(key, stringValue);
  },

  removeItem(key) {
    try {
      if (hasSessionStorage && typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.removeItem(key);
      }
    } catch (_) {}
    sessionMemoryStore.delete(key);
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
