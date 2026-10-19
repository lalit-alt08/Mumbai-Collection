import test from "node:test";
import assert from "node:assert/strict";
import { shouldRetryRead, readRetryDelayMs } from "../src/utils/readRetry.js";

test("admin retries transient safe reads but never writes", () => {
  const networkError = { code: "ERR_NETWORK" };
  assert.equal(shouldRetryRead(networkError, { method: "get" }), true);
  assert.equal(shouldRetryRead(networkError, { method: "post" }), false);
  assert.equal(
    shouldRetryRead({ response: { status: 504 } }, { method: "patch" }),
    false
  );
});

test("admin honors short Retry-After values and skips long automatic waits", () => {
  assert.equal(readRetryDelayMs({ response: { headers: { "retry-after": "0" } } }), 0);
  assert.equal(readRetryDelayMs({ response: { headers: { "retry-after": "60" } } }), null);
});
