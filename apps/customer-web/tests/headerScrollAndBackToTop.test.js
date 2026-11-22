import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const headerPath = path.resolve(__dirname, "../src/components/layout/Header.jsx");
const backToTopPath = path.resolve(__dirname, "../src/components/home/BackToTopButton.jsx");

test("Header Scroll Flow & Back-to-Top Reliability Suite", async (t) => {
  const headerSource = fs.readFileSync(headerPath, "utf8");
  const backToTopSource = fs.readFileSync(backToTopPath, "utf8");

  await t.test("1. Header implements smooth scroll collapse and intentional reveal thresholds", () => {
    // Deliberate upward scroll threshold (< -12) to avoid jitter
    assert.ok(
      headerSource.includes("delta < -12"),
      "Header must require a deliberate upward scroll (delta < -12) before showing search"
    );
    // Downward scroll threshold (> 8 and past top threshold > 70)
    assert.ok(
      headerSource.includes("delta > 8 && currentScrollY > 70"),
      "Header must only collapse on clear downward scroll past top area"
    );
    // Keep search visible near top (<= 50)
    assert.ok(
      headerSource.includes("currentScrollY <= 50"),
      "Header search must remain visible when near top of homepage"
    );
  });

  await t.test("2. Header never hides search while input is actively focused or being typed in", () => {
    assert.ok(
      headerSource.includes("isInputFocused"),
      "Header must track input focus state"
    );
    assert.ok(
      headerSource.includes("setIsSearchVisible(true)"),
      "Header must force search visibility when input receives focus"
    );
  });

  await t.test("3. BackToTopButton hides while scrolling and shows only after 400ms idle pause", () => {
    assert.ok(
      backToTopSource.includes("setVisible(false)"),
      "BackToTopButton must immediately hide during active scroll events"
    );
    assert.ok(
      backToTopSource.includes("400"),
      "BackToTopButton must use 400ms idle debounce before revealing"
    );
  });

  await t.test("4. BackToTopButton avoids dynamic getBoundingClientRect jumps that stretch during overscroll", () => {
    assert.strictEqual(
      backToTopSource.includes("getBoundingClientRect"),
      false,
      "BackToTopButton must not calculate position dynamically from getBoundingClientRect to avoid overscroll bounce stretching"
    );
    assert.ok(
      backToTopSource.includes("env(safe-area-inset-top"),
      "BackToTopButton must use safe-area-inset-top CSS calculation"
    );
  });

  await t.test("5. BackToTopButton hides when a modal or dialog is open", () => {
    assert.ok(
      backToTopSource.includes("mc-modal-state"),
      "BackToTopButton must listen for modal state events to prevent overlapping dialogs"
    );
  });
});
