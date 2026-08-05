import axios from "axios";

const STORE_API = "/api/store";

let nonce = "";
let cartToken = "";

const updateTokens = (response) => {
  if (response.headers["nonce"]) {
    nonce = response.headers["nonce"];
  }

  if (response.headers["cart-token"]) {
    cartToken = response.headers["cart-token"];
  }
};

export const getCart = async () => {
  const response = await axios.get(`${STORE_API}/cart`, {
    withCredentials: true,
    headers: {
      Nonce: nonce,
      "Cart-Token": cartToken,
    },
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
      headers: {
        Nonce: nonce,
        "Cart-Token": cartToken,
      },
    }
  );

  updateTokens(response);

  return response.data;
};

export const updateCartItem = async (key, quantity) => {
  const response = await axios.post(
    `${STORE_API}/cart/update-item`,
    {
      key,
      quantity,
    },
    {
      withCredentials: true,
      headers: {
        Nonce: nonce,
        "Cart-Token": cartToken,
      },
    }
  );

  updateTokens(response);

  return response.data;
};

export const removeCartItem = async (key) => {
  const response = await axios.post(
    `${STORE_API}/cart/remove-item`,
    {
      key,
    },
    {
      withCredentials: true,
      headers: {
        Nonce: nonce,
        "Cart-Token": cartToken,
      },
    }
  );

  updateTokens(response);

  return response.data;
};

export const applyCoupon = async (code) => {
  const response = await axios.post(
    `${STORE_API}/cart/apply-coupon`,
    {
      code,
    },
    {
      withCredentials: true,
      headers: {
        Nonce: nonce,
        "Cart-Token": cartToken,
      },
    }
  );

  updateTokens(response);

  return response.data;
};