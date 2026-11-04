import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { searchIndexService, transformProductToSearchDoc, scoreMatch, createMiniSearchInstance } from "../src/services/searchIndexService.js";
import {
  normalizeUnicodeText,
  normalizeConnectors,
  isNumericOrAgeToken,
  isShortOrSkuToken,
  getTermFuzziness,
  getTermPrefix,
  parseSearchQuery,
} from "../src/utils/searchNormalization.js";

describe("Search Normalization & Tokenization", () => {
  test("preserves Unicode letters and marks (Devanagari, Marathi, Latin accents)", () => {
    assert.equal(normalizeUnicodeText("खिलौना कार"), "खिलौना कार");
    assert.equal(normalizeUnicodeText("खेळणी"), "खेळणी");
    assert.equal(normalizeUnicodeText("Pâté & Café!"), "pâté café");
  });

  test("normalizes various connector spellings to unified typec token", () => {
    assert.equal(normalizeConnectors("USB Type-C cable"), "typec cable");
    assert.equal(normalizeConnectors("Type C Fast Charger"), "typec Fast Charger");
    assert.equal(normalizeConnectors("USB-C to C-Type Wire"), "typec to typec Wire");
  });

  test("disables fuzziness on age numbers, SKUs, and short tokens", () => {
    assert.equal(isNumericOrAgeToken("3+"), true);
    assert.equal(isNumericOrAgeToken("4+"), true);
    assert.equal(isNumericOrAgeToken("5"), true);
    assert.equal(isNumericOrAgeToken("car"), false);

    assert.equal(getTermFuzziness("3+"), false);
    assert.equal(getTermFuzziness("4+"), false);
    assert.equal(getTermFuzziness("rc"), false);
    assert.equal(getTermFuzziness("car"), false);
    assert.equal(getTermFuzziness("JH-CAR-01"), false);

    // Permitted fuzziness for longer descriptive words
    assert.equal(typeof getTermFuzziness("rechargeable"), "number");
    assert.equal(typeof getTermFuzziness("pastels"), "number");
  });

  test("expands centralized synonyms symmetrically", () => {
    const q1 = parseSearchQuery("rc car");
    assert.ok(q1.terms.includes("rc"));
    assert.ok(q1.terms.includes("car"));
    assert.ok(q1.terms.includes("remote") || q1.terms.includes("control"));

    const q2 = parseSearchQuery("remote control car");
    assert.ok(q2.terms.includes("rc"));
  });
});

describe("Authoritative Search Index Relevance & Hydration", () => {
  const realisticFixtures = [
    {
      id: 101,
      name: "Fast Type-C Fast Charging & Data Sync Cable (1.2m, Black)",
      sku: "CBL-TC-01",
      categories: [{ id: 10, name: "Cables & Adapters" }],
      tags: [{ id: 20, name: "fast-charging" }],
      attributes: [{ name: "Connector", options: ["Type-C", "USB-A"] }],
      short_description: "Durable braided nylon Type-C fast charging cable with 480Mbps data transfer.",
    },
    {
      id: 102,
      name: "Jam & Honey High Speed Formula RC Car for Kids",
      sku: "JH-RC-02",
      categories: [{ id: 11, name: "Remote Control Toys" }],
      tags: [{ id: 21, name: "rc-cars" }],
      attributes: [{ name: "Age Group", options: ["4+ Years"] }],
      short_description: "High speed electric racing car with 2.4GHz remote control. Includes Type-C charging cable and battery.",
    },
    {
      id: 103,
      name: "Popsugar Off-Roader Monster Truck Remote Control Car",
      sku: "PS-TRK-03",
      categories: [{ id: 11, name: "Remote Control Toys" }],
      tags: [{ id: 21, name: "rc-cars" }],
      attributes: [{ name: "Age Group", options: ["3+ Years"] }],
      short_description: "Monster truck with 4WD, all-terrain tires, and rechargeable lithium battery.",
    },
    {
      id: 104,
      name: "Camel Artist Acrylic Pastels Set 24 Shades",
      sku: "CAM-PAS-24",
      categories: [{ id: 12, name: "Art & Craft" }],
      tags: [{ id: 22, name: "painting" }],
      attributes: [{ name: "Color", options: ["Multicolor"] }],
      short_description: "Rich pigment oil pastels for drawing and fine art sketching.",
    },
    {
      id: 105,
      name: "Sandisk Cruzer Blade 32GB USB 2.0 Flash Drive",
      sku: "SD-32GB-01",
      categories: [{ id: 13, name: "Storage" }],
      tags: [],
      attributes: [{ name: "Capacity", options: ["32GB"] }],
      short_description: "Portable pendrive for storing music, documents, and pictures.",
    },
    {
      id: 106,
      name: "खेळणी आणि क्राफ्ट रिमोट कंट्रोल कार (Marathi Edition)",
      sku: "MR-RC-01",
      categories: [{ id: 11, name: "Remote Control Toys" }],
      tags: [],
      attributes: [],
      short_description: "विशेष मुलांसाठी खेळणी रिमोट कंट्रोल कार.",
    },
  ];

  beforeEach(() => {
    searchIndexService.buildFromFixtures(realisticFixtures);
  });

  test("rc car and remote control car retrieve RC products", () => {
    const rcIds = searchIndexService.rankMatchingIds("rc car");
    assert.ok(rcIds.includes(102), "Should match Jam & Honey RC Car");
    assert.ok(rcIds.includes(103), "Should match Popsugar Remote Control Car");

    const remoteIds = searchIndexService.rankMatchingIds("remote control car");
    assert.ok(remoteIds.includes(102), "Remote control query should match Jam & Honey RC Car via synonym");
    assert.ok(remoteIds.includes(103), "Remote control query should match Popsugar Remote Control Car");
  });

  test("type c cable ranks actual cable fixtures above cars that mention charging cables", () => {
    const rankedIds = searchIndexService.rankMatchingIds("type c cable");
    assert.ok(rankedIds.length >= 1, "Should find matching products");
    assert.equal(rankedIds[0], 101, "The dedicated Type-C Cable MUST rank first over RC car");
  });

  test("deliberate typo retrieves matching fixture", () => {
    const typoIds = searchIndexService.rankMatchingIds("cammel pastels");
    assert.ok(typoIds.includes(104), "Should retrieve Camel Pastels despite typo");
  });

  test("different age numbers are not treated as interchangeable typos", () => {
    const age3Matches = searchIndexService.rankMatchingIds("monster truck 3+");
    assert.ok(age3Matches.includes(103), "Should match product with 3+");

    // Product 102 has 4+ years, not 3+
    const age4Matches = searchIndexService.rankMatchingIds("formula car 4+");
    assert.ok(age4Matches.includes(102), "Should match product with 4+");
  });

  test("exact SKU matching gets highest relevance", () => {
    const skuMatches = searchIndexService.rankMatchingIds("CBL-TC-01");
    assert.equal(skuMatches[0], 101, "SKU exact match must rank first");
  });

  test("preserves Unicode queries accurately", () => {
    const devanagariMatches = searchIndexService.rankMatchingIds("खेळणी कार");
    assert.ok(devanagariMatches.includes(106), "Must match Marathi Devanagari text");
  });

  test("synonym matching for pendrive and flash drive", () => {
    const pendriveMatches = searchIndexService.rankMatchingIds("pendrive 32gb");
    assert.ok(pendriveMatches.includes(105), "Should find flash drive when searching pendrive");

    const flashMatches = searchIndexService.rankMatchingIds("flash drive 32gb");
    assert.ok(flashMatches.includes(105), "Should find pendrive when searching flash drive");
  });

  test("rebuild failure preserves last valid index atomically", async () => {
    const validCount = searchIndexService.index.documentCount;
    assert.ok(validCount > 0);

    // Simulate failed rebuild
    const originalFetch = searchIndexService.fetchCatalogDocuments;
    searchIndexService.fetchCatalogDocuments = async () => {
      throw new Error("Upstream database connection failure");
    };

    await assert.rejects(
      async () => {
        await searchIndexService.buildIndex();
      },
      /Upstream database connection failure/
    );

    // The index must NOT be corrupted or wiped
    assert.equal(searchIndexService.index.documentCount, validCount);
    const postFailMatches = searchIndexService.rankMatchingIds("rc car");
    assert.ok(postFailMatches.includes(102));

    // Restore
    searchIndexService.fetchCatalogDocuments = originalFetch;
  });

  test("concurrent rebuild calls are deduplicated into single flight", async () => {
    let callCount = 0;
    const originalFetch = searchIndexService.fetchCatalogDocuments;
    searchIndexService.fetchCatalogDocuments = async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return realisticFixtures;
    };

    const [res1, res2, res3] = await Promise.all([
      searchIndexService.buildIndex(),
      searchIndexService.buildIndex(),
      searchIndexService.buildIndex(),
    ]);

    assert.equal(callCount, 1, "fetchCatalogDocuments should only be called once for concurrent requests");
    assert.equal(res1.count, realisticFixtures.length);
    assert.equal(res2.count, realisticFixtures.length);
    assert.equal(res3.count, realisticFixtures.length);

    searchIndexService.fetchCatalogDocuments = originalFetch;
  });

  test("stale/deleted products in hydration are pruned from index", async () => {
    // Add temporary item 999
    searchIndexService.upsertProduct({
      id: 999,
      name: "Temporary Deleted Item",
      sku: "TEMP-999",
      categories: ["Misc"],
    });

    assert.ok(searchIndexService.rankMatchingIds("Temporary").includes(999));

    // Remove it simulating pruning
    searchIndexService.removeProduct(999);
    assert.ok(!searchIndexService.rankMatchingIds("Temporary").includes(999));
  });

  test("init starts reconciliation timer and stop cleans up all timers", async () => {
    const origFetch = searchIndexService.fetchCatalogDocuments;
    searchIndexService.fetchCatalogDocuments = async () => ({ products: realisticFixtures, isFromFeed: true });

    searchIndexService.stop();
    searchIndexService.init();
    assert.ok(searchIndexService.reconcileTimer, "reconcileTimer must be set after init()");

    if (searchIndexService.buildPromise) {
      await searchIndexService.buildPromise.catch(() => {});
    }

    searchIndexService.markDirty();
    assert.ok(searchIndexService.dirtyTimer, "dirtyTimer must be set after markDirty()");

    searchIndexService.stop();
    assert.equal(searchIndexService.reconcileTimer, null, "reconcileTimer must be null after stop()");
    assert.equal(searchIndexService.dirtyTimer, null, "dirtyTimer must be null after stop()");

    searchIndexService.fetchCatalogDocuments = origFetch;
  });

  test("monster truck 4+ strictly rejects products that only match 3+", () => {
    // Product 103 has "3+ Years" and Product 102 has "4+ Years"
    const matches4Plus = searchIndexService.rankMatchingIds("monster truck 4+");
    assert.ok(!matches4Plus.includes(103), "Must NOT match 3+ fixture when 4+ is requested");

    const matches3Plus = searchIndexService.rankMatchingIds("monster truck 3+");
    assert.ok(matches3Plus.includes(103), "Must match 3+ fixture when 3+ is requested");
  });

  test("indexes category ancestors so products match ancestor queries", () => {
    const ancestorLookup = new Map([
      [10, ["Electronics", "Mobile Accessories"]],
    ]);
    const doc = transformProductToSearchDoc(
      {
        id: 701,
        name: "Quick Sync Cord",
        sku: "QSC-01",
        categories: [{ id: 10, name: "Cables & Adapters" }],
      },
      ancestorLookup
    );

    assert.ok(doc.categories.includes("Electronics"), "Doc must include ancestor category");
    assert.ok(doc.categories.includes("Mobile Accessories"), "Doc must include intermediate ancestor");
  });

  test("excludes products with catalog_visibility catalog or hidden", () => {
    const hiddenProduct = {
      id: 801,
      name: "Secret Unlisted Product",
      sku: "HIDDEN-01",
      catalog_visibility: "hidden",
    };
    const catalogOnlyProduct = {
      id: 802,
      name: "Catalog Only Product",
      sku: "CAT-01",
      catalog_visibility: "catalog",
    };
    assert.equal(transformProductToSearchDoc(hiddenProduct), null);
    assert.equal(transformProductToSearchDoc(catalogOnlyProduct), null);
  });

  test("retains pending-dirty flag during active build to trigger follow-up build", async () => {
    let buildRuns = 0;
    const origFetch = searchIndexService.fetchCatalogDocuments;
    searchIndexService.fetchCatalogDocuments = async () => {
      buildRuns++;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { products: realisticFixtures, isFromFeed: true };
    };

    const firstBuild = searchIndexService.buildIndex();
    assert.equal(searchIndexService.isBuilding, true);

    // Call markDirty while building
    searchIndexService.markDirty();
    assert.equal(searchIndexService.hasPendingDirty, true);

    await firstBuild;
    // Wait for the scheduled follow-up
    await new Promise((resolve) => setTimeout(resolve, 1100));

    assert.ok(buildRuns >= 2, "Follow-up rebuild must execute after mutation during build");
    searchIndexService.fetchCatalogDocuments = origFetch;
  });
});
