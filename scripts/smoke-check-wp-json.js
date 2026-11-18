#!/usr/bin/env node
/**
 * Post-plugin-update & staging smoke check for headless WordPress + Node backend.
 * Parses the ENTIRE raw response body with JSON.parse() (catching both leading
 * and trailing PHP notices/HTML) and validates expected shapes across catalog,
 * cart, and auth endpoints.
 *
 * Usage:
 *   node scripts/smoke-check-wp-json.js
 *   BACKEND_URL=http://localhost:5000 WORDPRESS_URL=https://mumbai-collection.local node scripts/smoke-check-wp-json.js
 *   SMOKE_TEST_EMAIL=test@example.com SMOKE_TEST_PASSWORD=secret node scripts/smoke-check-wp-json.js
 */
import https from "node:https";
import http from "node:http";
import { fileURLToPath } from "node:url";

export const parseStrictJsonResponse = ({ rawBody, contentType = "", status = 200, validateShape }) => {
  if (typeof rawBody !== "string" || rawBody.trim().length === 0) {
    return { ok: false, reason: `Empty response body (HTTP ${status})` };
  }

  const normalizedType = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (normalizedType && !normalizedType.includes("json")) {
    return { ok: false, reason: `Non-JSON Content-Type "${normalizedType}" (HTTP ${status})` };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    const leadingNoise = !/^[\s]*[\[{]/.test(rawBody);
    const trailingNoise = !/[\]}][\s]*$/.test(rawBody);
    const hint = leadingNoise
      ? "leading non-JSON output (possible PHP notice/warning)"
      : trailingNoise
      ? "trailing non-JSON output (possible PHP shutdown warning/HTML)"
      : err.message;
    return { ok: false, reason: `Invalid JSON body: ${hint} (HTTP ${status}, ${rawBody.length} bytes)` };
  }

  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, reason: `Unexpected JSON scalar type "${typeof parsed}" (HTTP ${status})` };
  }

  if (typeof validateShape === "function") {
    const shapeError = validateShape(parsed, status);
    if (shapeError) {
      return { ok: false, reason: `Unexpected response shape: ${shapeError} (HTTP ${status})` };
    }
  }

  return { ok: true, data: parsed };
};

const rawRequest = (urlString, { method = "GET", headers = {}, body = null, timeoutMs = 10000 } = {}) =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlString);
    const isHttps = parsedUrl.protocol === "https:";
    const isLocalHost = parsedUrl.hostname === "localhost" || parsedUrl.hostname.endsWith(".local");
    const transport = isHttps ? https : http;

    const req = transport.request(
      parsedUrl,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
          ...headers,
        },
        timeout: timeoutMs,
        ...(isHttps && isLocalHost ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            rawBody: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });

const extractCookieHeader = (setCookieHeaders = []) => {
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders].filter(Boolean);
  return list.map((c) => String(c).split(";")[0]).filter(Boolean).join("; ");
};

export async function runSmokeChecks({
  backendUrl = process.env.BACKEND_URL || "http://localhost:5000",
  wordpressUrl = process.env.WORDPRESS_URL || "https://mumbai-collection.local",
  testEmail = process.env.SMOKE_TEST_EMAIL || "",
  testPassword = process.env.SMOKE_TEST_PASSWORD || "",
} = {}) {
  const cleanBackend = backendUrl.replace(/\/+$/, "");
  const cleanWp = wordpressUrl.replace(/\/+$/, "");
  const results = [];

  const check = async (name, url, options, allowedStatuses, validateShape) => {
    try {
      const res = await rawRequest(url, options);
      if (!allowedStatuses.includes(res.status)) {
        results.push({ name, ok: false, reason: `Unexpected HTTP ${res.status} (expected ${allowedStatuses.join("/")})` });
        return null;
      }
      const parsed = parseStrictJsonResponse({
        rawBody: res.rawBody,
        contentType: res.headers["content-type"],
        status: res.status,
        validateShape,
      });
      results.push({ name, ...parsed });
      return parsed.ok ? { ...res, data: parsed.data } : null;
    } catch (err) {
      results.push({ name, ok: false, reason: err.message });
      return null;
    }
  };

  // 1. Catalog endpoints
  await check(
    "Catalog: GET /api/products",
    `${cleanBackend}/api/products?page=1&per_page=1&format=paginated`,
    {},
    [200],
    (data) => (data.success === true && Array.isArray(data.products) ? null : "missing success/products array")
  );

  await check(
    "Catalog: GET /api/products/categories",
    `${cleanBackend}/api/products/categories`,
    {},
    [200],
    (data) => (Array.isArray(data) || Array.isArray(data.categories) ? null : "missing categories array")
  );

  await check(
    "Catalog: GET /api/banners",
    `${cleanBackend}/api/banners`,
    {},
    [200],
    (data) => (data.success === true && Array.isArray(data.banners) ? null : "missing success/banners array")
  );

  // 2. Cart Store API directly on WordPress
  await check(
    "Cart: GET /wp-json/wc/store/v1/cart",
    `${cleanWp}/wp-json/wc/store/v1/cart`,
    {},
    [200],
    (data) => (Array.isArray(data.items) && typeof data.totals === "object" ? null : "missing items array or totals object")
  );

  // 3. Auth session endpoint (unauthenticated check)
  await check(
    "Auth: GET /api/auth/me (guest)",
    `${cleanBackend}/api/auth/me`,
    {},
    [200, 401],
    (data) => (typeof data.success === "boolean" || typeof data.logged_in === "boolean" ? null : "missing auth status boolean")
  );

  // 4. Optional authenticated test account login -> /me -> logout check
  if (testEmail && testPassword) {
    const loginRes = await check(
      "Auth: POST /api/auth/login (test account)",
      `${cleanBackend}/api/auth/login`,
      {
        method: "POST",
        headers: { "X-Mumbai-Panel": "customer" },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      },
      [200],
      (data) => (data.success === true && data.user?.id ? null : "missing success or user.id")
    );

    if (loginRes) {
      const cookie = extractCookieHeader(loginRes.headers["set-cookie"]);
      await check(
        "Auth: GET /api/auth/me (authenticated)",
        `${cleanBackend}/api/auth/me`,
        { headers: { Cookie: cookie, "X-Mumbai-Panel": "customer" } },
        [200],
        (data) => (data.user?.id || data.current_user_id ? null : "missing authenticated user id")
      );
      await check(
        "Auth: POST /api/auth/logout (cleanup)",
        `${cleanBackend}/api/auth/logout`,
        {
          method: "POST",
          headers: { Cookie: cookie, "X-Mumbai-Panel": "customer" },
          body: JSON.stringify({ force: true }),
        },
        [200],
        (data) => (data.success === true ? null : "logout did not confirm success")
      );
    }
  }

  return results;
}

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();

if (isDirectExecution) {
  runSmokeChecks()
    .then((results) => {
      let failed = 0;
      for (const r of results) {
        if (r.ok) {
          console.log(`PASS  ${r.name}`);
        } else {
          failed++;
          console.error(`FAIL  ${r.name} -> ${r.reason}`);
        }
      }
      if (!process.env.SMOKE_TEST_EMAIL || !process.env.SMOKE_TEST_PASSWORD) {
        console.log("INFO  Skipped authenticated login check (set SMOKE_TEST_EMAIL & SMOKE_TEST_PASSWORD to include it).");
      }
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("Smoke check crashed:", err.message);
      process.exit(1);
    });
}
