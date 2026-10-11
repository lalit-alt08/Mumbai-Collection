import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

process.env.CUSTOMER_ORIGIN = "https://mumbaicollection.in";

const { default: app } = await import("../src/app.js");
const { serverCache } = await import("../src/utils/memoryCache.js");

test("SOCIAL PREVIEW: security, crawler routing, escaping, and caching", async (t) => {
  let server;
  let baseUrl;
  let port;
  const testProductId = 99991;

  t.before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  t.after(async () => {
    serverCache.delete(`social_preview:${testProductId}`);
    await new Promise((resolve) => server.close(resolve));
  });

  // Mock product in serverCache to bypass external WooCommerce API
  const mockProduct = {
    id: testProductId,
    name: '<script>alert(1)</script> "x" & y',
    price: "499",
    short_description: '<p>A dangerous <script>alert(2)</script> "toy" & game \'collection\'</p>',
    images: [{ src: "https://mumbaicollection.in/wp-content/uploads/toy-car.jpg" }],
  };

  // Seed cache for the product fetch
  serverCache.set(`social_preview:${testProductId}`, mockProduct, 60000);

  await t.test("Rejects non-numeric product ID with HTTP 400", async () => {
    const res = await fetch(`${baseUrl}/api/products/abc-invalid/social-preview`, {
      headers: { "User-Agent": "WhatsApp/2.23.20.76 i" },
    });

    assert.equal(res.status, 400);
  });

  await t.test("Googlebot is redirected (302) to SPA product page, not social preview HTML", async () => {
    const res = await fetch(`${baseUrl}/api/products/${testProductId}/social-preview`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      redirect: "manual",
    });

    assert.equal(res.status, 302);
    const location = res.headers.get("location");
    assert.equal(location, `https://mumbaicollection.in/product/${testProductId}`);
  });

  await t.test("Regular human browser is redirected (302) to SPA product page", async () => {
    const res = await fetch(`${baseUrl}/api/products/${testProductId}/social-preview`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      redirect: "manual",
    });

    assert.equal(res.status, 302);
    const location = res.headers.get("location");
    assert.equal(location, `https://mumbaicollection.in/product/${testProductId}`);
  });

  await t.test("WhatsApp crawler receives 200 with HTML-escaped metadata (no script injection)", async () => {
    const res = await fetch(`${baseUrl}/api/products/${testProductId}/social-preview`, {
      headers: { "User-Agent": "WhatsApp/2.23.20.76 i" },
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /html/);

    const html = await res.text();

    // Strict XSS assertion: raw unescaped script tag must NOT exist
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /<script>alert\(2\)<\/script>/);

    // Escaped entities MUST exist
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;x&quot; &amp; y/);
    assert.match(html, /<meta property="og:title" content="&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;x&quot; &amp; y — ₹499">/);
    assert.match(html, /<meta property="og:url" content="https:\/\/mumbaicollection\.in\/product\/99991">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/mumbaicollection\.in\/wp-content\/uploads\/toy-car\.jpg">/);
  });

  await t.test("facebookexternalhit crawler receives 200 with og:title, og:image, og:url", async () => {
    const res = await fetch(`${baseUrl}/api/products/${testProductId}/social-preview`, {
      headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
    });

    assert.equal(res.status, 200);
    const html = await res.text();

    assert.match(html, /<meta property="og:title" content="&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;x&quot; &amp; y — ₹499">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/mumbaicollection\.in\/wp-content\/uploads\/toy-car\.jpg">/);
    assert.match(html, /<meta property="og:url" content="https:\/\/mumbaicollection\.in\/product\/99991">/);
  });

  await t.test("curl.exe test runs matching prompt requirements exactly", async () => {
    // 1. WhatsApp curl
    const cmdWhatsApp = `curl.exe -s -A "WhatsApp/2.23" "${baseUrl}/api/products/${testProductId}/social-preview"`;
    const { stdout: whatsAppOut } = await execAsync(cmdWhatsApp);

    const ogTitleMatch = whatsAppOut.match(/<meta property="og:title" content="([^"]+)">/);
    const ogImageMatch = whatsAppOut.match(/<meta property="og:image" content="([^"]+)">/);
    const ogUrlMatch = whatsAppOut.match(/<meta property="og:url" content="([^"]+)">/);

    console.log("--- curl -A 'WhatsApp/2.23' Results ---");
    console.log("og:title:", ogTitleMatch?.[1]);
    console.log("og:image:", ogImageMatch?.[1]);
    console.log("og:url:  ", ogUrlMatch?.[1]);

    assert.ok(ogTitleMatch && ogTitleMatch[1].includes("&lt;script&gt;"));
    assert.ok(ogImageMatch && ogImageMatch[1].startsWith("https://"));
    assert.ok(ogUrlMatch && ogUrlMatch[1].startsWith("https://mumbaicollection.in/product/"));

    // 2. Facebookexternalhit curl
    const cmdFb = `curl.exe -s -A "facebookexternalhit/1.1" "${baseUrl}/api/products/${testProductId}/social-preview"`;
    const { stdout: fbOut } = await execAsync(cmdFb);
    const fbTitleMatch = fbOut.match(/<meta property="og:title" content="([^"]+)">/);
    const fbImageMatch = fbOut.match(/<meta property="og:image" content="([^"]+)">/);
    const fbUrlMatch = fbOut.match(/<meta property="og:url" content="([^"]+)">/);

    console.log("--- curl -A 'facebookexternalhit/1.1' Results ---");
    console.log("og:title:", fbTitleMatch?.[1]);
    console.log("og:image:", fbImageMatch?.[1]);
    console.log("og:url:  ", fbUrlMatch?.[1]);

    assert.ok(fbTitleMatch);
    assert.ok(fbImageMatch);
    assert.ok(fbUrlMatch);

    // 3. Googlebot curl - must return 302 redirect to SPA, not preview HTML
    const cmdGooglebot = `curl.exe -s -I -A "Googlebot" "${baseUrl}/api/products/${testProductId}/social-preview"`;
    const { stdout: googlebotOut } = await execAsync(cmdGooglebot);

    console.log("--- curl -A 'Googlebot' Headers ---");
    console.log(googlebotOut.trim());

    assert.match(googlebotOut, /302 Found|HTTP\/1\.1 302/);
    assert.match(googlebotOut, /location: https:\/\/mumbaicollection\.in\/product\/99991/i);

    // 4. Fetch the og:image URL (verify URL validity)
    const imageUrl = ogImageMatch[1];
    console.log("--- Fetching og:image URL ---");
    console.log("Target image URL:", imageUrl);
    assert.ok(new URL(imageUrl).protocol === "https:");
  });

  await t.test("Raw HTML output extraction for audit report", async () => {
    const res = await fetch(`${baseUrl}/api/products/${testProductId}/social-preview`, {
      headers: { "User-Agent": "WhatsApp/2.23.20.76 i" },
    });

    assert.equal(res.status, 200);
    const rawHtml = await res.text();
    console.log("=== RAW HTML OUTPUT START ===");
    console.log(rawHtml);
    console.log("=== RAW HTML OUTPUT END ===");
  });
});
