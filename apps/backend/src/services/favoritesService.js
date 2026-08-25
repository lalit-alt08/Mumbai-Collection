import api from "../config/woocommerce.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const LEGACY_FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const MIGRATED_FAVORITES_FILE = path.join(DATA_DIR, "favorites.json.migrated");

const META_KEY = "mumbai_favorites";

// In-memory cache for fast lookups & optimistic speed: Map<userId, { ids: Set<number>, timestamp: number }>
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

/**
 * Helper to parse and sanitize product IDs from WooCommerce customer meta
 */
const sanitizeProductIds = (metaValue) => {
  if (!metaValue) return [];
  let rawList = metaValue;
  if (typeof rawList === "string") {
    try {
      rawList = JSON.parse(rawList);
    } catch {
      rawList = rawList.split(",").map((s) => s.trim());
    }
  }
  if (!Array.isArray(rawList)) return [];

  const unique = new Set();
  for (const item of rawList) {
    const num = Number(item);
    if (num && !isNaN(num) && num > 0) {
      unique.add(num);
    }
  }
  return Array.from(unique);
};

/**
 * Fetch favorite product IDs directly from WooCommerce customer meta
 * @param {number} userId
 * @param {boolean} forceFresh
 * @returns {Promise<number[]>}
 */
export const getFavoriteProductIds = async (userId, forceFresh = false) => {
  const uId = Number(userId);
  if (!uId || isNaN(uId) || uId <= 0) return [];

  // Check cache unless forceFresh is requested
  const cached = cache.get(uId);
  if (!forceFresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return Array.from(cached.ids);
  }

  try {
    const response = await api.get(`customers/${uId}`);
    const customer = response.data;
    const metaItem = customer?.meta_data?.find((m) => m.key === META_KEY);
    const productIds = sanitizeProductIds(metaItem?.value);

    // Update in-memory cache
    cache.set(uId, {
      ids: new Set(productIds),
      timestamp: Date.now(),
    });

    return productIds;
  } catch (error) {
    console.warn(`[FavoritesService] Error fetching favorites for customer ${uId}:`, error.message);
    if (cached) {
      return Array.from(cached.ids);
    }
    return [];
  }
};

/**
 * Add a product to customer's favorites in WooCommerce
 * @param {number} userId
 * @param {number} productId
 * @returns {Promise<{ success: boolean, productIds: number[], isFavorited: boolean }>}
 */
export const addFavorite = async (userId, productId) => {
  const uId = Number(userId);
  const pId = Number(productId);
  if (!uId || !pId || isNaN(uId) || isNaN(pId) || uId <= 0 || pId <= 0) {
    return { success: false, productIds: [], isFavorited: false };
  }

  const currentIds = await getFavoriteProductIds(uId, true);
  const idSet = new Set(currentIds);

  if (idSet.has(pId)) {
    return { success: true, productIds: Array.from(idSet), isFavorited: true };
  }

  idSet.add(pId);
  const updatedList = Array.from(idSet);

  try {
    await api.put(`customers/${uId}`, {
      meta_data: [
        {
          key: META_KEY,
          value: updatedList,
        },
      ],
    });

    // Update cache
    cache.set(uId, {
      ids: idSet,
      timestamp: Date.now(),
    });

    return { success: true, productIds: updatedList, isFavorited: true };
  } catch (error) {
    console.error(`[FavoritesService] Error adding favorite product ${pId} for customer ${uId}:`, error.message);
    throw error;
  }
};

/**
 * Remove a product from customer's favorites in WooCommerce
 * @param {number} userId
 * @param {number} productId
 * @returns {Promise<{ success: boolean, productIds: number[], isFavorited: boolean }>}
 */
export const removeFavorite = async (userId, productId) => {
  const uId = Number(userId);
  const pId = Number(productId);
  if (!uId || !pId || isNaN(uId) || isNaN(pId) || uId <= 0 || pId <= 0) {
    return { success: false, productIds: [], isFavorited: false };
  }

  const currentIds = await getFavoriteProductIds(uId, true);
  const idSet = new Set(currentIds);

  if (!idSet.has(pId)) {
    return { success: true, productIds: Array.from(idSet), isFavorited: false };
  }

  idSet.delete(pId);
  const updatedList = Array.from(idSet);

  try {
    await api.put(`customers/${uId}`, {
      meta_data: [
        {
          key: META_KEY,
          value: updatedList,
        },
      ],
    });

    // Update cache
    cache.set(uId, {
      ids: idSet,
      timestamp: Date.now(),
    });

    return { success: true, productIds: updatedList, isFavorited: false };
  } catch (error) {
    console.error(`[FavoritesService] Error removing favorite product ${pId} for customer ${uId}:`, error.message);
    throw error;
  }
};

/**
 * Check if a product is favorited by customer
 * @param {number} userId
 * @param {number} productId
 * @returns {Promise<boolean>}
 */
export const isFavorited = async (userId, productId) => {
  const uId = Number(userId);
  const pId = Number(productId);
  if (!uId || !pId) return false;

  const productIds = await getFavoriteProductIds(uId);
  return productIds.includes(pId);
};

/**
 * One-time automatic migration from legacy favorites.json to WooCommerce Customer Meta
 */
export const migrateLegacyFavorites = async () => {
  if (!fs.existsSync(LEGACY_FAVORITES_FILE)) {
    return;
  }

  try {
    const raw = fs.readFileSync(LEGACY_FAVORITES_FILE, "utf-8");
    const list = JSON.parse(raw);

    if (Array.isArray(list) && list.length > 0) {
      console.log(`[Favorites Migration] Found ${list.length} legacy entries in favorites.json. Migrating to WooCommerce...`);

      // Group legacy favorites by userId
      const userFavoritesMap = new Map();
      for (const item of list) {
        const uId = Number(item.userId);
        const pId = Number(item.productId);
        if (uId && pId) {
          if (!userFavoritesMap.has(uId)) {
            userFavoritesMap.set(uId, new Set());
          }
          userFavoritesMap.get(uId).add(pId);
        }
      }

      for (const [uId, legacyProductIds] of userFavoritesMap.entries()) {
        try {
          const existingIds = await getFavoriteProductIds(uId, true);
          const merged = new Set([...existingIds, ...legacyProductIds]);
          const mergedArray = Array.from(merged);

          await api.put(`customers/${uId}`, {
            meta_data: [
              {
                key: META_KEY,
                value: mergedArray,
              },
            ],
          });

          console.log(`[Favorites Migration] Migrated customer #${uId} favorites (${mergedArray.length} items).`);
        } catch (custErr) {
          console.warn(`[Favorites Migration] Failed to migrate customer #${uId}:`, custErr.message);
        }
      }
    }

    // Rename file to indicate completion and prevent re-migration
    fs.renameSync(LEGACY_FAVORITES_FILE, MIGRATED_FAVORITES_FILE);
    console.log("[Favorites Migration] Legacy favorites.json successfully migrated and archived.");
  } catch (err) {
    console.error("[Favorites Migration] Migration failed:", err.message);
  }
};

// Run migration on module load
migrateLegacyFavorites().catch((err) => {
  console.error("[Favorites Migration] Uncaught migration error:", err.message);
});

export default {
  getFavoriteProductIds,
  addFavorite,
  removeFavorite,
  isFavorited,
  migrateLegacyFavorites,
};
