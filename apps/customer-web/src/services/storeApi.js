
import axios from "axios";

const STORE_API =
  import.meta.env.VITE_STORE_API_URL ||
  (import.meta.env.VITE_WORDPRESS_URL
    ? `${import.meta.env.VITE_WORDPRESS_URL}/wp-json/wc/store/v1`
    : "/api/store");

let nonce = localStorage.getItem("wc_nonce") || "";
let cartToken = localStorage.getItem("wc_cart_token") || "";

const updateTokens = (response) => {
  if (response.headers["nonce"]) {
    nonce = response.headers["nonce"];
    localStorage.setItem("wc_nonce", nonce);
  }

  if (response.headers["cart-token"]) {
    cartToken = response.headers["cart-token"];
    localStorage.setItem("wc_cart_token", cartToken);
  }
};

export const clearCartSession = () => {
  nonce = "";
  cartToken = "";
  localStorage.removeItem("wc_nonce");
  localStorage.removeItem("wc_cart_token");
};

const authHeaders = () => ({
  Nonce: nonce,
  "Cart-Token": cartToken,
});

export const getCart = async () => {
  const response = await axios.get(`${STORE_API}/cart`, {
    withCredentials: true,
    headers: authHeaders(),
  });

  updateTokens(response);

  return response.data;
};

export const addToCart = async (id, quantity = 1) => {
  const response = await axios.post(
    `${STORE_API}/cart/add-item`,
    {
      id,
      quantity,
    },
    {
      withCredentials: true,
      headers: authHeaders(),
    }
  );

  updateTokens(response);

  return response.data;
};

export const updateCartItem = async (key, quantity) => {
  try {
    const response = await axios.post(
      `${STORE_API}/cart/update-item`,
      {
        key,
        quantity,
      },
      {
        withCredentials: true,
        headers: authHeaders(),
      }
    );

    updateTokens(response);

    return response.data;
  } catch (error) {
    console.log("UPDATE CART STATUS:", error.response?.status);
    console.log("UPDATE CART DATA:", error.response?.data);
    console.log("UPDATE CART KEY:", key);
    console.log("UPDATE CART QUANTITY:", quantity);

    throw error;
  }
};

export const removeCartItem = async (key) => {
  try {
    const response = await axios.post(
      `${STORE_API}/cart/remove-item`,
      {
        key,
      },
      {
        withCredentials: true,
        headers: authHeaders(),
      }
    );

    updateTokens(response);

    return response.data;
  } catch (error) {
    console.log("STATUS:", error.response?.status);
    console.log("DATA:", error.response?.data);

    throw error;
  }
};

export const applyCoupon = async (code) => {
  const response = await axios.post(
    `${STORE_API}/cart/apply-coupon`,
    {
      code,
    },
    {
      withCredentials: true,
      headers: authHeaders(),
    }
  );

  updateTokens(response);

  return response.data;
};

export const getCheckout = async () => {

  const response = await axios.get(`${STORE_API}/checkout`, {
    withCredentials: true,
    headers: authHeaders(),
  });

  updateTokens(response);

  return response.data;
};

export const updateCheckout = async (checkoutData) => {
  const response = await axios.post(
    `${STORE_API}/checkout`,
    checkoutData,
    {
      withCredentials: true,
      headers: authHeaders(),
    }
  );

  updateTokens(response);

  return response.data;
};

