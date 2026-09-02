import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../src/app.js";

test("Integration: App starts and handles health check /", async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, "Backend is running");
  } finally {
    server.close();
  }
});

test("Integration: CSRF blocks cookie-authenticated POST with unauthorized Origin", async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/orders/1/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://malicious-site.example",
        "Cookie": "mumbai_customer_auth=fake-token",
      },
      body: JSON.stringify({ status: "cancelled" }),
    });

    // Should be blocked by CORS or CSRF middleware
    assert.ok(res.status === 403 || res.status === 500);
  } finally {
    server.close();
  }
});

test("Integration: Undefined /api routes return clean standardized 404 JSON", async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/non-existent-route`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.deepEqual(body, { success: false, message: "API route not found" });
  } finally {
    server.close();
  }
});
