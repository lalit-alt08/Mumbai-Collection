import test from "node:test";
import assert from "node:assert/strict";
import { parseOtpRateLimitError } from "../src/services/authService.js";

test("parseOtpRateLimitError: formats user-friendly rate limit messages dynamically", () => {
  // 1. HTTP 429 with retryAfter in JSON response body (180s -> 3 minutes)
  const err180 = {
    response: {
      status: 429,
      data: { retryAfter: 180 },
    },
  };
  const res180 = parseOtpRateLimitError(err180);
  assert.equal(res180.isRateLimited, true);
  assert.equal(res180.retryAfter, 180);
  assert.equal(res180.message, "Too many attempts. Please try again in 3 minutes.");

  // 2. HTTP 429 with retryAfter in JSON response body (60s -> 1 minute singular)
  const err60 = {
    response: {
      status: 429,
      data: { retryAfter: 60 },
    },
  };
  const res60 = parseOtpRateLimitError(err60);
  assert.equal(res60.isRateLimited, true);
  assert.equal(res60.retryAfter, 60);
  assert.equal(res60.message, "Too many attempts. Please try again in 1 minute.");

  // 3. HTTP 429 with retry_after snake_case in JSON response body (120s -> 2 minutes)
  const err120 = {
    response: {
      status: 429,
      data: { retry_after: 120 },
    },
  };
  const res120 = parseOtpRateLimitError(err120);
  assert.equal(res120.isRateLimited, true);
  assert.equal(res120.retryAfter, 120);
  assert.equal(res120.message, "Too many attempts. Please try again in 2 minutes.");

  // 4. HTTP 429 with Retry-After header string (900s -> 15 minutes)
  const errHeader = {
    response: {
      status: 429,
      headers: { "retry-after": "900" },
      data: {},
    },
  };
  const resHeader = parseOtpRateLimitError(errHeader);
  assert.equal(resHeader.isRateLimited, true);
  assert.equal(resHeader.retryAfter, 900);
  assert.equal(resHeader.message, "Too many attempts. Please try again in 15 minutes.");

  // 5. HTTP 429 without retryAfter or header -> falls back safely to 1 minute
  const errNoRetry = {
    response: {
      status: 429,
      data: {},
    },
  };
  const resNoRetry = parseOtpRateLimitError(errNoRetry);
  assert.equal(resNoRetry.isRateLimited, true);
  assert.equal(resNoRetry.retryAfter, 60);
  assert.equal(resNoRetry.message, "Too many attempts. Please try again in 1 minute.");

  // 6. Non-429 error (e.g. 400 Bad Request)
  const err400 = {
    response: {
      status: 400,
      data: { message: "Please enter a valid phone number." },
    },
  };
  const res400 = parseOtpRateLimitError(err400);
  assert.equal(res400.isRateLimited, false);
  assert.equal(res400.retryAfter, 0);
  assert.equal(res400.message, "Please enter a valid phone number.");

  // 7. Non-429 error without message (e.g. network drop) -> never leaks raw Axios error
  const errNetwork = new Error("Network Error");
  const resNetwork = parseOtpRateLimitError(errNetwork);
  assert.equal(resNetwork.isRateLimited, false);
  assert.equal(resNetwork.retryAfter, 0);
  assert.equal(resNetwork.message, "Unable to send verification code. Please try again.");
});
