import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const headerPath = path.resolve(__dirname, "../src/components/layout/Header.jsx");
const searchBarPath = path.resolve(__dirname, "../src/components/layout/SearchBar.jsx");

test("Search Autocomplete Visibility & Header Overflow Protection Suite", async (t) => {
  const headerSource = fs.readFileSync(headerPath, "utf8");
  const searchBarSource = fs.readFileSync(searchBarPath, "utf8");

  await t.test("1. Header does not hard-clip autocomplete dropdown when search row is visible", () => {
    assert.ok(
      headerSource.includes('showSearchRow ? "overflow-visible" : "overflow-hidden"'),
      "Collapsible container must use overflow-visible when showSearchRow is true"
    );
    assert.ok(
      !headerSource.includes('<div className="overflow-hidden min-h-0">'),
      "Header must not have unconditional overflow-hidden wrapping the search row"
    );
  });

  await t.test("2. Header gives search row higher stacking order than category bar", () => {
    assert.ok(
      headerSource.includes("z-20") && headerSource.includes("z-10"),
      "Search grid row must have z-20 and category bar must have z-10"
    );
  });

  await t.test("3. SearchBar listbox has proper accessibility attributes and positioning", () => {
    assert.ok(
      searchBarSource.includes('id="search-autocomplete-listbox"'),
      "SearchBar must declare #search-autocomplete-listbox"
    );
    assert.ok(
      searchBarSource.includes('role="listbox"'),
      "SearchBar dropdown must have role='listbox'"
    );
    assert.ok(
      searchBarSource.includes("absolute") &&
      searchBarSource.includes("top-full") &&
      searchBarSource.includes("z-50"),
      "SearchBar dropdown must be absolutely positioned below search bar with z-50"
    );
  });

  await t.test("4. SearchBar suggestions render readable results with hover and highlight states", () => {
    assert.ok(
      searchBarSource.includes("HighlightMatch"),
      "SearchBar suggestions must highlight query match in product title"
    );
    assert.ok(
      searchBarSource.includes("isSelected"),
      "SearchBar suggestions must reflect keyboard and mouse selection states"
    );
  });
});
