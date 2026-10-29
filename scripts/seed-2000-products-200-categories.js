import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import api from "../apps/backend/src/config/woocommerce.js";
import { uploadMedia } from "../apps/backend/src/services/wordpressMediaService.js";

// Ensure timeout is applied to axiosConfig which overrides api.timeout
api.axiosConfig = {
  ...api.axiosConfig,
  timeout: 120_000,
};
api.timeout = 120_000;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchDir = path.join(rootDir, "apps/backend/scratch");
const logoPath = path.join(rootDir, "App Logo.png");

const TOTAL_CATEGORIES = 200;
const TOTAL_PRODUCTS = 2000;
const PRODUCTS_PER_CATEGORY = 10;
const CATEGORY_BATCH_SIZE = 20;
const PRODUCT_BATCH_SIZE = 15;

const prefix = `LOADTEST-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;

const host = (() => {
  try {
    return new URL(process.env.WOOCOMMERCE_URL || "").hostname.toLowerCase();
  } catch {
    return "";
  }
})();

if (!host || !(host === "localhost" || host.endsWith(".local"))) {
  console.error("Refusing to run: WOOCOMMERCE_URL must point to localhost or a .local development site.");
  process.exit(2);
}

const args = new Set(process.argv.slice(2));
const isCleanup = args.has("--cleanup");
const isApply = args.has("--apply");

const DEPARTMENTS = [
  "Menswear", "Womenswear", "Kids Apparel", "Activewear", "Footwear",
  "Smartphones", "Laptops", "Audio & Sound", "Smart Wearables", "Cameras",
  "Kitchen Essentials", "Home Decor", "Bedding & Bath", "Lighting", "Cookware",
  "Skincare", "Haircare", "Fragrances", "Cosmetics", "Personal Grooming",
  "Fitness Gear", "Outdoor Equipment", "Cycling", "Team Sports", "Water Sports",
  "Board Games", "Action Figures", "Puzzles & Crafts", "Baby Toys", "Educational Toys",
  "Stationery", "Art Supplies", "Office Furniture", "Desk Organizers", "Notebooks & Pens",
  "Gourmet Coffee", "Premium Teas", "Artisanal Snacks", "Organic Spices", "Healthy Sweets"
];

export const generateCategoryNames = (count = TOTAL_CATEGORIES) => {
  const names = [];
  const modifiers = [
    "Collection", "Studio", "Essentials", "Gallery", "Select",
    "Prime", "Signature", "Heritage", "Trend", "Boutique"
  ];

  let id = 1;
  for (const dept of DEPARTMENTS) {
    for (const mod of modifiers) {
      if (names.length >= count) break;
      const numStr = String(id).padStart(3, "0");
      names.push(`LOADTEST ${numStr} - ${dept} ${mod}`);
      id++;
    }
    if (names.length >= count) break;
  }

  while (names.length < count) {
    const numStr = String(id).padStart(3, "0");
    names.push(`LOADTEST ${numStr} - Department ${numStr}`);
    id++;
  }

  return names;
};

const getLatestManifest = async () => {
  let entries = [];
  try {
    entries = await readdir(scratchDir);
  } catch {
    return null;
  }
  const manifests = entries
    .filter((name) => name.startsWith("load-test-products-") && name.endsWith(".json"))
    .sort();
  if (!manifests.length) return null;
  return path.join(scratchDir, manifests.at(-1));
};

const cleanup = async () => {
  const manifestPath = await getLatestManifest();
  if (!manifestPath) {
    console.log("No load-test manifest found; nothing to delete.");
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const productIds = [...new Set((manifest.createdProductIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const catIds = [...new Set((manifest.createdCategoryIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];

  console.log(`Found manifest: ${path.basename(manifestPath)}`);
  console.log(`To delete: ${productIds.length} products and ${catIds.length} categories from ${process.env.WOOCOMMERCE_URL}`);

  if (!isApply) {
    console.log("Dry run only. Run with --cleanup --apply to permanently delete.");
    return;
  }

  let deletedProducts = 0;
  for (let i = 0; i < productIds.length; i += 25) {
    const slice = productIds.slice(i, i + 25);
    const response = await api.post("products/batch", {
      delete: slice.map((id) => ({ id, force: true })),
    });
    const outcomes = Array.isArray(response.data?.delete) ? response.data.delete : [];
    deletedProducts += outcomes.filter((item) => item && !item.error).length;
    console.log(`Deleted ${deletedProducts}/${productIds.length} products...`);
  }

  let deletedCategories = 0;
  for (let i = 0; i < catIds.length; i += 20) {
    const slice = catIds.slice(i, i + 20);
    const response = await api.post("products/categories/batch", {
      delete: slice.map((id) => ({ id, force: true })),
    });
    const outcomes = Array.isArray(response.data?.delete) ? response.data.delete : [];
    deletedCategories += outcomes.filter((item) => item && !item.error).length;
    console.log(`Deleted ${deletedCategories}/${catIds.length} categories...`);
  }

  console.log(`\nCleanup complete: removed ${deletedProducts} products and ${deletedCategories} categories.`);
};

const seed = async () => {
  console.log(`Target: ${process.env.WOOCOMMERCE_URL}`);
  console.log(`Configuration: ${TOTAL_CATEGORIES} categories, ${TOTAL_PRODUCTS} products (${PRODUCTS_PER_CATEGORY} products/category)`);

  if (!isApply) {
    console.log("Dry run only. Run with --apply to execute.");
    return;
  }

  await mkdir(scratchDir, { recursive: true });
  const manifestPath = path.join(scratchDir, `load-test-products-${prefix}.json`);

  let manifest = {
    purpose: "Heavy load testing: 2,000 products across 200 categories.",
    target: process.env.WOOCOMMERCE_URL,
    prefix,
    createdAt: new Date().toISOString(),
    logoMediaId: null,
    createdCategoryIds: [],
    createdProductIds: [],
  };

  try {
    const existing = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest = { ...manifest, ...existing };
    console.log(`Found existing manifest with ${manifest.createdCategoryIds.length} categories and ${manifest.createdProductIds.length} products.`);
  } catch {
    // New manifest
  }

  // Step 1: Media
  if (!manifest.logoMediaId) {
    console.log("\n[Step 1/3] Ensuring shared test media...");
    const logoBuffer = await readFile(logoPath);
    const media = await uploadMedia(
      { originalname: "mumbai-collection-load-test-logo.png", buffer: logoBuffer, mimetype: "image/png" },
      { uploaderId: 0, trackPending: false }
    );
    manifest.logoMediaId = Number(media.id);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
  const logoMediaId = manifest.logoMediaId;
  console.log(`Shared media ID: ${logoMediaId}`);

  // Step 2: Categories (skip if already created)
  if (manifest.createdCategoryIds.length < TOTAL_CATEGORIES) {
    console.log(`\n[Step 2/3] Creating categories in batches of ${CATEGORY_BATCH_SIZE}...`);
    const categoryNames = generateCategoryNames(TOTAL_CATEGORIES);

    for (let i = manifest.createdCategoryIds.length; i < categoryNames.length; i += CATEGORY_BATCH_SIZE) {
      const chunk = categoryNames.slice(i, i + CATEGORY_BATCH_SIZE);
      const payloads = chunk.map((name) => ({
        name,
        parent: 0,
        image: { id: logoMediaId },
      }));

      const response = await api.post("products/categories/batch", { create: payloads });
      const created = Array.isArray(response.data?.create) ? response.data.create : [];
      const successful = created.filter((item) => item?.id && !item?.error);

      manifest.createdCategoryIds.push(...successful.map((item) => Number(item.id)));
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      console.log(`Categories created: ${manifest.createdCategoryIds.length}/${TOTAL_CATEGORIES}`);
    }
  } else {
    console.log(`\n[Step 2/3] All ${manifest.createdCategoryIds.length} categories already created. Skipping.`);
  }

  const categoryIds = manifest.createdCategoryIds;

  // Step 3: Products
  const startOffset = manifest.createdProductIds.length;
  console.log(`\n[Step 3/3] Creating products in batches of ${PRODUCT_BATCH_SIZE} (resuming from ${startOffset}/${TOTAL_PRODUCTS})...`);

  for (let offset = startOffset; offset < TOTAL_PRODUCTS; offset += PRODUCT_BATCH_SIZE) {
    const currentBatchCount = Math.min(PRODUCT_BATCH_SIZE, TOTAL_PRODUCTS - offset);
    const products = Array.from({ length: currentBatchCount }, (_, indexInBatch) => {
      const overallIndex = offset + indexInBatch;
      const numStr = String(overallIndex + 1).padStart(4, "0");

      const catIndex = Math.min(Math.floor(overallIndex / PRODUCTS_PER_CATEGORY), categoryIds.length - 1);
      const categoryId = categoryIds[catIndex];

      const price = (99 + ((overallIndex * 47) % 2400)).toFixed(2);
      const stock = 5 + ((overallIndex * 13) % 95);

      return {
        name: `${prefix} Product ${numStr}`,
        type: "simple",
        status: "publish",
        catalog_visibility: "visible",
        regular_price: price,
        description: `High-volume load test product #${numStr}. Part of category ID ${categoryId}.`,
        short_description: `Load test product #${numStr}.`,
        sku: `${prefix}-${numStr}`,
        manage_stock: true,
        stock_quantity: stock,
        stock_status: "instock",
        categories: [{ id: categoryId }],
        images: [{ id: logoMediaId }],
      };
    });

    let success = false;
    let attempts = 0;
    while (!success && attempts < 3) {
      attempts++;
      try {
        const response = await api.post("products/batch", { create: products });
        const created = Array.isArray(response.data?.create) ? response.data.create : [];
        const successful = created.filter((item) => item?.id && !item?.error);

        manifest.createdProductIds.push(...successful.map((item) => Number(item.id)));
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

        const percent = ((manifest.createdProductIds.length / TOTAL_PRODUCTS) * 100).toFixed(1);
        console.log(`Products created: ${manifest.createdProductIds.length}/${TOTAL_PRODUCTS} (${percent}%)`);

        const failures = created.filter((item) => item?.error);
        if (failures.length) {
          console.error(`Batch had ${failures.length} product failures:`, failures.map((f) => f.error?.message));
        }
        success = true;
      } catch (batchErr) {
        console.warn(`Batch failed (attempt ${attempts}/3): ${batchErr.message}`);
        if (attempts >= 3) throw batchErr;
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  }

  manifest.completedAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\n======================================================`);
  console.log(`SUCCESS: Seeded ${manifest.createdProductIds.length} products across ${categoryIds.length} categories!`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`To clean up: node scripts/seed-2000-products-200-categories.js --cleanup --apply`);
  console.log(`======================================================`);
};

try {
  if (isCleanup) await cleanup();
  else await seed();
} catch (error) {
  const message = error.response?.data?.message || error.message || "Unknown error";
  console.error(`Operation failed: ${message}`);
  process.exitCode = 1;
}
