import test from "node:test";
import assert from "node:assert/strict";
import { addToCart, storeClient, clearCartSession, updateCartItem } from "../src/services/storeApi.js";
import safeStorage from "../src/utils/safeStorage.js";

test("a rejected cart add retries exactly once with a replacement cart token and no stale nonce", async () => {
  clearCartSession();
  safeStorage.setItem("wc_nonce", "old-nonce");
  safeStorage.setItem("wc_cart_token", "old-cart");
  const originalAdapter = storeClient.defaults.adapter;
  const writes = [];

  try {
    storeClient.defaults.adapter = async (config) => {
      assert.equal(config.url, "/cart/add-item");
      writes.push([config.headers.get("Nonce"), config.headers.get("Cart-Token")]);
      if (writes.length === 1) {
        throw Object.assign(new Error("Invalid nonce"), {
          config,
          response: {
            status: 403,
            data: { code: "woocommerce_rest_invalid_nonce" },
            headers: { "cart-token": "current-cart" },
          },
        });
      }
      return { status: 200, data: { items: [{ id: 1, quantity: 1 }] }, headers: {}, config };
    };

    const cart = await addToCart(1);
    assert.deepEqual(writes, [["old-nonce", "old-cart"], [undefined, "current-cart"]]);
    assert.equal(cart.items[0].quantity, 1);
  } finally {
    storeClient.defaults.adapter = originalAdapter;
    clearCartSession();
  }
});

test("cart recovery stops when the refresh only echoes the rejected credentials", async () => {
  clearCartSession();
  safeStorage.setItem("wc_nonce", "old-nonce");
  safeStorage.setItem("wc_cart_token", "old-cart");
  const originalAdapter = storeClient.defaults.adapter;
  const requests = [];

  try {
    storeClient.defaults.adapter = async (config) => {
      requests.push(config.url);
      if (config.url === "/cart") {
        return { status: 200, data: {}, headers: { nonce: "old-nonce", "cart-token": "old-cart" }, config };
      }
      throw Object.assign(new Error("Invalid nonce"), {
        config,
        response: { status: 403, data: { code: "woocommerce_rest_invalid_nonce" }, headers: {} },
      });
    };

    await assert.rejects(addToCart(1), /Invalid nonce/);
    assert.deepEqual(requests, ["/cart/add-item", "/cart"]);
    assert.equal(safeStorage.getItem("wc_nonce"), null);
  } finally {
    storeClient.defaults.adapter = originalAdapter;
    clearCartSession();
  }
});

test("a late response from an old cart session cannot restore its token", async () => {
  clearCartSession();
  const originalAdapter = storeClient.defaults.adapter;
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  try {
    storeClient.defaults.adapter = (config) => new Promise((resolve) => {
      release = () => resolve({ data: {}, status: 200, statusText: "OK", headers: { "cart-token": "old-token" }, config });
      started();
    });
    const oldRequest = storeClient.get("/cart", { _isInitializing: true });
    await startedPromise;
    clearCartSession();
    release();
    await oldRequest;
    let sentToken;
    storeClient.defaults.adapter = async (config) => {
      sentToken = config.headers["Cart-Token"];
      return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };
    await storeClient.get("/cart", { _isInitializing: true });
    assert.equal(sentToken, undefined);
  } finally {
    storeClient.defaults.adapter = originalAdapter;
    clearCartSession();
  }
});

test("a late cart mutation cannot be applied after the session changes", async () => {
  clearCartSession();
  const originalAdapter = storeClient.defaults.adapter;
  let release;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  try {
    storeClient.defaults.adapter = (config) => {
      if (config.url === "/cart") return Promise.resolve({ data: {}, status: 200, headers: { nonce: "nonce" }, config });
      return new Promise((resolve) => {
        release = () => resolve({ data: { items: [{ id: 1 }] }, status: 200, headers: {}, config });
        started();
      });
    };
    const mutation = updateCartItem("item", 2);
    await ready;
    clearCartSession();
    release();
    await assert.rejects(mutation, { code: "ERR_CANCELED" });
  } finally {
    storeClient.defaults.adapter = originalAdapter;
    clearCartSession();
  }
});
