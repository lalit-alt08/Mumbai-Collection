import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import wcApi from "../src/config/woocommerce.js";
import { me } from "../src/controllers/authController.js";

const runMe = async ({ context, cookie, wpProfile }) => {
  const req = {
    query: { context },
    headers: {},
    cookies: { [`mumbai_${context}_auth`]: cookie },
  };

  let statusCode = 200;
  let body;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  await me(req, res);
  return { statusCode, body, wpProfile };
};

test("/auth/me avoids WooCommerce customer lookup for staff and keeps it for customers", async (t) => {
  const originalAxiosGet = axios.get;
  const originalWcGet = wcApi.get;
  let wcCalls = 0;
  let profile;

  t.after(() => {
    axios.get = originalAxiosGet;
    wcApi.get = originalWcGet;
  });

  axios.get = async () => ({ data: profile });
  wcApi.get = async () => {
    wcCalls += 1;
    return {
      data: {
        first_name: "Woo",
        last_name: "Customer",
        email: "woo@example.com",
        username: "woocustomer",
        billing: { phone: "9876543210" },
      },
    };
  };

  for (const context of ["admin", "employee"]) {
    profile = {
      logged_in: true,
      current_user_id: 42,
      roles: [context === "admin" ? "administrator" : "employee"],
      name: "Panel User",
      email: "panel@example.com",
    };

    const { statusCode, body } = await runMe({
      context,
      cookie: `${context}-session`,
      wpProfile: profile,
    });

    assert.equal(statusCode, 200);
    assert.equal(body.logged_in, true);
    assert.equal(body.user.name, "Panel User");
    assert.equal(body.user.email, "panel@example.com");
  }

  assert.equal(wcCalls, 0, "staff/admin session checks must not call WooCommerce");

  profile = {
    logged_in: true,
    current_user_id: 7,
    roles: ["customer"],
    name: "WordPress Name",
    email: "wp@example.com",
  };
  const { statusCode, body } = await runMe({
    context: "customer",
    cookie: "customer-session",
    wpProfile: profile,
  });

  assert.equal(statusCode, 200);
  assert.equal(wcCalls, 1, "customer session checks should retain WooCommerce enrichment");
  assert.equal(body.user.name, "Woo Customer");
  assert.equal(body.user.email, "woo@example.com");
});
