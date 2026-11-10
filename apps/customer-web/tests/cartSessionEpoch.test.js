import test from "node:test";
import assert from "node:assert/strict";
import { storeClient, clearCartSession, updateCartItem } from "../src/services/storeApi.js";

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
