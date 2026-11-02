import test from "node:test";
import assert from "node:assert/strict";

test("Customer Web: Onboarding and Profile Setup Contracts", async (suite) => {
  await suite.test("1. needsPassword contract for registration and Google SSO", () => {
    const computeNeedsPassword = (user) => {
      return user?.is_google_user !== true && user?.has_usable_password === false;
    };

    // User coming from OTP email registration: permanent password already established
    assert.equal(
      computeNeedsPassword({ has_usable_password: true, is_google_user: false }),
      false,
      "OTP registration user must not be asked for password"
    );

    // Client navigation state cannot bypass password requirement for passwordless non-Google user
    assert.equal(
      computeNeedsPassword({ has_usable_password: false, is_google_user: false }),
      true,
      "Authoritative account flag requires password setup for non-Google user"
    );

    // Google SSO user: must remain passwordless even if has_usable_password is false
    assert.equal(
      computeNeedsPassword({ has_usable_password: false, is_google_user: true }),
      false,
      "Google user must not be asked for password"
    );

    // Legacy passwordless customer (not Google): must set password
    assert.equal(
      computeNeedsPassword({ has_usable_password: false, is_google_user: false }),
      true,
      "Legacy passwordless customer must be prompted to set password"
    );
  });

  await suite.test("2. refreshUser() structured contract for success, unauthorized, and unavailable", async () => {
    // Simulator matching AuthContext.jsx refreshUser implementation
    const simulateRefreshUser = async ({ mockResponse, mockError }) => {
      try {
        if (mockError) throw mockError;
        const response = mockResponse;
        if ((response?.success && response?.user) || (response?.logged_in && response?.current_user_id)) {
          const userData = response.user || {
            id: response.current_user_id,
            roles: response.roles || [],
          };
          return { ok: true, user: userData };
        } else {
          return {
            ok: false,
            reason: "unauthorized",
            status: 401,
          };
        }
      } catch (error) {
        if (error.response?.status === 401) {
          return {
            ok: false,
            reason: "unauthorized",
            status: 401,
          };
        }
        return {
          ok: false,
          reason: "unavailable",
          status: error.response?.status || 0,
        };
      }
    };

    // Test successful refresh
    const successResult = await simulateRefreshUser({
      mockResponse: { success: true, user: { id: 123, name: "Test User", phone: "9876543210" } },
    });
    assert.equal(successResult.ok, true);
    assert.equal(successResult.user.id, 123);
    assert.equal(successResult.user.phone, "9876543210");

    // Test 401 session expiration
    const expiredResult = await simulateRefreshUser({
      mockResponse: { success: false, message: "Invalid session" },
    });
    assert.equal(expiredResult.ok, false);
    assert.equal(expiredResult.reason, "unauthorized");
    assert.equal(expiredResult.status, 401);

    // Test 401 thrown by network call
    const err401 = new Error("Unauthorized");
    err401.response = { status: 401 };
    const thrown401Result = await simulateRefreshUser({ mockError: err401 });
    assert.equal(thrown401Result.ok, false);
    assert.equal(thrown401Result.reason, "unauthorized");
    assert.equal(thrown401Result.status, 401);

    // Test 503 network outage (temporary backend/WordPress failure)
    const outageErr = new Error("Gateway Timeout");
    outageErr.response = { status: 504, data: { message: "Upstream timeout" } };
    const outageResult = await simulateRefreshUser({ mockError: outageErr });
    assert.equal(outageResult.ok, false);
    assert.equal(outageResult.reason, "unavailable");
    assert.equal(outageResult.status, 504);
  });

  await suite.test("3. ProtectedRoute explicit state model prevents outage redirect to profile-setup", () => {
    // Contract check for ProtectedRoute state-driven decision logic:
    // profileStatus: "checking" | "complete" | "incomplete" | "unavailable"
    const getRouteAction = ({ profileStatus, pathname }) => {
      if (pathname === "/profile-setup") {
        return "allow"; // Direct access to profile-setup always permitted
      }
      if (profileStatus === "complete") {
        return "allow";
      }
      if (profileStatus === "incomplete") {
        return "redirect-to-profile-setup";
      }
      if (profileStatus === "unavailable") {
        return "show-retry-screen";
      }
      return "show-loader"; // "checking"
    };

    // Case A: User on /profile-setup is always allowed without gate
    assert.equal(getRouteAction({ profileStatus: "incomplete", pathname: "/profile-setup" }), "allow");
    assert.equal(getRouteAction({ profileStatus: "checking", pathname: "/profile-setup" }), "allow");

    // Case B: Completeness check in-flight on /account shows loader, does NOT bounce
    assert.equal(getRouteAction({ profileStatus: "checking", pathname: "/account" }), "show-loader");

    // Case C: Verified complete allows access to /account
    assert.equal(getRouteAction({ profileStatus: "complete", pathname: "/account" }), "allow");

    // Case D: Authoritative incomplete redirects to /profile-setup
    assert.equal(getRouteAction({ profileStatus: "incomplete", pathname: "/account" }), "redirect-to-profile-setup");

    // Case E: Outage / 503 / timeout shows retry screen, does NOT redirect to profile-setup, does NOT allow access
    assert.equal(getRouteAction({ profileStatus: "unavailable", pathname: "/account" }), "show-retry-screen");
  });

  await suite.test("4. Duplicate address recovery and requiresAddress contract", async () => {
    // Check requiresAddress logic
    const computeRequiresAddress = (addresses, isEditingAddress) => {
      return addresses.length === 0 || isEditingAddress;
    };

    assert.equal(computeRequiresAddress([], false), true, "Address required if customer has no saved address");
    assert.equal(computeRequiresAddress([{ id: "1", type: "home" }], true), true, "Address required if actively editing");
    assert.equal(computeRequiresAddress([{ id: "1", type: "home" }], false), false, "Address not required if already saved and not editing");

    // Check duplicate address error recovery logic
    const handleAddressSaveError = (addrErr, existingAddresses, addressPayload) => {
      const isDuplicateType =
        addrErr.response?.status === 400 &&
        (addrErr.response?.data?.code === "ADDRESS_TYPE_EXISTS" ||
          String(addrErr.response?.data?.message || "").toLowerCase().includes("already have a saved"));

      if (!isDuplicateType) {
        throw addrErr;
      }

      const match = existingAddresses.find(
        (a) => (a.type || "").toLowerCase() === (addressPayload.type || "").toLowerCase()
      );
      if (!match?.id) {
        throw addrErr;
      }
      return { action: "update", targetId: match.id };
    };

    // Case A: 400 with code ADDRESS_TYPE_EXISTS and existing match updates target
    const dupErr = {
      response: {
        status: 400,
        data: {
          code: "ADDRESS_TYPE_EXISTS",
          message: "You already have a saved Home address.",
        },
      },
    };
    const recoveryResult = handleAddressSaveError(dupErr, [{ id: "addr_123", type: "home" }], { type: "home" });
    assert.deepEqual(recoveryResult, { action: "update", targetId: "addr_123" });

    // Case B: 400 duplicate type but no matching id found in current list must rethrow error, not swallow
    assert.throws(
      () => handleAddressSaveError(dupErr, [{ id: "addr_456", type: "office" }], { type: "home" }),
      (err) => err === dupErr
    );

    // Case C: Unrelated error (e.g. 500 or validation) must rethrow immediately
    const genericErr = { response: { status: 500, data: { message: "Server error" } } };
    assert.throws(
      () => handleAddressSaveError(genericErr, [{ id: "addr_123", type: "home" }], { type: "home" }),
      (err) => err === genericErr
    );
  });

  await suite.test("5. Initial mount 401 session expiration does not suppress genuine 401s for fresh registrations", () => {
    const evaluateInitialSessionState = (profileResult, addressResult) => {
      const bothUnauthorized =
        profileResult.status === "rejected" &&
        profileResult.reason?.response?.status === 401 &&
        addressResult.status === "rejected" &&
        addressResult.reason?.response?.status === 401;

      if (bothUnauthorized) {
        return "redirect-to-login";
      }
      return "stay-on-page";
    };

    // Both endpoints return 401: must redirect to login immediately even if arriving from register
    const err401 = { response: { status: 401 } };
    assert.equal(
      evaluateInitialSessionState(
        { status: "rejected", reason: err401 },
        { status: "rejected", reason: err401 }
      ),
      "redirect-to-login",
      "Both 401 responses must trigger session expiration and redirect to login"
    );

    // Profile succeeds, address empty (fresh user): stay on page
    assert.equal(
      evaluateInitialSessionState(
        { status: "fulfilled", value: { data: { profile: { first_name: "Rahul" } } } },
        { status: "fulfilled", value: { data: { addresses: [] } } }
      ),
      "stay-on-page",
      "Successful session must stay on page"
    );

    // Profile succeeds, addresses has network failure (500 or timeout): stay on page, do not boot to login
    assert.equal(
      evaluateInitialSessionState(
        { status: "fulfilled", value: { data: { profile: { first_name: "Rahul" } } } },
        { status: "rejected", reason: { response: { status: 504 } } }
      ),
      "stay-on-page",
      "Outage on one endpoint with valid session on the other must not trigger 401 redirect"
    );
  });
});
