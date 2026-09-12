import test from "node:test";
import assert from "node:assert/strict";
import {
  isStoreOpen,
  calculateNextOpening,
  evaluateStoreStatus,
  getISTTimeComponents,
  DEFAULT_STORE_HOURS_CONFIG,
  timeToMinutes,
} from "../src/services/storeHoursService.js";

test("Store Operating Hours Test Suite (Asia/Kolkata)", async (t) => {
  await t.test("1. Time String to Minutes Conversion", () => {
    assert.equal(timeToMinutes("00:00"), 0);
    assert.equal(timeToMinutes("09:00"), 540);
    assert.equal(timeToMinutes("09:30"), 570);
    assert.equal(timeToMinutes("22:00"), 1320);
    assert.equal(timeToMinutes("23:59"), 1439);
  });

  await t.test("2. Normal Daytime Schedule Evaluation (09:00 to 22:00)", () => {
    const config = {
      manual_override: "auto",
      schedule: {
        monday: { open: "09:00", close: "22:00", enabled: true },
        tuesday: { open: "09:00", close: "22:00", enabled: true },
        wednesday: { open: "09:00", close: "22:00", enabled: true },
        thursday: { open: "09:00", close: "22:00", enabled: true },
        friday: { open: "09:00", close: "22:00", enabled: true },
        saturday: { open: "09:00", close: "22:00", enabled: true },
        sunday: { open: "09:00", close: "22:00", enabled: true },
      },
    };

    // 08:59 IST on Monday (Closed - Before open)
    // 2026-09-07 is a Monday. 08:59 IST = 03:29 UTC
    const beforeOpen = new Date("2026-09-07T03:29:00Z");
    const statusBefore = evaluateStoreStatus(config, beforeOpen);
    assert.equal(statusBefore.is_open, false);

    // 09:00 IST on Monday (Open - Exact start)
    // 09:00 IST = 03:30 UTC
    const exactOpen = new Date("2026-09-07T03:30:00Z");
    const statusOpenExact = evaluateStoreStatus(config, exactOpen);
    assert.equal(statusOpenExact.is_open, true);

    // 14:30 IST on Monday (Open - Midday)
    // 14:30 IST = 09:00 UTC
    const midday = new Date("2026-09-07T09:00:00Z");
    const statusMidday = evaluateStoreStatus(config, midday);
    assert.equal(statusMidday.is_open, true);

    // 21:59 IST on Monday (Open - Just before close)
    // 21:59 IST = 16:29 UTC
    const beforeClose = new Date("2026-09-07T16:29:00Z");
    const statusBeforeClose = evaluateStoreStatus(config, beforeClose);
    assert.equal(statusBeforeClose.is_open, true);

    // 22:00 IST on Monday (Closed - Exact close)
    // 22:00 IST = 16:30 UTC
    const exactClose = new Date("2026-09-07T16:30:00Z");
    const statusCloseExact = evaluateStoreStatus(config, exactClose);
    assert.equal(statusCloseExact.is_open, false);

    // 23:00 IST on Monday (Closed - Night)
    // 23:00 IST = 17:30 UTC
    const night = new Date("2026-09-07T17:30:00Z");
    const statusNight = evaluateStoreStatus(config, night);
    assert.equal(statusNight.is_open, false);
  });

  await t.test("3. Overnight Schedule Evaluation (18:00 to 02:00 next day)", () => {
    const config = {
      manual_override: "auto",
      schedule: {
        monday: { open: "18:00", close: "02:00", enabled: true },
        tuesday: { open: "18:00", close: "02:00", enabled: true },
        wednesday: { open: "18:00", close: "02:00", enabled: true },
        thursday: { open: "18:00", close: "02:00", enabled: true },
        friday: { open: "18:00", close: "02:00", enabled: true },
        saturday: { open: "18:00", close: "02:00", enabled: true },
        sunday: { open: "18:00", close: "02:00", enabled: true },
      },
    };

    // 17:59 IST Monday (Closed - Before open)
    // 17:59 IST = 12:29 UTC
    const mon1759 = new Date("2026-09-07T12:29:00Z");
    assert.equal(evaluateStoreStatus(config, mon1759).is_open, false);

    // 18:00 IST Monday (Open - Start of evening shift)
    // 18:00 IST = 12:30 UTC
    const mon1800 = new Date("2026-09-07T12:30:00Z");
    assert.equal(evaluateStoreStatus(config, mon1800).is_open, true);

    // 23:59 IST Monday (Open - Late night)
    // 23:59 IST = 18:29 UTC
    const mon2359 = new Date("2026-09-07T18:29:00Z");
    assert.equal(evaluateStoreStatus(config, mon2359).is_open, true);

    // 00:30 IST Tuesday (Open - Midnight spillover from Monday's shift)
    // 00:30 IST = 19:00 UTC Monday
    const tue0030 = new Date("2026-09-07T19:00:00Z");
    assert.equal(evaluateStoreStatus(config, tue0030).is_open, true);

    // 01:59 IST Tuesday (Open - Just before 02:00 close)
    // 01:59 IST = 20:29 UTC Monday
    const tue0159 = new Date("2026-09-07T20:29:00Z");
    assert.equal(evaluateStoreStatus(config, tue0159).is_open, true);

    // 02:00 IST Tuesday (Closed - Overnight shift ended)
    // 02:00 IST = 20:30 UTC Monday
    const tue0200 = new Date("2026-09-07T20:30:00Z");
    assert.equal(evaluateStoreStatus(config, tue0200).is_open, false);

    // 12:00 IST Tuesday (Closed - Midday)
    // 12:00 IST = 06:30 UTC Tuesday
    const tue1200 = new Date("2026-09-08T06:30:00Z");
    assert.equal(evaluateStoreStatus(config, tue1200).is_open, false);
  });

  await t.test("4. Disabled Day (Store Closed All Day)", () => {
    const config = {
      manual_override: "auto",
      schedule: {
        monday: { open: "09:00", close: "22:00", enabled: false }, // Closed on Mondays
        tuesday: { open: "09:00", close: "22:00", enabled: true },
        wednesday: { open: "09:00", close: "22:00", enabled: true },
        thursday: { open: "09:00", close: "22:00", enabled: true },
        friday: { open: "09:00", close: "22:00", enabled: true },
        saturday: { open: "09:00", close: "22:00", enabled: true },
        sunday: { open: "09:00", close: "22:00", enabled: true },
      },
    };

    // 12:00 IST on Monday (Closed because Monday is disabled)
    const monNoon = new Date("2026-09-07T06:30:00Z");
    const statusMon = evaluateStoreStatus(config, monNoon);
    assert.equal(statusMon.is_open, false);

    // 12:00 IST on Tuesday (Open because Tuesday is enabled)
    const tueNoon = new Date("2026-09-08T06:30:00Z");
    const statusTue = evaluateStoreStatus(config, tueNoon);
    assert.equal(statusTue.is_open, true);
  });

  await t.test("5. Manual Override Modes (Open / Closed / Auto)", () => {
    // Force Open: Outside normal hours (03:00 AM)
    const forceOpenConfig = {
      manual_override: "open",
      schedule: {
        monday: { open: "09:00", close: "22:00", enabled: true },
      },
    };
    const at0300 = new Date("2026-09-07T21:30:00Z"); // 03:00 IST
    const statusForceOpen = evaluateStoreStatus(forceOpenConfig, at0300);
    assert.equal(statusForceOpen.is_open, true);
    assert.equal(statusForceOpen.manual_override, "open");

    // Force Closed: During normal peak hours (14:00 PM)
    const forceClosedConfig = {
      manual_override: "closed",
      closed_message: "Temporarily closed for inventory audit.",
      schedule: {
        monday: { open: "09:00", close: "22:00", enabled: true },
      },
    };
    const at1400 = new Date("2026-09-07T08:30:00Z"); // 14:00 IST
    const statusForceClosed = evaluateStoreStatus(forceClosedConfig, at1400);
    assert.equal(statusForceClosed.is_open, false);
    assert.equal(statusForceClosed.manual_override, "closed");
    assert.equal(statusForceClosed.closed_message, "Temporarily closed for inventory audit.");
  });

  await t.test("6. Next Opening Time Calculation", () => {
    const config = {
      manual_override: "auto",
      schedule: {
        monday: { open: "09:00", close: "22:00", enabled: true },
        tuesday: { open: "09:00", close: "22:00", enabled: true },
        wednesday: { open: "10:00", close: "22:00", enabled: true },
        thursday: { open: "09:00", close: "22:00", enabled: true },
        friday: { open: "09:00", close: "22:00", enabled: true },
        saturday: { open: "09:00", close: "22:00", enabled: true },
        sunday: { open: "09:00", close: "22:00", enabled: false }, // Sunday closed
      },
    };

    // Sunday at 15:00 IST -> Next opening is Monday 09:00 AM
    // 2026-09-13 is Sunday. 15:00 IST = 09:30 UTC
    const sun1500 = new Date("2026-09-13T09:30:00Z");
    const nextOpSun = calculateNextOpening(config, sun1500);
    assert.ok(nextOpSun);
    assert.equal(nextOpSun.day, "monday");
    assert.equal(nextOpSun.time, "09:00");
    assert.ok(nextOpSun.label.includes("Tomorrow") || nextOpSun.label.includes("Monday"));

    // Monday morning at 06:00 IST -> Next opening is today Monday at 09:00 AM
    const mon0600 = new Date("2026-09-07T00:30:00Z");
    const nextOpMon = calculateNextOpening(config, mon0600);
    assert.ok(nextOpMon);
    assert.equal(nextOpMon.day, "monday");
    assert.equal(nextOpMon.time, "09:00");
    assert.ok(nextOpMon.label.includes("Today") || nextOpMon.label.includes("09:00"));
  });

  await t.test("7. IST Components Evaluation Accuracy", () => {
    // 2026-09-08 10:30:00 IST = 2026-09-08 05:00:00 UTC
    const utcDate = new Date("2026-09-08T05:00:00Z");
    const ist = getISTTimeComponents(utcDate);

    assert.equal(ist.dayName, "tuesday");
    assert.equal(ist.hour, 10);
    assert.equal(ist.minute, 30);
    assert.equal(ist.currentMinutes, 630);
  });
});
