import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { saveProfile, checkProfileComplete } from "../src/controllers/profileController.js";

test("Backend: saveProfile Onboarding Security & Normalization", async (suite) => {
  const originalAxiosPut = axios.put;
  const originalAxiosGet = axios.get;

  suite.after(() => {
    axios.put = originalAxiosPut;
    axios.get = originalAxiosGet;
  });

  await suite.test("1. Rejects missing first or last name", async () => {
    let statusCode = 200;
    let body = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
      set() {
        return this;
      },
    };

    // Missing first_name
    await saveProfile({ body: { last_name: "Patil", phone: "9876543210" }, cookies: {} }, res);
    assert.equal(statusCode, 400);
    assert.equal(body.message, "First name is required.");

    // Missing last_name
    await saveProfile({ body: { first_name: "Rohan", phone: "9876543210" }, cookies: {} }, res);
    assert.equal(statusCode, 400);
    assert.equal(body.message, "Last name is required.");
  });

  await suite.test("2. Google users must remain passwordless (password stripped)", async () => {
    let capturedPayload = null;
    axios.put = async (_url, payload) => {
      capturedPayload = payload;
      return {
        data: {
          success: true,
          profile: {
            first_name: payload.first_name,
            last_name: payload.last_name,
            phone: payload.phone,
          },
        },
      };
    };

    let statusCode = 200;
    let body = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
      set() {
        return this;
      },
      cookie() {},
    };

    // Request with password submitted for a Google user
    await saveProfile(
      {
        isGoogleUser: true,
        user: { is_google_user: true },
        wpUserId: 99,
        body: {
          first_name: "Google",
          last_name: "User",
          phone: "9876543210",
          password: "MaliciousP@ssword123",
          current_password: "oldPassword",
        },
        cookies: {},
      },
      res
    );

    assert.equal(statusCode, 200);
    assert.ok(capturedPayload, "axios.put was called");
    assert.equal(capturedPayload.password, undefined, "password must be stripped for Google users");
    assert.equal(capturedPayload.current_password, undefined, "current_password must be stripped for Google users");
    assert.equal(capturedPayload.phone, "9876543210");
  });

  await suite.test("3. Normalizes phone with leading +91 / 91 before upstream dispatch", async () => {
    let capturedPayload = null;
    axios.put = async (_url, payload) => {
      capturedPayload = payload;
      return {
        data: {
          success: true,
          profile: {
            first_name: payload.first_name,
            last_name: payload.last_name,
            phone: payload.phone,
          },
        },
      };
    };

    const res = {
      status() {
        return this;
      },
      json() {
        return this;
      },
      set() {
        return this;
      },
      cookie() {},
    };

    await saveProfile(
      {
        wpUserId: 101,
        body: {
          first_name: "Anand",
          last_name: "Deshmukh",
          phone: "+91 98765 43210",
        },
        cookies: {},
      },
      res
    );

    assert.ok(capturedPayload, "axios.put was called");
    assert.equal(capturedPayload.phone, "9876543210", "Phone must be normalized to clean 10-digit number");
  });

  await suite.test("4. checkProfileComplete preserves fields, sets no-store, and sanitizes 503/401", async () => {
    let headersSet = {};
    const createRes = () => {
      let statusCode = 200;
      let body = null;
      return {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          body = payload;
          return this;
        },
        set(header, val) {
          headersSet[header] = val;
          return this;
        },
        getStatusCode: () => statusCode,
        getBody: () => body,
      };
    };

    // Subtest: Successful completion response
    axios.get = async () => ({
      data: {
        success: true,
        complete: true,
        profile_complete: true,
        address_complete: true,
        profile: { full_name: "Test User", phone: "9876543210" },
      },
    });

    const resSuccess = createRes();
    await checkProfileComplete({ wpUserId: 1 }, resSuccess);
    assert.equal(resSuccess.getStatusCode(), 200);
    assert.equal(resSuccess.getBody().complete, true);
    assert.equal(resSuccess.getBody().profile_complete, true);
    assert.equal(resSuccess.getBody().address_complete, true);
    assert.equal(headersSet["Cache-Control"], "no-store, no-cache, must-revalidate, private");

    // Subtest: Upstream timeout returns sanitized 503
    axios.get = async () => {
      const err = new Error("Connection timeout");
      err.code = "ETIMEDOUT";
      throw err;
    };

    const resTimeout = createRes();
    await checkProfileComplete({ wpUserId: 1 }, resTimeout);
    assert.equal(resTimeout.getStatusCode(), 503);
    assert.equal(resTimeout.getBody().complete, false);
    assert.match(resTimeout.getBody().message, /temporarily unavailable/);

    // Subtest: Upstream 401 returns sanitized 401
    axios.get = async () => {
      const err = new Error("Unauthorized");
      err.response = { status: 401, data: { message: "Invalid user token" } };
      throw err;
    };

    const res401 = createRes();
    await checkProfileComplete({ wpUserId: 1 }, res401);
    assert.equal(res401.getStatusCode(), 401);
    assert.equal(res401.getBody().complete, false);
    assert.equal(res401.getBody().message, "Session expired or invalid.");
  });

  await suite.test("5. saveProfile evicts user cache without setting revocation markers", async () => {
    axios.put = async (_url, payload) => ({
      data: {
        success: true,
        profile: {
          first_name: payload.first_name,
          last_name: payload.last_name,
          phone: payload.phone,
        },
      },
    });

    let statusCode = 200;
    let body = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
      set() {
        return this;
      },
      cookie() {},
    };

    const dummyCookie = "wordpress_logged_in_test=valid-token-123";
    await saveProfile(
      {
        body: { first_name: "Aarav", last_name: "Shah", phone: "9876543210" },
        wpUserId: 42,
        cookies: { mumbai_customer_auth: dummyCookie },
      },
      res
    );

    assert.equal(statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.profile.first_name, "Aarav");
    assert.equal(body.profile.phone, "9876543210");
  });

  await suite.test("6. saveProfile with password change invalidates older sessions and sets replacement session", async () => {
    let capturedPayload = null;
    axios.put = async (_url, payload) => {
      capturedPayload = payload;
      return {
        data: {
          success: true,
          session: "new-replacement-session-token",
          cookie_name: "wordpress_logged_in_hash",
          rest_nonce: "test-nonce",
          profile: {
            first_name: payload.first_name,
            last_name: payload.last_name,
            phone: payload.phone,
          },
        },
      };
    };

    let statusCode = 200;
    let body = null;
    const cookiesSet = {};
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
      set() {
        return this;
      },
      cookie(name, val) {
        cookiesSet[name] = val;
      },
    };

    await saveProfile(
      {
        body: { first_name: "Pooja", last_name: "Patil", phone: "9876543210", password: "NewStrongPassword123!" },
        wpUserId: 88,
        cookies: { mumbai_customer_auth: "old-session-cookie" },
      },
      res
    );

    assert.equal(statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(cookiesSet["mumbai_customer_auth"], "wordpress_logged_in_hash=new-replacement-session-token");
  });
});
