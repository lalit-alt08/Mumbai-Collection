import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDeliveryAddress,
  normalizeAndValidateIndianPhone,
  validatePincode,
} from "../src/controllers/addressController.js";

test("Backend Delivery Requirements & Geo-Fencing Validation Suite", async (suite) => {
  // 1. Phone validation
  await suite.test("1. normalizeAndValidateIndianPhone: accepts 10-digit Indian mobile and rejects invalid", () => {
    // Valid mobile formats
    assert.equal(normalizeAndValidateIndianPhone("9876543210"), "9876543210");
    assert.equal(normalizeAndValidateIndianPhone("+91 98765 43210"), "9876543210");
    assert.equal(normalizeAndValidateIndianPhone("09876543210"), "9876543210");
    assert.equal(normalizeAndValidateIndianPhone("8123456789"), "8123456789");
    assert.equal(normalizeAndValidateIndianPhone("7012345678"), "7012345678");
    assert.equal(normalizeAndValidateIndianPhone("6901234567"), "6901234567");

    // Invalid mobile formats
    assert.equal(normalizeAndValidateIndianPhone("5123456789"), null, "Must start with 6-9");
    assert.equal(normalizeAndValidateIndianPhone("12345"), null, "Too short");
    assert.equal(normalizeAndValidateIndianPhone("987654321000"), null, "Too long");
    assert.equal(normalizeAndValidateIndianPhone(""), null, "Empty");
    assert.equal(normalizeAndValidateIndianPhone(null), null, "Null");
  });

  // 2. Pincode validation: Optional policy, 6-digit format if provided
  await suite.test("2. validatePincode: Optional but strictly 6 digits when provided", () => {
    // Optional when omitted or empty
    assert.deepEqual(validatePincode(undefined), { valid: true, value: "" });
    assert.deepEqual(validatePincode(null), { valid: true, value: "" });
    assert.deepEqual(validatePincode(""), { valid: true, value: "" });
    assert.deepEqual(validatePincode("   "), { valid: true, value: "" });

    // Valid 6 digits
    assert.deepEqual(validatePincode("401202"), { valid: true, value: "401202" });
    assert.deepEqual(validatePincode(401209), { valid: true, value: "401209" });

    // Invalid formats
    assert.equal(validatePincode("40120").valid, false, "5 digits is invalid");
    assert.equal(validatePincode("4012022").valid, false, "7 digits is invalid");
    assert.equal(validatePincode("012345").valid, false, "Cannot start with 0");
    assert.equal(validatePincode("40120A").valid, false, "Alphanumeric is invalid");
  });

  // 3. Supported delivery regions & aliases
  await suite.test("3. validateDeliveryAddress: Enforces supported delivery regions and handles aliases", () => {
    const validBase = {
      first_name: "Lalit",
      last_name: "Solanki",
      phone: "9876543210",
      address_1: "Flat 402, Evershine Avenue",
      city: "Vasai West",
      state: "MH",
    };

    // Exactly 4 supported regions
    assert.equal(validateDeliveryAddress({ ...validBase, city: "Vasai West" }).valid, true);
    assert.equal(validateDeliveryAddress({ ...validBase, city: "Vasai East" }).valid, true);
    assert.equal(validateDeliveryAddress({ ...validBase, city: "Nallasopara West" }).valid, true);
    assert.equal(validateDeliveryAddress({ ...validBase, city: "Nallasopara East" }).valid, true);

    // Case-insensitivity & parentheses aliases
    assert.equal(validateDeliveryAddress({ ...validBase, city: "vasai (west)" }).valid, true);
    assert.equal(validateDeliveryAddress({ ...validBase, city: "VASAI EAST" }).valid, true);
    assert.equal(validateDeliveryAddress({ ...validBase, city: "nalasopara west" }).valid, true);

    // Shorthand region aliases
    assert.equal(validateDeliveryAddress({ ...validBase, city: "Vasai" }).valid, true);
    assert.equal(validateDeliveryAddress({ ...validBase, city: "Nallasopara" }).valid, true);

    // Rejection of unsupported cities
    const mumbaiCheck = validateDeliveryAddress({ ...validBase, city: "Mumbai" });
    assert.equal(mumbaiCheck.valid, false);
    assert.match(mumbaiCheck.message, /Delivery is only available in Vasai West/);

    const thaneCheck = validateDeliveryAddress({ ...validBase, city: "Thane" });
    assert.equal(thaneCheck.valid, false);

    const puneCheck = validateDeliveryAddress({ ...validBase, city: "Pune" });
    assert.equal(puneCheck.valid, false);

    const delhiCheck = validateDeliveryAddress({ ...validBase, city: "Delhi" });
    assert.equal(delhiCheck.valid, false);
  });

  // 4. Street address and recipient name enforcement
  await suite.test("4. validateDeliveryAddress: Requires recipient name and street address", () => {
    const validBase = {
      first_name: "Lalit",
      phone: "9876543210",
      address_1: "Shop 12, Station Road",
      city: "Vasai West",
    };

    // Missing first name / full name
    const missingName = validateDeliveryAddress({ ...validBase, first_name: "" });
    assert.equal(missingName.valid, false);
    assert.match(missingName.message, /Recipient name is required/i);

    // Empty or too short street address
    const missingStreet = validateDeliveryAddress({ ...validBase, address_1: "" });
    assert.equal(missingStreet.valid, false);
    assert.match(missingStreet.message, /Street \/ flat \/ house address is required/i);

    const shortStreet = validateDeliveryAddress({ ...validBase, address_1: "AB" });
    assert.equal(shortStreet.valid, false);

    // Missing phone number
    const missingPhone = validateDeliveryAddress({ ...validBase, phone: "" });
    assert.equal(missingPhone.valid, false);
    assert.match(missingPhone.message, /10-digit Indian mobile number/i);
  });

  // 5. Output normalization
  await suite.test("5. validateDeliveryAddress: Returns clean normalized object", () => {
    const res = validateDeliveryAddress({
      first_name: "  Lalit  ",
      last_name: "  Solanki  ",
      phone: "+91 98765-43210",
      address_1: "  Building 5, Flat 101  ",
      address_2: "  Opposite Station  ",
      city: "vasai west",
      postcode: "401202",
    });

    assert.equal(res.valid, true);
    assert.deepEqual(res.normalized, {
      first_name: "Lalit",
      last_name: "Solanki",
      phone: "9876543210",
      address_1: "Building 5, Flat 101",
      address_2: "Opposite Station",
      city: "Vasai West",
      state: "MH",
      postcode: "401202",
      country: "IN",
    });
  });
});
