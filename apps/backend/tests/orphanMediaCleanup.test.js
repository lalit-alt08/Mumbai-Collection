import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import {
  trackPendingMedia,
  markMediaAttached,
  deleteMediaIfUnreferenced,
  cleanupPendingOrphanMedia,
} from "../src/services/wordpressMediaService.js";
import {
  deleteEmployeeMedia,
} from "../src/controllers/employeeController.js";
import {
  deleteProduct,
  createProduct,
  triggerOrphanCleanup,
} from "../src/controllers/adminProductController.js";
import api from "../src/config/woocommerce.js";

test("Phase 5: Orphan & Abandoned Product-Image Cleanup Test Suite", async (t) => {
  const originalAxiosPost = axios.post;
  const originalApiPost = api.post;
  const originalApiDelete = api.delete;

  t.afterEach(() => {
    axios.post = originalAxiosPost;
    api.post = originalApiPost;
    api.delete = originalApiDelete;
  });

  await t.test("1. trackPendingMedia: Sends correct payload, headers, and endpoint", async () => {
    let capturedUrl = "";
    let capturedData = null;
    let capturedHeaders = null;

    axios.post = async (url, data, config) => {
      capturedUrl = url;
      capturedData = data;
      capturedHeaders = config.headers;
      return {
        data: {
          success: true,
          media_id: 101,
          status: "pending",
          timestamp: 1700000000,
        },
      };
    };

    const res = await trackPendingMedia(101, { uploaderId: 42 });
    assert.equal(res.success, true);
    assert.equal(res.media_id, 101);
    assert.match(capturedUrl, /\/wp-json\/mumbai-auth\/v1\/media\/track-pending$/);
    assert.equal(capturedData.media_id, 101);
    assert.equal(capturedData.uploader_id, 42);
    assert.ok(capturedHeaders["X-Mumbai-Internal-Key"]);
  });

  await t.test("2. markMediaAttached: Correctly transitions media array to attached state", async () => {
    let capturedUrl = "";
    let capturedData = null;

    axios.post = async (url, data) => {
      capturedUrl = url;
      capturedData = data;
      return {
        data: {
          success: true,
          updated_ids: [101, 102],
          count: 2,
        },
      };
    };

    const res = await markMediaAttached([101, 102], 555);
    assert.equal(res.success, true);
    assert.equal(res.count, 2);
    assert.match(capturedUrl, /\/wp-json\/mumbai-auth\/v1\/media\/mark-attached$/);
    assert.deepEqual(capturedData.media_ids, [101, 102]);
    assert.equal(capturedData.product_id, 555);
  });

  await t.test("3. markMediaAttached: Handles empty or invalid IDs gracefully without making API call", async () => {
    let called = false;
    axios.post = async () => {
      called = true;
      return { data: {} };
    };

    const res = await markMediaAttached([], 555);
    assert.equal(res.success, true);
    assert.equal(res.count, 0);
    assert.equal(called, false);
  });

  await t.test("4. deleteMediaIfUnreferenced: Sends context, uploaderId, and media array", async () => {
    let capturedData = null;

    axios.post = async (url, data) => {
      capturedData = data;
      return {
        data: {
          success: true,
          results: [{ media_id: 101, deleted: true, context: "pending_removal" }],
        },
      };
    };

    const res = await deleteMediaIfUnreferenced([101], {
      context: "pending_removal",
      uploaderId: 99,
    });
    assert.equal(res.success, true);
    assert.equal(capturedData.context, "pending_removal");
    assert.equal(capturedData.uploader_id, 99);
    assert.deepEqual(capturedData.media_ids, [101]);
  });

  await t.test("5. cleanupPendingOrphanMedia: Triggers 24h orphan reap endpoint", async () => {
    let capturedUrl = "";

    axios.post = async (url) => {
      capturedUrl = url;
      return {
        data: {
          success: true,
          inspected_count: 5,
          deleted_count: 4,
          deleted_ids: [11, 12, 13, 14],
          reclassified_ids: [15],
        },
      };
    };

    const res = await cleanupPendingOrphanMedia();
    assert.equal(res.success, true);
    assert.equal(res.deleted_count, 4);
    assert.match(capturedUrl, /\/wp-json\/mumbai-auth\/v1\/media\/cleanup-pending-orphans$/);
  });

  await t.test("6. Employee Delete Controller: Rejects deletion if media is attached (not_pending)", async () => {
    axios.post = async () => ({
      data: {
        success: true,
        results: [
          {
            media_id: 202,
            deleted: false,
            reason: "not_pending",
            message: "Cannot remove media that is already attached to a product.",
          },
        ],
      },
    });

    const req = {
      params: { id: "202" },
      user: { id: 7, role: "employee" },
    };
    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await deleteEmployeeMedia(req, res);
    assert.equal(statusCode, 400);
    assert.equal(responseBody.success, false);
    assert.equal(responseBody.code, "not_pending");
  });

  await t.test("7. Employee Delete Controller: Rejects deletion if media is referenced elsewhere (media_in_use)", async () => {
    axios.post = async () => ({
      data: {
        success: true,
        results: [
          {
            media_id: 303,
            deleted: false,
            reason: "referenced",
            reference: { type: "_thumbnail_id", post_id: 888 },
          },
        ],
      },
    });

    const req = {
      params: { id: "303" },
      user: { id: 7, role: "employee" },
    };
    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await deleteEmployeeMedia(req, res);
    assert.equal(statusCode, 409);
    assert.equal(responseBody.code, "media_in_use");
    assert.equal(responseBody.reference.type, "_thumbnail_id");
  });

  await t.test("8. Employee Delete Controller: Rejects deletion on ownership mismatch", async () => {
    axios.post = async () => ({
      data: {
        success: true,
        results: [
          {
            media_id: 404,
            deleted: false,
            reason: "ownership_mismatch",
          },
        ],
      },
    });

    const req = {
      params: { id: "404" },
      user: { id: 7, role: "employee" },
    };
    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await deleteEmployeeMedia(req, res);
    assert.equal(statusCode, 403);
    assert.equal(responseBody.code, "forbidden");
  });

  await t.test("9. Employee Delete Controller: Successfully deletes unreferenced pending media", async () => {
    axios.post = async () => ({
      data: {
        success: true,
        results: [
          {
            media_id: 505,
            deleted: true,
            context: "pending_removal",
          },
        ],
      },
    });

    const req = {
      params: { id: "505" },
      user: { id: 7, role: "employee" },
    };
    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await deleteEmployeeMedia(req, res);
    assert.equal(statusCode, 200);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.deleted, true);
    assert.equal(responseBody.mediaId, 505);
  });

  await t.test("10. Product Creation: Automatically marks newly uploaded images as attached", async () => {
    let attachedIds = null;
    let attachedProductId = null;

    api.post = async (endpoint, payload) => {
      return {
        data: {
          id: 777,
          name: payload.name,
          images: [{ id: 601 }, { id: 602 }],
        },
      };
    };

    axios.post = async (url, data) => {
      if (url.includes("/media/mark-attached")) {
        attachedIds = data.media_ids;
        attachedProductId = data.product_id;
        return { data: { success: true, count: 2 } };
      }
      return { data: {} };
    };

    const req = {
      body: {
        name: "Test Silk Kurti",
        regular_price: "1299",
        images: [{ id: 601 }, { id: 602 }],
      },
    };
    let responseBody = null;
    const res = {
      status() { return this; },
      json(data) { responseBody = data; return this; },
    };

    await createProduct(req, res);
    assert.equal(responseBody.success, true);
    assert.deepEqual(attachedIds, [601, 602]);
    assert.equal(attachedProductId, 777);
  });

  await t.test("11. Product Deletion: Safely triggers cleanup of deleted product's images", async () => {
    let cleanupIds = null;
    let cleanupContext = null;

    api.delete = async () => {
      return {
        data: {
          id: 888,
          name: "Deleted Product",
          images: [{ id: 701 }, { id: 702 }],
        },
      };
    };

    axios.post = async (url, data) => {
      if (url.includes("/media/delete-if-unreferenced")) {
        cleanupIds = data.media_ids;
        cleanupContext = data.context;
        return { data: { success: true, results: [{ media_id: 701, deleted: true }] } };
      }
      return { data: {} };
    };

    const req = {
      params: { id: "888" },
    };
    let responseBody = null;
    const res = {
      status() { return this; },
      json(data) { responseBody = data; return this; },
    };

    await deleteProduct(req, res);
    assert.equal(responseBody.success, true);
    assert.deepEqual(cleanupIds, [701, 702]);
    assert.equal(cleanupContext, "product_deletion");
  });

  await t.test("12. Admin triggerOrphanCleanup: Controller calls cleanupPendingOrphanMedia and returns stats", async () => {
    axios.post = async () => ({
      data: {
        success: true,
        inspected_count: 8,
        deleted_count: 3,
        deleted_ids: [1, 2, 3],
        reclassified_ids: [4],
      },
    });

    let responseBody = null;
    const res = {
      status() { return this; },
      json(data) { responseBody = data; return this; },
    };

    await triggerOrphanCleanup({}, res);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.deleted_count, 3);
    assert.deepEqual(responseBody.deleted_ids, [1, 2, 3]);
  });
});
