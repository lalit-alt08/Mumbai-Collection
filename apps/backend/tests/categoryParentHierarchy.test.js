import test from "node:test";
import assert from "node:assert/strict";
import { schemas } from "../src/middlewares/requestValidation.js";
import { isDescendantCategory } from "../src/controllers/adminCategoryController.js";
import { getRedisClient } from "../src/config/redis.js";

test.after(async () => {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.quit();
    } catch (_) {
      try { redis.disconnect(); } catch (_) {}
    }
  }
  setTimeout(() => process.exit(0), 100).unref();
});

test("category validation: categoryCreate and categoryUpdate support optional non-negative parent", () => {
  // Valid parent: 0 (top-level)
  const validRoot = schemas.categoryCreate.parse({
    name: "Art & Craft",
    image_id: 101,
    parent: 0,
  });
  assert.equal(validRoot.parent, 0);

  // Valid parent: positive integer
  const validChild = schemas.categoryCreate.parse({
    name: "Watercolors",
    image_id: 102,
    parent: 18,
  });
  assert.equal(validChild.parent, 18);

  // Valid without parent (defaults to undefined, optional)
  const withoutParent = schemas.categoryCreate.parse({
    name: "Toys",
    image_id: 103,
  });
  assert.equal(withoutParent.parent, undefined);

  // Coerces string number to integer
  const coercedParent = schemas.categoryCreate.parse({
    name: "Brushes",
    image_id: 104,
    parent: "25",
  });
  assert.equal(coercedParent.parent, 25);

  // Strips unknown keys (mass-assignment protection)
  const stripped = schemas.categoryCreate.parse({
    name: "Sketchbooks",
    image_id: 105,
    parent: 18,
    is_admin: true,
    hackedField: "injected",
  });
  assert.equal(stripped.is_admin, undefined);
  assert.equal(stripped.hackedField, undefined);

  // Rejects negative parent
  assert.throws(() => {
    schemas.categoryCreate.parse({
      name: "Invalid Category",
      image_id: 106,
      parent: -1,
    });
  });

  // Rejects floating point parent
  assert.throws(() => {
    schemas.categoryCreate.parse({
      name: "Invalid Category",
      image_id: 106,
      parent: 18.5,
    });
  });

  // Rejects non-numeric string parent
  assert.throws(() => {
    schemas.categoryCreate.parse({
      name: "Invalid Category",
      image_id: 106,
      parent: "invalid-id",
    });
  });

  // CategoryUpdate accepts parent as well
  const updateWithParent = schemas.categoryUpdate.parse({
    parent: 42,
  });
  assert.equal(updateWithParent.parent, 42);

  const updatePromoteToRoot = schemas.categoryUpdate.parse({
    parent: 0,
  });
  assert.equal(updatePromoteToRoot.parent, 0);

  assert.throws(() => {
    schemas.categoryUpdate.parse({
      parent: -5,
    });
  });
});

test("hierarchy: isDescendantCategory detects direct and indirect descendants to prevent circular loops", () => {
  // Tree structure:
  // Root A (10)
  //   ↳ Child B (20, parent: 10)
  //       ↳ Grandchild C (30, parent: 20)
  //           ↳ Great-Grandchild D (40, parent: 30)
  // Root E (50, parent: 0)
  //   ↳ Child F (60, parent: 50)
  const categories = [
    { id: 10, parent: 0, name: "Root A" },
    { id: 20, parent: 10, name: "Child B" },
    { id: 30, parent: 20, name: "Grandchild C" },
    { id: 40, parent: 30, name: "Great-Grandchild D" },
    { id: 50, parent: 0, name: "Root E" },
    { id: 60, parent: 50, name: "Child F" },
  ];

  // Setting B (20) as parent of A (10) -> Circular!
  assert.equal(isDescendantCategory(10, 20, categories), true);

  // Setting C (30) as parent of A (10) -> Circular!
  assert.equal(isDescendantCategory(10, 30, categories), true);

  // Setting D (40) as parent of A (10) -> Circular!
  assert.equal(isDescendantCategory(10, 40, categories), true);

  // Setting D (40) as parent of B (20) -> Circular!
  assert.equal(isDescendantCategory(20, 40, categories), true);

  // Setting Root E (50) as parent of A (10) -> Valid! Not a descendant
  assert.equal(isDescendantCategory(10, 50, categories), false);

  // Setting Child F (60) as parent of A (10) -> Valid! Not a descendant
  assert.equal(isDescendantCategory(10, 60, categories), false);

  // Setting parent: 0 (promote to root) -> Valid! Not a descendant
  assert.equal(isDescendantCategory(20, 0, categories), false);

  // Sibling relationships
  assert.equal(isDescendantCategory(50, 10, categories), false);
});

test("Group 1 validation: relatedProducts, categoryIdParam, and image_id null safety", () => {
  // relatedProducts preserves categoryId and currentProductId
  const relatedParsed = schemas.relatedProducts.parse({
    categoryId: "18",
    currentProductId: "105",
  });
  assert.equal(relatedParsed.categoryId, 18);
  assert.equal(relatedParsed.currentProductId, 105);

  const relatedWithSlug = schemas.relatedProducts.parse({
    categoryId: "stationery-supplies",
    currentProductId: 200,
  });
  assert.equal(relatedWithSlug.categoryId, "stationery-supplies");
  assert.equal(relatedWithSlug.currentProductId, 200);

  // categoryIdParam accepts both numeric ID and slug
  assert.equal(schemas.categoryIdParam.parse({ categoryId: "18" }).categoryId, "18");
  assert.equal(schemas.categoryIdParam.parse({ categoryId: "art-and-craft" }).categoryId, "art-and-craft");

  // categoryCreate safely accepts image_id null or empty string
  const createWithNull = schemas.categoryCreate.parse({
    name: "Stickers",
    image_id: null,
  });
  assert.equal(createWithNull.name, "Stickers");
  assert.equal(createWithNull.image_id, null);

  const createWithEmpty = schemas.categoryCreate.parse({
    name: "Stickers",
    image_id: "",
  });
  assert.equal(createWithEmpty.image_id, "");
});
