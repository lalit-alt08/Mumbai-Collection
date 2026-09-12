import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { getProducts } from "../src/services/employeeApi.js";

test("Phase 1: Employee Panel Product API Parameter Sanitization", async (t) => {
  let originalAxiosRequest;

  t.beforeEach(() => {
    originalAxiosRequest = axios.Axios.prototype.request;
  });

  t.afterEach(() => {
    axios.Axios.prototype.request = originalAxiosRequest;
  });

  await t.test("passes page, per_page, search, stock_status, and category cleanly", async () => {
    let capturedConfig = null;

    axios.Axios.prototype.request = async function (configOrUrl, maybeConfig) {
      const config = typeof configOrUrl === "string" ? maybeConfig : configOrUrl;
      capturedConfig = config;
      return {
        data: {
          success: true,
          products: [],
          total: 0,
        },
      };
    };

    await getProducts({
      page: 2,
      per_page: 50,
      search: "Bandhani",
      stock_status: "lowstock",
      category: "sarees",
    });

    assert.ok(capturedConfig, "Axios get should be called with config");
    assert.deepEqual(capturedConfig.params, {
      page: 2,
      per_page: 50,
      search: "Bandhani",
      stock_status: "lowstock",
      category: "sarees",
    });
  });

  await t.test("omits stock_status and category when set to 'all' or whitespace", async () => {
    let capturedConfig = null;

    axios.Axios.prototype.request = async function (configOrUrl, maybeConfig) {
      const config = typeof configOrUrl === "string" ? maybeConfig : configOrUrl;
      capturedConfig = config;
      return {
        data: {
          success: true,
          products: [],
        },
      };
    };

    await getProducts({
      page: 1,
      per_page: 20,
      search: "   ",
      stock_status: "all",
      category: "all",
    });

    assert.ok(capturedConfig);
    assert.deepEqual(capturedConfig.params, {
      page: 1,
      per_page: 20,
    });
  });

  await t.test("preserves backwards compatibility for additional custom params", async () => {
    let capturedConfig = null;

    axios.Axios.prototype.request = async function (configOrUrl, maybeConfig) {
      const config = typeof configOrUrl === "string" ? maybeConfig : configOrUrl;
      capturedConfig = config;
      return { data: { success: true } };
    };

    await getProducts({
      page: 1,
      custom_flag: "active",
      order: "asc",
    });

    assert.equal(capturedConfig.params.custom_flag, "active");
    assert.equal(capturedConfig.params.order, "asc");
  });
});
