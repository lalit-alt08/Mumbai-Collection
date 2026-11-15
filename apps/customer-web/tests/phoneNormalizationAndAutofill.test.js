import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIndianPhone,
  isValidIndianPhone,
} from "../src/data/indianStates.js";

describe("Phone Normalization & Autofill Handling", () => {
  it("preserves standard 10-digit Indian phone numbers", () => {
    assert.equal(normalizeIndianPhone("9876543210"), "9876543210");
    assert.equal(isValidIndianPhone("9876543210"), true);
  });

  it("normalizes phone numbers autofilled with +91 country prefix", () => {
    assert.equal(normalizeIndianPhone("+91 9876543210"), "9876543210");
    assert.equal(normalizeIndianPhone("+919876543210"), "9876543210");
    assert.equal(normalizeIndianPhone("+91-98765-43210"), "9876543210");
    assert.equal(normalizeIndianPhone("+91 (987) 654-3210"), "9876543210");
  });

  it("normalizes phone numbers with 91 prefix without plus", () => {
    assert.equal(normalizeIndianPhone("919876543210"), "9876543210");
    assert.equal(normalizeIndianPhone("91 98765 43210"), "9876543210");
  });

  it("normalizes phone numbers with 0 trunk prefix or 0091", () => {
    assert.equal(normalizeIndianPhone("09876543210"), "9876543210");
    assert.equal(normalizeIndianPhone("00919876543210"), "9876543210");
  });

  it("does not strip 91 when the total length is 10 digits (e.g. mobile starting with 91)", () => {
    // 9123456789 is a valid 10-digit number starting with 91
    assert.equal(normalizeIndianPhone("9123456789"), "9123456789");
    assert.equal(isValidIndianPhone("9123456789"), true);
  });

  it("allows partial numbers during live typing without corruption", () => {
    assert.equal(normalizeIndianPhone("9876"), "9876");
    assert.equal(normalizeIndianPhone(""), "");
    assert.equal(normalizeIndianPhone(null), "");
  });

  it("caps normalized numbers strictly at 10 digits", () => {
    assert.equal(normalizeIndianPhone("+91 9876543210999").length, 10);
    assert.equal(normalizeIndianPhone("+91 9876543210999"), "9876543210");
  });

  it("validates Indian phone patterns correctly", () => {
    assert.equal(isValidIndianPhone("+91 9876543210"), true);
    assert.equal(isValidIndianPhone("09876543210"), true);
    assert.equal(isValidIndianPhone("9876543210"), true);
    assert.equal(isValidIndianPhone("5876543210"), false); // Starts with 5 (invalid Indian mobile)
    assert.equal(isValidIndianPhone("98765"), false); // Short
    assert.equal(isValidIndianPhone(""), false);
  });
});
