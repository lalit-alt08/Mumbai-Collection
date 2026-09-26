import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Try default cwd (.env in current working directory)
dotenv.config();

// 2. If WOOCOMMERCE_URL is not set (e.g. running from repository root or external cwd),
// explicitly load apps/backend/.env
if (!process.env.WOOCOMMERCE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
}

// 3. Fallback: check workspace root .env if it exists
if (!process.env.WOOCOMMERCE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
}
