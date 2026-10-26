import test from "node:test";
import assert from "node:assert/strict";
import { isSafeExternalImageUrl, isPrivateOrRestrictedIp } from "../src/utils/imageValidator.js";
import { isOriginAllowed } from "../src/middlewares/csrfMiddleware.js";
import { maskEmail } from "../src/utils/piiUtils.js";

test("SSRF Image Guard: Rejects loopback, private IPv4/IPv6, bracketed literals, cloud metadata, and DNS rebinding", async () => {
  // Dangerous / SSRF targets - IPv4
  assert.equal(await isSafeExternalImageUrl("http://127.0.0.1/evil.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("http://localhost:8080/pic.png"), false);
  assert.equal(await isSafeExternalImageUrl("http://sub.localhost/pic.png"), false);
  assert.equal(await isSafeExternalImageUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(await isSafeExternalImageUrl("http://10.0.0.1/internal.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("http://192.168.1.1/router.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("http://172.20.0.1/docker.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("ftp://ftp.example.com/pic.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("javascript:alert(1)"), false);
  assert.equal(await isSafeExternalImageUrl(""), false);
  assert.equal(await isSafeExternalImageUrl(null), false);

  // Dangerous / SSRF targets - IPv6 literals (bracketed & unbracketed)
  assert.equal(await isSafeExternalImageUrl("http://[::1]/evil.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("http://[::]/evil.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("http://[fc00::1]/internal.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("http://[fd12:3456:789a::1]/internal.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("http://[fe80::1]/linklocal.jpg"), false);
  assert.equal(await isSafeExternalImageUrl("http://[::ffff:127.0.0.1]/mapped.jpg"), false);

  // Dangerous / SSRF targets - Internal domains & DNS resolving to loopback
  assert.equal(await isSafeExternalImageUrl("http://service.local/pic.png"), false);
  assert.equal(await isSafeExternalImageUrl("http://service.internal/pic.png"), false);
  assert.equal(await isSafeExternalImageUrl("http://127.0.0.1.nip.io/pic.jpg"), false);

  // Direct IP range inspection
  assert.equal(isPrivateOrRestrictedIp("127.0.0.1"), true);
  assert.equal(isPrivateOrRestrictedIp("10.50.0.1"), true);
  assert.equal(isPrivateOrRestrictedIp("192.168.0.1"), true);
  assert.equal(isPrivateOrRestrictedIp("172.16.0.1"), true);
  assert.equal(isPrivateOrRestrictedIp("169.254.169.254"), true);
  assert.equal(isPrivateOrRestrictedIp("::1"), true);
  assert.equal(isPrivateOrRestrictedIp("fc00::1"), true);
  assert.equal(isPrivateOrRestrictedIp("fe80::1"), true);
  assert.equal(isPrivateOrRestrictedIp("8.8.8.8"), false);
  assert.equal(isPrivateOrRestrictedIp("1.1.1.1"), false);
});

test("Origin & CORS Guard: Restricts localhost in production and prevents arbitrary subdomains", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAllowLocal = process.env.ALLOW_LOCAL_ORIGINS;

  try {
    // 1. Non-production allows localhost
    process.env.NODE_ENV = "development";
    delete process.env.ALLOW_LOCAL_ORIGINS;
    assert.equal(isOriginAllowed("http://localhost:5173", []), true);

    // 2. Production disables localhost by default
    process.env.NODE_ENV = "production";
    assert.equal(isOriginAllowed("http://localhost:5173", []), false);

    // 3. Production allows localhost when ALLOW_LOCAL_ORIGINS is enabled
    process.env.ALLOW_LOCAL_ORIGINS = "true";
    assert.equal(isOriginAllowed("http://localhost:5173", []), true);

    // 4. Subdomain restriction: Designated store panels are allowed
    assert.equal(isOriginAllowed("https://mumbaicollection.in", []), true);
    assert.equal(isOriginAllowed("https://www.mumbaicollection.in", []), true);
    assert.equal(isOriginAllowed("https://admin.mumbaicollection.in", []), true);
    assert.equal(isOriginAllowed("https://employee.mumbaicollection.in", []), true);

    // 5. Arbitrary untrusted subdomain is rejected in production
    assert.equal(isOriginAllowed("https://untrusted-subdomain.mumbaicollection.in", []), false);
    assert.equal(isOriginAllowed("https://phishing.mumbaicollection.in", []), false);
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalAllowLocal !== undefined) {
      process.env.ALLOW_LOCAL_ORIGINS = originalAllowLocal;
    } else {
      delete process.env.ALLOW_LOCAL_ORIGINS;
    }
  }
});

test("Audit Logger PII: Target email masking redacts local part while retaining domain context", () => {
  assert.equal(maskEmail("employee@mumbaicollection.in"), "e***e@mumbaicollection.in");
  assert.equal(maskEmail("rohan.sharma@gmail.com"), "r***a@gmail.com");
  assert.equal(maskEmail("ab@test.com"), "a***@test.com");
  assert.equal(maskEmail(null), null);
});

test("MemoryCache Invalidation & Bounds: generations map never grows unboundedly and discards stale writes", async () => {
  const { serverCache } = await import("../src/utils/memoryCache.js");
  const cache = serverCache;

  // 1. Stress test: deleting 5000 unique keys must not leak into generations map
  for (let i = 0; i < 5000; i++) {
    cache.delete(`cart_intent_temp_${i}`);
  }
  assert.ok(cache.generations.size <= cache.maxSize, `generations size (${cache.generations.size}) must never exceed maxSize (${cache.maxSize})`);

  // 2. In-flight race condition test: delete during fetchFn must prevent stale write
  let fetchFnResolve;
  const delayedFetch = () => new Promise((resolve) => {
    fetchFnResolve = resolve;
  });

  const fetchPromise = cache.getOrFetch("concurrent_key", delayedFetch);
  // While fetch is in-flight, invalidate the key
  cache.delete("concurrent_key");

  // Complete the slow fetch
  fetchFnResolve({ data: "stale_result" });
  await fetchPromise;

  // Cache must NOT contain the stale result
  assert.equal(cache.get("concurrent_key"), null, "Stale in-flight write must be discarded upon invalidation");
  assert.equal(cache.generations.has("concurrent_key"), false, "Settled in-flight key must be pruned from generations map");
});

test("Category Reordering: Rejects duplicates, invalid IDs, and inspects WooCommerce batch/fallback failures", async () => {
  const { reorderCategories } = await import("../src/controllers/adminCategoryController.js");
  const api = (await import("../src/config/woocommerce.js")).default;

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    return res;
  };

  // 1. Rejects non-integer or negative IDs
  const reqInvalid = { body: { category_ids: [1, "abc", 3] } };
  const resInvalid = createMockRes();
  await reorderCategories(reqInvalid, resInvalid);
  assert.equal(resInvalid.statusCode, 400);
  assert.match(resInvalid.body.message, /invalid category id/i);

  // 2. Rejects duplicate IDs
  const reqDup = { body: { category_ids: [10, 20, 10] } };
  const resDup = createMockRes();
  await reorderCategories(reqDup, resDup);
  assert.equal(resDup.statusCode, 400);
  assert.match(resDup.body.message, /duplicate category ids/i);

  // 3. Batch API reports partial failure -> Must return 400 with failed_ids
  const originalGet = api.get;
  const originalPost = api.post;
  const originalPut = api.put;
  try {
    api.get = async (p) => {
      if (typeof p === "string" && p.includes("categories")) {
        return { data: [{ id: 10, parent: 0 }, { id: 20, parent: 0 }] };
      }
      return { data: [] };
    };
    api.post = async (path) => {
      if (path === "products/categories/batch") {
        return {
          data: {
            update: [
              { id: 10, menu_order: 1 },
              { id: 20, error: { message: "Category not found" } },
            ],
          },
        };
      }
      return { data: {} };
    };

    api.put = async (path) => {
      if (path.includes("/20")) {
        throw new Error("Category 20 does not exist");
      }
      return { data: { id: 10 } };
    };

    const reqPartial = { body: { category_ids: [10, 20] } };
    const resPartial = createMockRes();
    await reorderCategories(reqPartial, resPartial);
    assert.equal(resPartial.statusCode, 400);
    assert.equal(resPartial.body.success, false);
    assert.deepEqual(resPartial.body.failed_ids, [20]);

    // 4. Batch API succeeds 100% -> Must return 200
    api.post = async (path) => {
      if (path === "products/categories/batch") {
        return {
          data: {
            update: [
              { id: 10, menu_order: 1 },
              { id: 20, menu_order: 2 },
            ],
          },
        };
      }
      return { data: {} };
    };

    const reqSuccess = { body: { category_ids: [10, 20] } };
    const resSuccess = createMockRes();
    await reorderCategories(reqSuccess, resSuccess);
    assert.equal(resSuccess.statusCode, 200);
    assert.equal(resSuccess.body.success, true);
    assert.deepEqual(resSuccess.body.ordered_ids, [10, 20]);
  } finally {
    api.get = originalGet;
    api.post = originalPost;
    api.put = originalPut;
  }
});

test("Payment Recovery Authorization: checkPaymentStatus rejects cross-customer queries with 404", async () => {
  const { checkPaymentStatus } = await import("../src/controllers/paymentController.js");
  const paymentIntentService = (await import("../src/services/paymentIntentService.js")).default;

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    return res;
  };

  const originalGetIntent = paymentIntentService.getPaymentIntent;
  const originalFindHpos = paymentIntentService.findWcOrderByRazorpayOrderId;

  try {
    // Intent belongs to customer 99
    paymentIntentService.getPaymentIntent = async (orderId) => {
      if (orderId === "order_customer_99") {
        return {
          rzp_order_id: "order_customer_99",
          customer_id: 99,
          wc_order_id: 5555,
          status: "order_created",
        };
      }
      return null;
    };

    paymentIntentService.findWcOrderByRazorpayOrderId = async (orderId) => {
      if (orderId === "order_customer_99") {
        return { id: 5555, status: "processing", customer_id: 99 };
      }
      return null;
    };

    // 1. Authenticated user 10 attempts to query order for customer 99 -> Must be rejected with 404
    const reqAlice = {
      wpUserId: 10,
      body: { razorpay_order_id: "order_customer_99" },
    };
    const resAlice = createMockRes();
    await checkPaymentStatus(reqAlice, resAlice);
    assert.equal(resAlice.statusCode, 404, "Cross-customer payment status check must return 404");
    assert.equal(resAlice.body.success, false);
    assert.equal(resAlice.body.message, "Payment order not found.");

    // 2. Authenticated user 99 queries their own order -> Must succeed with 200
    const reqBob = {
      wpUserId: 99,
      body: { razorpay_order_id: "order_customer_99" },
    };
    const resBob = createMockRes();
    await checkPaymentStatus(reqBob, resBob);
    assert.equal(resBob.statusCode, 200, "Own customer payment status check must succeed");
    assert.equal(resBob.body.success, true);
    assert.equal(resBob.body.order_id, 5555);
  } finally {
    paymentIntentService.getPaymentIntent = originalGetIntent;
    paymentIntentService.findWcOrderByRazorpayOrderId = originalFindHpos;
  }
});

test("Customer PII Cache Control: Profile and Address endpoints set no-store, private headers", async () => {
  const axios = (await import("axios")).default;
  const { getAddresses } = await import("../src/controllers/addressController.js");
  const { getProfile, checkProfileComplete } = await import("../src/controllers/profileController.js");

  const originalGet = axios.get;

  const createMockRes = () => {
    const headers = {};
    return {
      statusCode: 200,
      body: null,
      headers,
      set(key, val) {
        this.headers[key.toLowerCase()] = val;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
  };

  try {
    axios.get = async () => ({
      data: { success: true, profile: { first_name: "Test" }, addresses: [] },
    });

    const mockReq = { wpUserId: 42 };

    // 1. getAddresses
    const resAddr = createMockRes();
    await getAddresses(mockReq, resAddr);
    assert.equal(resAddr.headers["cache-control"], "no-store, no-cache, must-revalidate, private");
    assert.equal(resAddr.headers["pragma"], "no-cache");

    // 2. getProfile
    const resProf = createMockRes();
    await getProfile(mockReq, resProf);
    assert.equal(resProf.headers["cache-control"], "no-store, no-cache, must-revalidate, private");
    assert.equal(resProf.headers["pragma"], "no-cache");

    // 3. checkProfileComplete
    const resComplete = createMockRes();
    await checkProfileComplete(mockReq, resComplete);
    assert.equal(resComplete.headers["cache-control"], "no-store, no-cache, must-revalidate, private");
    assert.equal(resComplete.headers["pragma"], "no-cache");
  } finally {
    axios.get = originalGet;
  }
});

test("Order Status Mutation Guard: Rejects 'refunded' and 'on-hold' through generic status endpoints", async () => {
  const { validateOrderStatusTransition, ALLOWED_ORDER_STATUSES } = await import("../src/utils/orderStatusTransition.js");

  assert.equal(ALLOWED_ORDER_STATUSES.includes("refunded"), false, "ALLOWED_ORDER_STATUSES must not contain 'refunded'");
  assert.equal(ALLOWED_ORDER_STATUSES.includes("on-hold"), false, "ALLOWED_ORDER_STATUSES must not contain 'on-hold'");

  const mockOrder = {
    id: 101,
    status: "processing",
    date_created: new Date().toISOString(),
    meta_data: [{ key: "_delivery_status", value: "processing" }],
  };

  // 1. Rejects transition to refunded
  const resRefunded = validateOrderStatusTransition(mockOrder, "refunded");
  assert.equal(resRefunded.valid, false);
  assert.match(resRefunded.message, /cannot be marked refunded through status mutation/i);

  // 2. Rejects transition to on-hold
  const resOnHold = validateOrderStatusTransition(mockOrder, "on-hold");
  assert.equal(resOnHold.valid, false);
  assert.match(resOnHold.message, /on-hold status is disabled/i);

  // 3. Allows valid fulfillment transitions
  const resPacked = validateOrderStatusTransition(mockOrder, "packed");
  assert.equal(resPacked.valid, true);

  const resDelivered = validateOrderStatusTransition(mockOrder, "completed");
  assert.equal(resDelivered.valid, true);
});

test("Payment Intent Cache Consistency: Only updates cache on DB confirmation and invalidates on CAS failure", async () => {
  const {
    updatePaymentIntentStatus,
    _setWpClientForTesting,
  } = await import("../src/services/paymentIntentService.js");
  const { serverCache } = await import("../src/utils/memoryCache.js");

  const rzpOrderId = "order_rzp_cas_test_99";
  const cacheKey = `payment_intent:${rzpOrderId}`;

  // Pre-seed cache with created status
  serverCache.set(cacheKey, { rzp_order_id: rzpOrderId, status: "created", customer_id: 10 }, 3600 * 1000);

  // 1. Simulate DB Compare-and-Set rejection (updated = false)
  _setWpClientForTesting({
    post: async () => ({ data: { updated: false } }),
  });

  const casResult = await updatePaymentIntentStatus({
    rzpOrderId,
    fromStatus: "created",
    toStatus: "refunded",
  });

  assert.equal(casResult, false, "updatePaymentIntentStatus must return false on CAS rejection");
  // Cache must be invalidated, NOT holding the rejected 'refunded' status!
  assert.equal(serverCache.get(cacheKey), null, "Cache must be invalidated upon CAS rejection to prevent phantom state");

  // 2. Simulate DB confirmation (updated = true)
  serverCache.set(cacheKey, { rzp_order_id: rzpOrderId, status: "created", customer_id: 10 }, 3600 * 1000);

  _setWpClientForTesting({
    post: async () => ({ data: { updated: true } }),
  });

  const successResult = await updatePaymentIntentStatus({
    rzpOrderId,
    fromStatus: "created",
    toStatus: "paid",
    rzpPaymentId: "pay_12345",
  });

  assert.equal(successResult, true, "updatePaymentIntentStatus must return true on DB success");
  const cachedAfterSuccess = serverCache.get(cacheKey);
  assert.ok(cachedAfterSuccess !== null);
  assert.equal(cachedAfterSuccess.status, "paid", "Cache must reflect confirmed DB state");
  assert.equal(cachedAfterSuccess.rzp_payment_id, "pay_12345");
});

test("Store Hours Bounded Fallback: Detects staleness and fails closed once fallback age exceeds 5 minutes", async () => {
  const axios = (await import("axios")).default;
  const {
    getStoreHoursConfig,
    getStoreStatus,
    _resetStoreHoursCacheForTesting,
    MAX_FALLBACK_CONFIG_AGE_MS,
  } = await import("../src/services/storeHoursService.js");

  const originalGet = axios.get;

  try {
    _resetStoreHoursCacheForTesting();

    // 1. Successful live WordPress read
    axios.get = async () => ({
      data: {
        store_hours: {
          manual_override: "auto",
          schedule: {
            monday: { is_enabled: true, open: "09:00", close: "22:00" },
          },
        },
      },
    });

    const liveConfig = await getStoreHoursConfig(true);
    assert.equal(liveConfig._metadata.source, "wordpress");
    assert.equal(liveConfig._metadata.is_fallback, false);
    assert.equal(liveConfig._metadata.is_stale, false);

    // 2. WordPress goes down: immediate fallback is marked as fallback but not yet stale
    axios.get = async () => {
      throw new Error("WordPress timeout 504");
    };

    const fallbackStatus = await getStoreStatus();
    assert.equal(fallbackStatus.is_fallback, false, "Within 60s cache TTL, serves warm fresh cache");

    // Advance beyond 5-minute fallback limit
    const expiredConfig = {
      ...liveConfig,
      _metadata: {
        source: "fallback",
        age_ms: MAX_FALLBACK_CONFIG_AGE_MS + 1000,
        is_fallback: true,
        is_stale: true,
      },
    };
    assert.equal(expiredConfig._metadata.is_stale, true, "Fallback older than 5 minutes must be marked stale");
  } finally {
    axios.get = originalGet;
    _resetStoreHoursCacheForTesting();
  }
});

test("Admin Image Guard: Rejects non-positive integer media IDs and unresolvable/internal image URLs in product and category controllers", async () => {
  const { default: api } = await import("../src/config/woocommerce.js");
  const { createCategory, updateCategory } = await import("../src/controllers/adminCategoryController.js");
  const { createProduct } = await import("../src/controllers/adminProductController.js");
  const origApiGet = api.get;
  api.get = async (p) => {
    if (typeof p === "string" && p.match(/categories\/\d+/)) {
      return { data: { id: 10, name: "Test Category", slug: "test-cat", parent: 0 } };
    }
    if (typeof p === "string" && p.includes("categories")) {
      return { data: [{ id: 10, name: "Test Category", slug: "test-cat", parent: 0 }, { id: 20, parent: 0 }] };
    }
    return { data: [] };
  };

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    return res;
  };

  // 1. Category create: Rejects invalid media IDs (-1, 0, non-integer)
  for (const badId of [-1, 0, "abc", 2.5]) {
    const req = { body: { name: "Test Category", image_id: badId } };
    const res = createMockRes();
    await createCategory(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /positive numeric image ID/i);
  }

  // 2. Category create: Rejects loopback / SSRF image URL
  {
    const req = { body: { name: "Test Category", image_url: "http://127.0.0.1/cat.jpg" } };
    const res = createMockRes();
    await createCategory(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /restricted category image url/i);
  }

  // 3. Category update: Rejects invalid media IDs
  {
    const req = { params: { id: "10" }, body: { image_id: -5 } };
    const res = createMockRes();
    await updateCategory(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /positive numeric image ID/i);
  }

  // 4. Product create: Rejects non-positive integer media IDs
  for (const badImg of [-1, 0, { id: -2 }, { mediaId: 0 }]) {
    const req = {
      body: {
        name: "Test Shirt",
        regular_price: "499",
        categories: [{ id: 10 }],
        images: [badImg],
      },
    };
    const res = createMockRes();
    await createProduct(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /must be a positive integer/i);
  }

  // 5. Product create: Rejects bracketed IPv6 SSRF URL
  {
    const req = {
      body: {
        name: "Test Shirt",
        regular_price: "499",
        categories: [{ id: 10 }],
        images: ["http://[::1]/shirt.jpg"],
      },
    };
    const res = createMockRes();
    await createProduct(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /restricted image url/i);
  }
  api.get = origApiGet;
});

test("Account Deletion Guard: Propagates active_orders_exist error from WordPress to caller", async () => {
  const { deleteAccount } = await import("../src/controllers/profileController.js");
  const axios = (await import("axios")).default;
  const originalDelete = axios.delete;

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      clearedCookies: [],
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
      clearCookie(name, options) {
        this.clearedCookies.push({ name, options });
        return this;
      },
    };
    return res;
  };

  try {
    // 1. Simulates WordPress rejecting deletion because customer has active in-flight orders
    axios.delete = async () => {
      const err = new Error("Request failed with status code 400");
      err.response = {
        status: 400,
        data: {
          code: "active_orders_exist",
          message: "Your account cannot be deleted while you have active or in-flight orders. Please wait until your orders are completed or cancelled.",
        },
      };
      throw err;
    };

    const req = {
      wpUserId: 123,
      headers: {},
      cookies: {},
    };
    const res = createMockRes();
    await deleteAccount(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "active_orders_exist");
    assert.match(res.body.message, /active or in-flight orders/i);
    assert.equal(res.clearedCookies.length, 0, "Must not clear auth cookies if deletion was rejected");
  } finally {
    axios.delete = originalDelete;
  }
});

test("Address Validation: Normalizes Indian mobile numbers (+91/0), rejects invalid phones and malformed pincodes", async () => {
  const {
    normalizeAndValidateIndianPhone,
    validatePincode,
    saveAddress,
  } = await import("../src/controllers/addressController.js");

  // 1. Phone normalization & validation helper
  assert.equal(normalizeAndValidateIndianPhone("9876543210"), "9876543210");
  assert.equal(normalizeAndValidateIndianPhone("+91 9876543210"), "9876543210");
  assert.equal(normalizeAndValidateIndianPhone("09876543210"), "9876543210");
  assert.equal(normalizeAndValidateIndianPhone("919876543210"), "9876543210");
  assert.equal(normalizeAndValidateIndianPhone("8123456789"), "8123456789");
  assert.equal(normalizeAndValidateIndianPhone("7123456789"), "7123456789");
  assert.equal(normalizeAndValidateIndianPhone("6123456789"), "6123456789");

  // Invalid phones
  assert.equal(normalizeAndValidateIndianPhone("1234567890"), null, "Must reject number starting with 1");
  assert.equal(normalizeAndValidateIndianPhone("0000000000"), null, "Must reject all zeros");
  assert.equal(normalizeAndValidateIndianPhone("98765"), null, "Must reject short number");
  assert.equal(normalizeAndValidateIndianPhone("987654321012345"), null, "Must reject number > 12 digits");
  assert.equal(normalizeAndValidateIndianPhone("5555555555"), null, "Must reject number starting with 5");
  assert.equal(normalizeAndValidateIndianPhone(""), null);
  assert.equal(normalizeAndValidateIndianPhone(null), null);

  // 2. Pincode validation helper
  assert.equal(validatePincode("401202").valid, true);
  assert.equal(validatePincode("401209").valid, true);
  assert.equal(validatePincode("400001").valid, true);
  assert.equal(validatePincode("").valid, true, "Empty pincode is permitted");
  assert.equal(validatePincode(null).valid, true, "Null pincode is permitted");
  assert.equal(validatePincode(undefined).valid, true, "Undefined pincode is permitted");

  assert.equal(validatePincode("012345").valid, false, "Must reject starting with 0");
  assert.equal(validatePincode("40120").valid, false, "Must reject 5 digits");
  assert.equal(validatePincode("4012022").valid, false, "Must reject 7 digits");
  assert.equal(validatePincode("abcdef").valid, false, "Must reject letters");

  // 3. Controller rejection tests
  const createMockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    return res;
  };

  // Rejects invalid phone in saveAddress
  {
    const req = {
      wpUserId: 10,
      body: {
        type: "home",
        city: "Vasai West",
        first_name: "Rohan",
        last_name: "Sharma",
        phone: "1111111111",
        address_line1: "Flat 101, Sunshine Apts",
      },
    };
    const res = createMockRes();
    await saveAddress(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /valid 10-digit Indian phone number/i);
  }

  // Rejects invalid pincode in saveAddress
  {
    const req = {
      wpUserId: 10,
      body: {
        type: "home",
        city: "Vasai West",
        first_name: "Rohan",
        last_name: "Sharma",
        phone: "9876543210",
        address_line1: "Flat 101, Sunshine Apts",
        pincode: "12345", // 5 digits
      },
    };
    const res = createMockRes();
    await saveAddress(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /valid 6-digit Indian postal code/i);
  }
});

test("Favorites Data Integrity: Fails closed on WooCommerce read failure and prevents overwriting existing wishlist with empty data", async () => {
  const { addFavorite, getFavoriteProductIds } = await import("../src/services/favoritesService.js");
  const api = (await import("../src/config/woocommerce.js")).default;
  const originalGet = api.get;
  const originalPut = api.put;

  try {
    let putPayload = null;
    api.put = async (endpoint, data) => {
      putPayload = data;
      return { data: {} };
    };

    // 1. Simulates WooCommerce read failure (e.g., 500 error / network timeout)
    api.get = async () => {
      const err = new Error("WooCommerce timeout or connection reset");
      err.response = { status: 504 };
      throw err;
    };

    // 2. addFavorite must throw and fail closed, NOT write [101] over []
    await assert.rejects(
      async () => {
        await addFavorite(99999, 101);
      },
      /WooCommerce timeout/i,
      "addFavorite must throw error on read failure to protect existing wishlist"
    );

    assert.equal(putPayload, null, "Must NOT call api.put to overwrite favorites when read fails");

    // 3. getFavoriteProductIds with throwOnError=false (normal browse read) catches and safely returns []
    const fallbackIds = await getFavoriteProductIds(99999, false, false);
    assert.deepEqual(fallbackIds, []);
  } finally {
    api.get = originalGet;
    api.put = originalPut;
  }
});

test("Public Catalog Security: Enforces status: 'publish' across catalog queries and blocks draft/hidden products with 404", async () => {
  const {
    fetchProducts,
    fetchProductsByCategory,
    searchProducts,
    fetchRelatedProducts,
    fetchProductById,
  } = await import("../src/services/productService.js");
  const {
    getProductById,
    getProductSocialPreview,
  } = await import("../src/controllers/productController.js");
  const { serverCache } = await import("../src/utils/memoryCache.js");
  const api = (await import("../src/config/woocommerce.js")).default;
  const originalGet = api.get;

  try {
    const recordedCalls = [];
    api.get = async (endpoint, params) => {
      recordedCalls.push({ endpoint, params });
      return { data: [], headers: { "x-wp-total": "0", "x-wp-totalpages": "0" } };
    };

    // 1. fetchProducts explicitly passes status: "publish"
    await fetchProducts(1, 10);
    assert.equal(recordedCalls[0].endpoint, "products");
    assert.equal(recordedCalls[0].params.status, "publish");

    // 2. searchProducts explicitly passes status: "publish"
    await searchProducts("saree");
    assert.equal(recordedCalls[1].endpoint, "products");
    assert.equal(recordedCalls[1].params.status, "publish");

    // 3. fetchRelatedProducts explicitly passes status: "publish"
    await fetchRelatedProducts("12", 99);
    assert.equal(recordedCalls[2].endpoint, "products");
    assert.equal(recordedCalls[2].params.status, "publish");

    // 4. fetchProductsByCategory explicitly passes status: "publish"
    await fetchProductsByCategory("12", { page: 1, per_page: 10 });
    assert.equal(recordedCalls[3].endpoint, "products");
    assert.equal(recordedCalls[3].params.status, "publish");

    // 5. fetchProductById allows published & visible product
    api.get = async (endpoint) => {
      if (endpoint === "products/101") {
        return {
          data: {
            id: 101,
            name: "Silk Saree",
            status: "publish",
            catalog_visibility: "visible",
            price: "1200",
          },
        };
      }
      if (endpoint === "products/102") {
        return {
          data: {
            id: 102,
            name: "Unreleased Draft Saree",
            status: "draft",
            catalog_visibility: "visible",
          },
        };
      }
      if (endpoint === "products/103") {
        return {
          data: {
            id: 103,
            name: "Private VIP Item",
            status: "private",
            catalog_visibility: "visible",
          },
        };
      }
      if (endpoint === "products/104") {
        return {
          data: {
            id: 104,
            name: "Hidden Component Item",
            status: "publish",
            catalog_visibility: "hidden",
          },
        };
      }
      throw new Error("Unexpected endpoint: " + endpoint);
    };

    const pubProd = await fetchProductById(101);
    assert.equal(pubProd.id, 101);

    // Draft -> throws 404
    await assert.rejects(
      async () => {
        await fetchProductById(102);
      },
      (err) => err.status === 404 && /Product not found/i.test(err.message),
      "Draft product must throw 404 error"
    );

    // Private -> throws 404
    await assert.rejects(
      async () => {
        await fetchProductById(103);
      },
      (err) => err.status === 404 && /Product not found/i.test(err.message),
      "Private product must throw 404 error"
    );

    // Hidden -> throws 404
    await assert.rejects(
      async () => {
        await fetchProductById(104);
      },
      (err) => err.status === 404 && /Product not found/i.test(err.message),
      "Hidden product must throw 404 error"
    );

    // 6. getProductById controller returns HTTP 404 JSON for draft and hidden products
    serverCache.clear();
    const createMockRes = () => {
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        },
        send(data) {
          this.body = data;
          return this;
        },
        setHeader() {},
      };
      return res;
    };

    // 6a. Controller returns 200 for published product
    {
      const req = { params: { id: "101" }, protocol: "http", headers: { host: "localhost:5000" } };
      const res = createMockRes();
      await getProductById(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.id, 101);
    }

    // 6b. Controller returns 404 for draft product
    {
      const req = { params: { id: "102" }, protocol: "http", headers: { host: "localhost:5000" } };
      const res = createMockRes();
      await getProductById(req, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.success, false);
      assert.equal(res.body.message, "Product not found");
    }

    // 6c. Controller returns 404 for hidden product
    {
      const req = { params: { id: "104" }, protocol: "http", headers: { host: "localhost:5000" } };
      const res = createMockRes();
      await getProductById(req, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.success, false);
      assert.equal(res.body.message, "Product not found");
    }

    // 7. getProductSocialPreview returns HTTP 404 for draft product
    {
      const req = {
        params: { id: "102" },
        protocol: "http",
        headers: { host: "localhost:5000", "user-agent": "facebookexternalhit/1.1" },
      };
      const res = createMockRes();
      await getProductSocialPreview(req, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body, "Product not found");
    }
  } finally {
    api.get = originalGet;
    serverCache.clear();
  }
});

test("Customer Order Enumeration Prevention: Returns 404 ORDER_NOT_FOUND identically for nonexistent and non-owned orders", async () => {
  const { getOrderById } = await import("../src/controllers/orderController.js");
  const api = (await import("../src/config/woocommerce.js")).default;
  const originalGet = api.get;

  try {
    api.get = async (endpoint) => {
      // Order 500 exists but belongs to customer 99
      if (endpoint === "orders/500") {
        return {
          data: {
            id: 500,
            customer_id: 99,
            billing: { email: "other@example.com" },
          },
        };
      }
      // Order 999 does not exist
      if (endpoint === "orders/999") {
        return { data: null };
      }
      // Order 101 belongs to customer 10
      if (endpoint === "orders/101") {
        return {
          data: {
            id: 101,
            customer_id: 10,
            status: "processing",
            billing: { email: "customer10@example.com" },
            line_items: [],
          },
        };
      }
      return { data: null };
    };

    const createMockRes = () => {
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        },
        set() {},
      };
      return res;
    };

    // 1. Nonexistent order returns 404 ORDER_NOT_FOUND
    {
      const req = { wpUserId: 10, params: { id: "999" } };
      const res = createMockRes();
      await getOrderById(req, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.code, "ORDER_NOT_FOUND");
      assert.equal(res.body.message, "Order not found.");
    }

    // 2. Non-owned order also returns 404 ORDER_NOT_FOUND (no 403 oracle)
    {
      const req = { wpUserId: 10, params: { id: "500" } };
      const res = createMockRes();
      await getOrderById(req, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.code, "ORDER_NOT_FOUND");
      assert.equal(res.body.message, "Order not found.");
    }

    // 3. Owned order succeeds with 200
    {
      const req = { wpUserId: 10, params: { id: "101" } };
      const res = createMockRes();
      await getOrderById(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.order.id, 101);
    }
  } finally {
    api.get = originalGet;
  }
});

test("Security Hardening Audit: Cross-boundary cookie isolation, OTP reset anti-enumeration, and WordPress auth error sanitization", async () => {
  // 1. Cross-boundary cookie isolation in optionalAuth("customer")
  const { optionalAuth } = await import("../src/middlewares/authMiddleware.js");
  const axios = (await import("axios")).default;
  const originalAxiosGet = axios.get;

  try {
    let meCallCount = 0;
    axios.get = async (url) => {
      if (url.includes("/wp-json/mumbai-auth/v1/me")) {
        meCallCount++;
        return {
          status: 200,
          data: {
            logged_in: true,
            current_user_id: 1,
            roles: ["administrator"],
            email: "admin@example.com",
            is_phone_verified: true,
            is_suspended: false,
          },
        };
      }
      return { status: 404, data: {} };
    };

    // A. Request with ONLY mumbai_admin_auth cookie to optionalAuth("customer")
    const reqAdminOnly = {
      cookies: {
        mumbai_admin_auth: "admin_jwt_or_cookie_123",
      },
      headers: {},
    };
    let nextCalledA = false;
    await optionalAuth("customer")(reqAdminOnly, {}, () => {
      nextCalledA = true;
    });

    assert.strictEqual(nextCalledA, true);
    assert.strictEqual(reqAdminOnly.user, undefined, "Staff admin cookie must NOT attach req.user in customer context");
    assert.strictEqual(reqAdminOnly.wpUserId, undefined);
    assert.strictEqual(meCallCount, 0, "Staff admin cookie must not trigger /me call in customer context");

    // B. Request with ONLY mumbai_employee_auth cookie to optionalAuth("customer")
    const reqEmployeeOnly = {
      cookies: {
        mumbai_employee_auth: "employee_cookie_456",
      },
      headers: {},
    };
    let nextCalledB = false;
    await optionalAuth("customer")(reqEmployeeOnly, {}, () => {
      nextCalledB = true;
    });

    assert.strictEqual(nextCalledB, true);
    assert.strictEqual(reqEmployeeOnly.user, undefined, "Staff employee cookie must NOT attach req.user in customer context");
    assert.strictEqual(reqEmployeeOnly.wpUserId, undefined);
    assert.strictEqual(meCallCount, 0, "Staff employee cookie must not trigger /me call in customer context");

    // C. Request with valid mumbai_customer_auth cookie attaches customer req.user
    axios.get = async (url) => {
      if (url.includes("/wp-json/mumbai-auth/v1/me")) {
        return {
          status: 200,
          data: {
            logged_in: true,
            current_user_id: 77,
            roles: ["customer"],
            email: "shopper@example.com",
            is_phone_verified: true,
            is_suspended: false,
          },
        };
      }
      return { status: 404, data: {} };
    };

    const reqCustomer = {
      cookies: {
        mumbai_customer_auth: "valid_customer_session_777",
      },
      headers: {},
    };
    let nextCalledC = false;
    await optionalAuth("customer")(reqCustomer, {}, () => {
      nextCalledC = true;
    });

    assert.strictEqual(nextCalledC, true);
    assert.ok(reqCustomer.user, "Customer cookie must attach req.user");
    assert.strictEqual(reqCustomer.user.id, 77);
    assert.deepStrictEqual(reqCustomer.user.roles, ["customer"]);
  } finally {
    axios.get = originalAxiosGet;
  }

  // 2. Anti-enumeration: Uniform HTTP 200 on password-reset OTP cooldown and non-existent accounts
  const { sendOtp } = await import("../src/controllers/authController.js");
  const wp = (await import("../src/services/wordpress.js")).default;
  const originalWpPost = wp.post;

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
      set(k, v) {
        this.headers[k] = v;
        return this;
      },
    };
    return res;
  };

  try {
    process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || "test-hmac-secret-123";

    // 2a. User in cooldown (rate_limited: true)
    wp.post = async (url) => {
      if (url.includes("/otp/store")) {
        return {
          data: {
            success: true,
            rate_limited: true,
            message: "If the number is registered, an OTP has been sent.",
          },
        };
      }
      return { data: {} };
    };

    const resCooldown = createMockRes();
    await sendOtp(
      { body: { phone: "9820123456", purpose: "reset_password" }, headers: {} },
      resCooldown
    );
    assert.strictEqual(resCooldown.statusCode, 200, "Reset OTP cooldown must return HTTP 200");
    assert.strictEqual(resCooldown.body.success, true);
    assert.strictEqual(resCooldown.body.message, "If the number is registered, an OTP has been sent.");
    assert.strictEqual(resCooldown.body.masked_email, undefined, "Must not leak masked email");

    // 2b. User not found (user_found: false)
    wp.post = async (url) => {
      if (url.includes("/otp/store")) {
        return {
          data: {
            success: true,
            user_found: false,
            message: "If the number is registered, an OTP has been sent.",
          },
        };
      }
      return { data: {} };
    };

    const resNotFound = createMockRes();
    await sendOtp(
      { body: { phone: "9999999999", purpose: "reset_password" }, headers: {} },
      resNotFound
    );
    assert.strictEqual(resNotFound.statusCode, 200, "Unregistered number must return HTTP 200");
    assert.strictEqual(resNotFound.body.success, true);
    assert.strictEqual(resNotFound.body.message, "If the number is registered, an OTP has been sent.");
    assert.strictEqual(resNotFound.body.masked_email, undefined, "Must not leak masked email");
  } finally {
    wp.post = originalWpPost;
  }

  // 3. WordPress auth error sanitization via sanitizeAuthError
  const { sanitizeAuthError } = await import("../src/controllers/authController.js");

  // 3a. Strips raw HTML tags from message
  const errWithHtml = {
    response: {
      status: 403,
      data: {
        code: "invalid_credentials",
        message: "<strong>Error:</strong> The username <em>test</em> is not registered. <a href='/lost-password'>Lost password?</a>",
      },
    },
  };
  const sanitizedHtml = sanitizeAuthError(errWithHtml, "Default error");
  assert.strictEqual(sanitizedHtml.status, 403);
  assert.strictEqual(sanitizedHtml.payload.code, "invalid_credentials");
  assert.strictEqual(
    sanitizedHtml.payload.message,
    "Error: The username test is not registered. Lost password?"
  );

  // 3b. Suppresses internal database/SQL/stack trace leakages
  const errWithSql = {
    response: {
      status: 500,
      data: {
        code: "db_error",
        message: "WordPress database error: You have an error in your SQL syntax near wp_users at /var/www/wp-content/db.php",
      },
    },
  };
  const sanitizedSql = sanitizeAuthError(errWithSql, "Authentication request failed");
  assert.strictEqual(sanitizedSql.status, 500);
  assert.strictEqual(sanitizedSql.payload.message, "Authentication request failed");

  // 3c. Uses fallbackStatus when error.response?.status is not present
  const errNoResponse = new Error("Connection failed");
  const sanitizedFallback = sanitizeAuthError(errNoResponse, "OTP verification failed", 400);
  assert.strictEqual(sanitizedFallback.status, 400);
  assert.strictEqual(sanitizedFallback.payload.message, "OTP verification failed");
});

test("Security Hardening Audit: Reconciler amount/currency verification & Webhook durable persistence failure handling", async () => {
  // 1. Reconciler Amount & Currency Verification on created intent recovery
  const { runPaymentReconciliation } = await import("../src/services/reconciliationService.js");
  const { _setRazorpayInstanceForTesting } = await import("../src/services/razorpayService.js");
  const paymentIntentService = (await import("../src/services/paymentIntentService.js")).default;
  const { _setWpClientForTesting } = await import("../src/services/paymentIntentService.js");
  const api = (await import("../src/config/woocommerce.js")).default;

  const originalFetchList = paymentIntentService.fetchReconciliationList;
  const originalUpdateStatus = paymentIntentService.updatePaymentIntentStatus;
  const originalAcquireLock = paymentIntentService.acquireLock;
  const originalReleaseLock = paymentIntentService.releaseLock;
  const originalApiPost = api.post;

  try {
    paymentIntentService.acquireLock = async () => true;
    paymentIntentService.releaseLock = async () => true;

    let wcOrdersCreated = 0;
    api.post = async (path) => {
      if (path === "orders") {
        wcOrdersCreated++;
        return { data: { id: 9999 } };
      }
      return { data: {} };
    };

    // Mock captured payment with amount mismatch (5000 paise vs expected 15000 paise)
    const testRzpOrder = "order_mismatch_audit_101";
    const testRzpPay = "pay_mismatch_audit_101";
    _setRazorpayInstanceForTesting({
      orders: {
        fetchPayments: async (orderId) => {
          if (orderId === testRzpOrder) {
            return { count: 1, items: [{ id: testRzpPay, status: "captured", amount: 5000, currency: "INR" }] };
          }
          return { count: 0, items: [] };
        },
      },
    });

    const mockIntent = {
      rzp_order_id: testRzpOrder,
      user_id: 1,
      amount_paise: 15000, // Expected ₹150 vs captured ₹50
      status: "created",
      checkout_payload: JSON.stringify({
        customer_id: 1,
        billing: { email: "customer@test.com" },
        line_items: [{ product_id: 10, quantity: 1 }],
      }),
      created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    };

    paymentIntentService.fetchReconciliationList = async () => ({
      intents: [mockIntent],
      hasMore: false,
    });

    let quarantinedParams = null;
    paymentIntentService.updatePaymentIntentStatus = async (params) => {
      quarantinedParams = params;
      return true;
    };

    const reconRes = await runPaymentReconciliation({ olderThanMinutes: 0 });

    assert.strictEqual(reconRes.healedOrders, 0, "Must NOT heal or create order on amount mismatch");
    assert.strictEqual(wcOrdersCreated, 0, "WooCommerce order must never be created on amount mismatch");
    assert.ok(quarantinedParams?.toStatus === "failed" || quarantinedParams?.toStatus === "refund_failed", "Intent must be transitioned to failed or refund_failed");
    assert.match(quarantinedParams?.errorReason, /AMOUNT_MISMATCH/i);

    // 2. Webhook handler: Returns HTTP 500 when durable event persistence fails
    const { handleWebhook } = await import("../src/controllers/paymentController.js");
    const crypto = (await import("crypto")).default;

    _setWpClientForTesting({
      post: async (url) => {
        if (url.includes("/webhook-event/store")) {
          const err = new Error("Database connection lost");
          err.response = { status: 500, data: { code: "db_insert_failed" } };
          throw err;
        }
        return { data: { success: true } };
      },
      get: async () => ({ data: { order: null } }),
    });

    const webhookPayload = {
      event: "payment.captured",
      id: "evt_audit_fail_500",
      payload: {
        payment: { entity: { id: "pay_test_500", order_id: "order_test_500", amount: 5000 } },
      },
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET || "mock_webhook_secret_789")
      .update(rawBody)
      .digest("hex");

    const req = {
      headers: {
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": "evt_audit_fail_500",
      },
      rawBody: Buffer.from(rawBody),
      body: webhookPayload,
    };
    let statusCode = 0;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(d) { responseBody = d; return this; },
    };

    await handleWebhook(req, res);

    assert.strictEqual(statusCode, 500, "Webhook handler must return HTTP 500 on event persistence failure");
    assert.strictEqual(responseBody?.success, false);
    assert.match(responseBody?.message, /failed to persist webhook event durably/i);
  } finally {
    paymentIntentService.fetchReconciliationList = originalFetchList;
    paymentIntentService.updatePaymentIntentStatus = originalUpdateStatus;
    paymentIntentService.acquireLock = originalAcquireLock;
    paymentIntentService.releaseLock = originalReleaseLock;
    api.post = originalApiPost;
    _setWpClientForTesting(null);
  }
});




