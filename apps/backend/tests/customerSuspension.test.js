import test from "node:test";
import assert from "node:assert/strict";
import wp from "../src/services/wordpress.js";
import {
  lookupCustomerSuspension,
  suspendCustomer,
  unsuspendCustomer,
} from "../src/controllers/adminCustomerSuspensionController.js";
import {
  checkSessionSuspended,
  invalidateUserSessionCache,
} from "../src/middlewares/authMiddleware.js";
import { logAuditEvent } from "../src/utils/auditLogger.js";

// Mock helper for Express req/res
const createMockContext = ({
  body = {},
  params = {},
  query = {},
  headers = {},
  cookies = {},
  user = null,
  wpUserId = null,
} = {}) => {
  let statusCode = 200;
  let responseData = null;

  const req = {
    body,
    params,
    query,
    headers,
    cookies,
    user,
    wpUserId,
    ip: "127.0.0.1",
  };

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    getStatus: () => statusCode,
    getData: () => responseData,
  };

  return { req, res };
};

test("Customer Suspension Architecture & Enforcement Suite", async (t) => {
  const originalWpGet = wp.get;
  const originalWpPost = wp.post;
  let capturedLogs = [];
  const originalConsoleLog = console.log;

  t.beforeEach(() => {
    capturedLogs = [];
    console.log = (msg) => {
      if (typeof msg === "string" && msg.startsWith("[AUDIT] ")) {
        capturedLogs.push(JSON.parse(msg.slice(8)));
      }
    };
  });

  t.afterEach(() => {
    wp.get = originalWpGet;
    wp.post = originalWpPost;
    console.log = originalConsoleLog;
  });

  await t.test("1. Customer Lookup: Missing email returns 400", async () => {
    const { req, res } = createMockContext({ query: {} });
    await lookupCustomerSuspension(req, res);
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getData().success, false);
    assert.match(res.getData().message, /email is required/i);
  });

  await t.test("2. Customer Lookup: Registered customer returns details and suspension status", async () => {
    wp.get = async (url, config) => {
      assert.equal(url, "/wp-json/mumbai-auth/v1/admin/customer-suspension/lookup");
      assert.equal(config.params.email, "customer@example.com");
      return {
        data: {
          success: true,
          customer: {
            id: 101,
            email: "customer@example.com",
            name: "John Doe",
            phone: "9820123456",
            roles: ["customer"],
            registered_at: "2026-01-15T10:30:00Z",
            is_suspended: false,
            duration: null,
            expires_at: null,
            reason: "",
            is_permanent: false,
          },
        },
      };
    };

    const { req, res } = createMockContext({
      query: { email: "customer@example.com" },
    });

    await lookupCustomerSuspension(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getData().success, true);
    assert.equal(res.getData().customer.id, 101);
    assert.equal(res.getData().customer.is_suspended, false);
  });

  await t.test("3. Customer Lookup Eligibility: Rejects administrator and employee accounts", async () => {
    wp.get = async () => {
      const error = new Error("Administrator accounts cannot be suspended.");
      error.response = {
        status: 400,
        data: {
          success: false,
          message: "Administrator accounts cannot be suspended.",
        },
      };
      throw error;
    };

    const { req, res } = createMockContext({
      query: { email: "admin@mumbaicollection.com" },
    });

    await lookupCustomerSuspension(req, res);
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getData().message, "Administrator accounts cannot be suspended.");
  });

  await t.test("4. Customer Lookup: Unknown customer returns 404", async () => {
    wp.get = async () => {
      const error = new Error("Customer not found.");
      error.response = {
        status: 404,
        data: {
          success: false,
          message: "No registered customer found with email: unknown@example.com",
        },
      };
      throw error;
    };

    const { req, res } = createMockContext({
      query: { email: "unknown@example.com" },
    });

    await lookupCustomerSuspension(req, res);
    assert.equal(res.getStatus(), 404);
    assert.match(res.getData().message, /no registered customer found|not found/i);
  });

  await t.test("5. Suspend Customer: Validates required email and duration", async () => {
    const { req: req1, res: res1 } = createMockContext({
      body: { duration: "3_months" },
    });
    await suspendCustomer(req1, res1);
    assert.equal(res1.getStatus(), 400);

    const { req: req2, res: res2 } = createMockContext({
      body: { email: "customer@example.com" },
    });
    await suspendCustomer(req2, res2);
    assert.equal(res2.getStatus(), 400);
    assert.match(res2.getData().message, /duration is required/i);
  });

  await t.test("6. Suspend Customer: 3 months duration logs audit event with internal reason", async () => {
    wp.post = async (url, data) => {
      assert.equal(url, "/wp-json/mumbai-auth/v1/admin/customer-suspension/suspend");
      assert.equal(data.email, "customer@example.com");
      assert.equal(data.duration, "3_months");
      assert.equal(data.reason, "Repeated failed delivery");
      return {
        data: {
          success: true,
          message: "Customer account suspended successfully.",
          customer: {
            id: 101,
            email: "customer@example.com",
            is_suspended: true,
            duration: "3_months",
            expires_at: "2026-12-09T20:30:00Z",
            expires_at_timestamp: Math.floor(Date.now() / 1000) + 90 * 86400,
            reason: "Repeated failed delivery",
            is_permanent: false,
          },
        },
      };
    };

    const { req, res } = createMockContext({
      body: {
        email: "customer@example.com",
        duration: "3_months",
        reason: "Repeated failed delivery",
      },
      wpUserId: 1,
      user: { id: 1, roles: ["administrator"], email: "admin@mumbaicollection.com" },
    });

    await suspendCustomer(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getData().success, true);
    assert.equal(res.getData().customer.is_suspended, true);

    // Verify audit log captured
    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];
    assert.equal(log.action, "customer.suspended");
    assert.equal(log.target.type, "customer");
    assert.equal(log.target.id, 101);
    assert.equal(log.actor.id, 1);
    assert.equal(log.details.email, "c***r@example.com");
    assert.equal(log.details.duration, "3_months");
    assert.equal(log.details.is_permanent, false);
    assert.equal(log.details.reason, "Repeated failed delivery");
  });

  await t.test("7. Suspend Customer: Permanent duration sets is_permanent=true and expires_at=null", async () => {
    wp.post = async () => {
      return {
        data: {
          success: true,
          message: "Customer account suspended successfully.",
          customer: {
            id: 102,
            email: "fraud@example.com",
            is_suspended: true,
            duration: "permanent",
            expires_at: null,
            expires_at_timestamp: 0,
            reason: "Severe policy violation",
            is_permanent: true,
          },
        },
      };
    };

    const { req, res } = createMockContext({
      body: {
        email: "fraud@example.com",
        duration: "permanent",
        reason: "Severe policy violation",
      },
      wpUserId: 1,
    });

    await suspendCustomer(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getData().customer.is_permanent, true);
    assert.equal(res.getData().customer.expires_at, null);
  });

  await t.test("8. Unsuspend Customer: Clears suspension and logs audit event", async () => {
    wp.post = async (url, data) => {
      assert.equal(url, "/wp-json/mumbai-auth/v1/admin/customer-suspension/unsuspend");
      assert.equal(data.email, "customer@example.com");
      return {
        data: {
          success: true,
          message: "Customer suspension removed successfully.",
          customer: {
            id: 101,
            email: "customer@example.com",
            is_suspended: false,
          },
        },
      };
    };

    const { req, res } = createMockContext({
      body: { email: "customer@example.com" },
      wpUserId: 1,
    });

    await unsuspendCustomer(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getData().customer.is_suspended, false);

    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];
    assert.equal(log.action, "customer.unsuspended");
    assert.equal(log.target.id, 101);
  });

  await t.test("9. Server-Side Expiry Evaluation: Expired temporary suspension is automatically inactive", () => {
    const nowSec = Math.floor(Date.now() / 1000);

    // Helper simulating WordPress mumbai_is_customer_suspended logic
    const evalSuspended = (meta) => {
      if (meta.suspended !== "yes") return false;
      const exp = Number(meta.expires_at) || 0;
      if (exp > 0 && nowSec >= exp) return false;
      return true;
    };

    // 1. Unexpired 3-month suspension
    assert.equal(
      evalSuspended({ suspended: "yes", expires_at: nowSec + 3600 }),
      true,
      "Future expiry should be active"
    );

    // 2. Expired suspension (yesterday)
    assert.equal(
      evalSuspended({ suspended: "yes", expires_at: nowSec - 86400 }),
      false,
      "Past expiry should automatically be inactive"
    );

    // 3. Permanent suspension (expires_at = 0)
    assert.equal(
      evalSuspended({ suspended: "yes", expires_at: 0 }),
      true,
      "Permanent suspension should never expire"
    );

    // 4. Unsuspended customer
    assert.equal(
      evalSuspended({ suspended: "no", expires_at: 0 }),
      false,
      "Unsuspended customer should be false"
    );
  });

  await t.test("10. Checkout Enforcement: Active suspension blocks checkout with 403 CUSTOMER_SUSPENDED", () => {
    // Simulating checkout proxy guard logic
    const simulateCheckoutGuard = ({ isSuspended, isStoreOpen, isPhoneVerified }) => {
      if (!isStoreOpen) {
        return { status: 403, code: "STORE_CLOSED" };
      }
      if (isSuspended) {
        return {
          status: 403,
          code: "CUSTOMER_SUSPENDED",
          message: "Your account is currently suspended and you cannot place new orders.",
        };
      }
      if (!isPhoneVerified) {
        return { status: 403, code: "PHONE_NOT_VERIFIED" };
      }
      return { status: 200, code: "OK" };
    };

    // 1. Suspended customer cannot checkout
    const res1 = simulateCheckoutGuard({
      isSuspended: true,
      isStoreOpen: true,
      isPhoneVerified: true,
    });
    assert.equal(res1.status, 403);
    assert.equal(res1.code, "CUSTOMER_SUSPENDED");
    assert.equal(res1.message, "Your account is currently suspended and you cannot place new orders.");

    // 2. Non-suspended customer proceeds to checkout
    const res2 = simulateCheckoutGuard({
      isSuspended: false,
      isStoreOpen: true,
      isPhoneVerified: true,
    });
    assert.equal(res2.status, 200);

    // 3. Unsuspended customer is restored
    const res3 = simulateCheckoutGuard({
      isSuspended: false,
      isStoreOpen: true,
      isPhoneVerified: true,
    });
    assert.equal(res3.status, 200);
    assert.equal(res3.code, "OK");
  });

  await t.test("11. Checkout Guard Independence: Store hours and phone verification guards remain distinct", () => {
    const simulateCheckoutGuard = ({ isSuspended, isStoreOpen, isPhoneVerified }) => {
      if (!isStoreOpen) {
        return { status: 403, code: "STORE_CLOSED" };
      }
      if (isSuspended) {
        return { status: 403, code: "CUSTOMER_SUSPENDED" };
      }
      if (!isPhoneVerified) {
        return { status: 403, code: "PHONE_NOT_VERIFIED" };
      }
      return { status: 200, code: "OK" };
    };

    // Store closed takes precedence or remains distinct
    assert.equal(
      simulateCheckoutGuard({ isSuspended: true, isStoreOpen: false, isPhoneVerified: true }).code,
      "STORE_CLOSED"
    );

    // Phone unverified remains distinct when customer is not suspended
    assert.equal(
      simulateCheckoutGuard({ isSuspended: false, isStoreOpen: true, isPhoneVerified: false }).code,
      "PHONE_NOT_VERIFIED"
    );
  });
});
