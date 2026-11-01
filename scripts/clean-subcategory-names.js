import api from "../apps/backend/src/config/woocommerce.js";
import { fetchAllProductCategories } from "../apps/backend/src/services/productService.js";
import { decodeHtmlEntities } from "../apps/backend/src/utils/textUtils.js";
import { serverCache } from "../apps/backend/src/utils/memoryCache.js";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const isApply = process.argv.includes("--apply");
const rollbackArgIndex = process.argv.indexOf("--rollback");
const rollbackFilePath = rollbackArgIndex !== -1 ? process.argv[rollbackArgIndex + 1] : null;

async function rollback(filePath) {
  console.log(`[ROLLBACK MODE] Reading backup file: ${filePath}`);
  const content = await readFile(filePath, "utf8");
  const backup = JSON.parse(content);
  const items = backup.updates || [];

  if (!items.length) {
    console.log("No items found in backup file.");
    return true;
  }

  console.log(`Reverting ${items.length} subcategories to their original names...`);
  const BATCH_SIZE = 25;
  let reverted = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE).map((item) => ({
      id: item.id,
      name: item.originalName,
    }));

    const res = await api.post("products/categories/batch", { update: chunk });
    const success = (res.data?.update || []).filter((item) => item?.id && !item?.error);
    reverted += success.length;
    console.log(`Reverted ${reverted}/${items.length} subcategories...`);
  }

  serverCache.invalidatePrefix("catalog:");
  serverCache.invalidatePrefix("category:");
  serverCache.delete("admin:categories");
  if (reverted !== items.length) {
    console.error(
      `[PARTIAL ROLLBACK] Only ${reverted} of ${items.length} subcategories were restored. ` +
      "Review the WooCommerce batch response and retry the rollback before treating it as complete."
    );
    return false;
  }

  console.log("Rollback complete and caches invalidated.");
  return true;
}

async function cleanSubcategories() {
  if (rollbackFilePath) {
    const rollbackComplete = await rollback(rollbackFilePath);
    process.exit(rollbackComplete ? 0 : 1);
  }

  console.log("Fetching all product categories from WooCommerce...");
  const categories = await fetchAllProductCategories();
  console.log(`Fetched ${categories.length} total categories.`);

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const updates = [];
  const warnings = [];

  // Track sibling names per parent to prevent duplicate names
  const siblingNamesByParent = new Map();
  for (const cat of categories) {
    if (cat.parent && Number(cat.parent) > 0) {
      const pId = Number(cat.parent);
      if (!siblingNamesByParent.has(pId)) siblingNamesByParent.set(pId, new Set());
      siblingNamesByParent.get(pId).add(decodeHtmlEntities(cat.name).trim().toLowerCase());
    }
  }

  for (const cat of categories) {
    if (!cat.parent || Number(cat.parent) === 0) continue;

    const rawName = cat.name || "";
    let cleanName = decodeHtmlEntities(rawName).trim();
    const parent = categoryMap.get(Number(cat.parent));

    if (!parent) continue;

    const parentName = decodeHtmlEntities(parent.name || "").trim();
    const escaped = parentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefixRegex = new RegExp(`^${escaped}\\s*[-–—/:]\\s*`, "i");

    // Strictly match and strip only the actual parent category prefix
    if (prefixRegex.test(cleanName)) {
      const candidateName = cleanName.replace(prefixRegex, "").trim();

      // Guard: Ensure stripped name is not empty
      if (!candidateName) {
        warnings.push(`Category #${cat.id} ("${rawName}") would be empty after stripping parent prefix; skipping.`);
        continue;
      }

      // Guard: Check for duplicate sibling names under the same parent (including already-proposed names)
      const siblings = siblingNamesByParent.get(Number(cat.parent));
      if (siblings && candidateName.toLowerCase() !== rawName.toLowerCase() && siblings.has(candidateName.toLowerCase())) {
        warnings.push(`Category #${cat.id} ("${candidateName}") would conflict with an existing sibling under Parent #${parent.id}; skipping.`);
        continue;
      }

      cleanName = candidateName;
      if (siblings) {
        siblings.add(candidateName.toLowerCase());
      }
    }

    // Notice: NO generic "split(' - ')" fallback. Legitimate hyphens like "USB-C" or "Marvel - Spiderman" are fully protected.

    if (cleanName !== rawName) {
      updates.push({
        id: cat.id,
        originalName: rawName,
        newName: cleanName,
        parentId: Number(cat.parent),
        parentName,
      });
    }
  }

  if (warnings.length > 0) {
    console.log(`\n[WARNINGS] ${warnings.length} items flagged:`);
    warnings.slice(0, 5).forEach((w) => console.log(`  - ${w}`));
    if (warnings.length > 5) console.log(`  ... and ${warnings.length - 5} more.`);
  }

  console.log(`\nIdentified ${updates.length} subcategories requiring clean name updates.`);

  if (updates.length === 0) {
    console.log("All subcategory names are already clean and conformant!");
    process.exit(0);
  }

  console.log("Sample proposed updates:");
  updates.slice(0, 5).forEach((u) => {
    console.log(`  - ID #${u.id} (Parent: "${u.parentName}"): "${u.originalName}" -> "${u.newName}"`);
  });

  const scratchDir = path.resolve("apps/backend/scratch");
  await mkdir(scratchDir, { recursive: true });
  const backupFile = path.join(scratchDir, `subcategory-cleanup-backup-${Date.now()}.json`);
  await writeFile(backupFile, JSON.stringify({ timestamp: new Date().toISOString(), total: updates.length, updates }, null, 2), "utf8");
  console.log(`\nRollback backup saved to: ${backupFile}`);

  if (!isApply) {
    console.log("\n[DRY RUN] No changes were made to WooCommerce.");
    console.log("To apply these changes, run:");
    console.log("  node scripts/clean-subcategory-names.js --apply");
    console.log("To rollback after applying, run:");
    console.log(`  node scripts/clean-subcategory-names.js --rollback "${backupFile}"`);
    process.exit(0);
  }

  console.log("\n[APPLY MODE] Applying updates in batches of 25...");
  const BATCH_SIZE = 25;
  const successfullyUpdatedItems = [];

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunkUpdates = updates.slice(i, i + BATCH_SIZE);
    const chunk = chunkUpdates.map((u) => ({
      id: u.id,
      name: u.newName,
    }));

    try {
      const res = await api.post("products/categories/batch", { update: chunk });
      const successfulIds = new Set(
        (res.data?.update || [])
          .filter((item) => item?.id && !item?.error)
          .map((item) => Number(item.id))
      );
      for (const u of chunkUpdates) {
        if (successfulIds.has(Number(u.id))) {
          successfullyUpdatedItems.push(u);
        }
      }
      console.log(`Updated ${successfullyUpdatedItems.length}/${updates.length} subcategories...`);
    } catch (err) {
      console.error(`Batch update error at offset ${i}:`, err.message);
    }
  }

  // Save applied rollback file specifically with items that actually succeeded
  const appliedBackupFile = path.join(scratchDir, `subcategory-cleanup-applied-${Date.now()}.json`);
  await writeFile(
    appliedBackupFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        total: successfullyUpdatedItems.length,
        updates: successfullyUpdatedItems,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`\nApplied rollback backup saved to: ${appliedBackupFile}`);

  serverCache.invalidatePrefix("catalog:");
  serverCache.invalidatePrefix("category:");
  serverCache.delete("admin:categories");
  console.log("Invalidated category caches.");

  if (successfullyUpdatedItems.length !== updates.length) {
    console.error(
      `\n[PARTIAL FAILURE] Only ${successfullyUpdatedItems.length} of ${updates.length} subcategories were updated.`
    );
    console.error(`To rollback the successfully applied changes, run:`);
    console.error(`  node scripts/clean-subcategory-names.js --rollback "${appliedBackupFile}"`);
    process.exit(1);
  }

  console.log(`\nSuccessfully updated all ${successfullyUpdatedItems.length} subcategories in WooCommerce.`);
  process.exit(0);
}

cleanSubcategories().catch((err) => {
  console.error("Fatal cleanSubcategories error:", err);
  process.exit(1);
});
