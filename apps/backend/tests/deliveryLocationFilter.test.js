import test from "node:test";
import assert from "node:assert/strict";
import { classifyDeliveryLocation, DELIVERY_LOCATIONS } from "../src/utils/locationClassifier.js";

test("Delivery Location Classifier Test Suite", async (t) => {
  await t.test("1. Direct City Matching: All 4 areas with variations", () => {
    // Vasai East
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "Vasai East" } }), DELIVERY_LOCATIONS.VASAI_EAST);
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "vasai east" } }), DELIVERY_LOCATIONS.VASAI_EAST);
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "Vasai (East)" } }), DELIVERY_LOCATIONS.VASAI_EAST);
    assert.deepEqual(classifyDeliveryLocation({ billing: { city: "vasai-east" } }), DELIVERY_LOCATIONS.VASAI_EAST);

    // Vasai West
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "Vasai West" } }), DELIVERY_LOCATIONS.VASAI_WEST);
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "vasai west" } }), DELIVERY_LOCATIONS.VASAI_WEST);
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "Vasai (West)" } }), DELIVERY_LOCATIONS.VASAI_WEST);
    assert.deepEqual(classifyDeliveryLocation({ billing: { city: "vasai-west" } }), DELIVERY_LOCATIONS.VASAI_WEST);

    // Nalasopara East (handles Nallasopara & Nalasopara)
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "Nallasopara East" } }), DELIVERY_LOCATIONS.NALASOPARA_EAST);
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "Nalasopara East" } }), DELIVERY_LOCATIONS.NALASOPARA_EAST);
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "nalasopara (east)" } }), DELIVERY_LOCATIONS.NALASOPARA_EAST);
    assert.deepEqual(classifyDeliveryLocation({ billing: { city: "nallasopara-east" } }), DELIVERY_LOCATIONS.NALASOPARA_EAST);

    // Nalasopara West (handles Nallasopara & Nalasopara)
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "Nallasopara West" } }), DELIVERY_LOCATIONS.NALASOPARA_WEST);
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "Nalasopara West" } }), DELIVERY_LOCATIONS.NALASOPARA_WEST);
    assert.deepEqual(classifyDeliveryLocation({ shipping: { city: "nalasopara (west)" } }), DELIVERY_LOCATIONS.NALASOPARA_WEST);
    assert.deepEqual(classifyDeliveryLocation({ billing: { city: "nallasopara-west" } }), DELIVERY_LOCATIONS.NALASOPARA_WEST);
  });

  await t.test("2. Postcode Fallback when city is generic (e.g. 'Mumbai' or 'Vasai')", () => {
    // 401201 -> Vasai West
    assert.deepEqual(
      classifyDeliveryLocation({ shipping: { city: "Mumbai", postcode: "401201" } }),
      DELIVERY_LOCATIONS.VASAI_WEST
    );

    // 401208 or 401202 -> Vasai East
    assert.deepEqual(
      classifyDeliveryLocation({ shipping: { city: "Mumbai", postcode: "401208" } }),
      DELIVERY_LOCATIONS.VASAI_EAST
    );
    assert.deepEqual(
      classifyDeliveryLocation({ billing: { city: "Vasai", postcode: "401202" } }),
      DELIVERY_LOCATIONS.VASAI_EAST
    );

    // 401203 -> Nalasopara West
    assert.deepEqual(
      classifyDeliveryLocation({ shipping: { city: "Mumbai", postcode: "401203" } }),
      DELIVERY_LOCATIONS.NALASOPARA_WEST
    );

    // 401209 -> Nalasopara East
    assert.deepEqual(
      classifyDeliveryLocation({ shipping: { city: "Mumbai", postcode: "401209" } }),
      DELIVERY_LOCATIONS.NALASOPARA_EAST
    );
  });

  await t.test("3. Unambiguous Address Keywords Fallback", () => {
    // Evershine -> Vasai East
    assert.deepEqual(
      classifyDeliveryLocation({
        shipping: { city: "", postcode: "", address_1: "Flat 304, Evershine City" },
      }),
      DELIVERY_LOCATIONS.VASAI_EAST
    );

    // Chulna / Babola -> Vasai West
    assert.deepEqual(
      classifyDeliveryLocation({
        shipping: { city: "", postcode: "", address_1: "Near Babola Naka" },
      }),
      DELIVERY_LOCATIONS.VASAI_WEST
    );

    // Achole / Moregaon -> Nalasopara East
    assert.deepEqual(
      classifyDeliveryLocation({
        shipping: { city: "", postcode: "", address_1: "Achole Road, Near Station" },
      }),
      DELIVERY_LOCATIONS.NALASOPARA_EAST
    );

    // Patankar Park -> Nalasopara West
    assert.deepEqual(
      classifyDeliveryLocation({
        shipping: { city: "", postcode: "", address_1: "Flat 102, Patankar Park" },
      }),
      DELIVERY_LOCATIONS.NALASOPARA_WEST
    );
  });

  await t.test("4. Safe Unassigned Fallback for unknown / ambiguous addresses", () => {
    // Unknown city and no recognized keywords
    assert.deepEqual(
      classifyDeliveryLocation({
        shipping: { city: "mahavir nagar", postcode: "402345", address_1: "bingo tower" },
      }),
      DELIVERY_LOCATIONS.UNASSIGNED
    );

    // Empty order
    assert.deepEqual(classifyDeliveryLocation({}), DELIVERY_LOCATIONS.UNASSIGNED);
    assert.deepEqual(classifyDeliveryLocation(null), DELIVERY_LOCATIONS.UNASSIGNED);
  });
});
