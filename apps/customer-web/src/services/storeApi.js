import axios from "axios";
import API_URL from "../config/api.js";

const STORE_API = `${API_URL}/store`;

let nonce = typeof localStorage !== "undefined" ? localStorage.getItem("wc_nonce") || "" : "";
let cartToken = typeof localStorage !== "undefined" ? localStorage.getItem("wc_cart_token") || "" : "";

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
    try {
      localStorage.setItem("wc_nonce", nonce);
    } catch (_) {}
  }

  const hToken = getHeader(response.headers, "cart-token");
  if (hToken) {
    cartToken = hToken;
    try {
      localStorage.setItem("wc_cart_token", cartToken);
    } catch (_) {}
  }
};

export const clearCartSession = () => {
  nonce = "";
  cartToken = "";
  try {
    localStorage.removeItem("wc_nonce");
    localStorage.removeItem("wc_cart_token");
  } catch (_) {}
};

// Create a dedicated Axios client for WooCommerce Store API
export const storeClient = axios.create({
  baseURL: STORE_API,
  withCredentials: true,
  timeout: 12000,
});

let initializingPromise = null;

export const ensureSessionNonce = async () => {
  if (nonce) return nonce;
  if (!initializingPromise) {
    initializingPromise = getCart()
      .catch(() => null)
      .finally(() => {
        initializingPromise = null;
      });
  }
  await initializingPromise;
  return nonce;
};

// Request Interceptor: attach active Nonce & Cart-Token headers
storeClient.interceptors.request.use(
  async (config) => {
    // Re-sync from localStorage if memory is empty
    if (!nonce && typeof localStorage !== "undefined") {
      nonce = localStorage.getItem("wc_nonce") || "";
    }
    if (!cartToken && typeof localStorage !== "undefined") {
      cartToken = localStorage.getItem("wc_cart_token") || "";
    }

    // WooCommerce Store API requires a valid Nonce for all mutations and checkout endpoints.
    // If nonce is completely missing, fetch the cart first to initialize session and acquire a nonce.
    const isMutation = config.method && config.method.toLowerCase() !== "get";
    const urlStr = config.url || "";
    const isCheckout = urlStr === "/checkout" || urlStr === `${STORE_API}/checkout` || urlStr.includes("/checkout");
    const isCartGet = urlStr === "/cart" || urlStr === `${STORE_API}/cart`;
    const needsNonce = (isMutation || isCheckout) && !isCartGet && !config._isInitializing;

    if (needsNonce && !nonce) {
      await ensureSessionNonce();
    }

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
    updateTokens(response);
    return response;
  },
  async (error) => {
    const config = error.config;
    if (!config) return Promise.reject(error);

    const isGetMethod =
      config.method && config.method.toLowerCase() === "get";

    // Auto-retry once on network/socket reset for GET requests
    if (
      !config._retry &&
      isGetMethod &&
      (error.message?.includes("Network Error") ||
        error.code === "ERR_NETWORK" ||
        error.code === "ECONNRESET")
    ) {
      config._retry = true;
      return storeClient(config);
    }

    // Auto-recover from 401 missing or expired nonce:
    // Fetch a fresh nonce via GET /cart and retry the original request once.
    const isNonceError =
      error.response?.status === 401 &&
      (error.response?.data?.code === "woocommerce_rest_missing_nonce" ||
        error.response?.data?.code === "woocommerce_rest_invalid_nonce" ||
        error.response?.data?.message?.toLowerCase()?.includes("nonce"));

    if (isNonceError && !config._nonceRetried && !config._isInitializing) {
      config._nonceRetried = true;
      try {
        await getCart();
        if (nonce) {
          config.headers = config.headers || {};
          config.headers["Nonce"] = nonce;
        }
        if (cartToken) {
          config.headers = config.headers || {};
          config.headers["Cart-Token"] = cartToken;
        }
        return storeClient(config);
      } catch (refreshErr) {
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export const getCart = async () => {
  const response = await storeClient.get("/cart", {
    _isInitializing: true,
  });
  return response.data;
};

export const addToCart = async (id, quantity = 1) => {
  const response = await storeClient.post("/cart/add-item", {
    id,
    quantity,
  });
  return response.data;
};

export const updateCartItem = async (key, quantity) => {
  const response = await storeClient.post("/cart/update-item", {
    key,
    quantity,
  });
  return response.data;
};

export const removeCartItem = async (key) => {
  const response = await storeClient.post("/cart/remove-item", {
    key,
  });
  return response.data;
};

export const applyCoupon = async (code) => {
  const response = await storeClient.post("/cart/apply-coupon", {
    code,
  });
  return response.data;
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

