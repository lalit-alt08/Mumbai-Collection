import test from "node:test";
import assert from "node:assert/strict";

// Initialize required environment variables before modules initialize
process.env.WORDPRESS_URL = process.env.WORDPRESS_URL || "http://localhost:10004";
process.env.WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY || "ck_test_key";
process.env.WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET || "cs_test_secret";
process.env.JWT_AUTH_SECRET = process.env.JWT_AUTH_SECRET || "jwt_test_secret";

const { parseFirstAndLastName, formatCustomerDisplayName } = await import("../src/utils/nameFormatter.js");
const { register } = await import("../src/controllers/authController.js");
const { saveProfile } = await import("../src/controllers/profileController.js");
const { saveAddress, updateAddress } = await import("../src/controllers/addressController.js");

test("Mandatory Last Name & Deduplication Test Suite", async (t) => {
  await t.test("1. parseFirstAndLastName extracts explicit first_name and last_name", () => {
    const result = parseFirstAndLastName({
      first_name: "Rahul",
      last_name: "Sharma",
    });
    assert.equal(result.firstName, "Rahul");
    assert.equal(result.lastName, "Sharma");
  });

  await t.test("2. parseFirstAndLastName splits multi-word full_name/name correctly", () => {
    const result1 = parseFirstAndLastName({ full_name: "Rahul Sharma" });
    assert.equal(result1.firstName, "Rahul");
    assert.equal(result1.lastName, "Sharma");

    const result2 = parseFirstAndLastName({ name: "Lalit Mohan Sirvi" });
    assert.equal(result2.firstName, "Lalit");
    assert.equal(result2.lastName, "Mohan Sirvi");
  });

  await t.test("3. parseFirstAndLastName detects missing/single-word last names", () => {
    const single = parseFirstAndLastName({ name: "Lalit" });
    assert.equal(single.firstName, "Lalit");
    assert.equal(single.lastName, "");

    const whitespace = parseFirstAndLastName({ first_name: "Lalit", last_name: "   " });
    assert.equal(whitespace.firstName, "Lalit");
    assert.equal(whitespace.lastName, "");
  });

  await t.test("4. formatCustomerDisplayName deduplicates identical first and last names", () => {
    // Historical duplicate "lalit lalit" should render as single "lalit"
    assert.equal(formatCustomerDisplayName("lalit", "lalit"), "lalit");
    assert.equal(formatCustomerDisplayName("Lalit", "lalit"), "Lalit");
    assert.equal(formatCustomerDisplayName("LALIT", "lalit"), "LALIT");
    
    // Normal distinct first and last names should render in full
    assert.equal(formatCustomerDisplayName("Rahul", "Sharma"), "Rahul Sharma");
    assert.equal(formatCustomerDisplayName("Lalit", "Sirvi"), "Lalit Sirvi");

    // Single name or missing name
    assert.equal(formatCustomerDisplayName("Lalit", ""), "Lalit");
    assert.equal(formatCustomerDisplayName("", "Sirvi"), "Sirvi");
    assert.equal(formatCustomerDisplayName("", "", "Guest Customer"), "Guest Customer");
  });

  await t.test("5. Server-side register rejects missing or whitespace-only last name with 400", async () => {
    const createMockRes = () => {
      const res = {
        statusCode: 200,
        data: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.data = payload;
          return this;
        },
      };
      return res;
    };

    // Missing last_name
    const req1 = {
      body: {
        first_name: "Lalit",
        last_name: "",
        email: "test@example.com",
        password: "password123",
      },
    };
    const res1 = createMockRes();
    await register(req1, res1);
    assert.equal(res1.statusCode, 400);
    assert.equal(res1.data.message, "Last name is required.");

    // Whitespace last_name
    const req2 = {
      body: {
        name: "Lalit   ",
        email: "test2@example.com",
        password: "password123",
      },
    };
    const res2 = createMockRes();
    await register(req2, res2);
    assert.equal(res2.statusCode, 400);
    assert.equal(res2.data.message, "Last name is required.");
  });

  await t.test("6. Server-side saveProfile rejects missing or whitespace-only last name with 400", async () => {
    const createMockRes = () => {
      const res = {
        statusCode: 200,
        data: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.data = payload;
          return this;
        },
      };
      return res;
    };

    const req = {
      wpUserId: 1,
      body: {
        first_name: "Lalit",
        last_name: "   ",
        age: 25,
        phone: "9876543210",
      },
    };
    const res = createMockRes();
    await saveProfile(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.data.message, "Last name is required.");
  });

  await t.test("7. Server-side saveAddress & updateAddress reject missing or whitespace-only last name with 400", async () => {
    const createMockRes = () => {
      const res = {
        statusCode: 200,
        data: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.data = payload;
          return this;
        },
      };
      return res;
    };

    const reqSave = {
      wpUserId: 1,
      body: {
        type: "home",
        first_name: "Lalit",
        last_name: "   ",
        phone: "9876543210",
        address_line1: "Flat 101, Test Street",
        city: "Vasai West",
      },
    };
    const resSave = createMockRes();
    await saveAddress(reqSave, resSave);
    assert.equal(resSave.statusCode, 400);
    assert.equal(resSave.data.message, "Last name is required.");

    const reqUpdate = {
      wpUserId: 1,
      params: { id: "addr-123" },
      body: {
        type: "home",
        first_name: "Lalit",
        last_name: "",
        phone: "9876543210",
        address_line1: "Flat 101, Test Street",
        city: "Vasai West",
      },
    };
    const resUpdate = createMockRes();
    await updateAddress(reqUpdate, resUpdate);
    assert.equal(resUpdate.statusCode, 400);
    assert.equal(resUpdate.data.message, "Last name is required.");
  });
});
