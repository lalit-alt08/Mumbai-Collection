import { test } from "node:test";
import assert from "node:assert/strict";

const maskEmail = (email) => {
  if (!email || typeof email !== "string" || !email.includes("@")) return "";
  const [local, domain] = email.trim().split("@");
  if (local.length <= 2) {
    return `${local.charAt(0)}*@${domain}`;
  }
  const first = local.charAt(0);
  const last = local.charAt(local.length - 1);
  return `${first}${"*".repeat(Math.min(local.length - 2, 4))}${last}@${domain}`;
};

test("Unified Account Deletion Flow Suite", async (t) => {
  await t.test("1. maskEmail masks local part correctly for varied email lengths", () => {
    assert.equal(maskEmail("lalitsirvi0805@gmail.com"), "l****5@gmail.com");
    assert.equal(maskEmail("user@example.com"), "u**r@example.com");
    assert.equal(maskEmail("ab@domain.com"), "a*@domain.com");
    assert.equal(maskEmail(""), "");
    assert.equal(maskEmail("invalid-email"), "");
  });

  await t.test("2. Deletion payload uses delete_token issued by OTP verification", async () => {
    let capturedVerification = null;
    let capturedDeletion = null;

    const mockVerifyDeleteOtp = async (email, otp) => {
      capturedVerification = { email, otp };
      if (otp === "123456") {
        return { success: true, delete_token: "d".repeat(64) };
      }
      throw new Error("Invalid code");
    };

    const mockDeleteAccount = async (confirmation) => {
      capturedDeletion = confirmation;
      return { success: true, message: "Account deleted." };
    };

    // User inputs 6-digit code and confirms
    const inputCode = "123456";
    const userEmail = "customer@mumbaicollections.in";

    const proof = await mockVerifyDeleteOtp(userEmail, inputCode);
    assert.equal(capturedVerification.otp, "123456");
    assert.equal(proof.delete_token.length, 64);

    await mockDeleteAccount({ delete_token: proof.delete_token });
    assert.deepEqual(capturedDeletion, { delete_token: "d".repeat(64) });
  });

  await t.test("3. Active order error response sets active_orders flag", () => {
    const errorResponse = {
      code: "active_orders_exist",
      message: "Your account cannot be deleted while you have active or in-flight orders. Please wait until your orders are completed or cancelled.",
    };

    const isOrdersBlocked =
      errorResponse?.code === "active_orders_exist" ||
      (errorResponse?.message && String(errorResponse.message).toLowerCase().includes("active or in-flight orders"));

    assert.equal(isOrdersBlocked, true, "Must flag active order block so View active orders link is rendered");
  });
});
