import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdminCustomers } from "../src/controllers/adminCustomerController.js";
import wp from "../src/services/wordpress.js";
import { serverCache } from "../src/utils/memoryCache.js";

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  set() { return this; },
  json(body) { this.body = body; return this; },
});

test("customer directory refresh preserves other cache entries and hides upstream details", async () => {
  const originalGet = wp.get;
  const marker = "admin:customers:unrelated-test-entry";
  try {
    serverCache.set(marker, { preserved: true }, 30000);
    let calls = 0;
    wp.get = async () => {
      calls++;
      return { data: { success: true, customers: [], total: 0, totalPages: 1 } };
    };
    const refreshed = response();
    await getAdminCustomers({ query: { refresh: "true", search: "safety-test" } }, refreshed);
    assert.equal(refreshed.statusCode, 200);
    assert.equal(calls, 1);
    assert.deepEqual(serverCache.get(marker), { preserved: true });

    wp.get = async () => {
      const error = new Error("private database path");
      error.response = { status: 503, data: { message: "secret SQL details" } };
      throw error;
    };
    const failed = response();
    await getAdminCustomers({ query: { search: "unique-error-test" } }, failed);
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.body.message, "Unable to load the customer directory. Please try again.");
    assert.doesNotMatch(JSON.stringify(failed.body), /secret|private/);
  } finally {
    wp.get = originalGet;
    serverCache.delete(marker);
  }
});
