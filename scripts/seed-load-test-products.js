import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import api from "../apps/backend/src/config/woocommerce.js";
import { uploadMedia } from "../apps/backend/src/services/wordpressMediaService.js";

// Override the default 15s timeout — batch product creation in LocalWP is slow
api.timeout = 120_000;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchDir = path.join(rootDir, "apps/backend/scratch");
const logoPath = path.join(rootDir, "App Logo.png");
const count = 300;
const batchSize = 10;
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
  const ids = [...new Set((manifest.createdProductIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) {
    console.log(`Manifest has no recorded product IDs: ${manifestPath}`);
    return;
  }
  const catIds = [...new Set((manifest.createdCategoryIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  console.log(`Deleting ${ids.length} products and ${catIds.length} categories recorded by ${path.basename(manifestPath)} from ${process.env.WOOCOMMERCE_URL}.`);
  if (!isApply) {
    console.log("Dry run only. Add --apply to permanently delete those products and categories.");
    return;
  }
  let deleted = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const response = await api.post("products/batch", {
      delete: ids.slice(i, i + batchSize).map((id) => ({ id, force: true })),
    });
    const outcomes = Array.isArray(response.data?.delete) ? response.data.delete : [];
    deleted += outcomes.filter((item) => item && !item.error).length;
    const failures = outcomes.filter((item) => item?.error);
    if (failures.length) {
      console.error(`${failures.length} delete(s) failed in this batch; check WooCommerce before retrying.`);
      console.error(JSON.stringify(failures.map((item) => ({ id: item.id, message: item.error?.message }))));
    }
  }
  console.log(`Deleted ${deleted} of ${ids.length} recorded products. The shared logo media was kept.`);

  if (catIds.length) {
    console.log(`Deleting ${catIds.length} categories recorded in manifest...`);
    let catDeleted = 0;
    for (let i = 0; i < catIds.length; i += batchSize) {
      const response = await api.post("products/categories/batch", {
        delete: catIds.slice(i, i + batchSize).map((id) => ({ id, force: true })),
      });
      const outcomes = Array.isArray(response.data?.delete) ? response.data.delete : [];
      catDeleted += outcomes.filter((item) => item && !item.error).length;
    }
    console.log(`Deleted ${catDeleted} of ${catIds.length} recorded categories.`);
  }
};

const seed = async () => {
  console.log(`Target: ${process.env.WOOCOMMERCE_URL}`);
  console.log(`Products: ${count}; image: ${path.basename(logoPath)}`);
  if (!isApply) {
    console.log("Dry run only; no files or store data were changed.");
    console.log("After LocalWP is running, add --apply to upload the logo and create the products.");
    return;
  }

  const categoryResponse = await api.get("products/categories", { per_page: 100, hide_empty: false });
  const categories = (Array.isArray(categoryResponse.data) ? categoryResponse.data : [])
    .filter((category) => Number(category.parent) === 0 && category.slug !== "uncategorized")
    .map((category) => Number(category.id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!categories.length) {
    throw new Error("No top-level product categories were found. Create/select a test category first.");
  }

  const manifestPath = path.join(scratchDir, `load-test-products-${prefix}.json`);
  await mkdir(scratchDir, { recursive: true });
  const manifest = {
    purpose: "Local catalog/load-flow test products; safe to remove using this script's --cleanup mode.",
    target: process.env.WOOCOMMERCE_URL,
    prefix,
    createdAt: new Date().toISOString(),
    logoMediaId: null,
    createdProductIds: [],
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Products: ${count}; categories: ${categories.length}; shared image: ${path.basename(logoPath)}`);
  console.log(`Manifest: ${manifestPath}`);

  const logoBuffer = await readFile(logoPath);
  const media = await uploadMedia(
    { originalname: "mumbai-collection-load-test-logo.png", buffer: logoBuffer, mimetype: "image/png" },
    { uploaderId: 0, trackPending: false }
  );
  manifest.logoMediaId = Number(media.id);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  for (let offset = 0; offset < count; offset += batchSize) {
    const products = Array.from({ length: Math.min(batchSize, count - offset) }, (_, batchIndex) => {
      const index = offset + batchIndex + 1;
      const id = String(index).padStart(3, "0");
      const categoryId = categories[(index - 1) % categories.length];
      const price = (99 + ((index * 37) % 900)).toFixed(2);
      return {
        name: `${prefix} Product ${id}`,
        type: "simple",
        status: "publish",
        catalog_visibility: "visible",
        regular_price: price,
        description: "Temporary LOADTEST catalog item created to check product browsing and pagination. Remove with scripts/seed-load-test-products.js --cleanup --apply.",
        short_description: "Temporary catalog test product.",
        sku: `${prefix}-${id}`,
        manage_stock: true,
        stock_quantity: 5 + ((index * 13) % 46),
        stock_status: "instock",
        categories: [{ id: categoryId }],
        images: [{ id: media.id }],
      };
    });

    const response = await api.post("products/batch", { create: products });
    const created = Array.isArray(response.data?.create) ? response.data.create : [];
    const successful = created.filter((item) => item?.id && !item?.error);
    manifest.createdProductIds.push(...successful.map((item) => Number(item.id)));
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const failures = created.filter((item) => item?.error || !item?.id);
    console.log(`Created ${manifest.createdProductIds.length}/${count} products.`);
    if (failures.length) {
      console.error(`${failures.length} product(s) failed in the last batch. IDs already created are saved for cleanup.`);
      console.error(JSON.stringify(failures.map((item) => ({ sku: item.sku, message: item.error?.message || "Missing product ID" }))));
      process.exitCode = 1;
      return;
    }
  }

  manifest.completedAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Finished: created ${manifest.createdProductIds.length} test products. To remove only these products, run: node scripts/seed-load-test-products.js --cleanup --apply`);
};

try {
  if (isCleanup) await cleanup();
  else await seed();
} catch (error) {
  const message = error.response?.data?.message || error.message || "Unknown error";
  console.error(`Load-test product operation failed: ${message}`);
  console.error("No credential values are printed. Check that LocalWP is running and the local WooCommerce URL is reachable.");
  process.exitCode = 1;
}
