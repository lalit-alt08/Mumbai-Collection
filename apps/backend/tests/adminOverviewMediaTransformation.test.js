import { test } from "node:test";
import assert from "node:assert/strict";
import { serverCache } from "../src/utils/memoryCache.js";
import { transformMediaUrls } from "../src/utils/mediaUrl.js";
import { getDashboardOverview } from "../src/controllers/adminAnalyticsController.js";

test("Overview Media & Low-Stock Image Audit Suite", async (t) => {
  await t.test("1. transformMediaUrls converts internal WordPress URLs to backend proxy URLs", () => {
    const rawProducts = [
      {
        id: 101,
        name: "Portronics Charger",
        image: "http://localhost:10004/wp-content/uploads/2026/11/charger.jpg",
        stock_quantity: 4,
        price: "300",
      },
      {
        id: 102,
        name: "DOMS 14 Shades Oil Pastel",
        image: "https://mumbai-collection.local/wp-content/uploads/2026/11/doms.jpg",
        stock_quantity: 4,
        price: "160",
      },
    ];

    const req = {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "api.mumbaicollection.in",
      },
    };

    const transformed = transformMediaUrls(rawProducts, req);

    assert.equal(
      transformed[0].image,
      "https://api.mumbaicollection.in/api/media/uploads/2026/11/charger.jpg",
      "Must rewrite localhost:10004 to https proxy"
    );
    assert.equal(
      transformed[1].image,
      "https://api.mumbaicollection.in/api/media/uploads/2026/11/doms.jpg",
      "Must rewrite mumbai-collection.local to https proxy"
    );
  });

  await t.test("2. transformMediaUrls preserves external CDN URLs, nulls, and data URIs untouched", () => {
    const mixedProducts = [
      {
        id: 201,
        name: "External Item",
        image: "https://images.unsplash.com/photo-12345.jpg",
      },
      {
        id: 202,
        name: "No Image Item",
        image: null,
      },
      {
        id: 203,
        name: "Data URI Item",
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
    ];

    const req = {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "api.mumbaicollection.in",
      },
    };

    const transformed = transformMediaUrls(mixedProducts, req);

    assert.equal(transformed[0].image, "https://images.unsplash.com/photo-12345.jpg");
    assert.equal(transformed[1].image, null);
    assert.ok(transformed[2].image.startsWith("data:image/png;base64,"));
  });

  await t.test("3. Cached overview payload is transformed dynamically on each request", () => {
    serverCache.clear();

    const cachedPayload = {
      success: true,
      summary: {},
      salesTrend: [],
      lowStockProducts: [
        {
          id: 301,
          name: "Test Low Stock",
          image: "http://localhost:10004/wp-content/uploads/2026/11/item.jpg",
          stock_quantity: 2,
        },
      ],
      data: {
        lowStockProducts: [
          {
            id: 301,
            name: "Test Low Stock",
            image: "http://localhost:10004/wp-content/uploads/2026/11/item.jpg",
            stock_quantity: 2,
          },
        ],
      },
    };

    serverCache.set("admin:analytics:overview", cachedPayload, 60000);

    const req = {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "admin-backend.vercel-proxy.com",
      },
    };

    const transformedList = transformMediaUrls(cachedPayload.lowStockProducts, req);
    assert.equal(
      transformedList[0].image,
      "https://admin-backend.vercel-proxy.com/api/media/uploads/2026/11/item.jpg"
    );

    serverCache.clear();
  });
});

test("cached admin overview is transformed for the current request host", async () => {
  const raw = [{ id: 1, image: "http://localhost:10004/wp-content/uploads/item.jpg" }];
  serverCache.set("admin:analytics:overview", { lowStockProducts: raw, data: { lowStockProducts: raw } }, 60000);
  const response = () => ({ set() { return this; }, json(body) { this.body = body; return this; } });
  try {
    const first = response();
    const second = response();
    await getDashboardOverview({ query: {}, headers: { "x-forwarded-host": "first.example", "x-forwarded-proto": "https" } }, first);
    await getDashboardOverview({ query: {}, headers: { "x-forwarded-host": "second.example", "x-forwarded-proto": "https" } }, second);
    assert.equal(first.body.lowStockProducts[0].image, "https://first.example/api/media/uploads/item.jpg");
    assert.equal(second.body.lowStockProducts[0].image, "https://second.example/api/media/uploads/item.jpg");
    assert.equal(serverCache.get("admin:analytics:overview").lowStockProducts[0].image, raw[0].image);
  } finally { serverCache.delete("admin:analytics:overview"); }
});
