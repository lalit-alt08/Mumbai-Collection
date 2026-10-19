import test from "node:test";
import assert from "node:assert/strict";
import { shouldRetryRead, readRetryDelayMs } from "../src/utils/readRetry.js";

test("employee client retries transient safe reads but never writes", () => {
  const networkError = { code: "ECONNRESET" };
  assert.equal(shouldRetryRead(networkError, { method: "head" }), true);
  assert.equal(shouldRetryRead(networkError, { method: "delete" }), false);
  assert.equal(
    shouldRetryRead({ response: { status: 503 } }, { method: "put" }),
    false
  );
});

test("employee client honors short Retry-After values and skips long automatic waits", () => {
  assert.equal(readRetryDelayMs({ response: { headers: { "retry-after": "0" } } }), 0);
  assert.equal(readRetryDelayMs({ response: { headers: { "retry-after": "60" } } }), null);
});
