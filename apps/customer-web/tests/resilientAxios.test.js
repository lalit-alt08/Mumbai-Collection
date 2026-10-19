import test from "node:test";
import assert from "node:assert/strict";
import {
  attachStaleConnectionRetry,
  shouldRetryReadRequest,
  getReadRetryDelayMs,
} from "../src/utils/resilientAxios.js";

const makeAxiosStub = () => {
  let rejectInterceptor;
  const calls = [];
  const axios = (config) => {
    calls.push(config);
    return Promise.resolve({ retried: true, config });
  };
  axios.interceptors = {
    response: {
      use: (_onSuccess, onError) => {
        rejectInterceptor = onError;
      },
    },
  };
  attachStaleConnectionRetry(axios);
  return { calls, reject: (error) => rejectInterceptor(error) };
};

test("retries a transient GET once", async () => {
  const stub = makeAxiosStub();
  const error = {
    config: { method: "get", url: "/catalog" },
    response: { status: 503, headers: { "retry-after": "0" } },
  };

  const result = await stub.reject(error);
  assert.equal(result.retried, true);
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0]._networkRetryCount, 1);
  await assert.rejects(stub.reject(error), (received) => received === error);
  assert.equal(stub.calls.length, 1);
});

test("never retries POST after a response is lost or a gateway error occurs", async () => {
  const stub = makeAxiosStub();
  const error = {
    config: { method: "post", url: "/orders" },
    code: "ERR_NETWORK",
  };

  await assert.rejects(stub.reject(error), (received) => received === error);
  assert.equal(shouldRetryReadRequest(error), false);
  assert.equal(stub.calls.length, 0);

  const gatewayError = {
    config: { method: "post", url: "/orders" },
    response: { status: 504 },
  };
  await assert.rejects(stub.reject(gatewayError), (received) => received === gatewayError);
  assert.equal(stub.calls.length, 0);
});

test("honors short Retry-After values and skips retries that require a long wait", () => {
  assert.equal(
    getReadRetryDelayMs({ response: { headers: { "retry-after": "0" } } }),
    0
  );
  assert.equal(
    getReadRetryDelayMs({ response: { headers: { "retry-after": "60" } } }),
    null
  );
});
