import test from "node:test";
import assert from "node:assert/strict";
import { getCatalogImageUrl, getFullImageUrl } from "../src/utils/imageUtils.js";

test("getCatalogImageUrl: prefers thumbnail property when available", () => {
  const image = {
    id: 101,
    src: "http://localhost:5000/api/media/uploads/2026/09/stanley.jpg",
    thumbnail: "http://localhost:5000/api/media/uploads/2026/09/stanley-300x300.jpg",
    name: "stanley",
    alt: "Stanley mug",
  };

  const catalogUrl = getCatalogImageUrl(image);
  assert.equal(
    catalogUrl,
    "http://localhost:5000/api/media/uploads/2026/09/stanley-300x300.jpg",
    "Must select the 300x300 thumbnail for catalog/card rendering"
  );
});

test("getCatalogImageUrl: falls back to src if thumbnail is missing or empty", () => {
  const imageWithoutThumb = {
    id: 102,
    src: "http://localhost:5000/api/media/uploads/2026/09/item.webp",
  };

  const catalogUrl = getCatalogImageUrl(imageWithoutThumb);
  assert.equal(
    catalogUrl,
    "http://localhost:5000/api/media/uploads/2026/09/item.webp",
    "Must fallback to src when thumbnail is not present"
  );
});

test("getCatalogImageUrl: handles string, null, or undefined inputs gracefully", () => {
  assert.equal(
    getCatalogImageUrl("http://localhost:5000/api/media/uploads/manual.jpg"),
    "http://localhost:5000/api/media/uploads/manual.jpg"
  );
  assert.equal(getCatalogImageUrl(null), "");
  assert.equal(getCatalogImageUrl(undefined), "");
  assert.equal(getCatalogImageUrl({}), "");
});

test("getFullImageUrl: returns full-resolution src for hero/detail view", () => {
  const image = {
    id: 103,
    src: "http://localhost:5000/api/media/uploads/2026/09/hero_watch.jpg",
    thumbnail: "http://localhost:5000/api/media/uploads/2026/09/hero_watch-300x300.jpg",
  };

  const fullUrl = getFullImageUrl(image);
  assert.equal(
    fullUrl,
    "http://localhost:5000/api/media/uploads/2026/09/hero_watch.jpg",
    "Main detail view must use the high-resolution source image"
  );
});

test("getFullImageUrl: falls back to thumbnail if src is missing", () => {
  const imageWithThumbOnly = {
    id: 104,
    thumbnail: "http://localhost:5000/api/media/uploads/2026/09/thumb.jpg",
  };

  const fullUrl = getFullImageUrl(imageWithThumbOnly);
  assert.equal(fullUrl, "http://localhost:5000/api/media/uploads/2026/09/thumb.jpg");
});

test("getFullImageUrl: handles string, null, or undefined inputs gracefully", () => {
  assert.equal(
    getFullImageUrl("http://localhost:5000/api/media/uploads/test.webp"),
    "http://localhost:5000/api/media/uploads/test.webp"
  );
  assert.equal(getFullImageUrl(null), "");
  assert.equal(getFullImageUrl(undefined), "");
  assert.equal(getFullImageUrl({}), "");
});

test("WooCommerce product image payload end-to-end resolution", () => {
  // Realistic WooCommerce REST API product payload
  const product = {
    id: 256,
    name: "stanley",
    images: [
      {
        id: 254,
        src: "http://localhost:5000/api/media/uploads/2026/09/stanley.jpg",
        name: "stanley_photo",
        alt: "Stanley insulated cup",
        thumbnail: "http://localhost:5000/api/media/uploads/2026/09/stanley-300x300.jpg",
      },
      {
        id: 255,
        src: "http://localhost:5000/api/media/uploads/2026/09/stanley2.jpg",
        name: "stanley2_photo",
        alt: "Stanley angle 2",
        thumbnail: "http://localhost:5000/api/media/uploads/2026/09/stanley2-300x300.jpg",
      },
    ],
  };

  // 1. ProductCard representation
  const cardPrimary = product.images[0];
  const cardImage = getCatalogImageUrl(cardPrimary);
  assert.equal(cardImage, "http://localhost:5000/api/media/uploads/2026/09/stanley-300x300.jpg");

  // 2. ProductGallery main view representation
  const mainImage = getFullImageUrl(product.images[0]);
  assert.equal(mainImage, "http://localhost:5000/api/media/uploads/2026/09/stanley.jpg");

  // 3. ProductGallery thumbnail strip representation
  const thumbImages = product.images.map((img) => getCatalogImageUrl(img));
  assert.deepEqual(thumbImages, [
    "http://localhost:5000/api/media/uploads/2026/09/stanley-300x300.jpg",
    "http://localhost:5000/api/media/uploads/2026/09/stanley2-300x300.jpg",
  ]);
});
