import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { logAuditEvent, maskEmail, redactSensitive, rotateAuditLogIfNeeded } from "../src/utils/auditLogger.js";

test("Audit Logger Actor Resolution Suite", async (t) => {
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
    console.log = originalConsoleLog;
  });

  await t.test("1. Administrator action with roles array and email: logs role='administrator' and masked email", () => {
    const req = {
      wpUserId: 1,
      wpUserEmail: "admin@mumbaicollection.com",
      authContext: "admin",
      user: {
        id: 1,
        roles: ["administrator"],
        email: "admin@mumbaicollection.com",
      },
      ip: "127.0.0.1",
      headers: {
        "user-agent": "AdminDashboard/1.0",
      },
    };

    logAuditEvent({
      req,
      action: "employee.access_requested",
      targetType: "employee_candidate",
      targetId: "candidate@example.com",
      details: { role: "employee" },
    });

    assert.equal(capturedLogs.length, 1);
    const entry = capturedLogs[0];
    assert.equal(entry.action, "employee.access_requested");
    assert.equal(entry.actor.id, 1);
    assert.equal(entry.actor.role, "administrator");
    assert.equal(entry.actor.email, "a***n@mumbaicollection.com");
    assert.equal(entry.actor.ip, "127.0.0.1");
  });

  await t.test("2. Administrator approval action: resolves actor role from roles[0] and masks email", () => {
    const req = {
      wpUserId: 1,
      user: {
        id: 1,
        roles: ["administrator"],
        email: "storeadmin@vasai.in",
      },
      ip: "::1",
      headers: {},
    };

    logAuditEvent({
      req,
      action: "employee.approved",
      targetType: "user",
      targetId: 42,
      details: { role: "employee", approved_by: 1 },
    });

    assert.equal(capturedLogs.length, 1);
    const entry = capturedLogs[0];
    assert.equal(entry.action, "employee.approved");
    assert.equal(entry.actor.id, 1);
    assert.equal(entry.actor.role, "administrator");
    assert.equal(entry.actor.email, "s***n@vasai.in");
  });

  await t.test("3. Employee action: logs role='employee' and masks employee email", () => {
    const req = {
      wpUserId: 5,
      authContext: "employee",
      user: {
        id: 5,
        roles: ["employee"],
        email: "staff.ops@mumbaicollection.com",
      },
      ip: "192.168.1.50",
      headers: { "user-agent": "EmployeePanel/1.0" },
    };

    logAuditEvent({
      req,
      action: "ORDER_STATUS_UPDATE",
      targetType: "order",
      targetId: "305",
      details: { newStatus: "out-for-delivery" },
    });

    assert.equal(capturedLogs.length, 1);
    const entry = capturedLogs[0];
    assert.equal(entry.action, "ORDER_STATUS_UPDATE");
    assert.equal(entry.actor.id, 5);
    assert.equal(entry.actor.role, "employee");
    assert.equal(entry.actor.email, "s***s@mumbaicollection.com");
  });

  await t.test("4. Customer action: resolves role='customer' from roles array", () => {
    const req = {
      wpUserId: 10,
      authContext: "customer",
      user: {
        id: 10,
        roles: ["customer"],
        email: "customer10@gmail.com",
      },
      ip: "10.0.0.2",
    };

    logAuditEvent({
      req,
      action: "PROFILE_UPDATE",
      targetType: "customer",
      targetId: 10,
      details: { full_name: "Rahul Sharma" },
    });

    assert.equal(capturedLogs.length, 1);
    const entry = capturedLogs[0];
    assert.equal(entry.actor.id, 10);
    assert.equal(entry.actor.role, "customer");
    assert.equal(entry.actor.email, "c***0@gmail.com");
  });

  await t.test("5. Fallback precedence: wpUserRole > user.role > user.roles[0] > authContext > guest", () => {
    // A. wpUserRole takes highest precedence
    logAuditEvent({
      req: { wpUserId: 1, wpUserRole: "administrator", user: { role: "guest" } },
      action: "TEST_1",
      targetType: "test",
      targetId: 1,
    });
    assert.equal(capturedLogs[0].actor.role, "administrator");

    // B. user.role (singular)
    logAuditEvent({
      req: { user: { id: 2, role: "employee" } },
      action: "TEST_2",
      targetType: "test",
      targetId: 2,
    });
    assert.equal(capturedLogs[1].actor.role, "employee");

    // C. user.roles (array)
    logAuditEvent({
      req: { user: { id: 3, roles: ["administrator"] } },
      action: "TEST_3",
      targetType: "test",
      targetId: 3,
    });
    assert.equal(capturedLogs[2].actor.role, "administrator");

    // D. authContext='admin' -> 'administrator'
    logAuditEvent({
      req: { authContext: "admin" },
      action: "TEST_4",
      targetType: "test",
      targetId: 4,
    });
    assert.equal(capturedLogs[3].actor.role, "administrator");

    // E. Unauthenticated -> 'guest' and 'unauthenticated'
    logAuditEvent({
      req: {},
      action: "TEST_5",
      targetType: "test",
      targetId: 5,
    });
    assert.equal(capturedLogs[4].actor.role, "guest");
    assert.equal(capturedLogs[4].actor.id, "unauthenticated");
    assert.equal(capturedLogs[4].actor.email, null);
  });

  await t.test("6. rotateAuditLogIfNeeded rotates files when file size threshold is reached", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-rotate-test-"));
    const testLogFile = path.join(tmpDir, "test-audit.log");

    try {
      // Create a small test log file (100 bytes)
      fs.writeFileSync(testLogFile, "x".repeat(100));

      // With maxSizeBytes = 200: does not rotate
      const rotatedBefore = rotateAuditLogIfNeeded(testLogFile, 200, 3);
      assert.equal(rotatedBefore, false);
      assert.equal(fs.existsSync(testLogFile), true);
      assert.equal(fs.existsSync(`${testLogFile}.1`), false);

      // With maxSizeBytes = 50: rotates to .1
      const rotatedAfter = rotateAuditLogIfNeeded(testLogFile, 50, 3);
      assert.equal(rotatedAfter, true);
      assert.equal(fs.existsSync(testLogFile), false);
      assert.equal(fs.existsSync(`${testLogFile}.1`), true);

      // Create new active log file and rotate again
      fs.writeFileSync(testLogFile, "y".repeat(100));
      const rotatedSecond = rotateAuditLogIfNeeded(testLogFile, 50, 3);
      assert.equal(rotatedSecond, true);
      assert.equal(fs.existsSync(`${testLogFile}.1`), true);
      assert.equal(fs.existsSync(`${testLogFile}.2`), true);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
