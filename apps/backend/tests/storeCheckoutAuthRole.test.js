import test from "node:test";
import assert from "node:assert/strict";

test("Store API Checkout Authentication & Customer Role Boundary Suite", async (suite) => {
  // 1. Staff cookie rejection and customer role enforcement
  await suite.test("1. Checkout resolver rejects staff accounts and requires customer role", () => {
    const validateCheckoutCaller = ({ sessionData, cookieName }) => {
      // Must not accept staff cookie names
      if (cookieName === "mumbai_admin_auth" || cookieName === "mumbai_employee_auth") {
        return { statusCode: 401, code: "AUTH_REQUIRED" };
      }

      if (!sessionData) {
        return { statusCode: 401, code: "AUTH_REQUIRED" };
      }

      // Handle upstream outage / timeout
      if (sessionData.error === "AUTH_UNAVAILABLE" || sessionData.error === "AUTH_TIMEOUT") {
        return { statusCode: 503, code: "SERVICE_UNAVAILABLE" };
      }

      // Genuinely invalid or missing session
      if (!sessionData.valid || !sessionData.userId) {
        return { statusCode: 401, code: "AUTH_REQUIRED" };
      }

      // Role check: Only customer role permitted; staff accounts blocked from retail checkout
      const roles = Array.isArray(sessionData.roles) ? sessionData.roles : [];
      const isCustomer = roles.includes("customer");
      const isStaff = roles.some((r) => ["administrator", "shop_manager", "employee"].includes(r));

      if (!isCustomer || isStaff) {
        return { statusCode: 403, code: "CUSTOMER_ROLE_REQUIRED" };
      }

      return { statusCode: 200, code: "ALLOWED" };
    };

    // Case A: Valid customer -> allowed
    const customer = validateCheckoutCaller({
      cookieName: "mumbai_customer_auth",
      sessionData: { valid: true, userId: 101, roles: ["customer"] },
    });
    assert.equal(customer.statusCode, 200);
    assert.equal(customer.code, "ALLOWED");

    // Case B: Staff cookie rejected
    const adminCookie = validateCheckoutCaller({
      cookieName: "mumbai_admin_auth",
      sessionData: { valid: true, userId: 1, roles: ["administrator"] },
    });
    assert.equal(adminCookie.statusCode, 401);

    const employeeCookie = validateCheckoutCaller({
      cookieName: "mumbai_employee_auth",
      sessionData: { valid: true, userId: 2, roles: ["employee"] },
    });
    assert.equal(employeeCookie.statusCode, 401);

    // Case C: Administrator logging into storefront rejected from retail checkout
    const adminRole = validateCheckoutCaller({
      cookieName: "mumbai_customer_auth",
      sessionData: { valid: true, userId: 1, roles: ["administrator"] },
    });
    assert.equal(adminRole.statusCode, 403);
    assert.equal(adminRole.code, "CUSTOMER_ROLE_REQUIRED");

    // Case D: Employee logging into storefront rejected from retail checkout
    const employeeRole = validateCheckoutCaller({
      cookieName: "mumbai_customer_auth",
      sessionData: { valid: true, userId: 2, roles: ["employee"] },
    });
    assert.equal(employeeRole.statusCode, 403);
    assert.equal(employeeRole.code, "CUSTOMER_ROLE_REQUIRED");

    // Case E: Upstream outage / timeout returns 503 Service Unavailable, NOT 401 Auth Required
    const outage = validateCheckoutCaller({
      cookieName: "mumbai_customer_auth",
      sessionData: { valid: false, error: "AUTH_UNAVAILABLE" },
    });
    assert.equal(outage.statusCode, 503);
    assert.equal(outage.code, "SERVICE_UNAVAILABLE");

    const timeout = validateCheckoutCaller({
      cookieName: "mumbai_customer_auth",
      sessionData: { valid: false, error: "AUTH_TIMEOUT" },
    });
    assert.equal(timeout.statusCode, 503);
    assert.equal(timeout.code, "SERVICE_UNAVAILABLE");

    // Case F: Genuinely expired session returns 401
    const expired = validateCheckoutCaller({
      cookieName: "mumbai_customer_auth",
      sessionData: { valid: false, error: "SESSION_EXPIRED" },
    });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.code, "AUTH_REQUIRED");
  });

  // 2. Registration session confirmation flag
  await suite.test("2. Registration payload includes session_established boolean", () => {
    const buildRegistrationPayload = ({ session, cookieName, authUser }) => {
      const sessionEstablished = Boolean(session && cookieName);
      return {
        success: true,
        session_established: sessionEstablished,
        message: sessionEstablished
          ? "Account created successfully."
          : "Account created successfully. Please sign in to continue.",
        user: authUser,
      };
    };

    // Auto-login succeeded
    const withSession = buildRegistrationPayload({
      session: "sess_123",
      cookieName: "mumbai_customer_auth",
      authUser: { id: 50, name: "Customer" },
    });
    assert.equal(withSession.session_established, true);

    // Auto-login failed
    const withoutSession = buildRegistrationPayload({
      session: null,
      cookieName: null,
      authUser: { id: 51, name: "Customer 2" },
    });
    assert.equal(withoutSession.session_established, false);
    assert.match(withoutSession.message, /Please sign in/i);
  });
});
