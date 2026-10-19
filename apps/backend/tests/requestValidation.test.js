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

test("registration rejects malformed email shapes and profile rejects invalid Indian mobile numbers", () => {
  for (const email of ["name@gmail", "name@gmail..com", ".name@gmail.com", "name@-gmail.com"]) {
    assert.equal(runValidation(schemas.register, { email, password: "StrongPassword123!" }).nextCalled, false, email);
  }
  assert.equal(runValidation(schemas.register, { email: "NAME@gmail.com", password: "StrongPassword123!" }).nextCalled, true);
  assert.equal(runValidation(schemas.profile, { phone: "9876543210" }).nextCalled, true);
  assert.equal(runValidation(schemas.profile, { phone: "12345" }).nextCalled, false);
});

test("registration and reset password enforce strong password requirements (8+ chars, upper, lower, number, special)", () => {
  // Missing uppercase
  assert.equal(runValidation(schemas.register, { email: "test@example.com", password: "mumbai@123" }).nextCalled, false);
  // Missing lowercase
  assert.equal(runValidation(schemas.register, { email: "test@example.com", password: "MUMBAI@123" }).nextCalled, false);
  // Missing number
  assert.equal(runValidation(schemas.register, { email: "test@example.com", password: "Mumbai@Password" }).nextCalled, false);
  // Missing special character
  assert.equal(runValidation(schemas.register, { email: "test@example.com", password: "MumbaiPass123" }).nextCalled, false);
  // Too short
  assert.equal(runValidation(schemas.register, { email: "test@example.com", password: "Mu1!" }).nextCalled, false);
  // Valid strong password
  assert.equal(runValidation(schemas.register, { email: "test@example.com", password: "StrongPassword123!" }).nextCalled, true);
  assert.equal(runValidation(schemas.resetPassword, { token: "tok_123", password: "StrongPassword123!" }).nextCalled, true);
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

test("request validation strips unauthorized/injected keys (mass assignment protection)", () => {
  const regResult = runValidation(schemas.register, {
    email: "customer@example.com",
    password: "StrongPassword123!",
    first_name: "Test",
    role: "administrator",
    is_admin: true,
    wp_user_id: 1,
  });
  assert.equal(regResult.nextCalled, true);
  assert.equal(regResult.req.body.role, undefined);
  assert.equal(regResult.req.body.is_admin, undefined);
  assert.equal(regResult.req.body.wp_user_id, undefined);
  assert.equal(regResult.req.body.email, "customer@example.com");

  const profResult = runValidation(schemas.profile, {
    phone: "9876543210",
    role: "administrator",
    customer_id: 42,
  });
  assert.equal(profResult.nextCalled, true);
  assert.equal(profResult.req.body.role, undefined);
  assert.equal(profResult.req.body.customer_id, undefined);
  assert.equal(profResult.req.body.phone, "9876543210");
});

