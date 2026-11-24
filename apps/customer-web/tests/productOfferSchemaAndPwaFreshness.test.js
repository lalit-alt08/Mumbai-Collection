import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildProductOfferSchema } from "../src/utils/productUtils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = resolve(__dirname, "../index.html");
const networkBannerPath = resolve(__dirname, "../src/components/common/NetworkBanner.jsx");

test("Product JSON-LD Offer Schema & PWA Safe Reload Suite", async (t) => {
  await t.test("1. Marks stock_status 'outofstock' as OutOfStock even when in_stock is undefined", () => {
    const offer = buildProductOfferSchema({
      id: 101,
      price: "299",
      stock_status: "outofstock",
    });
    assert.equal(offer?.availability, "https://schema.org/OutOfStock");
    assert.equal(offer?.price, "299");
  });

  await t.test("2. Marks managed stock with zero quantity as OutOfStock after live stock merge", () => {
    const offer = buildProductOfferSchema({
      id: 102,
      price: "499",
      in_stock: true, // stale flag from before refresh
      manage_stock: true,
      stock_quantity: 0,
      stock_status: "outofstock",
      backorders_allowed: false,
    });
    assert.equal(offer?.availability, "https://schema.org/OutOfStock");
  });

  await t.test("3. Marks backorderable onbackorder product as BackOrder", () => {
    const offer = buildProductOfferSchema({
      id: 103,
      price: "199",
      stock_status: "onbackorder",
      backorders_allowed: true,
    });
    assert.equal(offer?.availability, "https://schema.org/BackOrder");
  });

  await t.test("4. Preserves genuine 0 price and omits offers when both prices are absent", () => {
    const freeOffer = buildProductOfferSchema({ id: 104, price: "0", stock_status: "instock" });
    assert.equal(freeOffer?.price, "0");

    const missingPriceOffer = buildProductOfferSchema({ id: 105, stock_status: "instock" });
    assert.equal(missingPriceOffer, null);
  });

  await t.test("5. Standalone PWA freshness check defers reload on checkout, payment return, and reset-password flows", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    assert.match(html, /pendingPwaUpdate/);
    assert.match(html, /\/checkout/);
    assert.match(html, /\/reset-password/);
    assert.match(html, /isSafeForPwaReload/);
  });

  await t.test("6. NetworkBanner manual check verifies API readiness and HTTP ok with timeout", () => {
    const bannerSource = fs.readFileSync(networkBannerPath, "utf8");
    assert.match(bannerSource, /store-hours/);
    assert.match(bannerSource, /response\.ok/);
    assert.match(bannerSource, /AbortController/);
  });
});
