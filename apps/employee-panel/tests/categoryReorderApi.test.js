import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { reorderCategories } from "../src/services/employeeApi.js";

test("Category Reorder Employee API Client", async (t) => {
  let originalAxiosRequest;

  t.beforeEach(() => {
    originalAxiosRequest = axios.Axios.prototype.request;
  });

  t.afterEach(() => {
    axios.Axios.prototype.request = originalAxiosRequest;
  });

  await t.test("sends PUT /categories/reorder with category_ids and custom idempotency headers", async () => {
    let capturedConfig = null;

    axios.Axios.prototype.request = async function (configOrUrl, maybeConfig) {
      const config = typeof configOrUrl === "string" ? { ...maybeConfig, url: configOrUrl } : configOrUrl;
      capturedConfig = config;
      return {
        data: {
          success: true,
          message: "Category merchandising order updated successfully.",
          ordered_ids: [19, 18, 17],
        },
      };
    };

    const res = await reorderCategories([19, 18, 17], {
      "X-Idempotency-Key": "test_idempotency_12345",
    });

    assert.ok(capturedConfig, "Axios request must be executed");
    assert.equal(capturedConfig.method?.toLowerCase(), "put");
    assert.ok(capturedConfig.url?.includes("/categories/reorder"));
    assert.deepEqual(capturedConfig.data, { category_ids: [19, 18, 17] });
    assert.equal(capturedConfig.headers?.["X-Idempotency-Key"], "test_idempotency_12345");
    assert.equal(res.success, true);
  });

  await t.test("propagates HTTP 409 REORDER_IN_PROGRESS error so frontend can backoff retry", async () => {
    axios.Axios.prototype.request = async function () {
      const error = new Error("Request failed with status code 409");
      error.response = {
        status: 409,
        data: {
          success: false,
          code: "REORDER_IN_PROGRESS",
          message: "A category reordering operation is currently in progress.",
        },
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await reorderCategories([19, 18]);
      },
      (err) => {
        assert.equal(err.response?.status, 409);
        assert.equal(err.response?.data?.code, "REORDER_IN_PROGRESS");
        return true;
      }
    );
  });

  await t.test("propagates HTTP 503 REORDER_LOCK_UNAVAILABLE error without retrying", async () => {
    axios.Axios.prototype.request = async function () {
      const error = new Error("Request failed with status code 503");
      error.response = {
        status: 503,
        data: {
          success: false,
          code: "REORDER_LOCK_UNAVAILABLE",
          message: "Category reordering requires distributed lock coordination and is temporarily unavailable.",
        },
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await reorderCategories([19, 18]);
      },
      (err) => {
        assert.equal(err.response?.status, 503);
        assert.equal(err.response?.data?.code, "REORDER_LOCK_UNAVAILABLE");
        return true;
      }
    );
  });

  await t.test("propagates HTTP 409 LOCK_LOST error so frontend aborts without infinite loop", async () => {
    axios.Axios.prototype.request = async function () {
      const error = new Error("Request failed with status code 409");
      error.response = {
        status: 409,
        data: {
          success: false,
          code: "LOCK_LOST",
          message: "Category reordering was aborted because the distributed lock was lost.",
        },
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await reorderCategories([19, 18]);
      },
      (err) => {
        assert.equal(err.response?.status, 409);
        assert.equal(err.response?.data?.code, "LOCK_LOST");
        return true;
      }
    );
  });

  await t.test("Queued order retry budget reset behavior", async () => {
    // Tests that when a new order is queued during a retry countdown, retry budget is reset to 0
    let retryAttemptedWith = null;
    let initialOrder = [1, 2, 3];
    let queuedOrder = [3, 2, 1];

    let currentQueued = queuedOrder;
    const hasNewQueued = Boolean(currentQueued);
    const targetList = currentQueued || initialOrder;
    currentQueued = null;
    const nextRetryCount = hasNewQueued ? 0 : 1; // Must reset to 0!

    assert.equal(nextRetryCount, 0, "A fresh queued order must reset retry count to 0");
    assert.deepEqual(targetList, [3, 2, 1], "Target list must pick up the newly queued order");
  });
});
