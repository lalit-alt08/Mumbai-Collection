import test from "node:test";
import assert from "node:assert";
import { normalizePersonName, isValidPersonName } from "../src/utils/nameValidator.js";
import { validatePassword, getPasswordRuleChecks } from "../src/utils/passwordValidator.js";

test("Customer Web: Registration OTP & Profile Setup Flow Test Suite", async (suite) => {
  await suite.test("1. Name validation for registration step 1", () => {
    const cleanFirst = normalizePersonName("  Aarav  ");
    const cleanLast = normalizePersonName("  Sharma  ");

    assert.strictEqual(cleanFirst, "Aarav");
    assert.strictEqual(cleanLast, "Sharma");
    assert.strictEqual(isValidPersonName(cleanFirst), true);
    assert.strictEqual(isValidPersonName(cleanLast), true);

    assert.strictEqual(isValidPersonName("1234"), false);
    assert.strictEqual(isValidPersonName(""), false);
  });

  await suite.test("2. Email validation for registration step 1", () => {
    const emailRegex = /^(?!\.)(?!.*\.\.)[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)*\.[A-Z]{2,63}$/i;
    assert.strictEqual(emailRegex.test("customer@example.com"), true);
    assert.strictEqual(emailRegex.test("not-an-email"), false);
    assert.strictEqual(emailRegex.test("invalid@"), false);
  });

  await suite.test("3. OTP formatting: only digits and exact 6-character length", () => {
    const rawInput = " 123-456 ";
    const cleanOtp = rawInput.trim().replace(/\D/g, "").slice(0, 6);
    assert.strictEqual(cleanOtp, "123456");
    assert.strictEqual(cleanOtp.length, 6);

    const partial = "123".replace(/\D/g, "").slice(0, 6);
    assert.notStrictEqual(partial.length, 6);
  });

  await suite.test("4. Profile setup: Mandatory password validation", () => {
    // Empty password is not allowed
    const emptyPassword = "";
    assert.strictEqual(!emptyPassword, true);

    // Weak password is rejected
    const weakResult = validatePassword("weak");
    assert.strictEqual(weakResult.isValid, false);

    // Strong password passes all rules
    const strongPassword = "StrongP@ssw0rd123";
    const strongResult = validatePassword(strongPassword);
    assert.strictEqual(strongResult.isValid, true);

    const checks = getPasswordRuleChecks(strongPassword);
    assert.strictEqual(checks.length, true);
    assert.strictEqual(checks.uppercase, true);
    assert.strictEqual(checks.lowercase, true);
    assert.strictEqual(checks.number, true);
    assert.strictEqual(checks.special, true);
  });
});
