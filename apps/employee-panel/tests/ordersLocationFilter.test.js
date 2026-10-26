import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  LOCATION_OPTIONS,
  getOrderLocationInfo,
  getLocationBadgeClass,
} from "../src/utils/orderLocation.js";

describe("Employee Panel Orders: Delivery Location Filter Suite", () => {
  describe("1. Location Options & Badge Helpers", () => {
    test("All 5 delivery filter options (4 zones + Unassigned + All) are defined", () => {
      const ids = LOCATION_OPTIONS.map((l) => l.id);
      assert.deepEqual(ids, [
        "all",
        "vasai-east",
        "vasai-west",
        "nalasopara-east",
        "nalasopara-west",
        "unassigned",
      ]);
    });

    test("Badge classes return distinct, styling classes for each location", () => {
      assert.match(getLocationBadgeClass("vasai-east"), /blue/);
      assert.match(getLocationBadgeClass("vasai-west"), /indigo/);
      assert.match(getLocationBadgeClass("nalasopara-east"), /purple/);
      assert.match(getLocationBadgeClass("nalasopara-west"), /teal/);
      assert.match(getLocationBadgeClass("unassigned"), /amber/);
    });
  });

  describe("2. Deterministic Location Classification", () => {
    test("Pre-computed server delivery_location and key are prioritized", () => {
      const order = {
        delivery_location: "Vasai East",
        delivery_location_key: "vasai-east",
      };
      const info = getOrderLocationInfo(order);
      assert.equal(info.location, "Vasai East");
      assert.equal(info.location_key, "vasai-east");
    });

    test("Direct city matching for all 4 delivery regions", () => {
      // Vasai East
      assert.equal(getOrderLocationInfo({ shipping: { city: "Vasai East" } }).location_key, "vasai-east");
      assert.equal(getOrderLocationInfo({ billing: { city: "vasai (east)" } }).location_key, "vasai-east");

      // Vasai West
      assert.equal(getOrderLocationInfo({ shipping: { city: "Vasai West" } }).location_key, "vasai-west");
      assert.equal(getOrderLocationInfo({ billing: { city: "vasai-west" } }).location_key, "vasai-west");

      // Nalasopara East (handles Nallasopara & Nalasopara)
      assert.equal(getOrderLocationInfo({ shipping: { city: "Nallasopara East" } }).location_key, "nalasopara-east");
      assert.equal(getOrderLocationInfo({ billing: { city: "Nalasopara East" } }).location_key, "nalasopara-east");

      // Nalasopara West (handles Nallasopara & Nalasopara)
      assert.equal(getOrderLocationInfo({ shipping: { city: "Nallasopara West" } }).location_key, "nalasopara-west");
      assert.equal(getOrderLocationInfo({ billing: { city: "Nalasopara West" } }).location_key, "nalasopara-west");
    });

    test("Postcode fallback when city is missing or generic (e.g. 'Mumbai')", () => {
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401201" } }).location_key, "vasai-west");
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401208" } }).location_key, "vasai-east");
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401202" } }).location_key, "vasai-east");
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401203" } }).location_key, "nalasopara-west");
      assert.equal(getOrderLocationInfo({ shipping: { city: "Mumbai", postcode: "401209" } }).location_key, "nalasopara-east");
    });

    test("Address keyword fallback", () => {
      assert.equal(
        getOrderLocationInfo({ shipping: { address_1: "Flat 204, Evershine City" } }).location_key,
        "vasai-east"
      );
      assert.equal(
        getOrderLocationInfo({ shipping: { address_1: "Near Babola Naka, Vasai" } }).location_key,
        "vasai-west"
      );
      assert.equal(
        getOrderLocationInfo({ shipping: { address_1: "Achole Road" } }).location_key,
        "nalasopara-east"
      );
      assert.equal(
        getOrderLocationInfo({ shipping: { address_1: "Near Patankar Park" } }).location_key,
        "nalasopara-west"
      );
    });

    test("Safe fallback to Unassigned for ambiguous addresses", () => {
      assert.equal(
        getOrderLocationInfo({ shipping: { city: "mahavir nagar", postcode: "402345" } }).location_key,
        "unassigned"
      );
      assert.equal(getOrderLocationInfo({}).location_key, "unassigned");
      assert.equal(getOrderLocationInfo(null).location_key, "unassigned");
    });
  });

});
