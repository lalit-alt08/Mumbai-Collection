import axios from "axios";
import API_URL from "../config/api.js";
import safeStorage from "../utils/safeStorage.js";
import {
  shouldRetryReadRequest,
  getReadRetryDelayMs,
} from "../utils/resilientAxios.js";

const STORE_API = `${API_URL}/store`;

let nonce = safeStorage.getItem("wc_nonce") || "";
let cartToken = safeStorage.getItem("wc_cart_token") || "";
let cartSessionEpoch = 0;

const getHeader = (headers, key) => {
  if (!headers) return null;
  const lowerKey = key.toLowerCase();
  if (headers[lowerKey]) return headers[lowerKey];
  if (headers[key]) return headers[key];
  if (typeof headers.get === "function") {
    return headers.get(lowerKey) || headers.get(key);
  }
  return null;
};

const updateTokens = (response) => {
  if (!response?.headers) return;

  const hNonce = getHeader(response.headers, "nonce");
  if (hNonce) {
    nonce = hNonce;
    safeStorage.setItem("wc_nonce", nonce);
  }

  const hToken = getHeader(response.headers, "cart-token");
  if (hToken) {
    cartToken = hToken;
    safeStorage.setItem("wc_cart_token", cartToken);
  }
};

export const invalidateCartRequests = () => {
  cartSessionEpoch += 1;
};

const sessionTrackingMap = new Map();

const getSessionTracking = (epoch = cartSessionEpoch) => {
  let t = sessionTrackingMap.get(epoch);
  if (!t) {
    t = {
      totalWritesInitiated: 0,
      activeWritesCount: 0,
      latestCompletedWriteId: 0,
      latestTokenWriteId: 0,
    };
    sessionTrackingMap.set(epoch, t);
  }
  return t;
};

let cartWriteQueue = Promise.resolve();

const serializeCartWrite = (fn) => {
  // Capture the session when a write is queued
  const queuedEpoch = cartSessionEpoch;
  const result = cartWriteQueue.then(
    () => {
      // Check it again before sending
      if (queuedEpoch !== cartSessionEpoch) {
        throw new axios.CanceledError("Cart session changed while write was queued");
      }
      return fn(queuedEpoch);
    },
    () => {
      if (queuedEpoch !== cartSessionEpoch) {
        throw new axios.CanceledError("Cart session changed while write was queued");
      }
      return fn(queuedEpoch);
    }
  );
  cartWriteQueue = result.catch(() => {});
  return result;
};

export const getCartMutationVersion = () => getSessionTracking(cartSessionEpoch).latestCompletedWriteId;
export const isCartWriteInFlight = () => getSessionTracking(cartSessionEpoch).activeWritesCount > 0;
export const waitForCartWrites = () => cartWriteQueue;

export const clearCartSession = () => {
  invalidateCartRequests();
  const tracking = getSessionTracking(cartSessionEpoch);
  tracking.activeWritesCount = 0;
  cartWriteQueue = Promise.resolve();
  nonce = "";
  cartToken = "";
  safeStorage.removeItem("wc_nonce");
  safeStorage.removeItem("wc_cart_token");
};

// Create a dedicated Axios client for WooCommerce Store API
export const storeClient = axios.create({
  baseURL: STORE_API,
  withCredentials: true,
  timeout: 12000,
});

let cartInitialization;

const fetchCartResponse = () => storeClient.get("/cart", { _isInitializing: true });

const initializeCartSession = () => {
  const epoch = cartSessionEpoch;
  if (cartInitialization?.epoch === epoch) return cartInitialization.promise;

  const initialization = { epoch };
  initialization.promise = fetchCartResponse().finally(() => {
    if (cartInitialization === initialization) cartInitialization = undefined;
  });
  cartInitialization = initialization;
  return initialization.promise;
};

export const ensureSessionNonce = async () => {
  if (!nonce && !cartToken) {
    await initializeCartSession().catch(() => null);
  }
  return nonce;
};

// Request Interceptor: attach active Nonce & Cart-Token headers
storeClient.interceptors.request.use(
  async (config) => {
    if (config._cartSessionEpoch === undefined) config._cartSessionEpoch = cartSessionEpoch;
    if (config._cartSessionEpoch !== cartSessionEpoch) throw new axios.CanceledError("Cart session changed");
    // Re-sync from safeStorage if memory is empty
    if (!nonce) {
      nonce = safeStorage.getItem("wc_nonce") || "";
    }
    if (!cartToken) {
      cartToken = safeStorage.getItem("wc_cart_token") || "";
    }

    // Initialize cart credentials before a write or checkout if neither credential is available.
    const isMutation = config.method && config.method.toLowerCase() !== "get";
    const urlStr = config.url || "";
    const isCheckout = urlStr === "/checkout" || urlStr === `${STORE_API}/checkout` || urlStr.includes("/checkout");
    const isCartGet = urlStr === "/cart" || urlStr === `${STORE_API}/cart`;
    const needsCredentials = (isMutation || isCheckout) && !isCartGet && !config._isInitializing;

    if (needsCredentials && !nonce && !cartToken) {
      await ensureSessionNonce();
    }

    const tracking = getSessionTracking(config._cartSessionEpoch);
    if (isMutation) {
      tracking.totalWritesInitiated += 1;
      tracking.activeWritesCount += 1;
      config._writeId = tracking.totalWritesInitiated;
    } else {
      config._readStartWriteId = tracking.latestCompletedWriteId;
      config._hadActiveWritesAtStart = tracking.activeWritesCount > 0;
    }

    if (config._cartSessionEpoch !== cartSessionEpoch) throw new axios.CanceledError("Cart session changed");

    if (nonce) {
      config.headers["Nonce"] = nonce;
    }
    if (cartToken) {
      config.headers["Cart-Token"] = cartToken;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: extract tokens, retry network blips, auto-recover from missing/expired nonces
storeClient.interceptors.response.use(
  (response) => {
    const epoch = response.config?._cartSessionEpoch;
    if (epoch !== undefined) {
      const tracking = getSessionTracking(epoch);
      if (response.config?._writeId) {
        tracking.latestCompletedWriteId = Math.max(tracking.latestCompletedWriteId, response.config._writeId);
        tracking.activeWritesCount = Math.max(0, tracking.activeWritesCount - 1);
        if (epoch === cartSessionEpoch && response.config._writeId >= tracking.latestTokenWriteId) {
          tracking.latestTokenWriteId = response.config._writeId;
          updateTokens(response);
        }
      }
    }

    if (response.config?._cartSessionEpoch !== cartSessionEpoch && response.config?.method?.toLowerCase() !== "get") {
      throw new axios.CanceledError("Cart session changed");
    }

    if (response.config?._cartSessionEpoch === cartSessionEpoch) {
      const currentTracking = getSessionTracking(cartSessionEpoch);
      if (!response.config?._writeId && response.config?._readStartWriteId !== undefined) {
        // Reject reads that overlap a write and return an older snapshot
        const isStale =
          response.config._hadActiveWritesAtStart ||
          currentTracking.latestCompletedWriteId > response.config._readStartWriteId ||
          currentTracking.activeWritesCount > 0;

        if (isStale) {
          const staleErr = new Error("Cart read overlapped an active or newer cart write; discarding stale snapshot");
          staleErr.code = "ERR_STALE_CART_READ";
          staleErr.isStaleCartRead = true;
          staleErr.config = response.config;
          return Promise.reject(staleErr);
        }

        updateTokens(response);
      } else if (!response.config?._writeId) {
        updateTokens(response);
      }
    }
    return response;
  },
  async (error) => {
    const config = error.config;
    if (config?._writeId && config._cartSessionEpoch !== undefined) {
      const tracking = getSessionTracking(config._cartSessionEpoch);
      tracking.activeWritesCount = Math.max(0, tracking.activeWritesCount - 1);
    }
    if (!config) return Promise.reject(error);
    if (config._cartSessionEpoch !== cartSessionEpoch) return Promise.reject(error);

    // Cart/checkout writes can be applied even if their response is lost; only
    // retry safe reads automatically. An explicit nonce rejection is handled below.
    if (!config._retry && shouldRetryReadRequest(error, config)) {
      const delayMs = getReadRetryDelayMs(error);
      if (delayMs === null) return Promise.reject(error);
      config._retry = true;
      await new Promise((r) => setTimeout(r, delayMs));
      if (config._cartSessionEpoch !== cartSessionEpoch) throw new axios.CanceledError("Cart session changed");
      return storeClient(config);
    }

    // Auto-recover strictly from exact, known pre-mutation Store API nonce errors (401/403)
    const statusCode = error.response?.status;
    const errorCode = error.response?.data?.code;
    const isNonceError =
      (statusCode === 401 || statusCode === 403) &&
      (errorCode === "woocommerce_rest_invalid_nonce" ||
        errorCode === "woocommerce_rest_missing_nonce" ||
        errorCode === "woocommerce_rest_cookie_invalid_nonce");

    const rejectedNonce = getHeader(config.headers, "nonce");
    const rejectedToken = getHeader(config.headers, "cart-token");
    const clearRejectedNonce = () => {
      if (!rejectedNonce || nonce !== rejectedNonce) return;
      nonce = "";
      if (safeStorage.getItem("wc_nonce") === rejectedNonce) {
        safeStorage.removeItem("wc_nonce");
      }
    };
    if (isNonceError) clearRejectedNonce();

    if (isNonceError && !config._nonceRetried && !config._isInitializing) {
      config._nonceRetried = true;
      const hasFreshCredentials = (response) => {
        const newNonce = getHeader(response.headers, "nonce");
        const newToken = getHeader(response.headers, "cart-token");
        return (newNonce && newNonce !== rejectedNonce && newNonce === nonce) ||
          (newToken && newToken !== rejectedToken && newToken === cartToken);
      };

      try {
        updateTokens(error.response);
        clearRejectedNonce();
        let refreshed = error.response;
        if (!hasFreshCredentials(refreshed)) {
          refreshed = await initializeCartSession();
        }
        if (config._cartSessionEpoch !== cartSessionEpoch) throw new axios.CanceledError("Cart session changed");
        clearRejectedNonce();
        if (!hasFreshCredentials(refreshed)) return Promise.reject(error);
        config.headers.delete("Nonce");
        config.headers.delete("Cart-Token");
        return storeClient(config);
      } catch (refreshErr) {
        if (axios.isCancel(refreshErr)) throw refreshErr;
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export const getCart = async () => {
  const response = await storeClient.get("/cart");
  return response.data;
};

export const getStoreProductById = async (id) => {
  const response = await storeClient.get(`/products/${id}`);
  return response.data;
};

export const addToCart = (id, quantity = 1, variation = []) => {
  return serializeCartWrite(async (queuedEpoch) => {
    const payload = {
      id,
      quantity,
    };
    if (Array.isArray(variation) && variation.length > 0) {
      payload.variation = variation;
    }
    const response = await storeClient.post("/cart/add-item", payload, {
      _cartSessionEpoch: queuedEpoch,
    });
    return response.data;
  });
};

export const updateCartItem = (key, quantity) => {
  return serializeCartWrite(async (queuedEpoch) => {
    const response = await storeClient.post(
      "/cart/update-item",
      {
        key,
        quantity,
      },
      {
        _cartSessionEpoch: queuedEpoch,
      }
    );
    return response.data;
  });
};

export const removeCartItem = (key) => {
  return serializeCartWrite(async (queuedEpoch) => {
    const response = await storeClient.post(
      "/cart/remove-item",
      {
        key,
      },
      {
        _cartSessionEpoch: queuedEpoch,
      }
    );
    return response.data;
  });
};

export const applyCoupon = (code) => {
  return serializeCartWrite(async (queuedEpoch) => {
    const response = await storeClient.post(
      "/cart/apply-coupon",
      {
        code,
      },
      {
        _cartSessionEpoch: queuedEpoch,
      }
    );
    return response.data;
  });
};

export const updateCartCustomer = (billingAddress, shippingAddress) => {
  return serializeCartWrite(async (queuedEpoch) => {
    const response = await storeClient.post(
      "/cart/update-customer",
      {
        billing_address: billingAddress,
        shipping_address: shippingAddress,
      },
      {
        _cartSessionEpoch: queuedEpoch,
      }
    );
    return response.data;
  });
};

export const getCheckout = async () => {
  const response = await storeClient.get("/checkout");
  return response.data;
};

export const updateCheckout = async (checkoutData, config = {}) => {
  const response = await storeClient.post("/checkout", checkoutData, config);
  return response.data;
};

export const getStoreHours = async () => {
  const response = await axios.get(`${API_URL}/store-hours`, {
    withCredentials: true,
  });
  return response.data;
};

