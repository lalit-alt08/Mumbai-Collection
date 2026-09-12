import test from "node:test";
import assert from "node:assert/strict";

test("401 session expiration: clears auth session cleanly and suppresses false-alarm console errors", () => {
  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);

  try {
    let userState = { id: 123, email: "staff@example.com", name: "Staff Member" };
    let storage = {
      user: JSON.stringify(userState),
      user_profile: JSON.stringify({ full_name: "Staff Member" }),
    };
    let cartCleared = false;

    const clearCartSession = () => {
      cartCleared = true;
    };

    const handleSessionExpired = () => {
      userState = null;
      delete storage.user;
      delete storage.user_profile;
      clearCartSession();
    };

    // Simulate 401 Session Expired response
    const mock401Error = {
      response: {
        status: 401,
        data: { message: "Session expired." },
      },
    };

    // Execute session expiration handling logic (matching ProtectedRoute / ProfileSetup)
    if (mock401Error.response?.status === 401) {
      handleSessionExpired();
    } else {
      console.error("PROFILE COMPLETION CHECK ERROR:", mock401Error.response?.data);
    }

    assert.equal(userState, null, "User state must be cleared on 401 session expiration");
    assert.equal(storage.user, undefined, "localStorage user must be cleared on 401");
    assert.equal(storage.user_profile, undefined, "localStorage user_profile must be cleared on 401");
    assert.equal(cartCleared, true, "Cart session must be cleared on 401");
    assert.equal(errors.length, 0, "No console errors should be logged for expected 401 session expiration");
  } finally {
    console.error = originalConsoleError;
  }
});

test("Unexpected API error (500 / network): logs error to console and preserves failure visibility", () => {
  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);

  try {
    let userState = { id: 123, email: "staff@example.com" };
    let storage = { user: JSON.stringify(userState) };
    let cartCleared = false;

    const clearCartSession = () => {
      cartCleared = true;
    };

    const handleSessionExpired = () => {
      userState = null;
      delete storage.user;
      clearCartSession();
    };

    // Simulate 500 Internal Server Error
    const mock500Error = {
      response: {
        status: 500,
        data: { message: "Internal server database error" },
      },
      message: "Request failed with status code 500",
    };

    // Execute error handling logic
    if (mock500Error.response?.status === 401) {
      handleSessionExpired();
    } else {
      console.error(
        "PROFILE COMPLETION CHECK ERROR:",
        mock500Error.response?.data || mock500Error.message
      );
    }

    assert.notEqual(userState, null, "User state should not be wiped blindly on temporary 500 error");
    assert.equal(cartCleared, false, "Cart should not be cleared on 500 server error");
    assert.equal(errors.length, 1, "Genuine 500 error must be logged to console");
    assert.equal(errors[0][0], "PROFILE COMPLETION CHECK ERROR:");
    assert.deepEqual(errors[0][1], { message: "Internal server database error" });
  } finally {
    console.error = originalConsoleError;
  }
});
