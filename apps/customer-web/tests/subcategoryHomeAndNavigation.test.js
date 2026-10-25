import test from "node:test";
import assert from "node:assert/strict";

/**
 * Root department resolution algorithm used by Home.jsx
 */
function getRootDepartment(cat, categoryById) {
  if (!cat || !cat.id) return null;
  let curr = categoryById.get(Number(cat.id)) || cat;
  let depth = 0;
  while (curr && curr.parent && Number(curr.parent) > 0 && depth < 10) {
    const p = categoryById.get(Number(curr.parent));
    if (!p || Number(p.id) === Number(curr.id)) break;
    curr = p;
    depth++;
  }
  return curr;
}

/**
 * Category grouping algorithm matching Home.jsx
 */
function buildHomeCategorySections(products, categories) {
  if (!Array.isArray(products) || products.length === 0) return [];

  const categoryById = new Map();
  categories.forEach((c) => {
    if (c && c.id) categoryById.set(Number(c.id), c);
  });

  const map = new Map();

  products.forEach((product) => {
    if (!Array.isArray(product.categories) || product.categories.length === 0) {
      return;
    }

    const seenRootIds = new Set();
    product.categories.forEach((cat) => {
      const root = getRootDepartment(cat, categoryById);
      if (!root || !root.id || seenRootIds.has(Number(root.id))) return;
      seenRootIds.add(Number(root.id));

      const catKey = String(root.id);
      if (!map.has(catKey)) {
        map.set(catKey, {
          id: root.id,
          name: root.name || "Category",
          slug: root.slug || String(root.id),
          products: [],
        });
      }
      map.get(catKey).products.push(product);
    });
  });

  const activeSections = Array.from(map.values()).filter((section) => section.products.length > 0);

  if (categories.length > 0) {
    const orderMap = new Map(categories.map((c, idx) => [String(c.id), idx]));
    activeSections.sort((a, b) => {
      const orderA = orderMap.has(String(a.id)) ? orderMap.get(String(a.id)) : 9999;
      const orderB = orderMap.has(String(b.id)) ? orderMap.get(String(b.id)) : 9999;
      return orderA - orderB;
    });
  }

  return activeSections;
}

/**
 * Product deduplication helper matching Category.jsx
 */
function deduplicateProducts(products) {
  const seen = new Set();
  const unique = [];
  for (const p of products) {
    if (p && p.id && !seen.has(p.id)) {
      seen.add(p.id);
      unique.push(p);
    }
  }
  return unique;
}

test("Home sections: rolls up parent and child categories into single top-level section without duplicate rows", () => {
  const categories = [
    { id: 18, name: "Stationery", slug: "stationery", parent: 0, count: 10 },
    { id: 25, name: "Pens & Markers", slug: "pens", parent: 18, count: 5 },
    { id: 26, name: "Notebooks", slug: "notebooks", parent: 18, count: 5 },
    { id: 17, name: "Toys & Games", slug: "toys", parent: 0, count: 12 },
    { id: 30, name: "Board Games", slug: "board-games", parent: 17, count: 4 },
  ];

  const products = [
    // Product 1: Assigned to both parent (18) and child (25)
    {
      id: 101,
      name: "Gel Pen 0.5mm",
      categories: [
        { id: 18, name: "Stationery" },
        { id: 25, name: "Pens & Markers" },
      ],
    },
    // Product 2: Assigned ONLY to child category (26)
    {
      id: 102,
      name: "Spiral Notebook A4",
      categories: [
        { id: 26, name: "Notebooks" },
      ],
    },
    // Product 3: Assigned to child category (30) of Toys (17)
    {
      id: 103,
      name: "Chess Set Deluxe",
      categories: [
        { id: 30, name: "Board Games" },
      ],
    },
  ];

  const sections = buildHomeCategorySections(products, categories);

  // Should generate exactly 2 sections: Stationery (18) and Toys & Games (17)
  assert.equal(sections.length, 2);
  assert.equal(sections[0].id, 18);
  assert.equal(sections[0].name, "Stationery");
  assert.equal(sections[1].id, 17);
  assert.equal(sections[1].name, "Toys & Games");

  // In Stationery section:
  // Product 101 should appear exactly once (not duplicated across Stationery and Pens)
  // Product 102 (child-only) must be included (discoverable!)
  const stationeryProds = sections[0].products;
  assert.equal(stationeryProds.length, 2);
  assert.equal(stationeryProds[0].id, 101);
  assert.equal(stationeryProds[1].id, 102);

  // In Toys section:
  // Product 103 (assigned only to Board Games) must roll up to Toys
  const toysProds = sections[1].products;
  assert.equal(toysProds.length, 1);
  assert.equal(toysProds[0].id, 103);
});

test("Category deduplication: removes identical product IDs safely", () => {
  const rawList = [
    { id: 101, name: "Ball Pen" },
    { id: 102, name: "Marker" },
    { id: 101, name: "Ball Pen Duplicate" },
    { id: 103, name: "Highlighter" },
    { id: 102, name: "Marker Duplicate" },
  ];

  const deduplicated = deduplicateProducts(rawList);
  assert.equal(deduplicated.length, 3);
  assert.deepEqual(deduplicated.map((p) => p.id), [101, 102, 103]);
});

test("Deep subcategory roll-up: multi-level hierarchy resolves to root ancestor", () => {
  const categories = [
    { id: 1, name: "Root Department", parent: 0 },
    { id: 2, name: "Level 1 Child", parent: 1 },
    { id: 3, name: "Level 2 Grandchild", parent: 2 },
  ];

  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const rootOf3 = getRootDepartment({ id: 3 }, categoryById);
  assert.equal(rootOf3.id, 1);
  assert.equal(rootOf3.name, "Root Department");

  const rootOf2 = getRootDepartment({ id: 2 }, categoryById);
  assert.equal(rootOf2.id, 1);

  const rootOf1 = getRootDepartment({ id: 1 }, categoryById);
  assert.equal(rootOf1.id, 1);
});
