import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import axios from "axios";
import {
  getAdminStoreHours,
  updateAdminStoreHours,
  toggleAdminPeakHours,
} from "../src/controllers/adminStoreHoursController.js";
import storeHoursService, {
  saveStoreHoursConfig,
  getStoreHoursConfig,
  normalizeStoreHoursConfig,
  _resetStoreHoursCacheForTesting,
} from "../src/services/storeHoursService.js";
import { serverCache } from "../src/utils/memoryCache.js";

test("Admin Store Hours Concurrency & Error Sanitization Suite", async (t) => {
  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;

  t.afterEach(() => {
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
    _resetStoreHoursCacheForTesting();
    serverCache.clear();
  });

  await t.test("1. normalizeStoreHoursConfig preserves and validates version", () => {
    const rawWithVer = { version: 5, manual_override: "open" };
    const normalized = normalizeStoreHoursConfig(rawWithVer);
    assert.equal(normalized.version, 5);
    assert.equal(normalized.manual_override, "open");

    const rawWithoutVer = { manual_override: "closed" };
    const normDefault = normalizeStoreHoursConfig(rawWithoutVer);
    assert.equal(normDefault.version, 1, "Missing version defaults safely to 1");
  });

  await t.test("2. getAdminStoreHours includes authoritative version in JSON response", async () => {
    axios.get = async () => ({
      data: {
        success: true,
        version: 7,
        store_hours: {
          version: 7,
          manual_override: "auto",
          schedule: {
            monday: { is_enabled: true, open: "09:00", close: "22:00" },
          },
        },
        wp_timezone: "Asia/Kolkata",
        gmt_offset: 5.5,
      },
    });

    let jsonResult = null;
    let statusCode = 200;
    const req = {};
    const res = {
      json: (d) => { jsonResult = d; },
      status: (c) => { statusCode = c; return res; },
    };

    await getAdminStoreHours(req, res);

    assert.equal(statusCode, 200);
    assert.equal(jsonResult.success, true);
    assert.equal(jsonResult.version, 7, "Must expose numeric version at top level");
    assert.equal(jsonResult.config.version, 7, "Must expose numeric version in config");
  });

  await t.test("3. getAdminStoreHours fails closed with HTTP 503 when WordPress is offline (never gives fallback data to staff)", async () => {
    axios.get = async () => {
      const err = new Error("Connection refused to WordPress");
      err.code = "ECONNREFUSED";
      throw err;
    };

    let statusCode = null;
    let jsonResult = null;
    const req = {};
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonResult = data; },
    };

    await getAdminStoreHours(req, res);

    assert.equal(statusCode, 503, "Staff forced read must fail closed on network error rather than returning fallback 1");
    assert.equal(jsonResult.success, false);
    assert.match(jsonResult.message, /temporarily unavailable/i);
    assert.equal(jsonResult.config, null);
  });

  await t.test("4. getStoreHoursConfig(true) strictly fails closed if WordPress omits version (never fabricates version 1)", async () => {
    axios.get = async () => ({
      data: {
        success: true,
        store_hours: {
          manual_override: "auto",
          schedule: { monday: { is_enabled: true, open: "09:00", close: "22:00" } },
          // version omitted
        },
      },
    });

    await assert.rejects(
      async () => {
        await getStoreHoursConfig(true);
      },
      /missing a valid authoritative version/i,
      "Forced read must reject WordPress response lacking authoritative numeric version"
    );
  });

  await t.test("5. saveStoreHoursConfig strictly requires expected_version and rejects decimals", async () => {
    // Missing version
    await assert.rejects(
      async () => {
        await saveStoreHoursConfig({ manual_override: "closed" });
      },
      /expected_version is required/,
      "Must reject save when expected_version is omitted"
    );

    // Decimal version
    await assert.rejects(
      async () => {
        await saveStoreHoursConfig({ manual_override: "closed" }, { expectedVersion: 1.5 });
      },
      /positive integer/,
      "Must reject decimal expected_version"
    );

    // Controller check for missing version
    let statusCodeMissing = null;
    let jsonResultMissing = null;
    await updateAdminStoreHours(
      { body: { manual_override: "closed" } },
      {
        status: (c) => { statusCodeMissing = c; return { json: (d) => { jsonResultMissing = d; } }; },
        json: (d) => { statusCodeMissing = 200; jsonResultMissing = d; },
      }
    );
    assert.equal(statusCodeMissing, 400);
    assert.equal(jsonResultMissing.error, "MISSING_VERSION");

    // Controller check for decimal version
    let statusCodeDecimal = null;
    let jsonResultDecimal = null;
    await updateAdminStoreHours(
      { body: { expected_version: 2.7, manual_override: "closed" } },
      {
        status: (c) => { statusCodeDecimal = c; return { json: (d) => { jsonResultDecimal = d; } }; },
        json: (d) => { statusCodeDecimal = 200; jsonResultDecimal = d; },
      }
    );
    assert.equal(statusCodeDecimal, 400);
    assert.equal(jsonResultDecimal.error, "MISSING_VERSION");
  });

  await t.test("6. saveStoreHoursConfig strictly fails closed without merging with defaults if fresh read fails", async () => {
    axios.get = async () => {
      throw new Error("WordPress database unreachable");
    };

    let postCalled = false;
    axios.post = async () => {
      postCalled = true;
      return { data: { success: true } };
    };

    await assert.rejects(
      async () => {
        await saveStoreHoursConfig(
          { manual_override: "closed" },
          { expectedVersion: 1 }
        );
      },
      /WordPress store operating hours unavailable/,
      "Save must abort immediately if current settings cannot be read under lock"
    );

    assert.equal(postCalled, false, "Must not post partial update merged with default config");
  });

  await t.test("7. saveStoreHoursConfig sends expected_version in request payload", async () => {
    let capturedPayload = null;

    axios.get = async () => ({
      data: {
        success: true,
        version: 3,
        store_hours: { version: 3, manual_override: "auto", schedule: {} },
      },
    });

    axios.post = async (url, payload) => {
      capturedPayload = payload;
      return {
        data: {
          success: true,
          version: 4,
          store_hours: { ...payload.store_hours, version: 4 },
        },
      };
    };

    const saved = await saveStoreHoursConfig(
      { manual_override: "closed", closed_message: "Renovation" },
      { expectedVersion: 3 }
    );

    assert.ok(capturedPayload, "axios.post must be called");
    assert.equal(capturedPayload.expected_version, 3, "expected_version must be transmitted in payload");
    assert.equal(saved.version, 4, "Returned config must reflect incremented version");
  });

  await t.test("8. updateAdminStoreHours maps upstream 409 conflict to STORE_HOURS_CONFLICT", async () => {
    axios.get = async () => ({
      data: {
        success: true,
        version: 1,
        store_hours: { version: 1, manual_override: "auto", schedule: {} },
      },
    });

    axios.post = async () => {
      const err = new Error("Conflict");
      err.response = {
        status: 409,
        data: {
          code: "store_hours_conflict",
          message: "Another administrator updated the store operating hours while you were editing.",
          data: { current_version: 5, expected_version: 1 },
        },
      };
      throw err;
    };

    let statusCode = null;
    let jsonResult = null;
    const req = {
      body: {
        expected_version: 1,
        manual_override: "closed",
      },
    };
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonResult = data; },
    };

    await updateAdminStoreHours(req, res);

    assert.equal(statusCode, 409, "Must return HTTP 409 on version conflict");
    assert.equal(jsonResult.error, "STORE_HOURS_CONFLICT");
    assert.equal(jsonResult.code, "store_hours_conflict");
    assert.equal(jsonResult.current_version, 5);
    assert.match(jsonResult.message, /Another administrator updated/i);
  });

  await t.test("9. Two-Admin Concurrency Simulation: Admin B's stale save is rejected without overwriting Admin A", async () => {
    let dbVersion = 1;
    let dbConfig = { version: 1, manual_override: "auto", closed_message: "", schedule: {} };

    const simulateWpPost = async (url, payload) => {
      const expVer = payload.expected_version;
      if (expVer !== undefined && expVer !== dbVersion) {
        const err = new Error("Conflict");
        err.response = {
          status: 409,
          data: {
            code: "store_hours_conflict",
            message: "Another administrator updated the store operating hours while you were editing.",
            data: { current_version: dbVersion, expected_version: expVer },
          },
        };
        throw err;
      }
      dbVersion += 1;
      dbConfig = { ...payload.store_hours, version: dbVersion };
      return {
        data: {
          success: true,
          version: dbVersion,
          store_hours: dbConfig,
        },
      };
    };

    axios.get = async () => ({
      data: { success: true, version: dbVersion, store_hours: dbConfig },
    });
    axios.post = simulateWpPost;

    // Both Admin A and Admin B load the page at version 1
    const adminA_initial = await storeHoursService.getStoreHoursConfig(true);
    const adminB_initial = await storeHoursService.getStoreHoursConfig(true);
    assert.equal(adminA_initial.version, 1);
    assert.equal(adminB_initial.version, 1);

    // Admin A updates manual_override to "closed" with expected_version 1
    let adminA_status = null;
    let adminA_res = null;
    await updateAdminStoreHours(
      { body: { expected_version: 1, manual_override: "closed", closed_message: "Admin A closed for rain" } },
      {
        status: (c) => { adminA_status = c; return { json: (d) => { adminA_res = d; } }; },
        json: (d) => { adminA_status = 200; adminA_res = d; },
      }
    );
    assert.equal(adminA_status, 200, "Admin A save succeeds");
    assert.equal(dbVersion, 2, "Database version incremented to 2");
    assert.equal(dbConfig.closed_message, "Admin A closed for rain");

    // Admin B now tries to save festival notice with stale expected_version 1
    let adminB_status = null;
    let adminB_res = null;
    await updateAdminStoreHours(
      { body: { expected_version: 1, manual_override: "closed", closed_message: "Admin B festive holiday" } },
      {
        status: (c) => { adminB_status = c; return { json: (d) => { adminB_res = d; } }; },
        json: (d) => { adminB_status = 200; adminB_res = d; },
      }
    );

    assert.equal(adminB_status, 409, "Admin B save must be REJECTED with 409 Conflict");
    assert.equal(adminB_res.error, "STORE_HOURS_CONFLICT");
    assert.equal(adminB_res.current_version, 2);
    assert.equal(dbConfig.closed_message, "Admin A closed for rain", "Admin A's change was NOT overwritten!");
  });

  await t.test("10. Error Sanitization: unexpected internal exceptions do NOT leak error.message", async () => {
    axios.get = async () => ({
      data: { success: true, version: 1, store_hours: {} },
    });

    axios.post = async () => {
      const sensitiveErr = new Error("connect ECONNREFUSED 10.0.1.42:3306 - SELECT * FROM wp_options WHERE option_name = 'mumbai_store_hours'");
      sensitiveErr.code = "ECONNREFUSED";
      throw sensitiveErr;
    };

    let statusCode = null;
    let jsonResult = null;
    const req = { body: { expected_version: 1, manual_override: "open" } };
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonResult = data; },
    };

    await updateAdminStoreHours(req, res);

    assert.equal(statusCode, 500, "Unexpected error must return 500");
    assert.equal(jsonResult.success, false);
    assert.equal(
      jsonResult.message,
      "Failed to update store hours configuration. Please retry.",
      "Must return safe user message"
    );
    assert.ok(
      !jsonResult.message.includes("10.0.1.42") && !jsonResult.message.includes("ECONNREFUSED"),
      "Sensitive internal error details MUST NOT leak in response"
    );
  });

  await t.test("11. WordPress plugin (mumbai-auth.php) implements GET_LOCK, mandatory integer version, transactions, dual verified persistence, and transient recovery", () => {
    const candidatePaths = [
      path.resolve(process.cwd(), "mumbai-auth.php"),
      path.resolve(process.cwd(), "../../mumbai-auth.php"),
      path.resolve(process.cwd(), "../mumbai-auth.php"),
    ];
    const phpPath = candidatePaths.find((p) => fs.existsSync(p));
    assert.ok(phpPath, `mumbai-auth.php must exist in one of: ${candidatePaths.join(", ")}`);
    const phpSource = fs.readFileSync(phpPath, "utf8");

    // Verify GET_LOCK in mumbai_save_store_hours
    assert.match(
      phpSource,
      /function mumbai_save_store_hours[\s\S]*?GET_LOCK\(%s,\s*5\)[\s\S]*?!\$locked[\s\S]*?'lock_timeout'/,
      "mumbai_save_store_hours must acquire GET_LOCK and return lock_timeout on busy mutex"
    );

    // Verify mandatory positive integer expected_version check
    assert.match(
      phpSource,
      /!is_numeric\(\$raw_expected\)[\s\S]*?\(int\)\s*\$raw_expected\s*!=\s*\$raw_expected[\s\S]*?'missing_version'/,
      "mumbai_save_store_hours must reject missing or non-integer expected_version"
    );

    // Verify 409 store_hours_conflict on version mismatch
    assert.match(
      phpSource,
      /\$expected_version !== \$current_version[\s\S]*?store_hours_conflict[\s\S]*?'status'\s*=>\s*409/,
      "mumbai_save_store_hours must reject with 409 store_hours_conflict when expected_version !== current_version"
    );

    // Verify transaction wrapping writes with checked start and commit
    assert.match(
      phpSource,
      /\$wpdb->query\('START TRANSACTION'\)\s*===\s*false[\s\S]*?'transaction_start_failed'[\s\S]*?\$wpdb->query\('COMMIT'\)\s*===\s*false[\s\S]*?'transaction_commit_failed'/,
      "mumbai_save_store_hours must check return values of START TRANSACTION and COMMIT"
    );

    // Verify post-commit direct database query verification for BOTH main row and version option
    assert.match(
      phpSource,
      /SELECT option_name,\s*option_value FROM {\$wpdb->options}[\s\S]*?mumbai_store_hours[\s\S]*?mumbai_store_hours_version[\s\S]*?version_verification_failed/,
      "mumbai_save_store_hours must verify both main bundle and version option directly against options table after commit"
    );

    // Verify transient recovery (delete transient if set_transient fails)
    assert.match(
      phpSource,
      /set_transient\('mumbai_store_hours'[\s\S]*?!\$transient_set[\s\S]*?delete_transient\('mumbai_store_hours'\)/,
      "mumbai_save_store_hours must delete transient if set_transient fails to ensure safe cache bypass"
    );

    // Verify RELEASE_LOCK in finally block
    assert.match(
      phpSource,
      /finally\s*\{[\s\S]*?RELEASE_LOCK\(%s\)/,
      "mumbai_save_store_hours must release GET_LOCK in finally block"
    );
  });
});
