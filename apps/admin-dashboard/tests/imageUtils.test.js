import test from "node:test";
import assert from "node:assert/strict";
import { resolveMediaUrl } from "../src/utils/imageUtils.js";

test("resolveMediaUrl transforms WordPress uploads to backend media proxy", () => {
  const wpUrl = "http://mumbai-collection.local/wp-content/uploads/2026/11/doms.jpg";
  const resolved = resolveMediaUrl(wpUrl);
  assert.ok(resolved.endsWith("/api/media/uploads/2026/11/doms.jpg"));
});

test("resolveMediaUrl leaves external CDN, data, and placeholder URLs untouched", () => {
  assert.equal(
    resolveMediaUrl("https://placehold.co/56x56?text=Item"),
    "https://placehold.co/56x56?text=Item"
  );
  assert.equal(
    resolveMediaUrl("data:image/svg+xml;utf8,<svg></svg>"),
    "data:image/svg+xml;utf8,<svg></svg>"
  );
  assert.equal(
    resolveMediaUrl("blob:http://localhost/123"),
    "blob:http://localhost/123"
  );
  assert.equal(resolveMediaUrl(""), "");
  assert.equal(resolveMediaUrl(null), "");
});

test("hosted images use the site's media route and external upload URLs remain external", () => {
  const previous = globalThis.window;
  globalThis.window = { location: { href: "https://admin.example/", origin: "https://admin.example", hostname: "admin.example", protocol: "https:" } };
  try {
    assert.equal(resolveMediaUrl("/api/media/uploads/picture.jpg"), "/api/media/uploads/picture.jpg");
    assert.equal(resolveMediaUrl("http://localhost:10004/wp-content/uploads/picture.jpg"), "/api/media/uploads/picture.jpg");
    assert.equal(resolveMediaUrl("https://cdn.example/wp-content/uploads/picture.jpg"), "https://cdn.example/wp-content/uploads/picture.jpg");
  } finally {
    globalThis.window = previous;
  }
});
