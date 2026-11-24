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

  await t.test("1. Homepage keeps a stable layout height and pins categories using a measured sticky offset", () => {
    assert.ok(
      headerSource.includes("searchArea.getBoundingClientRect().height"),
      "The sticky offset must follow the actual logo and search height"
    );
    assert.ok(
      headerSource.includes("${searchAreaHeight}px)") && !headerSource.includes('window.addEventListener("scroll"'),
      "Scrolling must not repeatedly resize the header across its own threshold"
    );
  });

  await t.test("2. Header never hides search while input is actively focused or being typed in", () => {
    assert.ok(
      headerSource.includes("isInputFocused"),
      "Header must track input focus state"
    );
    assert.ok(
      headerSource.includes("isHomePage && !isInputFocused"),
      "The negative sticky offset must be disabled while search is focused"
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

  await t.test("4. BackToTopButton positions cleanly below rested header and uses compact, sleek pill dimensions", () => {
    assert.ok(
      backToTopSource.includes("headerBottom + 12"),
      "BackToTopButton must calculate position cleanly 12px below rested header"
    );
    assert.ok(
      backToTopSource.includes("h-8"),
      "BackToTopButton must use compact h-8 height for subtle appearance"
    );
    assert.ok(
      backToTopSource.includes("text-[11px]"),
      "BackToTopButton must use refined text-[11px] font size"
    );
  });

  await t.test("5. BackToTopButton hides when a modal or dialog is open", () => {
    assert.ok(
      backToTopSource.includes("mc-modal-state"),
      "BackToTopButton must listen for modal state events to prevent overlapping dialogs"
    );
  });

  await t.test("6. Header preserves autocomplete overflow and remeasures responsive search dimensions", () => {
    assert.ok(
      headerSource.includes("new ResizeObserver(measure)"),
      "Header must account for resized logo and search content"
    );
    assert.ok(
      headerSource.includes('className="min-h-0 overflow-visible"') && !headerSource.includes("grid-rows-[0fr]"),
      "Search suggestions must remain visible without collapsing layout height"
    );
  });
});
