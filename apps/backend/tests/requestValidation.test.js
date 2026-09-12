import test from "node:test";
import assert from "node:assert/strict";
import { schemas, validateRequest } from "../src/middlewares/requestValidation.js";
import { sanitizeError, sanitizeLogValue } from "../src/utils/logger.js";

const runValidation = (schema, value, target = "body") => {
  const req = { [target]: value };
  let response;
  let nextCalled = false;
  const res = { status: (status) => ({ json: (body) => { response = { status, body }; } }) };
  validateRequest({ [target]: schema })(req, res, () => { nextCalled = true; });
  return { req, response, nextCalled };
};

test("request validation accepts valid auth and rejects malformed credentials", () => {
  assert.equal(runValidation(schemas.login, { email: "customer@example.com", password: "password123" }).nextCalled, true);
  const invalid = runValidation(schemas.login, { email: "not-an-email", password: "short" });
  assert.equal(invalid.nextCalled, false);
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.response.body.code, "VALIDATION_ERROR");
});

test("request validation enforces OTP purpose and six-digit code", () => {
  assert.equal(runValidation(schemas.otpSend, { phone: "+919876543210", purpose: "verify_phone" }).nextCalled, true);
  assert.equal(runValidation(schemas.otpVerify, { phone: "9876543210", purpose: "other", otp: "123456" }).nextCalled, false);
  assert.equal(runValidation(schemas.otpVerify, { phone: "9876543210", purpose: "verify_phone", otp: "1234" }).nextCalled, false);
});

test("request validation enforces positive IDs, enums, and pagination bounds", () => {
  assert.equal(runValidation(schemas.orderStatus, { status: "completed" }).nextCalled, true);
  assert.equal(runValidation(schemas.orderStatus, { status: "made-up" }).nextCalled, false);
  assert.equal(runValidation(schemas.idParam, { id: "12" }, "params").req.params.id, 12);
  assert.equal(runValidation(schemas.idParam, { id: "0" }, "params").nextCalled, false);
  assert.equal(runValidation(schemas.pagination, { page: "1", per_page: "100", search: "phone" }, "query").nextCalled, true);
  assert.equal(runValidation(schemas.pagination, { page: "1", per_page: "1000" }, "query").nextCalled, false);
});

test("logging sanitizers redact credentials, tokens, cookies, and idempotency keys", () => {
  const value = sanitizeLogValue({ password: "secret", otp: "123456", cookie: "session", idempotencyKey: "raw-key", safe: "ok" });
  assert.deepEqual(value, { password: "[REDACTED]", otp: "[REDACTED]", cookie: "[REDACTED]", idempotencyKey: "[REDACTED]", safe: "ok" });
  const sanitized = sanitizeError({ message: "upstream failed", response: { status: 502, data: { token: "secret", message: "failed" } } });
  assert.equal(sanitized.upstream.token, "[REDACTED]");
  assert.equal(sanitized.status, 502);
});
