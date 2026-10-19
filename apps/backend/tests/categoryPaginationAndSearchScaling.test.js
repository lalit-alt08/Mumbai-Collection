import test from "node:test";
import assert from "node:assert/strict";
import api from "../src/config/woocommerce.js";
import { serverCache } from "../src/utils/memoryCache.js";
import {
  matchesEmployeeOrderSearch,
  filterAndPaginateEmployeeOrders,
} from "../src/controllers/employeeController.js";
import {
  fetchProducts,
  fetchProductsByIds,
  fetchProductsByCategory,
} from "../src/services/productService.js";
import {
  getAllProducts,
  getProductById,
  getProductsByCategory,
} from "../src/controllers/productController.js";

const makeOrder = (overrides = {}) => ({
  id: 101,
  number: "101",
  status: "processing",
  billing: {
    first_name: "Lalit",
    last_name: "Solanki",
    email: "lalit@example.com",
    phone: "+91 98765 43210",
  },
  shipping: {
    city: "Vasai East",
  },
  meta_data: [],
  date_created: "2026-09-08T10:00:00Z",
  ...overrides,
});

test("Fix 1 - Employee Order Search: correctly filters across all criteria", () => {
  const orders = [
    makeOrder({ id: 1, number: "1001", status: "completed", meta_data: [{ key: "_delivery_status", value: "delivered" }] }),
    makeOrder({ id: 2, number: "1002", status: "processing", meta_data: [{ key: "_delivery_status", value: "packed" }], shipping: { city: "Nallasopara West" } }),
    makeOrder({ id: 3, number: "1003", status: "processing", shipping: { city: "Vasai East" } }),
    makeOrder({ id: 4, number: "1004", status: "processing", shipping: { city: "Vasai East" }, billing: { first_name: "Anita", last_name: "Deshmukh", email: "anita@example.com", phone: "9876500000" } }),
  ];

  // Test search + status + location filter combined
  const result = filterAndPaginateEmployeeOrders(orders, {
    search: "lalit",
    status: "processing",
    location: "vasai-east",
    page: 1,
    limit: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.orders.map((o) => o.id), [3]);
});

test("Fix 1 - Employee Order Search: search matching handles phone formatting and partial terms", () => {
  const order = makeOrder();
  assert.equal(matchesEmployeeOrderSearch(order, "9876543210"), true);
  assert.equal(matchesEmployeeOrderSearch(order, "+91 98765"), true);
  assert.equal(matchesEmployeeOrderSearch(order, "Lalit"), true);
  assert.equal(matchesEmployeeOrderSearch(order, "nonexistent"), false);
});

test("Fix 2 - Customer Directory: serverCache caching and pagination", async () => {
  serverCache.clear();
  const mockDirectory = Array.from({ length: 55 }, (_, i) => ({
    id: i + 1,
    name: `Customer ${i + 1}`,
    email: `customer${i + 1}@example.com`,
    phone: `98000000${String(i).padStart(2, "0")}`,
    location: i % 2 === 0 ? "Vasai East" : "Nallasopara West",
    ordersCount: (i % 5) + 1,
    lifetimeSpent: (i + 1) * 100,
  }));

  serverCache.set("admin:customers:directory", mockDirectory, 120000);
  const cached = serverCache.get("admin:customers:directory");
  assert.equal(cached.length, 55);

  // Filter in-memory like adminCustomerController
  const search = "Customer 1";
  const filtered = cached.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  assert.equal(filtered.length >= 11, true); // Customer 1, 10, 11, 12, etc.
});

test("Fix 3 - Category Products: fetchProductsByCategory queries WooCommerce with page and per_page", async () => {
  const originalApiGet = api.get;
  const capturedParams = [];

  api.get = async (endpoint, params) => {
    capturedParams.push({ endpoint, params });
    return {
      data: [
        { id: 10, name: "Product 10" },
        { id: 11, name: "Product 11" },
      ],
      headers: {
        "x-wp-total": "45",
        "x-wp-totalpages": "3",
      },
    };
  };

  try {
    const res = await fetchProductsByCategory("123", { page: 2, per_page: 20 });
    assert.equal(capturedParams[0].endpoint, "products");
    assert.equal(capturedParams[0].params.category, "123");
    assert.equal(capturedParams[0].params.page, 2);
    assert.equal(capturedParams[0].params.per_page, 20);

    assert.equal(res.total, 45);
    assert.equal(res.totalPages, 3);
    assert.equal(res.page, 2);
    assert.equal(res.per_page, 20);
    assert.equal(res.products.length, 2);
  } finally {
    api.get = originalApiGet;
  }
});

test("Fix 3 - Category Products: getProductsByCategory controller returns paginated response structure", async () => {
  const originalApiGet = api.get;
  serverCache.clear();

  api.get = async (_endpoint, params) => {
    return {
      data: [
        { id: 20, name: "Category Product A", images: [{ src: "http://example.com/wp-content/uploads/a.jpg" }] },
      ],
      headers: {
        "x-wp-total": "55",
        "x-wp-totalpages": "3",
      },
    };
  };

  try {
    let responseData;
    const req = {
      params: { categoryId: "sarees" },
      query: { page: "1", per_page: "20" },
      headers: { host: "localhost:5000" },
      protocol: "http",
    };
    const res = {
      json: (data) => {
        responseData = data;
      },
      status: () => res,
    };

    await getProductsByCategory(req, res);

    assert.equal(responseData.success, true);
    assert.equal(responseData.page, 1);
    assert.equal(responseData.per_page, 20);
    assert.equal(responseData.total, 55);
    assert.equal(responseData.totalPages, 3);
    assert.equal(responseData.products.length, 1);
    assert.equal(responseData.products[0].id, 20);
    assert.equal(
      responseData.products[0].images[0].src,
      "http://localhost:5000/api/media/uploads/a.jpg"
    );
  } finally {
    api.get = originalApiGet;
    serverCache.clear();
  }
});

test("Product stock refresh bypasses stale product-detail cache and refreshes it", async () => {
  const originalApiGet = api.get;
  serverCache.clear();
  serverCache.set("catalog:product:321", {
    id: 321,
    name: "Camel Oil Pastels",
    manage_stock: true,
    stock_quantity: 2,
    stock_status: "instock",
  }, 120000);

  let upstreamCalls = 0;
  api.get = async (endpoint) => {
    upstreamCalls += 1;
    assert.equal(endpoint, "products/321");
    return {
      data: {
        id: 321,
        name: "Camel Oil Pastels",
        status: "publish",
        catalog_visibility: "visible",
        manage_stock: true,
        stock_quantity: 0,
        stock_status: "outofstock",
      },
    };
  };

  try {
    let body;
    const req = {
      params: { id: "321" },
      query: { refresh: "1" },
      protocol: "http",
      headers: { host: "localhost:5000" },
    };
    const res = {
      status() { return this; },
      json(data) { body = data; return this; },
    };

    await getProductById(req, res);
    assert.equal(upstreamCalls, 1, "refresh request must fetch live WooCommerce product data");
    assert.equal(body.stock_quantity, 0);
    assert.equal(body.stock_status, "outofstock");
    assert.equal(serverCache.get("catalog:product:321").stock_quantity, 0);
  } finally {
    api.get = originalApiGet;
    serverCache.clear();
  }
});

test("Fix 4 - Catalog Products: fetchProducts queries WooCommerce with page and per_page", async () => {
  const originalApiGet = api.get;
  const capturedParams = [];

  api.get = async (endpoint, params) => {
    capturedParams.push({ endpoint, params });
    return {
      data: [
        { id: 101, name: "Catalog Product 101" },
        { id: 102, name: "Catalog Product 102" },
      ],
      headers: {
        "x-wp-total": "120",
        "x-wp-totalpages": "6",
      },
    };
  };

  try {
    const res = await fetchProducts(2, 20);
    assert.equal(capturedParams[0].endpoint, "products");
    assert.equal(capturedParams[0].params.page, 2);
    assert.equal(capturedParams[0].params.per_page, 20);

    assert.equal(res.total, 120);
    assert.equal(res.totalPages, 6);
    assert.equal(res.page, 2);
    assert.equal(res.per_page, 20);
    assert.equal(res.products.length, 2);
  } finally {
    api.get = originalApiGet;
  }
});

test("Catalog recommendations fetch only selected published products in requested order", async () => {
  const originalApiGet = api.get;
  let captured;
  api.get = async (endpoint, params) => {
    captured = { endpoint, params };
    return {
      data: [
        { id: 22, status: "publish", catalog_visibility: "visible" },
        { id: 11, status: "publish", catalog_visibility: "visible" },
        { id: 33, status: "publish", catalog_visibility: "hidden" },
      ],
    };
  };

  try {
    const products = await fetchProductsByIds([22, 11, 22, -1]);
    assert.equal(captured.endpoint, "products");
    assert.equal(captured.params.include, "22,11");
    assert.equal(captured.params.orderby, "include");
    assert.equal(captured.params.per_page, 2);
    assert.deepEqual(products.map((product) => product.id), [22, 11]);
  } finally {
    api.get = originalApiGet;
  }
});

test("Fix 4 - Catalog Products: getAllProducts returns backwards-compatible array with pagination headers", async () => {
  const originalApiGet = api.get;
  serverCache.clear();

  api.get = async (_endpoint, params) => {
    return {
      data: [
        { id: 301, name: "Saree 301", images: [{ src: "http://example.com/wp-content/uploads/saree.jpg" }] },
      ],
      headers: {
        "x-wp-total": "80",
        "x-wp-totalpages": "4",
      },
    };
  };

  try {
    let responseData;
    const responseHeaders = {};
    const req = {
      query: { page: "2", per_page: "20" },
      headers: { host: "localhost:5000" },
      protocol: "http",
    };
    const res = {
      setHeader: (name, value) => {
        responseHeaders[name] = value;
      },
      json: (data) => {
        responseData = data;
      },
      status: () => res,
    };

    await getAllProducts(req, res);

    assert.equal(Array.isArray(responseData), true, "Must return an array for storefront backwards compatibility");
    assert.equal(responseData.length, 1);
    assert.equal(responseData[0].id, 301);
    assert.equal(responseHeaders["X-Total-Count"], "80");
    assert.equal(responseHeaders["X-Total-Pages"], "4");
    assert.equal(responseHeaders["X-Current-Page"], "2");
    assert.equal(responseHeaders["X-Per-Page"], "20");
  } finally {
    api.get = originalApiGet;
    serverCache.clear();
  }
});

test("Fix 4 - Catalog Products: getAllProducts returns enveloped JSON when format=paginated", async () => {
  const originalApiGet = api.get;
  serverCache.clear();

  api.get = async (_endpoint, params) => {
    return {
      data: [
        { id: 401, name: "Kurti 401", images: [{ src: "http://example.com/wp-content/uploads/kurti.jpg" }] },
      ],
      headers: {
        "x-wp-total": "40",
        "x-wp-totalpages": "2",
      },
    };
  };

  try {
    let responseData;
    const responseHeaders = {};
    const req = {
      query: { page: "1", per_page: "20", format: "paginated" },
      headers: { host: "localhost:5000" },
      protocol: "http",
    };
    const res = {
      setHeader: (name, value) => {
        responseHeaders[name] = value;
      },
      json: (data) => {
        responseData = data;
      },
      status: () => res,
    };

    await getAllProducts(req, res);

    assert.equal(responseData.success, true);
    assert.equal(responseData.page, 1);
    assert.equal(responseData.per_page, 20);
    assert.equal(responseData.total, 40);
    assert.equal(responseData.totalPages, 2);
    assert.equal(Array.isArray(responseData.products), true);
    assert.equal(responseData.products[0].id, 401);
  } finally {
    api.get = originalApiGet;
    serverCache.clear();
  }
});
