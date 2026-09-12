import test from "node:test";
import assert from "node:assert/strict";
import {
  getAdminEmployees,
  requestEmployeeAccess,
  approveEmployee,
  rejectEmployee,
  updateEmployeeStatus,
  revokeEmployeeSessions,
} from "../src/controllers/adminEmployeeController.js";
import { requireRole } from "../src/middlewares/roleMiddleware.js";
import { invalidateUserSessionCache } from "../src/middlewares/authMiddleware.js";
import { maskEmail, maskPhone, redactSensitive } from "../src/utils/auditLogger.js";

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

test("1. Role Boundaries: Only employee can be assigned; shop_manager, administrator, and invalid roles are rejected", async (t) => {
  const invalidRoles = ["shop_manager", "administrator", "admin", "superadmin", "customer", "subscriber", "invalid_role", ""];

  for (const role of invalidRoles) {
    const { req, res } = createMockContext({
      params: { id: "10" },
      body: { role },
      user: { id: 1, roles: ["administrator"] },
      wpUserId: 1,
    });

    await approveEmployee(req, res);
    assert.equal(res.getStatus(), 400, `Role '${role}' should be rejected with 400`);
    assert.equal(res.getData()?.success, false);
    assert.match(res.getData()?.message, /invalid role/i);
  }

  for (const role of invalidRoles) {
    const { req, res } = createMockContext({
      body: { email: "test@example.com", role },
      user: { id: 1, roles: ["administrator"] },
      wpUserId: 1,
    });

    await requestEmployeeAccess(req, res);
    assert.equal(res.getStatus(), 400, `Role '${role}' in requestEmployeeAccess should be rejected with 400`);
    assert.equal(res.getData()?.success, false);
    assert.match(res.getData()?.message, /invalid role/i);
  }
});

test("2. Self-Modification Protection: Administrator cannot approve, reject, deactivate, or revoke own sessions via employee endpoints", async (t) => {
  const adminId = 5;

  // Approve self
  {
    const { req, res } = createMockContext({
      params: { id: String(adminId) },
      body: { role: "employee" },
      user: { id: adminId, roles: ["administrator"] },
      wpUserId: adminId,
    });
    await approveEmployee(req, res);
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getData()?.success, false);
    assert.match(res.getData()?.message, /cannot approve/i);
  }

  // Reject self
  {
    const { req, res } = createMockContext({
      params: { id: String(adminId) },
      body: { reason: "Self-reject" },
      user: { id: adminId, roles: ["administrator"] },
      wpUserId: adminId,
    });
    await rejectEmployee(req, res);
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getData()?.success, false);
  }

  // Deactivate self
  {
    const { req, res } = createMockContext({
      params: { id: String(adminId) },
      body: { status: "deactivated" },
      user: { id: adminId, roles: ["administrator"] },
      wpUserId: adminId,
    });
    await updateEmployeeStatus(req, res);
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getData()?.success, false);
  }

  // Revoke own sessions
  {
    const { req, res } = createMockContext({
      params: { id: String(adminId) },
      user: { id: adminId, roles: ["administrator"] },
      wpUserId: adminId,
    });
    await revokeEmployeeSessions(req, res);
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getData()?.success, false);
  }
});

test("3. Role Middleware: Employee routes strictly allow employee and administrator; reject customer, pending, or deactivated", (t) => {
  const allowedEmployeeRoles = ["employee", "administrator"];
  const middleware = requireRole(allowedEmployeeRoles);

  // Allowed roles
  ["employee", "administrator"].forEach((role) => {
    let nextCalled = false;
    const { req, res } = createMockContext({
      user: { id: 10, roles: [role] },
    });
    middleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true, `Role '${role}' should have access to employee routes`);
  });

  // Rejected roles (customers, pending candidates, deactivated users with customer role)
  [
    ["customer"],
    ["subscriber"],
    [],
    ["guest"],
    ["pending_employee"],
  ].forEach((roles) => {
    let nextCalled = false;
    const { req, res } = createMockContext({
      user: { id: 20, roles },
    });
    middleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false, `Roles ${JSON.stringify(roles)} should be blocked from employee routes`);
    assert.equal(res.getStatus(), 403);
  });
});

test("4. Email Validation: requestEmployeeAccess validates email syntax strictly", async (t) => {
  const invalidEmails = ["not-an-email", "test@", "@domain.com", "spaces in@email.com", "", null];

  for (const email of invalidEmails) {
    const { req, res } = createMockContext({
      body: { email, role: "employee" },
      user: { id: 1, roles: ["administrator"] },
      wpUserId: 1,
    });

    await requestEmployeeAccess(req, res);
    assert.equal(res.getStatus(), 400, `Invalid email '${email}' should return 400`);
    assert.equal(res.getData()?.success, false);
  }
});

test("5. Status Validation: updateEmployeeStatus strictly accepts only 'active' and 'deactivated'", async (t) => {
  const invalidStatuses = ["pending", "approved", "rejected", "deleted", "banned", "", null];

  for (const status of invalidStatuses) {
    const { req, res } = createMockContext({
      params: { id: "15" },
      body: { status },
      user: { id: 1, roles: ["administrator"] },
      wpUserId: 1,
    });

    await updateEmployeeStatus(req, res);
    assert.equal(res.getStatus(), 400, `Invalid status '${status}' should return 400`);
    assert.equal(res.getData()?.success, false);
  }
});

test("6. Audit Logging: Masks email/phone and redacts sensitive data on employee access events", (t) => {
  const email = "employee.dispatch@mumbaicollection.com";
  const masked = maskEmail(email);
  assert.equal(masked.startsWith("e***h@"), true);
  assert.equal(masked.includes("dispatch"), false);

  const phone = "+919820123456";
  const maskedP = maskPhone(phone);
  assert.equal(maskedP, "******3456");

  const sensitiveObj = {
    password: "SuperSecretPassword123!",
    token: "wp_session_token_xyz",
    email: "dispatch@store.com",
    role: "employee",
  };
  const redacted = redactSensitive(sensitiveObj);
  assert.equal(redacted.password, "[REDACTED]");
  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.role, "employee");
  assert.equal(redacted.email.includes("***"), true);
});

test("7. Session Cache Invalidation: invalidateUserSessionCache safely handles numeric and string user IDs without exceptions", (t) => {
  assert.doesNotThrow(() => {
    invalidateUserSessionCache(123);
    invalidateUserSessionCache("456");
    invalidateUserSessionCache(null);
    invalidateUserSessionCache(undefined);
  });
});
