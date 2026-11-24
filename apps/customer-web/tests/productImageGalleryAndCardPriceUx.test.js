import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const galleryPath = path.resolve(__dirname, "../src/components/product/ProductGallery.jsx");
const productCardPath = path.resolve(__dirname, "../src/components/product/ProductCard.jsx");
const indexCssPath = path.resolve(__dirname, "../src/index.css");

test("Product Image Gallery Card & Product Card Mobile Price Suite", async (t) => {
  const gallerySource = fs.readFileSync(galleryPath, "utf8");
  const productCardSource = fs.readFileSync(productCardPath, "utf8");
  const indexCssSource = fs.readFileSync(indexCssPath, "utf8");

  await t.test("1. ProductGallery has dedicated classes for card, slider, and slide", () => {
    assert.ok(
      gallerySource.includes("product-gallery-card"),
      "ProductGallery must assign .product-gallery-card"
    );
    assert.ok(
      gallerySource.includes("product-gallery-slider"),
      "ProductGallery must assign .product-gallery-slider"
    );
    assert.ok(
      gallerySource.includes("product-gallery-slide"),
      "ProductGallery must assign .product-gallery-slide"
    );
  });

  await t.test("2. index.css forces pure white background for product-gallery-card in dark mode", () => {
    assert.ok(
      indexCssSource.includes('html[data-store-theme="dark"] .product-gallery-card'),
      "index.css must target .product-gallery-card in dark theme"
    );
    assert.ok(
      indexCssSource.includes("background-color: #FFFFFF !important;"),
      "index.css must force #FFFFFF background for gallery card so white product images blend seamlessly"
    );
  });

  await t.test("3. ProductCard aligns price properly on mobile without clipping next to stepper", () => {
    // Must stack or flex-col on mobile so regular price is not truncated next to stepper
    assert.ok(
      productCardSource.includes("flex-col") && productCardSource.includes("sm:flex-row"),
      "ProductCard price container must use flex-col on mobile and sm:flex-row on desktop"
    );
    assert.ok(
      productCardSource.includes("whitespace-nowrap"),
      "ProductCard strikethrough price must use whitespace-nowrap to prevent clipping"
    );
    assert.ok(
      !productCardSource.includes('line-through font-medium truncate'),
      "ProductCard strikethrough price must not truncate"
    );
  });

  await t.test("4. ProductCard stepper button has balanced symmetric touch targets", () => {
    assert.ok(
      productCardSource.includes("w-7 sm:w-8") &&
      productCardSource.includes("rounded-r-full"),
      "ProductCard '+' stepper button must have symmetric w-7 sm:w-8 sizing matching '-' button"
    );
  });
});
