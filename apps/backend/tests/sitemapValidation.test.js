import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.CUSTOMER_ORIGIN = "https://mumbaicollections.in";

const { default: app } = await import("../src/app.js");
const { _setSitemapCatalogProviderForTesting } = await import("../src/routes/storeRoutes.js");
const { serverCache } = await import("../src/utils/memoryCache.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("SITEMAP: exclusion of drafts/private/hidden items, XML escaping, and robots.txt validation", async (t) => {
  let server;
  let baseUrl;

  t.before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  t.after(async () => {
    _setSitemapCatalogProviderForTesting(null);
    serverCache.delete("seo:sitemap_xml");
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test("robots.txt contains Sitemap directive and disallows sensitive routes", () => {
    const robotsPath = path.resolve(__dirname, "../../customer-web/public/robots.txt");
    assert.ok(fs.existsSync(robotsPath), "robots.txt exists");
    const robotsContent = fs.readFileSync(robotsPath, "utf8");

    assert.match(robotsContent, /Sitemap:\s*https:\/\/mumbaicollections\.in\/sitemap\.xml/);
    assert.match(robotsContent, /Disallow:\s*\/checkout/);
    assert.match(robotsContent, /Disallow:\s*\/account/);
    assert.match(robotsContent, /Disallow:\s*\/cart/);
    assert.match(robotsContent, /Disallow:\s*\/order-success/);
  });

  await t.test("Dynamically excludes drafts, private, and hidden products and escapes special XML characters", async () => {
    const mockProducts = [
      { id: 101, status: "publish", catalog_visibility: "visible", date_modified_gmt: "2026-10-09T10:00:00", categories: [{ id: 201 }, { id: 202 }] },
      { id: 102, status: "draft", catalog_visibility: "visible" },          // MUST BE EXCLUDED (draft)
      { id: 103, status: "private", catalog_visibility: "visible" },        // MUST BE EXCLUDED (private)
      { id: 104, status: "publish", catalog_visibility: "hidden" },         // MUST BE EXCLUDED (hidden visibility)
      { id: 105, status: "pending", catalog_visibility: "visible" },        // MUST BE EXCLUDED (pending)
      { id: 106, status: "publish", catalog_visibility: "catalog", date_modified_gmt: "2026-10-10T12:00:00", categories: [{ id: 201 }] }, // PUBLISHED
    ];

    const mockCategories = [
      { id: 201, slug: "toys-and-games", count: 2 },
      { id: 202, slug: "stationery-&-gifts", count: 1 }, // Contains & that MUST be escaped as &amp;
      { id: 999, slug: "empty-category-with-no-products", count: 0 }, // MUST BE EXCLUDED (empty category)
    ];

    _setSitemapCatalogProviderForTesting(async () => ({
      products: mockProducts,
      categories: mockCategories,
    }));

    const res = await fetch(`${baseUrl}/sitemap.xml`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/xml/);

    const xml = await res.text();

    // Verify exclusions
    assert.match(xml, /<loc>https:\/\/mumbaicollections\.in\/product\/101<\/loc>/);
    assert.match(xml, /<loc>https:\/\/mumbaicollections\.in\/product\/106<\/loc>/);
    assert.doesNotMatch(xml, /<loc>https:\/\/mumbaicollections\.in\/product\/102<\/loc>/); // draft excluded
    assert.doesNotMatch(xml, /<loc>https:\/\/mumbaicollections\.in\/product\/103<\/loc>/); // private excluded
    assert.doesNotMatch(xml, /<loc>https:\/\/mumbaicollections\.in\/product\/104<\/loc>/); // hidden excluded
    assert.doesNotMatch(xml, /<loc>https:\/\/mumbaicollections\.in\/product\/105<\/loc>/); // pending excluded
    assert.doesNotMatch(xml, /<loc>https:\/\/mumbaicollections\.in\/category\/empty-category-with-no-products<\/loc>/); // empty category excluded

    // Verify XML escaping
    assert.match(xml, /<loc>https:\/\/mumbaicollections\.in\/category\/stationery-&amp;-gifts<\/loc>/);
    assert.doesNotMatch(xml, /<loc>https:\/\/mumbaicollections\.in\/category\/stationery-&-gifts<\/loc>/);

    // Verify URL count
    // 7 static pages + 2 populated categories + 2 valid products = 11 URLs
    const urlMatches = xml.match(/<url>/g) || [];
    assert.equal(urlMatches.length, 11);

    // Print first 20 lines and URL count
    const lines = xml.split("\n");
    console.log("=== SITEMAP FIRST 20 LINES ===");
    console.log(lines.slice(0, 20).join("\n"));
    console.log("=== END OF FIRST 20 LINES ===");
    console.log(`Total URLs in sitemap: ${urlMatches.length}`);
  });

});
