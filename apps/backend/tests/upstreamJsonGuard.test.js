import test from "node:test";
import assert from "node:assert/strict";
import {
  validateUpstreamJsonResponse,
  sanitizeUpstreamErrorResponse,
} from "../src/utils/upstreamJsonGuard.js";
import { sanitizeError } from "../src/utils/logger.js";
import { runWithRequestContext } from "../src/utils/requestContext.js";
import { _setAnomalyHandlerForTesting } from "../src/services/alertService.js";
import wp from "../src/services/wordpress.js";
import { login } from "../src/controllers/authController.js";
import { parseStrictJsonResponse } from "../../../scripts/smoke-check-wp-json.js";

test("rejects HTTP 200 with leading PHP warning as 503 and emits PII-free alert", async () => {
  const alerts = [];
  _setAnomalyHandlerForTesting(async (alert) => {
    alerts.push(alert);
    return { success: true, queued: true };
  });

  try {
    const rawLeakedBody =
      '<br /><b>Warning</b>: Undefined variable in /var/www/brave.php on line 42<br />{"success":true,"email":"customer@secret.in"}';

    assert.throws(
      () =>
        runWithRequestContext({ requestId: "req-leak-101" }, () =>
          validateUpstreamJsonResponse(
            {
              status: 200,
              headers: { "content-type": "application/json; charset=UTF-8" },
              config: { url: "/wp-json/wc/v3/orders/99881" },
              data: rawLeakedBody,
            },
            "woocommerce"
          )
        ),
      (err) => {
        assert.equal(err.code, "UPSTREAM_INVALID_JSON");
        assert.equal(err.statusCode, 503);
        assert.equal(err.response.status, 503);
        assert.ok(!JSON.stringify(err.response.data).includes("customer@secret.in"));
        assert.ok(!JSON.stringify(err.response.data).includes("brave.php"));
        return true;
      }
    );

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, "UPSTREAM_INVALID_JSON");
    assert.equal(alerts[0].details.endpoint, "/wp-json/wc/v3/orders/:id");
    assert.equal(alerts[0].details.upstreamStatus, 200);
    assert.equal(alerts[0].details.requestId, "req-leak-101");
    assert.ok(!JSON.stringify(alerts[0]).includes("customer@secret.in"), "Alert must not contain customer PII");
    assert.ok(!JSON.stringify(alerts[0]).includes("brave.php"), "Alert must not contain raw PHP response body");
  } finally {
    _setAnomalyHandlerForTesting(null);
  }
});

test("rejects HTTP 200 with trailing PHP output as 503", () => {
  _setAnomalyHandlerForTesting(async () => ({ success: true }));
  try {
    assert.throws(
      () =>
        validateUpstreamJsonResponse(
          {
            status: 200,
            headers: { "content-type": "application/json" },
            config: { url: "/wp-json/mumbai-auth/v1/login" },
            data: '{"success":true}<br /><b>Notice</b>: shutdown notice',
          },
          "wordpress"
        ),
      (err) => err.code === "UPSTREAM_INVALID_JSON" && err.statusCode === 503
    );
  } finally {
    _setAnomalyHandlerForTesting(null);
  }
});

test("allows valid JSON objects/arrays, 204 responses, and binary streams", () => {
  const okObj = validateUpstreamJsonResponse({
    status: 200,
    headers: { "content-type": "application/json" },
    config: { url: "/wp-json/mumbai-auth/v1/banners" },
    data: { success: true, banners: [] },
  });
  assert.deepEqual(okObj.data, { success: true, banners: [] });

  const okArr = validateUpstreamJsonResponse({
    status: 200,
    headers: { "content-type": "application/json" },
    config: { url: "/wp-json/wc/v3/products" },
    data: [{ id: 1 }],
  });
  assert.equal(okArr.data.length, 1);

  const okStream = validateUpstreamJsonResponse({
    status: 200,
    headers: { "content-type": "image/jpeg" },
    config: { url: "/wp-content/uploads/a.jpg", responseType: "stream" },
    data: "binary-chunk",
  });
  assert.equal(okStream.data, "binary-chunk");
});

test("login returns clean 503 when WordPress emits PHP warnings on HTTP 200", async () => {
  _setAnomalyHandlerForTesting(async () => ({ success: true }));
  const originalAdapter = wp.defaults.adapter;
  wp.defaults.adapter = async (config) => ({
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    config,
    data: '<br /><b>Warning</b>: plugin leak{"success":true}',
  });

  try {
    let statusCode = 200;
    let body = null;
    await login(
      {
        id: "req-login-503",
        body: { email: "shopper@example.com", password: "Password123!" },
        headers: { "x-mumbai-panel": "customer" },
      },
      {
        status(code) { statusCode = code; return this; },
        json(payload) { body = payload; return this; },
      }
    );

    assert.equal(statusCode, 503);
    assert.equal(body.success, false);
    assert.equal(body.code, "UPSTREAM_INVALID_JSON");
    assert.match(body.message, /temporarily unavailable/i);
    assert.ok(!body.message.includes("Warning"));
  } finally {
    wp.defaults.adapter = originalAdapter;
    _setAnomalyHandlerForTesting(null);
  }
});

test("smoke check parser rejects leading/trailing HTML, bad content-type, and shape mismatches", () => {
  const leading = parseStrictJsonResponse({
    rawBody: '<br /><b>Warning</b>{"products":[]}',
    contentType: "application/json",
    status: 200,
  });
  assert.equal(leading.ok, false);
  assert.match(leading.reason, /leading non-JSON/i);

  const trailing = parseStrictJsonResponse({
    rawBody: '{"products":[]}<b>Deprecated</b>',
    contentType: "application/json",
    status: 200,
  });
  assert.equal(trailing.ok, false);
  assert.match(trailing.reason, /trailing non-JSON/i);

  const badType = parseStrictJsonResponse({
    rawBody: '{"products":[]}',
    contentType: "text/html; charset=utf-8",
    status: 200,
  });
  assert.equal(badType.ok, false);

  const badShape = parseStrictJsonResponse({
    rawBody: '{"unexpected":true}',
    contentType: "application/json",
    status: 200,
    validateShape: (d) => (Array.isArray(d.products) ? null : "missing products"),
  });
  assert.equal(badShape.ok, false);
  assert.match(badShape.reason, /missing products/);

  const valid = parseStrictJsonResponse({
    rawBody: '{"products":[{"id":1}]}',
    contentType: "application/json; charset=UTF-8",
    status: 200,
    validateShape: (d) => (Array.isArray(d.products) ? null : "missing products"),
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.products[0].id, 1);
});

test("sanitizes HTML 500 and proxy HTML 502 error responses to clean 503 with zero raw body in diagnostics or alerts", async () => {
  const alerts = [];
  _setAnomalyHandlerForTesting(async (alert) => {
    alerts.push(alert);
    return { success: true, queued: true };
  });

  try {
    const rawFatal500 = {
      message: "Request failed with status code 500",
      config: { url: "/wp-json/mumbai-auth/v1/login" },
      response: {
        status: 500,
        headers: { "content-type": "text/html; charset=UTF-8" },
        data: "<html><body><b>Fatal error</b>: Uncaught Error in /var/www/secret-plugin.php with customer@pii.in</body></html>",
      },
    };

    const sanitized500 = runWithRequestContext({ requestId: "req-html-500" }, () =>
      sanitizeUpstreamErrorResponse(rawFatal500, "wordpress")
    );
    assert.equal(sanitized500.code, "UPSTREAM_INVALID_JSON");
    assert.equal(sanitized500.statusCode, 503);
    assert.equal(sanitized500.response.status, 503);
    const diag500 = JSON.stringify(sanitizeError(sanitized500));
    assert.ok(!diag500.includes("secret-plugin.php"), "Diagnostics must not contain raw HTML body");
    assert.ok(!diag500.includes("customer@pii.in"), "Diagnostics must not contain PII from raw HTML body");

    const rawProxy502 = {
      message: "Request failed with status code 502",
      config: { url: "/wp-json/wc/v3/products/4421" },
      response: {
        status: 502,
        headers: { "content-type": "text/html" },
        data: "<html><head><title>502 Bad Gateway</title></head><body>nginx/1.24</body></html>",
      },
    };
    const sanitized502 = runWithRequestContext({ requestId: "req-html-502" }, () =>
      sanitizeUpstreamErrorResponse(rawProxy502, "woocommerce")
    );
    assert.equal(sanitized502.code, "UPSTREAM_INVALID_JSON");
    assert.equal(sanitized502.statusCode, 503);
    assert.equal(sanitized502.response.status, 503);
    assert.ok(!JSON.stringify(sanitized502.response.data).includes("nginx"));

    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].details.upstreamStatus, 500);
    assert.equal(alerts[0].details.requestId, "req-html-500");
    assert.equal(alerts[1].details.endpoint, "/wp-json/wc/v3/products/:id");
    assert.equal(alerts[1].details.upstreamStatus, 502);
    assert.ok(!JSON.stringify(alerts).includes("secret-plugin.php"));
    assert.ok(!JSON.stringify(alerts).includes("customer@pii.in"));
    assert.ok(!JSON.stringify(alerts).includes("nginx"));
  } finally {
    _setAnomalyHandlerForTesting(null);
  }
});

test("preserves legitimate WordPress JSON errors such as 401 invalid credentials and 409 conflicts", async () => {
  const alerts = [];
  _setAnomalyHandlerForTesting(async (alert) => {
    alerts.push(alert);
    return { success: true };
  });

  const originalAdapter = wp.defaults.adapter;
  wp.defaults.adapter = async (config) => {
    const err = new Error("Request failed with status code 401");
    err.config = config;
    err.response = {
      status: 401,
      statusText: "Unauthorized",
      headers: { "content-type": "application/json" },
      config,
      data: { code: "incorrect_password", message: "Invalid email or password." },
    };
    throw err;
  };

  try {
    let statusCode = 200;
    let body = null;
    await login(
      {
        id: "req-valid-401",
        body: { email: "shopper@example.com", password: "WrongPassword!" },
        headers: { "x-mumbai-panel": "customer" },
      },
      {
        status(code) { statusCode = code; return this; },
        json(payload) { body = payload; return this; },
      }
    );

    assert.equal(statusCode, 401);
    assert.equal(body.code, "incorrect_password");
    assert.equal(body.message, "Invalid email or password.");
    assert.equal(alerts.length, 0, "Normal 401 JSON errors must not trigger malformed-JSON alerts");

    const conflictErr = {
      config: { url: "/wp-json/mumbai-auth/v1/banners" },
      response: {
        status: 409,
        headers: { "content-type": "application/json" },
        data: { code: "banner_conflict", message: "Version mismatch" },
      },
    };
    assert.strictEqual(sanitizeUpstreamErrorResponse(conflictErr, "wordpress"), conflictErr);
  } finally {
    wp.defaults.adapter = originalAdapter;
    _setAnomalyHandlerForTesting(null);
  }
});
