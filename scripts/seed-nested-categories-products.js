import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import api from "../apps/backend/src/config/woocommerce.js";
import { uploadMedia } from "../apps/backend/src/services/wordpressMediaService.js";

// Ensure generous timeout for batch operations
api.axiosConfig = {
  ...api.axiosConfig,
  timeout: 120_000,
};
api.timeout = 120_000;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchDir = path.join(rootDir, "apps/backend/scratch");
const logoPath = path.join(rootDir, "App Logo.png");

// CLI Flags and Parameters
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getParam = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (arg) {
    const val = Number.parseInt(arg.split("=")[1], 10);
    if (Number.isFinite(val) && val > 0) return val;
  }
  return fallback;
};

const isApply = hasFlag("--apply");
const isCleanup = hasFlag("--cleanup");
const forceRemote = hasFlag("--force-remote");

// Defaults: 60 parent categories (between 50 and 70), 10 subcategories per parent, 20 products per subcategory
const TOTAL_PARENT_CATEGORIES = Math.min(70, Math.max(50, getParam("parents", 60)));
const SUB_PER_PARENT = getParam("subs", 10);
const PRODUCTS_PER_SUBCATEGORY = getParam("products", 20);
const TOTAL_SUBCATEGORIES = TOTAL_PARENT_CATEGORIES * SUB_PER_PARENT;
const TOTAL_PRODUCTS = TOTAL_SUBCATEGORIES * PRODUCTS_PER_SUBCATEGORY;

const CATEGORY_BATCH_SIZE = 20;
const PRODUCT_BATCH_SIZE = 25;

const timestamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const prefix = `TEST-${timestamp}`;

// Safety Host Check: Only run on localhost or .local development environments unless explicitly forced
const host = (() => {
  try {
    return new URL(process.env.WOOCOMMERCE_URL || "").hostname.toLowerCase();
  } catch {
    return "";
  }
})();

if (!host || !(host === "localhost" || host.endsWith(".local") || host.includes("127.0.0.1"))) {
  if (!forceRemote) {
    console.error("Refusing to run: WOOCOMMERCE_URL does not point to a local development site (localhost / .local).");
    console.error("If you deliberately intend to seed a remote staging server, pass --force-remote with --apply.");
    process.exit(2);
  }
}

// 70 Curated Parent Departments (Toys, Hobbies, Games, Stationery, Art, Learning)
const PARENT_DEPARTMENTS = [
  "Action Figures & Heroes",
  "Board Games & Strategy",
  "Building Blocks & Bricks",
  "Art & Sketching Supplies",
  "Gel & Fountain Pens",
  "Notebooks & Daily Planners",
  "School & Geometry Essentials",
  "Remote Control Vehicles",
  "Toddler & Early Learning",
  "Outdoor & Sports Toys",
  "Card Games & Family Play",
  "Model Kits & Die-Cast Cars",
  "Crafts, Glues & Origami",
  "Markers & Highlighters",
  "Office Stationery & Organizers",
  "Puzzles & Brain Teasers",
  "Dolls & Miniature Playsets",
  "Science, STEM & Robotics",
  "Plush Toys & Soft Animals",
  "Wooden Toys & Montessori",
  "Paints, Canvas & Palettes",
  "Novelty & Desk Accessories",
  "Water Guns & Pool Play",
  "Kids Party Supplies & Favors",
  "Fidget & Sensory Toys",
  "Children Story Books & Flashcards",
  "Musical Instruments for Kids",
  "Pretend Play & Kitchen Sets",
  "Electric Train Sets & Tracks",
  "Skateboards, Scooters & Helmets",
  "Clay, Dough & Pottery",
  "Diaries, Locks & Secret Journals",
  "Calculators & Technical Scales",
  "Balloons, Ribbons & Wrapping",
  "Action Playsets & Forts",
  "Magic Tricks & Illusion Kits",
  "Kids Electronics & Walkie Talkies",
  "Dress-Up Costumes & Masks",
  "Bath Toys & Water Games",
  "Baby Rattles & Soft Teethers",
  "Files, Folders & Envelopes",
  "Erasers, Sharpeners & Rulers",
  "Desk Lamps & Book Lights",
  "Coloring Books & Sticker Albums",
  "Robotic Pets & Interactive Animals",
  "Flying Drones & Gliders",
  "Dartboards & Target Games",
  "Badge & Pin Maker Crafts",
  "Tie-Dye & Fabric Art",
  "Beads, Jewelry & Looms",
  "Toy Guns, Blasters & Targets",
  "Wooden Jigsaws & Peg Boards",
  "Calligraphy & Lettering Inks",
  "Stamps, Ink Pads & Wax Seals",
  "Magnetic Drawing Boards",
  "Microscopes & Discovery Kits",
  "Space, Galaxy & Telescope Toys",
  "Dinosaur Adventures & Fossils",
  "Mini Arcade & Retro Handhelds",
  "Finger Skateboards & Ramps",
  "Stunt Kites & Parachutes",
  "Kids Play Tents & Tunnels",
  "Sandbox Tools & Kinetic Sand",
  "Baby Gyms & Playmats",
  "Sticky Notes, Memo Tabs & Clips",
  "Laser Cut Wooden Puzzles",
  "Badge Holders & Lanyards",
  "Whiteboards & Dry Erase Pens",
  "Tape Dispensers & Washi Tapes",
  "Educational Flash Cards & Globe"
];

// 10 Universal Subcategory archetypes that map cleanly to each parent
const SUB_TEMPLATES = [
  "Beginner Starter Packs",
  "Premium Pro Edition",
  "Best Sellers Collection",
  "Compact & Pocket Sized",
  "Deluxe Gift Sets",
  "Budget Everyday Value",
  "Creative & DIY Special",
  "Collector Edition",
  "Accessories & Refills",
  "Heavy Duty & Durable"
];

const getLatestManifest = async () => {
  let entries = [];
  try {
    entries = await readdir(scratchDir);
  } catch {
    return null;
  }
  const manifests = entries
    .filter((name) => name.startsWith("nested-seed-manifest-") && name.endsWith(".json"))
    .sort();
  if (!manifests.length) return null;
  return path.join(scratchDir, manifests.at(-1));
};

// CLEANUP ROUTINE
const cleanup = async () => {
  const manifestPath = await getLatestManifest();
  if (!manifestPath) {
    console.log("No seed manifest found in apps/backend/scratch; nothing to clean up.");
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const productIds = [...new Set((manifest.createdProductIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const subCategoryIds = [...new Set((manifest.createdSubCategoryIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const parentCategoryIds = [...new Set((manifest.createdParentCategoryIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];

  console.log(`Found manifest: ${path.basename(manifestPath)}`);
  console.log(`Queued for deletion on ${process.env.WOOCOMMERCE_URL}:`);
  console.log(`- Products: ${productIds.length}`);
  console.log(`- Subcategories: ${subCategoryIds.length}`);
  console.log(`- Parent Categories: ${parentCategoryIds.length}`);

  if (!isApply) {
    console.log("\n[DRY RUN] Run with --cleanup --apply to permanently delete.");
    return;
  }

  // 1. Delete Products first
  let deletedProducts = 0;
  for (let i = 0; i < productIds.length; i += 25) {
    const slice = productIds.slice(i, i + 25);
    try {
      const response = await api.post("products/batch", {
        delete: slice.map((id) => ({ id, force: true })),
      });
      const outcomes = Array.isArray(response.data?.delete) ? response.data.delete : [];
      deletedProducts += outcomes.filter((item) => item && !item.error).length;
      console.log(`Deleted ${deletedProducts}/${productIds.length} products...`);
    } catch (err) {
      console.warn(`Product batch delete warning: ${err.message}`);
    }
  }

  // 2. Delete Subcategories second
  let deletedSubs = 0;
  for (let i = 0; i < subCategoryIds.length; i += 20) {
    const slice = subCategoryIds.slice(i, i + 20);
    try {
      const response = await api.post("products/categories/batch", {
        delete: slice.map((id) => ({ id, force: true })),
      });
      const outcomes = Array.isArray(response.data?.delete) ? response.data.delete : [];
      deletedSubs += outcomes.filter((item) => item && !item.error).length;
      console.log(`Deleted ${deletedSubs}/${subCategoryIds.length} subcategories...`);
    } catch (err) {
      console.warn(`Subcategory batch delete warning: ${err.message}`);
    }
  }

  // 3. Delete Parent Categories last
  let deletedParents = 0;
  for (let i = 0; i < parentCategoryIds.length; i += 20) {
    const slice = parentCategoryIds.slice(i, i + 20);
    try {
      const response = await api.post("products/categories/batch", {
        delete: slice.map((id) => ({ id, force: true })),
      });
      const outcomes = Array.isArray(response.data?.delete) ? response.data.delete : [];
      deletedParents += outcomes.filter((item) => item && !item.error).length;
      console.log(`Deleted ${deletedParents}/${parentCategoryIds.length} parent categories...`);
    } catch (err) {
      console.warn(`Parent category batch delete warning: ${err.message}`);
    }
  }

  console.log(`\nCleanup complete! Deleted ${deletedProducts} products and ${deletedSubs + deletedParents} categories.`);
};

// SEED ROUTINE
const seed = async () => {
  console.log("==================================================================");
  console.log("MUMBAI COLLECTION — HIERARCHICAL CATEGORY & PRODUCT SEEDER");
  console.log("==================================================================");
  console.log(`Target Store URL: ${process.env.WOOCOMMERCE_URL}`);
  console.log(`Parent Categories: ${TOTAL_PARENT_CATEGORIES}`);
  console.log(`Subcategories:     ${TOTAL_SUBCATEGORIES} (${SUB_PER_PARENT} per parent)`);
  console.log(`Products per Sub:  ${PRODUCTS_PER_SUBCATEGORY} products`);
  console.log(`Total Products:    ${TOTAL_PRODUCTS} items`);
  console.log("==================================================================");

  if (!isApply) {
    console.log("\n[DRY RUN] No changes were made to WooCommerce.");
    console.log("To execute this seeder, run with:");
    console.log("  node scripts/seed-nested-categories-products.js --apply");
    return;
  }

  await mkdir(scratchDir, { recursive: true });
  const manifestPath = path.join(scratchDir, `nested-seed-manifest-${prefix}.json`);

  let manifest = {
    purpose: "Hierarchical categories & product seeding",
    target: process.env.WOOCOMMERCE_URL,
    prefix,
    createdAt: new Date().toISOString(),
    logoMediaId: null,
    createdParentCategoryIds: [],
    createdParentMap: {}, // parentId -> [subCategoryIds]
    createdSubCategoryIds: [],
    createdProductIds: [],
  };

  try {
    const existing = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest = { ...manifest, ...existing };
    console.log(`Resuming from existing manifest: ${path.basename(manifestPath)}`);
  } catch {
    // New run
  }

  // 1. Upload or reuse shared logo image
  if (!manifest.logoMediaId) {
    console.log("\n[Step 1/4] Ensuring shared product image media...");
    try {
      const logoBuffer = await readFile(logoPath);
      const media = await uploadMedia(
        { originalname: "mumbai-collection-test-asset.png", buffer: logoBuffer, mimetype: "image/png" },
        { uploaderId: 0, trackPending: false }
      );
      manifest.logoMediaId = Number(media.id);
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`Uploaded media ID: ${manifest.logoMediaId}`);
    } catch (e) {
      console.warn("Could not upload test image media; continuing without image attachments:", e.message);
    }
  }
  const logoMediaId = manifest.logoMediaId;

  // 2. Create Parent Categories
  const parentNames = PARENT_DEPARTMENTS.slice(0, TOTAL_PARENT_CATEGORIES);
  if (manifest.createdParentCategoryIds.length < TOTAL_PARENT_CATEGORIES) {
    console.log(`\n[Step 2/4] Creating ${TOTAL_PARENT_CATEGORIES} Parent Categories...`);
    for (let i = manifest.createdParentCategoryIds.length; i < parentNames.length; i += CATEGORY_BATCH_SIZE) {
      const chunk = parentNames.slice(i, i + CATEGORY_BATCH_SIZE);
      const payloads = chunk.map((deptName, idx) => ({
        name: `${deptName}`,
        parent: 0,
        description: `Premium collection of ${deptName} at Mumbai Collection, Vasai West.`,
        ...(logoMediaId ? { image: { id: logoMediaId } } : {}),
      }));

      const response = await api.post("products/categories/batch", { create: payloads });
      const created = Array.isArray(response.data?.create) ? response.data.create : [];
      const successful = created.filter((item) => item?.id && !item?.error);

      for (const cat of successful) {
        const id = Number(cat.id);
        manifest.createdParentCategoryIds.push(id);
        manifest.createdParentMap[id] ||= [];
      }
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`Parent categories created: ${manifest.createdParentCategoryIds.length}/${TOTAL_PARENT_CATEGORIES}`);
    }
  } else {
    console.log(`\n[Step 2/4] All ${manifest.createdParentCategoryIds.length} Parent Categories already created.`);
  }

  const parentIds = manifest.createdParentCategoryIds;

  // 3. Create 10 Subcategories per Parent
  console.log(`\n[Step 3/4] Creating ${SUB_PER_PARENT} Subcategories inside each Parent Category...`);
  for (let pIndex = 0; pIndex < parentIds.length; pIndex++) {
    const parentId = parentIds[pIndex];
    const parentName = parentNames[pIndex] || `Department ${pIndex + 1}`;
    manifest.createdParentMap[parentId] ||= [];

    const existingSubs = manifest.createdParentMap[parentId];
    if (existingSubs.length >= SUB_PER_PARENT) continue;

    const subPayloads = [];
    for (let sIndex = existingSubs.length; sIndex < SUB_PER_PARENT; sIndex++) {
      const subArchetype = SUB_TEMPLATES[sIndex % SUB_TEMPLATES.length];
      subPayloads.push({
        name: `${subArchetype}`, // Clean subcategory name without redundant parent prefix
        parent: parentId,
        description: `${subArchetype} curated specifically for ${parentName}.`,
        ...(logoMediaId ? { image: { id: logoMediaId } } : {}),
      });
    }

    if (subPayloads.length > 0) {
      const response = await api.post("products/categories/batch", { create: subPayloads });
      const created = Array.isArray(response.data?.create) ? response.data.create : [];
      const successful = created.filter((item) => item?.id && !item?.error);

      for (const sub of successful) {
        const subId = Number(sub.id);
        manifest.createdParentMap[parentId].push(subId);
        manifest.createdSubCategoryIds.push(subId);
      }
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`Parent [${pIndex + 1}/${parentIds.length}] (${parentName}): ${manifest.createdParentMap[parentId].length}/${SUB_PER_PARENT} subs created.`);
    }
  }

  // 4. Create 20 Products per Subcategory
  console.log(`\n[Step 4/4] Creating ${PRODUCTS_PER_SUBCATEGORY} Products per Subcategory in batches of ${PRODUCT_BATCH_SIZE}...`);
  const allSubIdsWithParent = [];
  for (const parentId of parentIds) {
    const subs = manifest.createdParentMap[parentId] || [];
    for (const subId of subs) {
      allSubIdsWithParent.push({ subId, parentId });
    }
  }

  const totalProductTarget = allSubIdsWithParent.length * PRODUCTS_PER_SUBCATEGORY;
  let currentProductCount = manifest.createdProductIds.length;

  console.log(`Target: ${totalProductTarget} products (Currently created: ${currentProductCount})`);

  let currentSubIndex = Math.floor(currentProductCount / PRODUCTS_PER_SUBCATEGORY);

  while (currentSubIndex < allSubIdsWithParent.length) {
    const { subId, parentId } = allSubIdsWithParent[currentSubIndex];
    const createdForThisSub = currentProductCount % PRODUCTS_PER_SUBCATEGORY;
    const remainingForThisSub = PRODUCTS_PER_SUBCATEGORY - createdForThisSub;
    const batchAmount = Math.min(PRODUCT_BATCH_SIZE, remainingForThisSub);

    const productPayloads = Array.from({ length: batchAmount }, (_, i) => {
      const itemNum = createdForThisSub + i + 1;
      const globalItemIndex = currentProductCount + i + 1;
      const padNum = String(globalItemIndex).padStart(5, "0");

      const price = (99 + ((globalItemIndex * 37) % 2900)).toFixed(2);
      const stock = 10 + ((globalItemIndex * 19) % 80);

      return {
        name: `${prefix} Item ${padNum}`,
        type: "simple",
        status: "publish",
        catalog_visibility: "visible",
        regular_price: price,
        description: `Authentic, high-grade toy/stationery product #${padNum}. Guaranteed original packaging.`,
        short_description: `Quality product #${padNum} from Mumbai Collection.`,
        sku: `${prefix}-${padNum}`,
        manage_stock: true,
        stock_quantity: stock,
        stock_status: "instock",
        categories: [{ id: subId }, { id: parentId }],
        ...(logoMediaId ? { images: [{ id: logoMediaId }] } : {}),
      };
    });

    let success = false;
    let attempts = 0;
    while (!success && attempts < 3) {
      attempts++;
      try {
        const response = await api.post("products/batch", { create: productPayloads });
        const created = Array.isArray(response.data?.create) ? response.data.create : [];
        const successful = created.filter((item) => item?.id && !item?.error);

        for (const prod of successful) {
          manifest.createdProductIds.push(Number(prod.id));
        }
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

        currentProductCount = manifest.createdProductIds.length;
        const percent = ((currentProductCount / totalProductTarget) * 100).toFixed(1);
        console.log(`Products created: ${currentProductCount}/${totalProductTarget} (${percent}%) — Subcategory ${currentSubIndex + 1}/${allSubIdsWithParent.length}`);

        const failures = created.filter((item) => item?.error);
        if (failures.length) {
          console.warn(`Encountered ${failures.length} errors in batch:`, failures.map((f) => f.error?.message));
        }
        success = true;
      } catch (err) {
        console.warn(`Product batch attempt ${attempts}/3 failed: ${err.message}`);
        if (attempts >= 3) throw err;
        await new Promise((res) => setTimeout(res, 3000));
      }
    }

    if (currentProductCount % PRODUCTS_PER_SUBCATEGORY === 0) {
      currentSubIndex++;
    }
  }

  manifest.completedAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log("\n==================================================================");
  console.log("SEEDING COMPLETED SUCCESSFULLY!");
  console.log(`- Parent Categories: ${manifest.createdParentCategoryIds.length}`);
  console.log(`- Subcategories:     ${manifest.createdSubCategoryIds.length}`);
  console.log(`- Products Created:  ${manifest.createdProductIds.length}`);
  console.log(`- Manifest Path:     ${manifestPath}`);
  console.log("To clean up this test data later, run:");
  console.log("  node scripts/seed-nested-categories-products.js --cleanup --apply");
  console.log("==================================================================");
};

try {
  if (isCleanup) await cleanup();
  else await seed();
} catch (error) {
  const message = error.response?.data?.message || error.message || "Unknown error";
  console.error(`Execution failed: ${message}`);
  process.exitCode = 1;
}
