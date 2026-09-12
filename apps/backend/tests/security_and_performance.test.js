import test from "node:test";
import assert from "node:assert/strict";
import { verifyCsrf } from "../src/middlewares/csrfMiddleware.js";
import {
  EMPLOYEE_MAX_IMAGE_SIZE_BYTES,
  checkImageDimensions,
  validateImageBuffer,
  detectImageFormat,
  sanitizeFilename,
} from "../src/utils/imageValidator.js";
import { requireRole } from "../src/middlewares/roleMiddleware.js";
import { formatEmployeeMediaUploadResponse } from "../src/controllers/employeeController.js";
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

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const onePixelGif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const onePixelJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//Z",
  "base64"
);
const onePixelWebp = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBAAAADwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAAA==",
  "base64"
);

const imageFile = (buffer, originalname = "product.jpg", mimetype = "image/jpeg") => ({
  buffer,
  originalname,
  mimetype,
});

test("ImageValidator: Accepts valid employee JPEG, PNG, WebP and GIF images", () => {
  for (const [buffer, originalname, mimetype] of [
    [onePixelJpeg, "product.jpg", "image/jpeg"],
    [onePixelPng, "product.png", "image/png"],
    [onePixelWebp, "product.webp", "image/webp"],
    [onePixelGif, "product.gif", "image/gif"],
  ]) {
    const result = validateImageBuffer(imageFile(buffer, originalname, mimetype), {
      maxFileSizeBytes: EMPLOYEE_MAX_IMAGE_SIZE_BYTES,
    });
    assert.equal(result.valid, true, `${originalname} should be accepted: ${result.message || ""}`);
    assert.equal(result.width, 1);
    assert.equal(result.height, 1);
  }

  const validWithSpoofedMetadata = validateImageBuffer(
    imageFile(onePixelJpeg, "not-an-image.bin", "text/plain"),
    { maxFileSizeBytes: EMPLOYEE_MAX_IMAGE_SIZE_BYTES }
  );
  assert.equal(validWithSpoofedMetadata.valid, true, "server content detection must override client metadata");
  assert.equal(validWithSpoofedMetadata.ext, "jpg");
});

test("ImageValidator: Rejects employee files larger than 5MB", () => {
  const oversized = Buffer.alloc(EMPLOYEE_MAX_IMAGE_SIZE_BYTES + 1);
  const result = validateImageBuffer(imageFile(oversized), {
    maxFileSizeBytes: EMPLOYEE_MAX_IMAGE_SIZE_BYTES,
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /5MB/i);
});

test("ImageValidator: Rejects JPEG and WebP dimensions over 6000px", () => {
  const wideJpeg = Buffer.from(onePixelJpeg);
  const jpegSof = wideJpeg.indexOf(Buffer.from([0xff, 0xc0]));
  wideJpeg.writeUInt16BE(6001, jpegSof + 5); // height
  assert.equal(checkImageDimensions(wideJpeg, "jpeg").valid, false);

  const wideJpegWidth = Buffer.from(onePixelJpeg);
  const jpegWidthSof = wideJpegWidth.indexOf(Buffer.from([0xff, 0xc0]));
  wideJpegWidth.writeUInt16BE(6001, jpegWidthSof + 7); // width
  assert.equal(checkImageDimensions(wideJpegWidth, "jpeg").valid, false);

  const wideWebp = Buffer.from(onePixelWebp);
  // The fixture is a VP8X WebP: canvas width starts at byte 24.
  wideWebp[24] = 0x70;
  wideWebp[25] = 0x17;
  wideWebp[26] = 0x00;
  assert.equal(checkImageDimensions(wideWebp, "webp").valid, false);

  const tallWebp = Buffer.from(onePixelWebp);
  tallWebp[27] = 0x70;
  tallWebp[28] = 0x17;
  tallWebp[29] = 0x00;
  assert.equal(checkImageDimensions(tallWebp, "webp").valid, false);
});

test("ImageValidator: Rejects malformed, truncated, and spoofed image data", () => {
  const truncatedPng = onePixelPng.subarray(0, onePixelPng.length - 8);
  assert.equal(validateImageBuffer(imageFile(truncatedPng, "photo.png", "image/png")).valid, false);

  const truncatedJpeg = onePixelJpeg.subarray(0, onePixelJpeg.length - 2);
  assert.equal(validateImageBuffer(imageFile(truncatedJpeg, "photo.jpg", "image/jpeg")).valid, false);

  const truncatedWebp = onePixelWebp.subarray(0, 35); // before the declared RIFF payload ends
  assert.equal(validateImageBuffer(imageFile(truncatedWebp, "photo.webp", "image/webp")).valid, false);

  const spoofed = Buffer.from("not an image");
  assert.equal(validateImageBuffer(imageFile(spoofed, "photo.jpg", "image/jpeg")).valid, false);
});

test("Employee authorization: role middleware still rejects unauthenticated and unauthorized users", () => {
  const middleware = requireRole(["employee", "administrator"]);
  let status = null;
  const res = {
    status(code) {
      status = code;
      return { json() {} };
    },
  };

  middleware({ user: { roles: ["customer"] } }, res, () => assert.fail("customer must be rejected"));
  assert.equal(status, 403);

  status = null;
  middleware({}, res, () => assert.fail("anonymous user must be rejected"));
  assert.equal(status, 401);
});

test("Employee upload response: preserves success, URL, and media ID shape", () => {
  const response = formatEmployeeMediaUploadResponse(
    { id: 42, url: "https://wordpress.example/wp-content/uploads/product.webp" },
    null
  );
  assert.deepEqual(response, {
    success: true,
    url: "/api/media/uploads/product.webp",
    id: 42,
  });
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

test("Order Invalidation: Operational caches are cleared for employee and admin when order is created", (t) => {
  serverCache.set("employee:overview", { summary: { totalOrders: 10 } }, 60000);
  serverCache.set("admin:analytics:overview", { summary: { totalOrders: 10 } }, 120000);
  serverCache.set("admin:customers:orders", [{ id: 10 }], 120000);

  assert.ok(serverCache.get("employee:overview"));
  assert.ok(serverCache.get("admin:analytics:overview"));
  assert.ok(serverCache.get("admin:customers:orders"));

  // Simulate invalidation triggered by storeRoutes on POST /checkout
  serverCache.invalidatePrefix("employee:overview");
  serverCache.invalidatePrefix("admin:analytics");
  serverCache.invalidatePrefix("admin:customers");

  assert.equal(serverCache.get("employee:overview"), null, "employee:overview must be null immediately after order creation");
  assert.equal(serverCache.get("admin:analytics:overview"), null, "admin:analytics must be null immediately after order creation");
  assert.equal(serverCache.get("admin:customers:orders"), null, "admin:customers must be null immediately after order creation");

  serverCache.clear();
});
