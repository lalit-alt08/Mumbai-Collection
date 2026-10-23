import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import axios from "axios";
import { checkPhoneAvailability } from "../src/controllers/profileController.js";

describe("Phone Availability Verification", () => {
  let mockWpServer;
  let mockWpPort;
  let originalWordpressUrl;
  let originalInternalKey;
  let lastWpRequest = null;

  beforeEach(async () => {
    originalWordpressUrl = process.env.WORDPRESS_URL;
    originalInternalKey = process.env.MUMBAI_INTERNAL_API_KEY;
    process.env.MUMBAI_INTERNAL_API_KEY = "test_internal_key";

    await new Promise((resolve) => {
      mockWpServer = http.createServer((req, res) => {
        lastWpRequest = {
          url: req.url,
          method: req.method,
          headers: req.headers,
        };

        if (req.url.startsWith("/wp-json/mumbai-auth/v1/check-phone")) {
          const urlObj = new URL(req.url, "http://localhost");
          const phone = urlObj.searchParams.get("phone");
          const userId = req.headers["x-mumbai-user-id"];

          if (phone === "9876543210") {
            // Already taken by user 42
            if (userId === "42") {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, available: true, exists: false, message: "Mobile number is available." }));
            } else {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, available: false, exists: true, message: "This mobile number is already registered to another account. Please use a different number." }));
            }
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, available: true, exists: false, message: "Mobile number is available." }));
          }
          return;
        }

        res.writeHead(404);
        res.end();
      });

      mockWpServer.listen(0, () => {
        mockWpPort = mockWpServer.address().port;
        process.env.WORDPRESS_URL = `http://localhost:${mockWpPort}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    process.env.WORDPRESS_URL = originalWordpressUrl;
    process.env.MUMBAI_INTERNAL_API_KEY = originalInternalKey;
    if (mockWpServer) {
      await new Promise((resolve) => mockWpServer.close(resolve));
    }
  });

  test("rejects missing phone parameter with 400", async () => {
    let statusCode = null;
    let jsonBody = null;

    const req = {
      query: {},
      headers: {},
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonBody = data;
      },
    };

    await checkPhoneAvailability(req, res);
    assert.equal(statusCode, 400);
    assert.equal(jsonBody.available, false);
    assert.equal(jsonBody.message, "Phone number is required.");
  });

  test("reports already registered mobile number as unavailable (exists: true)", async () => {
    let jsonBody = null;
    const req = {
      query: { phone: "9876543210" },
      headers: {},
      wpUserId: 99, // Different user
    };
    const res = {
      status() { return this; },
      json(data) { jsonBody = data; },
      set() {},
    };

    await checkPhoneAvailability(req, res);
    assert.equal(jsonBody.available, false);
    assert.equal(jsonBody.exists, true);
    assert.match(jsonBody.message, /already registered/i);
    assert.equal(lastWpRequest.headers["x-mumbai-user-id"], "99");
  });

  test("reports available mobile number as available (exists: false, available: true)", async () => {
    let jsonBody = null;
    const req = {
      query: { phone: "7000012345" },
      headers: {},
      wpUserId: 99,
    };
    const res = {
      status() { return this; },
      json(data) { jsonBody = data; },
      set() {},
    };

    await checkPhoneAvailability(req, res);
    assert.equal(jsonBody.available, true);
    assert.equal(jsonBody.exists, false);
    assert.match(jsonBody.message, /available/i);
  });

  test("allows user to keep/claim their own mobile number", async () => {
    let jsonBody = null;
    const req = {
      query: { phone: "9876543210" },
      headers: {},
      wpUserId: 42, // Owner user
    };
    const res = {
      status() { return this; },
      json(data) { jsonBody = data; },
      set() {},
    };

    await checkPhoneAvailability(req, res);
    assert.equal(jsonBody.available, true);
    assert.equal(jsonBody.exists, false);
  });
});
