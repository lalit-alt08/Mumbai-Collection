import test from "node:test";
import assert from "node:assert";
import { normalizePersonName, isValidPersonName } from "../src/utils/nameValidator.js";
import { validatePassword, getPasswordRuleChecks } from "../src/utils/passwordValidator.js";

test("Customer Web: Registration name and password validation", async (suite) => {
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

  await suite.test("Password complexity rules are available when a customer chooses to set a password", () => {
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
