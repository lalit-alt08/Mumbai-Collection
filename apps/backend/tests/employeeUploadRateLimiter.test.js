import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, uploadLimiter } from "../src/middlewares/rateLimiter.js";

const createMockRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(key, val) {
      this.headers[key] = val;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
};

test("Upload Rate Limiter: Employee A and Employee B on the same IP have independent upload limits", (t) => {
  const sharedIp = "192.168.1.100";
  const customLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 3,
    keyGenerator: (req) => {
      const userId = req.user?.id || req.wpUserId;
      if (userId) return `user:${userId}`;
      return `ip:${req.ip || "unknown"}`;
    },
  });

  // Employee A (user 101) makes 3 uploads on shared IP -> all succeed
  for (let i = 0; i < 3; i++) {
    let calledNext = false;
    const req = { ip: sharedIp, user: { id: 101, roles: ["employee"] } };
    const res = createMockRes();
    customLimiter(req, res, () => {
      calledNext = true;
    });
    assert.equal(calledNext, true, `Employee A request #${i + 1} should succeed`);
    assert.equal(res.statusCode, 200);
  }

  // Employee A 4th upload -> rate limited with 429
  let employeeANext = false;
  const reqA4 = { ip: sharedIp, user: { id: 101, roles: ["employee"] } };
  const resA4 = createMockRes();
  customLimiter(reqA4, resA4, () => {
    employeeANext = true;
  });
  assert.equal(employeeANext, false, "Employee A request #4 must be blocked");
  assert.equal(resA4.statusCode, 429);
  assert.match(resA4.body.message, /too many requests/i);

  // Employee B (user 102) on the SAME IP makes 3 uploads -> ALL SUCCEED independently
  for (let i = 0; i < 3; i++) {
    let calledNext = false;
    const req = { ip: sharedIp, user: { id: 102, roles: ["employee"] } };
    const res = createMockRes();
    customLimiter(req, res, () => {
      calledNext = true;
    });
    assert.equal(calledNext, true, `Employee B request #${i + 1} on same IP should succeed independently`);
    assert.equal(res.statusCode, 200);
  }

  // Employee B 4th upload -> rate limited with 429
  let employeeBNext = false;
  const reqB4 = { ip: sharedIp, user: { id: 102, roles: ["employee"] } };
  const resB4 = createMockRes();
  customLimiter(reqB4, resB4, () => {
    employeeBNext = true;
  });
  assert.equal(employeeBNext, false, "Employee B request #4 must be blocked");
  assert.equal(resB4.statusCode, 429);
});

test("Upload Rate Limiter: The same employee cannot bypass limit by changing IP", (t) => {
  const customLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 2,
    keyGenerator: (req) => {
      const userId = req.user?.id || req.wpUserId;
      if (userId) return `user:${userId}`;
      return `ip:${req.ip || "unknown"}`;
    },
  });

  // Upload 1 from IP 1.1.1.1
  let next1 = false;
  customLimiter({ ip: "1.1.1.1", user: { id: 555 } }, createMockRes(), () => { next1 = true; });
  assert.equal(next1, true);

  // Upload 2 from IP 2.2.2.2 (different IP, same user ID)
  let next2 = false;
  customLimiter({ ip: "2.2.2.2", user: { id: 555 } }, createMockRes(), () => { next2 = true; });
  assert.equal(next2, true);

  // Upload 3 from IP 3.3.3.3 (attempt to bypass limit by rotating IP) -> BLOCKED
  let next3 = false;
  const res3 = createMockRes();
  customLimiter({ ip: "3.3.3.3", user: { id: 555 } }, res3, () => { next3 = true; });
  assert.equal(next3, false, "User cannot bypass rate limit by changing IP address");
  assert.equal(res3.statusCode, 429);
});

test("Upload Rate Limiter: Unauthenticated requests fall back to IP-based rate limiting", (t) => {
  const ipLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 2,
    keyGenerator: (req) => {
      const userId = req.user?.id || req.wpUserId;
      if (userId) return `user:${userId}`;
      return `ip:${req.ip || "unknown"}`;
    },
  });

  // IP 10.0.0.1 without user object
  let next1 = false;
  ipLimiter({ ip: "10.0.0.1" }, createMockRes(), () => { next1 = true; });
  assert.equal(next1, true);

  let next2 = false;
  ipLimiter({ ip: "10.0.0.1" }, createMockRes(), () => { next2 = true; });
  assert.equal(next2, true);

  let next3 = false;
  const res3 = createMockRes();
  ipLimiter({ ip: "10.0.0.1" }, res3, () => { next3 = true; });
  assert.equal(next3, false);
  assert.equal(res3.statusCode, 429);

  // Different IP 10.0.0.2 still has its own quota
  let nextOtherIp = false;
  ipLimiter({ ip: "10.0.0.2" }, createMockRes(), () => { nextOtherIp = true; });
  assert.equal(nextOtherIp, true, "Different unauthenticated IP should have separate rate limit");
});

test("Upload Rate Limiter: Live export uploadLimiter is configured with windowMs=10min and max=30", (t) => {
  if (typeof uploadLimiter.reset === "function") {
    uploadLimiter.reset();
  }

  const req = { ip: "127.0.0.1", user: { id: 999, roles: ["employee"] } };
  let passedCount = 0;

  for (let i = 0; i < 30; i++) {
    uploadLimiter(req, createMockRes(), () => {
      passedCount++;
    });
  }
  assert.equal(passedCount, 30, "Live uploadLimiter must allow exactly 30 uploads per user");

  const res31 = createMockRes();
  let calledNext31 = false;
  uploadLimiter(req, res31, () => {
    calledNext31 = true;
  });
  assert.equal(calledNext31, false, "31st upload must be rate-limited");
  assert.equal(res31.statusCode, 429);
  assert.match(res31.body.message, /upload rate limit reached/i);
});
