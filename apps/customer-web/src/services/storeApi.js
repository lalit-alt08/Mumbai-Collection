import axios from "axios";

const STORE_API = import.meta.env.VITE_STORE_API_URL || "/api/store";

let nonce = localStorage.getItem("wc_nonce") || "";
let cartToken = localStorage.getItem("wc_cart_token") || "";

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
const storeClient = axios.create({
  baseURL: STORE_API,
  withCredentials: true,
});

// Request Interceptor: attach active Nonce & Cart-Token headers
storeClient.interceptors.request.use(
  async (config) => {
    // Re-sync from localStorage if memory is empty
    if (!nonce) {
      nonce = localStorage.getItem("wc_nonce") || "";
    }
    if (!cartToken) {
      cartToken = localStorage.getItem("wc_cart_token") || "";
    }

    // For non-GET requests (mutations like add-item, update-item), WooCommerce requires a valid Nonce.
    // If nonce is completely missing, fetch the cart first to initialize session and acquire a nonce.
    const isMutation = config.method && config.method.toLowerCase() !== "get";
    const isCartGet = config.url === "/cart" || config.url === `${STORE_API}/cart`;

    if (isMutation && !nonce && !isCartGet && !config._isInitializing) {
      try {
        await getCart();
      } catch (_) {}
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

    // Auto-recover from 401 missing or expired nonce on mutations:
    // Fetch a fresh nonce via GET /cart and retry the original mutation once.
    const isNonceError =
      error.response?.status === 401 &&
      (error.response?.data?.code === "woocommerce_rest_missing_nonce" ||
        error.response?.data?.code === "woocommerce_rest_invalid_nonce" ||
        error.response?.data?.message?.toLowerCase()?.includes("nonce"));

    if (isNonceError && !config._nonceRetried) {
      config._nonceRetried = true;
      try {
        const freshCart = await getCart();
        if (nonce) {
          config.headers["Nonce"] = nonce;
        }
        if (cartToken) {
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

export const updateCheckout = async (checkoutData) => {
  const response = await storeClient.post("/checkout", checkoutData);
  return response.data;
};
