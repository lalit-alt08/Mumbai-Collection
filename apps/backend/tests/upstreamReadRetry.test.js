import test from "node:test";
import assert from "node:assert/strict";
import { shouldRetryUpstreamRead } from "../src/utils/upstreamReadRetry.js";

test("WordPress client retries upstream read failures once", () => {
  assert.equal(
    shouldRetryUpstreamRead({ code: "ECONNRESET", config: { method: "get" } }),
    true
  );
  assert.equal(
    shouldRetryUpstreamRead({ message: "socket hang up", config: { method: "head" } }),
    true
  );
});

test("WordPress client never automatically retries mutations or a second attempt", () => {
  assert.equal(
    shouldRetryUpstreamRead({ code: "ECONNRESET", config: { method: "post" } }),
    false
  );
  assert.equal(
    shouldRetryUpstreamRead({ code: "ETIMEDOUT", config: { method: "put", _retry: true } }),
    false
  );
});
