import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoPluginPath = path.resolve(__dirname, "../mumbai-auth.php");
const localWpPluginPath = process.env.LOCALWP_PLUGIN_PATH ||
  "C:\\Users\\asus\\Local Sites\\mumbai-collection\\app\\public\\wp-content\\plugins\\mumbai-auth\\mumbai-auth.php";

if (!fs.existsSync(repoPluginPath)) {
  console.error(`[Sync] Error: Repo plugin file not found at ${repoPluginPath}`);
  process.exit(1);
}

const getHash = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
};

const repoHash = getHash(repoPluginPath);
const localWpHash = getHash(localWpPluginPath);

if (repoHash === localWpHash) {
  console.log("[Sync] Repo plugin and LocalWP plugin are already identical (in sync).");
  process.exit(0);
}

const destDir = path.dirname(localWpPluginPath);
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

fs.copyFileSync(repoPluginPath, localWpPluginPath);
console.log(`[Sync] Successfully synced repo mumbai-auth.php -> ${localWpPluginPath}`);
