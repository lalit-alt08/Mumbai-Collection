import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validatePassword,
  isValidPassword,
  getPasswordRuleChecks,
  PASSWORD_REGEX,
} from "../src/utils/passwordValidator.js";

describe("Password Validator", () => {
  it("rejects empty, null, or non-string inputs", () => {
    assert.equal(validatePassword("").isValid, false);
    assert.equal(validatePassword(null).isValid, false);
    assert.equal(validatePassword(undefined).isValid, false);
    assert.equal(validatePassword(12345).isValid, false);
  });

  it("rejects passwords shorter than 8 characters", () => {
    const res = validatePassword("Ab1!xyz");
    assert.equal(res.isValid, false);
    assert.match(res.message, /at least 8 characters/i);
    assert.equal(isValidPassword("Ab1!xyz"), false);
  });

  it("rejects passwords missing uppercase letters", () => {
    const res = validatePassword("mumbai@123");
    assert.equal(res.isValid, false);
    assert.match(res.message, /uppercase/i);
  });

  it("rejects passwords missing lowercase letters", () => {
    const res = validatePassword("MUMBAI@123");
    assert.equal(res.isValid, false);
    assert.match(res.message, /lowercase/i);
  });

  it("rejects passwords missing numbers", () => {
    const res = validatePassword("Mumbai@Secret");
    assert.equal(res.isValid, false);
    assert.match(res.message, /number/i);
  });

  it("rejects passwords missing special characters", () => {
    const res = validatePassword("MumbaiPass123");
    assert.equal(res.isValid, false);
    assert.match(res.message, /special character/i);
  });

  it("accepts valid passwords meeting all criteria", () => {
    const validPasswords = [
      "Mumbai@123",
      "P@ssw0rd2026!",
      "Super#Secure9",
      "Kolkata$456",
      "Valid_Pass1",
      "Test.1234A",
    ];

    for (const pw of validPasswords) {
      const res = validatePassword(pw);
      assert.equal(res.isValid, true, `Expected "${pw}" to be valid`);
      assert.equal(isValidPassword(pw), true);
      assert.equal(PASSWORD_REGEX.test(pw), true, `Expected regex to match "${pw}"`);
    }
  });

  it("provides granular rule check booleans for live feedback", () => {
    const checks = getPasswordRuleChecks("Ab1!");
    assert.equal(checks.length, false);
    assert.equal(checks.uppercase, true);
    assert.equal(checks.lowercase, true);
    assert.equal(checks.number, true);
    assert.equal(checks.special, true);

    const fullChecks = getPasswordRuleChecks("Mumbai@123");
    assert.equal(fullChecks.length, true);
    assert.equal(fullChecks.uppercase, true);
    assert.equal(fullChecks.lowercase, true);
    assert.equal(fullChecks.number, true);
    assert.equal(fullChecks.special, true);
  });
});
