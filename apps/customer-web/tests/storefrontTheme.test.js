import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("store appearance persists, updates browser chrome, and follows other tabs", async () => {
  const values = new Map();
  const handlers = {};
  const meta = { value: null, setAttribute(_key, value) { this.value = value; } };
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    addEventListener: (event, fn) => { handlers[event] = fn; },
  };
  globalThis.document = {
    documentElement: { dataset: {}, style: {} },
    querySelector: () => meta,
  };
  const { setStorefrontTheme, THEME_STORAGE_KEY } = await import("../src/utils/storefrontTheme.js");
  setStorefrontTheme("dark");
  assert.equal(values.get(THEME_STORAGE_KEY), "dark");
  assert.equal(document.documentElement.dataset.storeTheme, "dark");
  assert.equal(meta.value, "#1F272E");
  values.set(THEME_STORAGE_KEY, "light");
  handlers.storage({ key: THEME_STORAGE_KEY });
  assert.equal(document.documentElement.dataset.storeTheme, "light");
  assert.equal(meta.value, "#F0F8E8");
  delete globalThis.window;
  delete globalThis.document;
});

test("dark storefront text and action colors have readable contrast", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const findColor = (rule, property) => {
    const match = css.match(new RegExp(`${rule}[^{}]*\\{[^{}]*${property}:\\s*(#[\\da-f]{6})`, "i"));
    assert.ok(match, `Missing ${property} for ${rule}`);
    return match[1];
  };
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
    return (values[1] + 0.05) / (values[0] + 0.05);
  };
  const body = css.match(/html\[data-store-theme="dark"\] body\s*\{\s*background:\s*(#[\da-f]{6});\s*color:\s*(#[\da-f]{6})/i);
  assert.ok(body, "Missing dark page colors");
  const action = findColor("\\.store-primary-action:not\\(:disabled\\)", "background");
  const actionText = findColor("\\.store-primary-action:not\\(:disabled\\)", "color");
  assert.ok(contrast(body[1], body[2]) >= 4.5, "Page text needs at least 4.5:1 contrast");
  assert.ok(contrast(action, actionText) >= 4.5, "Action text needs at least 4.5:1 contrast");
});
