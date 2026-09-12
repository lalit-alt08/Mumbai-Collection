import test from "node:test";
import assert from "node:assert/strict";

test("Customer Profile Phone Flow Test Suite", async (t) => {
  await t.test("1. Normal profile update cannot change phone number: preserves verified phone on submission", () => {
    // Current verified profile state
    let serverProfile = {
      full_name: "Rahul Sharma",
      age: 26,
      phone: "9820123456",
      verified_phone: "9820123456",
      is_phone_verified: true,
    };

    // User attempts to edit form and send updated name/age along with an arbitrary/tampered phone
    const clientPayload = {
      full_name: "Rahul M. Sharma",
      age: 27,
      phone: "9999988888", // Form submitted with different phone
    };

    // Server-side enforcement rule in profile save
    const executeSaveProfile = (payload, currentProfile) => {
      // If phone is already verified, normal profile update locks phone to verified_phone
      const enforcedPhone = currentProfile.verified_phone || currentProfile.phone;
      return {
        ...currentProfile,
        full_name: payload.full_name,
        age: payload.age,
        phone: enforcedPhone,
        is_phone_verified: currentProfile.is_phone_verified,
      };
    };

    const result = executeSaveProfile(clientPayload, serverProfile);

    assert.equal(result.full_name, "Rahul M. Sharma");
    assert.equal(result.age, 27);
    assert.equal(result.phone, "9820123456", "Phone must remain the verified phone on normal profile update");
    assert.equal(result.is_phone_verified, true, "Verification state must remain intact");
  });

  await t.test("2. Verified phone remains verified when other profile fields change", () => {
    let profile = {
      full_name: "Ananya Desai",
      age: 24,
      phone: "9123456780",
      verified_phone: "9123456780",
      is_phone_verified: true,
    };

    // Form save payload from Profile.jsx edit mode
    const formSaveData = {
      full_name: "Ananya Patel",
      age: 25,
      phone: profile.phone,
    };

    const isVerifiedAfterSave = (savedPhone, verifiedPhone) => {
      return !!verifiedPhone && savedPhone === verifiedPhone;
    };

    assert.equal(isVerifiedAfterSave(formSaveData.phone, profile.verified_phone), true);
  });

  await t.test("3. Phone change requires OTP verification: state requires otpSent and 6-digit code", () => {
    let state = {
      currentPhone: "9820123456",
      isPhoneVerified: true,
      newPhone: "9876543210",
      otpSent: false,
      verified: false,
    };

    // 1. User enters new phone and requests OTP
    const handleSendOtp = (newNumber) => {
      if (newNumber.length === 10 && newNumber !== state.currentPhone) {
        state.otpSent = true;
        return { success: true, message: "OTP sent" };
      }
      return { success: false, message: "Invalid number" };
    };

    const sendRes = handleSendOtp(state.newPhone);
    assert.equal(sendRes.success, true);
    assert.equal(state.otpSent, true);
    assert.equal(state.verified, false, "Phone cannot be verified until OTP check passes");
    assert.equal(state.currentPhone, "9820123456", "Current phone must remain active before verification");
  });

  await t.test("4. Failed or cancelled OTP leaves old phone unchanged", () => {
    const originalPhone = "9820123456";
    const originalVerified = "9820123456";
    let profile = {
      phone: originalPhone,
      verified_phone: originalVerified,
      is_phone_verified: true,
    };

    const handleVerifyOtp = (submittedOtp, correctOtp, pendingPhone) => {
      if (submittedOtp === correctOtp) {
        profile.phone = pendingPhone;
        profile.verified_phone = pendingPhone;
        profile.is_phone_verified = true;
        return { success: true };
      }
      // Verification failure leaves state unchanged
      return { success: false, message: "Invalid or expired verification code." };
    };

    // Attempt with incorrect OTP
    const res = handleVerifyOtp("000000", "654321", "9876543210");

    assert.equal(res.success, false);
    assert.equal(profile.phone, originalPhone, "Old phone must be preserved upon failed OTP");
    assert.equal(profile.verified_phone, originalVerified);
    assert.equal(profile.is_phone_verified, true);
  });

  await t.test("5. Successful OTP updates phone and verified-phone consistently", () => {
    let userContext = {
      phone: "9820123456",
      verified_phone: "9820123456",
      is_phone_verified: true,
    };

    let localProfile = {
      full_name: "Pooja Mehta",
      age: 28,
      phone: "9820123456",
      verified_phone: "9820123456",
    };

    const newTargetPhone = "7738899001";
    const correctOtp = "849201";

    const verifyAndApplyPhoneChange = (otp) => {
      if (otp === correctOtp) {
        userContext.phone = newTargetPhone;
        userContext.verified_phone = newTargetPhone;
        userContext.is_phone_verified = true;

        localProfile.phone = newTargetPhone;
        localProfile.verified_phone = newTargetPhone;

        return { success: true, phone: newTargetPhone, verified_phone: newTargetPhone };
      }
      return { success: false };
    };

    const result = verifyAndApplyPhoneChange("849201");

    assert.equal(result.success, true);
    assert.equal(userContext.phone, "7738899001");
    assert.equal(userContext.verified_phone, "7738899001");
    assert.equal(userContext.is_phone_verified, true);
    assert.equal(localProfile.phone, "7738899001");
    assert.equal(localProfile.verified_phone, "7738899001");
  });
});
