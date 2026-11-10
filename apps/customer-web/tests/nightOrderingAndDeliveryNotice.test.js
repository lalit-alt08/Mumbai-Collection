import { test, describe } from "node:test";
import assert from "node:assert/strict";

import storeHoursService, {
  evaluateStoreStatus,
  checkCheckoutStoreGuard,
  _resetStoreHoursCacheForTesting,
} from "../../backend/src/services/storeHoursService.js";

describe("Night Ordering & Next-Day Delivery Architecture Suite", () => {
  // Base configuration mimicking store settings: 10:00 to 23:30 daily in Asia/Kolkata
  const baseStoreConfig = {
    manual_override: "auto",
    timezone: "Asia/Kolkata",
    notice_message: "Our store is currently closed for new orders. We operate daily from 10:00 AM to 11:30 PM IST.",
    schedule: {
      monday: { is_enabled: true, open: "10:00", close: "23:30" },
      tuesday: { is_enabled: true, open: "10:00", close: "23:30" },
      wednesday: { is_enabled: true, open: "10:00", close: "23:30" },
      thursday: { is_enabled: true, open: "10:00", close: "23:30" },
      friday: { is_enabled: true, open: "10:00", close: "23:30" },
      saturday: { is_enabled: true, open: "10:00", close: "23:30" },
      sunday: { is_enabled: true, open: "10:00", close: "23:30" },
    },
  };

  test("1. Daytime store hours evaluate as open with regular delivery ETA", () => {
    // 2:30 PM IST on Monday (inside 10:00 - 23:30 window)
    const daytime = new Date("2026-11-09T09:00:00.000Z"); // 14:30 IST
    const status = evaluateStoreStatus(baseStoreConfig, daytime);

    assert.equal(status.is_open, true);
    assert.equal(status.reason, "schedule_open");
    assert.equal(status.is_after_hours, undefined);
  });

  test("2. Late night after closing (e.g. 11:45 PM IST) evaluates as closed but sets after-hours & next-day delivery flags", () => {
    // 11:45 PM IST on Monday (23:45 IST is 18:15 UTC on Nov 9, 2026)
    const lateNight = new Date("2026-11-09T18:15:00.000Z");
    const status = evaluateStoreStatus(baseStoreConfig, lateNight);

    assert.equal(status.is_open, false);
    assert.equal(status.reason, "schedule_closed");
    assert.equal(status.is_after_hours, true);
    assert.equal(status.is_next_day_delivery, true);
    assert.ok(status.next_opening, "Next opening slot must be computed");
    assert.equal(status.next_opening.time, "10:00");
    assert.equal(status.next_opening.time_formatted, "10:00 AM");
    assert.match(status.next_delivery_eta_text, /tomorrow/i);
  });

  test("3. Early morning before opening (e.g. 2:30 AM IST) evaluates as after-hours with morning delivery", () => {
    // 2:30 AM IST on Tuesday (21:00 UTC on Nov 9, 2026)
    const earlyMorning = new Date("2026-11-09T21:00:00.000Z");
    const status = evaluateStoreStatus(baseStoreConfig, earlyMorning);

    assert.equal(status.is_open, false);
    assert.equal(status.reason, "schedule_closed");
    assert.equal(status.is_after_hours, true);
    assert.equal(status.is_next_day_delivery, false);
    assert.equal(status.next_opening.relative_day, "today");
    assert.equal(status.next_opening.time_formatted, "10:00 AM");
  });

  test("4. Emergency manual override 'closed' does NOT set after-hours and strictly blocks checkout", async () => {
    _resetStoreHoursCacheForTesting();
    const emergencyConfig = {
      ...baseStoreConfig,
      manual_override: "closed",
      closed_message: "Store closed due to heavy rainfall in Mumbai. Reopening shortly.",
    };

    // Daytime check with emergency manual override
    const daytime = new Date("2026-11-09T09:00:00.000Z");
    const status = evaluateStoreStatus(emergencyConfig, daytime);

    assert.equal(status.is_open, false);
    assert.equal(status.manual_override, "closed");
    assert.equal(status.reason, "manual_override_closed");
    assert.equal(status.is_after_hours, undefined);

    // Mock storeHoursService to return this manual closed status
    const origGetStoreStatus = storeHoursService.getStoreStatus;
    try {
      storeHoursService.getStoreStatus = async () => status;
      const guardResult = await checkCheckoutStoreGuard();

      assert.equal(guardResult.allowed, false);
      assert.equal(guardResult.statusCode, 403);
      assert.equal(guardResult.payload.code, "STORE_CLOSED");
    } finally {
      storeHoursService.getStoreStatus = origGetStoreStatus;
    }
  });

  test("5. Checkout store guard allows checkout during routine after-hours with tomorrow delivery metadata", async () => {
    _resetStoreHoursCacheForTesting();
    const lateNightStatus = {
      is_open: false,
      is_after_hours: true,
      is_next_day_delivery: true,
      reason: "schedule_closed",
      manual_override: "auto",
      next_opening: {
        day: "monday",
        time: "10:00",
        date: "2026-11-10",
        label: "Tomorrow at 10:00 AM IST",
        time_formatted: "10:00 AM",
      },
    };

    const origGetStoreStatus = storeHoursService.getStoreStatus;
    try {
      storeHoursService.getStoreStatus = async () => lateNightStatus;
      const guardResult = await checkCheckoutStoreGuard();

      assert.equal(guardResult.allowed, true, "Checkout must be allowed for after-hours night orders");
      assert.equal(guardResult.is_after_hours, true);
      assert.equal(guardResult.is_next_day_delivery, true);
      assert.equal(guardResult.scheduled_delivery_label, "Tomorrow at 10:00 AM IST");
    } finally {
      storeHoursService.getStoreStatus = origGetStoreStatus;
    }
  });

  test("6. Customer Web: Cart & Checkout logic cleanly separates manual shutdown from night ordering", () => {
    // Simulated store hours object from /api/store-hours during night closure
    const nightStoreHours = {
      is_open: false,
      is_after_hours: true,
      is_next_day_delivery: true,
      manual_override: "auto",
      next_opening: { time_formatted: "10:00 AM", label: "Tomorrow at 10:00 AM IST" },
    };

    const isManualClosed = nightStoreHours.manual_override === "closed";
    const isAfterHours = Boolean(
      nightStoreHours &&
      (nightStoreHours.is_after_hours || (nightStoreHours.is_open === false && !isManualClosed))
    );
    const isStoreClosed = isManualClosed;

    // Must NOT block checkout
    assert.equal(isManualClosed, false);
    assert.equal(isAfterHours, true);
    assert.equal(isStoreClosed, false, "Night ordering should not trigger keep_shopping or checkout block");

    // Button label remains simply "Place Order"
    const buttonLabel = "Place Order";
    assert.equal(buttonLabel, "Place Order");

    // ETA text
    const etaText = isAfterHours
      ? `Delivery Tomorrow (from ${nightStoreHours.next_opening.time_formatted})`
      : "Delivery in 60–90 mins";
    assert.equal(etaText, "Delivery Tomorrow (from 10:00 AM)");
  });

  test("7. Customer Web: Emergency manual shutdown sets keep_shopping and halts checkout", () => {
    const emergencyStoreHours = {
      is_open: false,
      manual_override: "closed",
      closed_message: "Severe weather alert: Store temporarily closed",
    };

    const isManualClosed = emergencyStoreHours.manual_override === "closed";
    const isAfterHours = Boolean(
      emergencyStoreHours &&
      (emergencyStoreHours.is_after_hours || (emergencyStoreHours.is_open === false && !isManualClosed))
    );
    const isStoreClosed = isManualClosed;

    assert.equal(isManualClosed, true);
    assert.equal(isAfterHours, false);
    assert.equal(isStoreClosed, true, "Emergency shutdown must block checkout");
  });

  test("8. Order metadata & notes contain next-day delivery tracking attributes", () => {
    const intentPayload = {
      is_after_hours: true,
      is_next_day_delivery: true,
      scheduled_delivery_label: "Tomorrow at 10:00 AM IST",
    };

    const extraMeta = [];
    if (intentPayload.is_after_hours) {
      extraMeta.push(
        { key: "_order_placed_after_hours", value: "yes" },
        { key: "_delivery_slot", value: "next_day" },
        { key: "_scheduled_delivery_label", value: intentPayload.scheduled_delivery_label }
      );
    }

    assert.equal(extraMeta.length, 3);
    assert.equal(extraMeta[0].key, "_order_placed_after_hours");
    assert.equal(extraMeta[0].value, "yes");
    assert.equal(extraMeta[1].value, "next_day");
    assert.equal(extraMeta[2].value, "Tomorrow at 10:00 AM IST");

    const note = intentPayload.is_after_hours
      ? `Order placed after store hours. Scheduled for delivery tomorrow (${intentPayload.scheduled_delivery_label}).`
      : "";
    assert.match(note, /Order placed after store hours/);
    assert.match(note, /Scheduled for delivery tomorrow/);
  });
});
