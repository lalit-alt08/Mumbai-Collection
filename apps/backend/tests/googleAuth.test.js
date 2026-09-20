import test from "node:test";
import assert from "node:assert";
import { OAuth2Client } from "google-auth-library";
import { googleLogin } from "../src/controllers/authController.js";
import axios from "axios";

// Mock environment variables
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.WORDPRESS_URL = "http://mock-wordpress";
process.env.MUMBAI_INTERNAL_API_KEY = "test-internal-key";

// Helper to simulate express request
const simulateRequest = async (body, headers = {}) => {
  return new Promise((resolve) => {
    const req = {
      body,
      headers: { ...headers, "x-mumbai-panel": "customer" },
      query: {},
    };

    const res = {
      cookies: {},
      statusCode: 200,
      status: function (code) {
        this.statusCode = code;
        return this;
      },
      json: function (data) {
        resolve({ status: this.statusCode || 200, data, cookies: this.cookies });
      },
      cookie: function (name, value, options) {
        this.cookies[name] = { value, options };
      },
    };

    googleLogin(req, res).catch(err => {
      resolve({ status: 500, data: { message: err.message } });
    });
  });
};

test("Google Auth Controller Tests", async (t) => {
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  const originalAxiosPost = axios.post;

  t.afterEach(() => {
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
    axios.post = originalAxiosPost;
  });

  await t.test("Valid Google token sets session and returns user", async () => {
    OAuth2Client.prototype.verifyIdToken = async ({ idToken, audience }) => {
      assert.strictEqual(audience, "test-client-id");
      return {
        getPayload: () => ({
          sub: "google-123",
          email: "test@example.com",
          name: "Test User",
          email_verified: true,
        }),
      };
    };

    axios.post = async (url, data, config) => {
      assert.strictEqual(url, "http://mock-wordpress/wp-json/mumbai-auth/v1/sso");
      assert.strictEqual(config.headers["X-Mumbai-Internal-Key"], "test-internal-key");
      assert.strictEqual(data.google_sub, "google-123");
      assert.strictEqual(data.email, "test@example.com");

      return {
        data: {
          success: true,
          message: "SSO successful.",
          session: "mock-session-token",
          cookie_name: "logged_in",
          user: { id: 1, email: "test@example.com" },
        },
      };
    };

    const response = await simulateRequest({ credential: "valid-token" });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data.success, true);
    assert.strictEqual(response.data.user.id, 1);
    assert.ok(response.cookies["mumbai_customer_auth"]);
    assert.strictEqual(response.cookies["mumbai_customer_auth"].value, "logged_in=mock-session-token");
  });

  await t.test("Invalid token payload returns 400", async () => {
    OAuth2Client.prototype.verifyIdToken = async () => {
      return {
        getPayload: () => null,
      };
    };

    const response = await simulateRequest({ credential: "bad-token" });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.data.message, "Invalid Google token payload");
  });

  await t.test("Unverified email returns 400", async () => {
    OAuth2Client.prototype.verifyIdToken = async () => {
      return {
        getPayload: () => ({
          sub: "google-123",
          email: "test@example.com",
          email_verified: false,
        }),
      };
    };

    const response = await simulateRequest({ credential: "unverified-token" });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.data.message, "Google email is not verified");
  });

  await t.test("Missing sub returns 400", async () => {
    OAuth2Client.prototype.verifyIdToken = async () => {
      return {
        getPayload: () => ({
          email: "test@example.com",
          email_verified: true,
        }),
      };
    };

    const response = await simulateRequest({ credential: "missing-sub-token" });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.data.message, "Invalid Google token payload");
  });

  await t.test("Token validation throws error (wrong audience/expired) returns 500", async () => {
    OAuth2Client.prototype.verifyIdToken = async () => {
      throw new Error("Wrong audience");
    };

    const response = await simulateRequest({ credential: "wrong-audience-token" });
    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.data.message, "Unable to authenticate with Google.");
  });

  await t.test("WordPress /sso handles existing customer linking without duplication", async () => {
    OAuth2Client.prototype.verifyIdToken = async () => {
      return {
        getPayload: () => ({
          sub: "google-123",
          email: "existing@example.com",
          name: "Existing User",
          email_verified: true,
        }),
      };
    };

    axios.post = async () => {
      return {
        data: {
          success: true,
          message: "SSO successful.",
          session: "existing-session",
          cookie_name: "logged_in",
          user: { id: 42, email: "existing@example.com" },
        },
      };
    };

    const response = await simulateRequest({ credential: "valid-token" });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data.user.id, 42);
    assert.strictEqual(response.cookies["mumbai_customer_auth"].value, "logged_in=existing-session");
  });

  await t.test("WordPress /sso rejects unauthorized direct access", async () => {
    OAuth2Client.prototype.verifyIdToken = async () => {
      return {
        getPayload: () => ({
          sub: "google-123",
          email: "test@example.com",
          name: "Test User",
          email_verified: true,
        }),
      };
    };

    axios.post = async () => {
      const error = new Error("Unauthorized");
      error.response = { status: 401, data: { message: "Authentication required." } };
      throw error;
    };

    const response = await simulateRequest({ credential: "valid-token" });
    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.data.message, "Unable to authenticate with Google.");
  });

  await t.test("WordPress /sso rejects unauthenticated linking to staff/admin accounts with 403", async () => {
    OAuth2Client.prototype.verifyIdToken = async () => {
      return {
        getPayload: () => ({
          sub: "google-admin-123",
          email: "admin@example.com",
          name: "Admin User",
          email_verified: true,
        }),
      };
    };

    axios.post = async () => {
      const error = new Error("Forbidden");
      error.response = {
        status: 403,
        data: {
          code: "sso_linking_not_allowed",
          message: "Automatic Google login is disabled for staff and administrator accounts. Please log in with your email and password.",
        },
      };
      throw error;
    };

    const response = await simulateRequest({ credential: "valid-token" });
    assert.strictEqual(response.status, 403);
    assert.strictEqual(
      response.data.message,
      "Automatic Google login is disabled for staff and administrator accounts. Please log in with your email and password."
    );
  });
});
