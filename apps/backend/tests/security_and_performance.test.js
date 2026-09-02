import test from "node:test";
import assert from "node:assert/strict";
import { verifyCsrf } from "../src/middlewares/csrfMiddleware.js";
import { validateImageBuffer, detectImageFormat, sanitizeFilename } from "../src/utils/imageValidator.js";
import { serverCache } from "../src/utils/memoryCache.js";
import { maskEmail, maskPhone, redactSensitive } from "../src/utils/auditLogger.js";

// ==========================================
// 1. CSRF Protection Middleware Tests
// ==========================================
test("CSRF: Allows safe GET, HEAD, and OPTIONS without origin", (t) => {
  const middleware = verifyCsrf(["https://mumbaicollection.com"]);

  ["GET", "HEAD", "OPTIONS"].forEach((method) => {
    let calledNext = false;
    const req = { method, headers: {}, cookies: { mumbai_customer_auth: "token123" } };
    const res = {};
    middleware(req, res, () => { calledNext = true; });
    assert.equal(calledNext, true, `${method} should pass through CSRF check`);
  });
});

test("CSRF: Allows unauthenticated mutations (login/register)", (t) => {
  const middleware = verifyCsrf(["https://mumbaicollection.com"]);
  let calledNext = false;
  const req = { method: "POST", headers: {}, cookies: {} };
  const res = {};
  middleware(req, res, () => { calledNext = true; });
  assert.equal(calledNext, true, "Unauthenticated POST should bypass CSRF check");
});

test("CSRF: Blocks cookie-authenticated mutations from unauthorized origins", (t) => {
  const middleware = verifyCsrf(["https://mumbaicollection.com"]);
  let statusSent = null;
  let jsonSent = null;
  const req = {
    method: "POST",
    headers: { origin: "https://evil-attacker.com" },
    cookies: { mumbai_customer_auth: "token123" },
  };
  const res = {
    status(code) {
      statusSent = code;
      return {
        json(data) {
          jsonSent = data;
        },
      };
    },
  };

  middleware(req, res, () => {
    assert.fail("Should not call next() for unauthorized origin");
  });

  assert.equal(statusSent, 403);
  assert.match(jsonSent.message, /unauthorized origin/i);
});

test("CSRF: Allows cookie-authenticated mutations from exact allowed origin", (t) => {
  const middleware = verifyCsrf(["https://mumbaicollection.com"]);
  let calledNext = false;
  const req = {
    method: "POST",
    headers: { origin: "https://mumbaicollection.com" },
    cookies: { mumbai_customer_auth: "token123" },
  };
  const res = {};
  middleware(req, res, () => { calledNext = true; });
  assert.equal(calledNext, true, "Authorized origin should pass CSRF");
});

test("CSRF: Falls back to same-origin Referer when Origin is omitted", (t) => {
  const middleware = verifyCsrf(["https://mumbaicollection.com"]);
  let calledNext = false;
  const req = {
    method: "PUT",
    headers: { referer: "https://mumbaicollection.com/checkout/step-2" },
    cookies: { mumbai_customer_auth: "token123" },
  };
  const res = {};
  middleware(req, res, () => { calledNext = true; });
  assert.equal(calledNext, true, "Authorized Referer should pass CSRF");
});

// ==========================================
// 2. Upload Validation & Magic Bytes Tests
// ==========================================
test("ImageValidator: Correctly detects authentic JPEG magic bytes", (t) => {
  const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const format = detectImageFormat(jpegBuffer);
  assert.deepEqual(format, { format: "jpeg", ext: "jpg", mime: "image/jpeg" });
});

test("ImageValidator: Correctly detects authentic PNG magic bytes", (t) => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const format = detectImageFormat(pngHeader);
  assert.deepEqual(format, { format: "png", ext: "png", mime: "image/png" });
});

test("ImageValidator: Correctly detects authentic WebP magic bytes", (t) => {
  const webpHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, // WEBP
  ]);
  const format = detectImageFormat(webpHeader);
  assert.deepEqual(format, { format: "webp", ext: "webp", mime: "image/webp" });
});

test("ImageValidator: Rejects disguised malicious executable or script files", (t) => {
  const phpShell = Buffer.from("<?php system($_GET['cmd']); ?>");
  const file = { buffer: phpShell, originalname: "exploit.php", mimetype: "image/jpeg" };
  const validation = validateImageBuffer(file);
  assert.equal(validation.valid, false);
  assert.match(validation.message, /Invalid file signature/i);
});

test("ImageValidator: Sanitizes filename and enforces server-derived extension", (t) => {
  const sanitized = sanitizeFilename("../../../evil_name.php.exe", "png");
  assert.ok(!sanitized.includes("../"));
  assert.ok(sanitized.endsWith(".png"));
});

// ==========================================
// 3. Cache & Request Coalescing (Single-Flight) Tests
// ==========================================
test("MemoryCache: Coalesces multiple concurrent cold requests into single execution", async (t) => {
  let executionCount = 0;
  const mockFetch = async () => {
    executionCount++;
    await new Promise((r) => setTimeout(r, 50));
    return { data: "sample_result" };
  };

  const key = "test:coalescing:" + Date.now();

  // Fire 5 concurrent requests simultaneously
  const results = await Promise.all([
    serverCache.getOrFetch(key, mockFetch, 5000),
    serverCache.getOrFetch(key, mockFetch, 5000),
    serverCache.getOrFetch(key, mockFetch, 5000),
    serverCache.getOrFetch(key, mockFetch, 5000),
    serverCache.getOrFetch(key, mockFetch, 5000),
  ]);

  // All 5 must receive identical results, but mockFetch should only be called ONCE
  assert.equal(executionCount, 1, "fetchFn must only execute once across concurrent calls");
  results.forEach((res) => {
    assert.deepEqual(res, { data: "sample_result" });
  });

  serverCache.delete(key);
});

test("MemoryCache: Prefix invalidation properly removes matching keys", async (t) => {
  serverCache.set("catalog:prod:1", { id: 1 }, 10000);
  serverCache.set("catalog:prod:2", { id: 2 }, 10000);
  serverCache.set("orders:1", { id: 1 }, 10000);

  assert.ok(serverCache.get("catalog:prod:1"));
  assert.ok(serverCache.get("catalog:prod:2"));
  assert.ok(serverCache.get("orders:1"));

  serverCache.invalidatePrefix("catalog:");

  assert.equal(serverCache.get("catalog:prod:1"), null);
  assert.equal(serverCache.get("catalog:prod:2"), null);
  assert.ok(serverCache.get("orders:1"), "Non-matching prefix must remain untouched");

  serverCache.clear();
});

// ==========================================
// 4. Audit Logger PII Redaction Tests
// ==========================================
test("AuditLogger: Masks customer email and phone correctly", (t) => {
  assert.equal(maskEmail("john.doe@example.com"), "j***e@example.com");
  assert.equal(maskPhone("+91 98765 43210"), "******3210");
});

test("AuditLogger: Redacts sensitive password and token fields from audit details", (t) => {
  const sensitivePayload = {
    password: "supersecret123",
    auth_token: "jwt.token.here",
    email: "customer@domain.com",
    phone: "9876543210",
    order_id: 105,
    status: "processing",
  };

  const redacted = redactSensitive(sensitivePayload);
  assert.equal(redacted.password, "[REDACTED]");
  assert.equal(redacted.auth_token, "[REDACTED]");
  assert.equal(redacted.email, "c***r@domain.com");
  assert.equal(redacted.phone, "******3210");
  assert.equal(redacted.order_id, 105);
  assert.equal(redacted.status, "processing");
});
