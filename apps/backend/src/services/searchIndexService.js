import MiniSearch from "minisearch";
import { randomUUID } from "node:crypto";
import api from "../config/woocommerce.js";
import wp from "./wordpress.js";
import { logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";
import { getRedisClient, getRedisSubscriber, isRedisActive } from "../config/redis.js";
import { decodeHtmlEntities } from "../utils/textUtils.js";
import {
  normalizeUnicodeText,
  normalizeConnectors,
  tokenizeSearchText,
  parseSearchQuery,
  getTermFuzziness,
  getTermPrefix,
} from "../utils/searchNormalization.js";

const CATALOG_PRODUCT_FIELDS =
  "id,name,slug,price,regular_price,sale_price,on_sale,images,categories,stock_status,stock_quantity,manage_stock,backorders_allowed,average_rating,rating_count,catalog_visibility";

/**
 * Checks if a product has customer-facing search visibility in WooCommerce.
 * WooCommerce catalog_visibility values:
 * - 'visible': visible in both catalog and search (eligible)
 * - 'search': visible only in search (eligible)
 * - 'catalog': visible only in catalog, excluded from search (NOT eligible)
 * - 'hidden': hidden from both catalog and search (NOT eligible)
 */
export const isSearchVisible = (product) => {
  if (!product) return false;
  if (product.status && product.status !== "publish") return false;
  if (product.catalog_visibility) {
    return product.catalog_visibility === "visible" || product.catalog_visibility === "search";
  }
  return true;
};

export const createMiniSearchInstance = () => {
  return new MiniSearch({
    fields: ["sku", "title", "categories", "tags", "attributes", "short_description"],
    storeFields: ["id"],
    searchOptions: {
      boost: {
        sku: 8,
        title: 6,
        categories: 2.5,
        tags: 2.0,
        attributes: 1.8,
        short_description: 0.2,
      },
      prefix: (term, index, terms) => getTermPrefix(term, index, terms),
      fuzzy: (term) => getTermFuzziness(term),
      combineWith: "AND",
    },
    tokenize: (text) => tokenizeSearchText(text),
    processTerm: (term) => normalizeUnicodeText(term),
  });
};

/**
 * Transforms any raw product (from index-feed or WooCommerce API) into a compact search document.
 * Appends category ancestors if provided.
 */
export const transformProductToSearchDoc = (product, ancestorLookup = null) => {
  if (!product || !product.id) return null;
  if (!isSearchVisible(product)) return null;

  const rawTitle = decodeHtmlEntities(product.name || product.title || "");
  const sku = String(product.sku || "").trim();

  const categorySet = new Set();
  if (Array.isArray(product.categories)) {
    for (const c of product.categories) {
      const name = typeof c === "string" ? c : c?.name;
      if (name) categorySet.add(decodeHtmlEntities(name));

      // Append ancestors if category has ID and lookup map is available
      const catId = typeof c === "object" ? Number(c?.id) : null;
      if (catId && ancestorLookup?.has(catId)) {
        for (const ancestor of ancestorLookup.get(catId)) {
          categorySet.add(ancestor);
        }
      }
    }
  }

  const tagSet = new Set();
  if (Array.isArray(product.tags)) {
    for (const t of product.tags) {
      const name = typeof t === "string" ? t : t?.name;
      if (name) tagSet.add(decodeHtmlEntities(name));
    }
  }

  const attributeSet = new Set();
  if (Array.isArray(product.attributes)) {
    for (const attr of product.attributes) {
      if (typeof attr === "string") {
        attributeSet.add(decodeHtmlEntities(attr));
      } else if (attr && typeof attr === "object") {
        if (attr.name) attributeSet.add(decodeHtmlEntities(attr.name));
        if (Array.isArray(attr.options)) {
          for (const opt of attr.options) {
            if (opt) attributeSet.add(decodeHtmlEntities(String(opt)));
          }
        }
      }
    }
  }

  const shortDescription = decodeHtmlEntities(
    String(product.short_description || "")
      .replace(/<[^>]*>/g, " ")
      .trim()
  );

  const categories = [...categorySet].join(" ");
  const tags = [...tagSet].join(" ");
  const attributes = [...attributeSet].join(" ");

  return {
    id: Number(product.id),
    title: rawTitle,
    sku,
    categories,
    tags,
    attributes,
    short_description: shortDescription,
    normalizedTitle: normalizeConnectors(normalizeUnicodeText(rawTitle)),
    normalizedSku: normalizeConnectors(normalizeUnicodeText(sku)),
    normalizedCategories: normalizeConnectors(normalizeUnicodeText(categories)),
    normalizedAttributes: normalizeConnectors(normalizeUnicodeText(attributes)),
  };
};

/**
 * Secondary ranking calculation:
 * - SKU exact match: +2000
 * - Title exact match: +1500
 * - Title contains query phrase: +1000
 * - Title starts with query: +200
 * - Title token coverage: up to +150
 * - Category match bonus: up to +50
 * - Attribute match bonus: up to +40
 * - Accessory penalty if query specifies a product type missing from title
 */
export const scoreMatch = (doc, normalizedQuery, queryTerms) => {
  if (!doc) return 0;
  let score = 0;

  const title = doc.normalizedTitle || "";
  const sku = doc.normalizedSku || "";
  const categories = doc.normalizedCategories || "";
  const attributes = doc.normalizedAttributes || "";

  // 1. Exact SKU
  if (sku && (sku === normalizedQuery || sku === normalizedQuery.replace(/\s+/g, ""))) {
    score += 2000;
  }

  // 2. Exact Title
  if (title === normalizedQuery) {
    score += 1500;
  } else if (normalizedQuery.length > 2 && title.includes(normalizedQuery)) {
    score += 1000;
    if (title.startsWith(normalizedQuery)) {
      score += 200;
    }
  }

  // 3. Token coverage in Title
  let titleMatches = 0;
  let catMatches = 0;
  let attrMatches = 0;

  for (const term of queryTerms) {
    if (title.includes(term)) {
      titleMatches++;
    }
    if (categories.includes(term)) {
      catMatches++;
    }
    if (attributes.includes(term)) {
      attrMatches++;
    }
  }

  if (queryTerms.length > 0) {
    const titleRatio = titleMatches / queryTerms.length;
    score += titleRatio * 150;

    const catRatio = catMatches / queryTerms.length;
    score += catRatio * 50;

    const attrRatio = attrMatches / queryTerms.length;
    score += attrRatio * 40;
  }

  // 4. Accessory handling
  const hasAccessoryMention = title.includes(" with ") || title.includes(" included");
  if (hasAccessoryMention && titleMatches < queryTerms.length) {
    score -= 100;
  }

  return score;
};

class SearchIndexService {
  constructor() {
    this.instanceId = randomUUID();
    this.index = null;
    this.metadata = new Map();
    this.isBuilding = false;
    this.buildPromise = null;
    this.lastBuiltAt = 0;
    this.revision = 1;
    this.hasPendingDirty = false;
    this.reconcileTimer = null;
    this.dirtyTimer = null;
    this.subChannel = "mumbai:search:dirty:v1";
    // Distributed invalidation listener references (stored for cleanup in stop())
    this._messageHandler = null;
    this._readyHandler = null;
    // Mutation generation successfully incorporated into this instance's index.
    // Updated only after a successful buildIndex(); compared on reconnect to detect missed updates.
    this.lastIndexedMutationGen = 0;
    // Mutation generation last observed from Redis (may be ahead of lastIndexedMutationGen
    // if the rebuild triggered by that observation has not yet succeeded).
    this.lastObservedMutationGen = 0;
    // Set of known actual catalog SKUs and normalized SKUs
    this.knownSkus = new Set();
    // Lifecycle and failure tracking for exponential backoff retries
    this.isStopped = false;
    this.consecutiveFailures = 0;
    // Persistent rebuild flag: set on every mutation (or failed build), cleared only on successful build
    this.needsRebuild = false;
  }

  /**
   * Initializes the search index non-blockingly.
   */
  init() {
    this.isStopped = false;
    this.needsRebuild = true;
    this.buildIndex().catch((err) => {
      logger.error({ err: err?.message }, "[SearchIndex] Initial build failed");
    });
    this.setupPeriodicReconcile();
    this.setupDistributedInvalidation();
  }

  /**
   * Listens for search dirty notifications from peer backend instances over Redis.
   */
  setupDistributedInvalidation() {
    const sub = getRedisSubscriber();
    if (!sub) return;

    // Named message handler stored so it can be removed in stop()
    this._messageHandler = (channel, message) => {
      if (channel !== this.subChannel) return;
      try {
        const data = JSON.parse(message);
        if (data?.source && data.source === this.instanceId) return;
        if (data?.gen && Number(data.gen) > this.lastObservedMutationGen) {
          this.lastObservedMutationGen = Number(data.gen);
        }
        logger.info(
          { fromSource: data?.source, gen: data?.gen },
          "[SearchIndex] Received distributed dirty notification; scheduling index refresh"
        );
        this.markDirty(1000, false);
      } catch (err) {
        logger.warn({ err: err?.message }, "[SearchIndex] Failed to process distributed dirty message");
      }
    };

    // Named ready handler stored so it can be removed in stop()
    this._readyHandler = async () => {
      try {
        await sub.subscribe(this.subChannel);
        // On reconnect, check whether we missed mutation increments while disconnected.
        // Compare against lastIndexedMutationGen (not lastObservedMutationGen) so that
        // a previously failed rebuild does not hide the missed generation.
        const redis = getRedisClient();
        if (redis && isRedisActive()) {
          try {
            const currentMutGen = Number(await redis.get("mumbai:search:mutation_gen:v1")) || 0;
            if (currentMutGen > this.lastIndexedMutationGen) {
              logger.info(
                { lastIndexed: this.lastIndexedMutationGen, current: currentMutGen },
                "[SearchIndex] Missed mutation generations on reconnect; triggering rebuild"
              );
              // Record what we observed; lastIndexedMutationGen is set only after success
              this.lastObservedMutationGen = currentMutGen;
              this.markDirty(500, false);
            }
          } catch {
            // Redis read failed — trigger a precautionary rebuild
            this.markDirty(500, false);
          }
        }
      } catch (err) {
        logger.warn({ err: err?.message }, "[SearchIndex] Distributed invalidation subscription unavailable");
      }
    };

    sub.on("message", this._messageHandler);
    sub.on("ready", this._readyHandler);
    if (sub.status === "ready") void this._readyHandler();
  }

  /**
   * Stops background reconciliation and mutation debounce timers.
   */
  stop() {
    this.isStopped = true;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.dirtyTimer) {
      clearTimeout(this.dirtyTimer);
      this.dirtyTimer = null;
    }
    // Remove named Redis pub/sub listeners to prevent accumulation on reconnect
    const sub = getRedisSubscriber();
    if (sub) {
      if (this._messageHandler) {
        sub.removeListener("message", this._messageHandler);
        this._messageHandler = null;
      }
      if (this._readyHandler) {
        sub.removeListener("ready", this._readyHandler);
        this._readyHandler = null;
      }
    }
    logger.info("[SearchIndex] Stopped search index background timers and listeners");
  }

  /**
   * Periodic background reconciliation (every 15 minutes by default).
   */
  setupPeriodicReconcile(intervalMs = 15 * 60 * 1000) {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
    }
    this.reconcileTimer = setInterval(() => {
      this.buildIndex().catch((err) => {
        logger.warn({ err: err?.message }, "[SearchIndex] Periodic reconciliation failed");
      });
    }, intervalMs);
    if (this.reconcileTimer.unref) {
      this.reconcileTimer.unref();
    }
  }

  /**
   * Schedules a debounced rebuild when mutations occur and notifies peer instances via Redis.
   * If a build is currently in flight, records hasPendingDirty so a follow-up
   * rebuild is guaranteed to capture the change.
   */
  markDirty(delayMs = 2000, broadcast = true) {
    if (this.isStopped) return;

    // Persist dirty state across failures until a build successfully incorporates it
    this.needsRebuild = true;

    if (broadcast) {
      const redis = getRedisClient();
      if (redis && isRedisActive()) {
        // Increment shared mutation generation so peers can detect missed signals on reconnect.
        // Track the observed generation here; lastIndexedMutationGen is updated only
        // after buildIndex() succeeds, so a failed rebuild doesn't hide the pending update.
        redis.incr("mumbai:search:mutation_gen:v1").then((gen) => {
          const genNum = Number(gen);
          this.lastObservedMutationGen = Math.max(this.lastObservedMutationGen, genNum);
          redis
            .publish(this.subChannel, JSON.stringify({ source: this.instanceId, gen: genNum }))
            .catch(() => {});
        }).catch(() => {});
      }
    }

    if (this.isBuilding) {
      this.hasPendingDirty = true;
      return;
    }

    if (this.dirtyTimer) {
      clearTimeout(this.dirtyTimer);
    }
    this.dirtyTimer = setTimeout(() => {
      if (this.isStopped) return;
      this.buildIndex().catch((err) => {
        logger.warn({ err: err?.message }, "[SearchIndex] Dirty refresh failed");
      });
    }, delayMs);
  }

  /**
   * Loads complete category ancestor lookup map across all pages for Node fallback ingestion.
   * Explicitly rejects fallback builds if taxonomy loading fails.
   */
  async fetchCategoryAncestorMap() {
    const catMap = new Map();
    const parentMap = new Map();
    const perPage = 100;
    const MAX_CAT_PAGES = 25;

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      if (page > MAX_CAT_PAGES) {
        throw new Error(
          `WooCommerce category ancestor lookup exceeded safety ceiling of ${MAX_CAT_PAGES} pages; build rejected`
        );
      }

      const response = await api.get("products/categories", {
        per_page: perPage,
        page,
        hide_empty: false,
        _fields: "id,name,parent",
      });

      if (!Array.isArray(response?.data)) {
        throw new Error(`Invalid categories response structure at page ${page}`);
      }

      for (const c of response.data) {
        if (c?.id) {
          catMap.set(Number(c.id), decodeHtmlEntities(c.name || ""));
          parentMap.set(Number(c.id), Number(c.parent) || 0);
        }
      }

      const totalPages = parseInt(response.headers?.["x-wp-totalpages"], 10);
      if (Number.isFinite(totalPages)) {
        if (page >= totalPages) hasMore = false;
        else page++;
      } else {
        if (response.data.length < perPage) hasMore = false;
        else page++;
      }
    }

    const ancestorLookup = new Map();
    for (const [catId] of catMap) {
      const ancestors = [];
      let curr = catId;
      const visited = new Set();
      while (parentMap.get(curr) && !visited.has(curr)) {
        visited.add(curr);
        const parentId = parentMap.get(curr);
        if (catMap.has(parentId)) {
          ancestors.push(catMap.get(parentId));
        }
        curr = parentId;
      }
      ancestorLookup.set(catId, ancestors);
    }
    return ancestorLookup;
  }

  /**
   * Ingests published, search-visible products from WordPress index-feed or fallback.
   * Fetches every page with bounded concurrency and strictly rejects partial/failed builds.
   */
  async fetchCatalogDocuments() {
    // Attempt 1: Fast index-feed endpoint in custom WordPress plugin
    try {
      const firstPageRes = await wp.get("/wp-json/mumbai-auth/v1/catalog/index-feed", {
        params: { page: 1, per_page: 2000 },
        timeout: 10000,
      });

      if (firstPageRes?.data?.success && Array.isArray(firstPageRes.data.products)) {
        const allProducts = [...firstPageRes.data.products];
        const total = Number(firstPageRes.data.total) || allProducts.length;
        const totalPages = Number(firstPageRes.data.totalPages) || 1;
        const MAX_FEED_PAGES = 50;

        if (totalPages > 1) {
          const remainingPages = [];
          for (let p = 2; p <= Math.min(totalPages, MAX_FEED_PAGES); p++) {
            remainingPages.push(p);
          }

          const BATCH_CONCURRENCY = 2;
          for (let i = 0; i < remainingPages.length; i += BATCH_CONCURRENCY) {
            const pageBatch = remainingPages.slice(i, i + BATCH_CONCURRENCY);
            const settled = await Promise.allSettled(
              pageBatch.map((p) =>
                wp.get("/wp-json/mumbai-auth/v1/catalog/index-feed", {
                  params: { page: p, per_page: 2000 },
                  timeout: 10000,
                })
              )
            );

            for (const res of settled) {
              if (res.status === "rejected") {
                throw new Error(`Failed to fetch index-feed page: ${res.reason?.message}`);
              }
              const pageData = res.value?.data;
              if (!pageData?.success || !Array.isArray(pageData.products)) {
                throw new Error("Invalid index-feed page payload received");
              }
              allProducts.push(...pageData.products);
            }
          }
        }

        // Validate complete ingestion
        if (total > 0 && allProducts.length < total) {
          throw new Error(
            `Incomplete index-feed ingestion: received ${allProducts.length} of ${total} products`
          );
        }

        logger.info(
          { count: allProducts.length, total },
          "[SearchIndex] Ingested catalog from /catalog/index-feed"
        );
        return { products: allProducts, isFromFeed: true };
      }
    } catch (wpErr) {
      logger.warn(
        { err: wpErr?.message },
        "[SearchIndex] /catalog/index-feed unavailable; falling back to WooCommerce REST API"
      );
    }

    // Attempt 2: Bounded pagination via standard WooCommerce REST API
    const products = [];
    const perPage = 100;
    const BATCH_CONCURRENCY = 2;
    const MAX_PAGES = 100;
    let totalRawFetched = 0;

    const firstPage = await api.get("products", {
      status: "publish",
      page: 1,
      per_page: perPage,
      _fields: CATALOG_PRODUCT_FIELDS,
    });

    if (!Array.isArray(firstPage.data)) {
      throw new Error("Invalid WooCommerce products response during index build");
    }

    totalRawFetched += firstPage.data.length;
    products.push(...firstPage.data.filter(isSearchVisible));
    const reportedPages = parseInt(firstPage.headers?.["x-wp-totalpages"], 10);
    const reportedTotal = parseInt(firstPage.headers?.["x-wp-total"], 10);

    if (Number.isFinite(reportedPages) && reportedPages > 1) {
      if (reportedPages > MAX_PAGES) {
        throw new Error(
          `WooCommerce catalog size (${reportedPages} pages, ${reportedTotal || "unknown"} items) exceeds safety ceiling of ${MAX_PAGES} pages; build rejected to prevent partial indexing`
        );
      }

      // Total pages header present
      const remainingPages = [];
      for (let p = 2; p <= reportedPages; p++) {
        remainingPages.push(p);
      }

      for (let i = 0; i < remainingPages.length; i += BATCH_CONCURRENCY) {
        const batch = remainingPages.slice(i, i + BATCH_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map((p) =>
            api.get("products", {
              status: "publish",
              page: p,
              per_page: perPage,
              _fields: CATALOG_PRODUCT_FIELDS,
            })
          )
        );

        for (const res of settled) {
          if (res.status === "rejected") {
            // Reject incomplete build on failure to retain previous valid index
            throw new Error(`WooCommerce pagination request failed: ${res.reason?.message}`);
          }
          if (!Array.isArray(res.value?.data)) {
            throw new Error("Malformed WooCommerce products page received");
          }
          totalRawFetched += res.value.data.length;
          products.push(...res.value.data.filter(isSearchVisible));
        }
      }

      if (Number.isFinite(reportedTotal) && reportedTotal > 0 && totalRawFetched < reportedTotal) {
        throw new Error(
          `Incomplete WooCommerce fallback ingestion: fetched ${totalRawFetched} raw products of ${reportedTotal} reported`
        );
      }
    } else if (firstPage.data.length === perPage) {
      // Total pages header stripped: paginate sequentially until end of catalog
      let currentPage = 2;
      let hasMore = true;

      while (hasMore) {
        if (currentPage > MAX_PAGES) {
          throw new Error(
            `WooCommerce sequential pagination exceeded safety ceiling of ${MAX_PAGES} pages without reaching confirmed end; build rejected`
          );
        }

        try {
          const res = await api.get("products", {
            status: "publish",
            page: currentPage,
            per_page: perPage,
            _fields: CATALOG_PRODUCT_FIELDS,
          });

          if (!Array.isArray(res.data)) {
            throw new Error("Malformed WooCommerce products page received");
          }
          totalRawFetched += res.data.length;
          products.push(...res.data.filter(isSearchVisible));
          if (res.data.length < perPage) {
            hasMore = false;
          } else {
            currentPage++;
          }
        } catch (pageErr) {
          const status = pageErr?.response?.status;
          const errCode = pageErr?.response?.data?.code;
          if (
            status === 400 &&
            (errCode === "rest_post_invalid_page_number" || String(errCode).includes("invalid_page_number"))
          ) {
            // Specifically confirmed end of pages
            hasMore = false;
          } else {
            throw new Error(
              `WooCommerce pagination failed at page ${currentPage}: ${pageErr?.message || pageErr}`
            );
          }
        }
      }

      if (Number.isFinite(reportedTotal) && reportedTotal > 0 && totalRawFetched < reportedTotal) {
        throw new Error(
          `Incomplete WooCommerce sequential fallback ingestion: fetched ${totalRawFetched} raw products of ${reportedTotal} reported`
        );
      }
    }

    const ancestorLookup = await this.fetchCategoryAncestorMap();
    return { products, isFromFeed: false, ancestorLookup };
  }

  /**
   * Builds the search index.
   * Single-flight deduplicated, isolated build, atomic swap on success.
   * On failure, retains the existing valid index.
   */
  async buildIndex() {
    if (this.isStopped) {
      return Promise.resolve({ count: this.metadata.size, revision: this.revision });
    }
    if (this.isBuilding) {
      return this.buildPromise;
    }

    this.isBuilding = true;
    let buildSucceeded = false;
    this.buildPromise = (async () => {
      const startTime = Date.now();
      try {
        // Capture the target mutation generation BEFORE fetching documents from upstream.
        let targetMutationGen = this.lastObservedMutationGen;
        const redis = getRedisClient();
        if (redis && isRedisActive()) {
          try {
            const redisGen = Number(await redis.get("mumbai:search:mutation_gen:v1")) || 0;
            targetMutationGen = Math.max(targetMutationGen, redisGen);
            this.lastObservedMutationGen = Math.max(this.lastObservedMutationGen, targetMutationGen);
          } catch {
            // retain existing targetMutationGen
          }
        }

        const fetched = await this.fetchCatalogDocuments();
        const rawProducts = Array.isArray(fetched) ? fetched : (fetched?.products || []);
        const ancestorLookup = fetched?.ancestorLookup || null;
        const newIndex = createMiniSearchInstance();
        const newMetadata = new Map();
        const newKnownSkus = new Set();

        const docs = [];
        for (const raw of rawProducts) {
          const doc = transformProductToSearchDoc(raw, ancestorLookup);
          if (doc && doc.id) {
            docs.push(doc);
            newMetadata.set(doc.id, doc);
            if (doc.sku) {
              newKnownSkus.add(doc.sku.toLowerCase());
              if (doc.normalizedSku) {
                newKnownSkus.add(doc.normalizedSku);
              }
            }
          }
        }

        // Refuse to swap healthy non-empty index with empty catalog
        if (docs.length === 0 && this.metadata.size > 0) {
          throw new Error(
            `Ingestion returned 0 products while previous index contained ${this.metadata.size} products; build rejected to protect index`
          );
        }

        if (docs.length > 0) {
          await newIndex.addAllAsync(docs);
        }

        // ATOMIC SWAP
        this.index = newIndex;
        this.metadata = newMetadata;
        this.knownSkus = newKnownSkus;
        this.lastBuiltAt = Date.now();

        // Increment revision and sync to shared Redis catalog generation if active
        if (redis && isRedisActive()) {
          try {
            const sharedGen = await redis.incr("mumbai:search:catalog_generation:v1");
            this.revision = Number(sharedGen);
          } catch {
            this.revision++;
          }
        } else {
          this.revision++;
        }

        // Commit ONLY the target generation captured before fetching documents.
        // If a newer generation arrived during the build, targetMutationGen < this.lastObservedMutationGen,
        // and the check in finally ensures the follow-up build indexes the newer generation.
        this.lastIndexedMutationGen = Math.max(this.lastIndexedMutationGen, targetMutationGen);

        // Reset consecutive failure counter on successful build
        this.consecutiveFailures = 0;
        buildSucceeded = true;

        // Clear persistent rebuild flag if no mutations arrived during this build
        if (!this.hasPendingDirty && !(this.lastObservedMutationGen > targetMutationGen)) {
          this.needsRebuild = false;
        }

        // Invalidate cached search responses after new index replacement
        serverCache.invalidatePrefix("catalog:search:");

        logger.info(
          {
            indexedDocs: docs.length,
            durationMs: Date.now() - startTime,
            revision: this.revision,
          },
          "[SearchIndex] Catalog search index successfully built and swapped"
        );

        return { count: docs.length, revision: this.revision };
      } catch (buildErr) {
        this.consecutiveFailures++;
        logger.error(
          { err: buildErr?.message, consecutiveFailures: this.consecutiveFailures },
          "[SearchIndex] Ingestion failed: retaining existing valid index"
        );
        throw buildErr;
      } finally {
        this.isBuilding = false;
        this.buildPromise = null;

        // Prevent scheduling retries after stop()
        if (
          !this.isStopped &&
          (this.needsRebuild || this.hasPendingDirty || this.lastObservedMutationGen > this.lastIndexedMutationGen)
        ) {
          this.hasPendingDirty = false;
          let delayMs = 1000;
          if (!buildSucceeded) {
            // Exponential backoff with jitter on failure: 2s, 4s, 8s... up to 60s
            // e.g. failure 1: ~2-3s, failure 2: ~4-5s, failure 3: ~8-9s, ..., max 60s
            const baseBackoff = Math.min(60000, 2000 * Math.pow(2, Math.max(0, this.consecutiveFailures - 1)));
            const jitter = Math.floor(Math.random() * 1000);
            delayMs = Math.min(60000, baseBackoff + jitter);
            logger.warn(
              { failureCount: this.consecutiveFailures, retryDelayMs: delayMs },
              "[SearchIndex] Scheduling failed rebuild retry with exponential backoff"
            );
          }
          this.markDirty(delayMs, false);
        }
      }
    })();

    return this.buildPromise;
  }

  /**
   * Builds search index directly from provided fixture documents (for unit tests).
   */
  buildFromFixtures(fixtures = []) {
    const newIndex = createMiniSearchInstance();
    const newMetadata = new Map();
    const newKnownSkus = new Set();
    const docs = [];

    for (const raw of fixtures) {
      const doc = transformProductToSearchDoc(raw);
      if (doc && doc.id) {
        docs.push(doc);
        newMetadata.set(doc.id, doc);
        if (doc.sku) {
          newKnownSkus.add(doc.sku.toLowerCase());
          if (doc.normalizedSku) {
            newKnownSkus.add(doc.normalizedSku);
          }
        }
      }
    }

    newIndex.addAll(docs);
    this.index = newIndex;
    this.metadata = newMetadata;
    this.knownSkus = newKnownSkus;
    this.lastBuiltAt = Date.now();
    this.revision++;
    this.needsRebuild = false;
    this.hasPendingDirty = false;
    this.consecutiveFailures = 0;
    return { count: docs.length, revision: this.revision };
  }

  /**
   * Evaluates whether a candidate document satisfies required age constraints.
   * E.g. "monster truck 4+" requires matching 4+, and rejects products marked only 3+.
   */
  satisfiesAgeConstraints(doc, requiredAges = []) {
    if (!requiredAges || requiredAges.length === 0) return true;
    const fullText = `${doc.title} ${doc.attributes} ${doc.short_description}`.toLowerCase();

    for (const age of requiredAges) {
      const num = age.replace("+", "");
      const ageRegex = new RegExp(
        `\\b${num}\\s*(?:\\+|plus|yr|yrs|year|years)\\b|\\b${num}\\+`,
        "i"
      );
      if (!ageRegex.test(fullText)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluates whether a candidate document satisfies required numeric constraints.
   * E.g. "iPhone 15" requires matching "15" in title, SKU, or attributes.
   */
  satisfiesNumericConstraints(doc, numericTokens = []) {
    if (!numericTokens || numericTokens.length === 0) return true;
    const fullText = `${doc.title} ${doc.sku} ${doc.attributes} ${doc.short_description}`.toLowerCase();
    for (const num of numericTokens) {
      const numRegex = new RegExp(`\\b${num}\\b`, "i");
      if (!numRegex.test(fullText)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluates whether a candidate document satisfies required SKU identity constraints.
   * If the search query explicitly matches a SKU pattern (e.g. "CBL-TC-02"), candidates must match
   * that exact SKU or its normalized variant.
   */
  satisfiesSkuConstraints(doc, requiredSkus = [], isExplicitSkuQuery = false) {
    if (!requiredSkus || requiredSkus.length === 0) return true;
    const docSku = (doc.sku || "").toLowerCase();
    const docNormSku = (doc.normalizedSku || "").toLowerCase();

    for (const reqSku of requiredSkus) {
      const cleanReq = reqSku.toLowerCase();
      const normReq = cleanReq.replace(/-/g, "");
      // Use strict equality only: includes() allows longer SKUs containing the queried code to pass
      const matchesDoc = docSku === cleanReq || docNormSku === normReq;
      if (isExplicitSkuQuery && !matchesDoc) {
        return false;
      }
    }
    return true;
  }

  /**
   * Core ranking algorithm. Searches index and calculates secondary scores.
   */
  rankMatchingIds(query) {
    if (!this.index) {
      return [];
    }

    const { normalizedQuery, terms, requiredAges, requiredSkus, numericTokens } = parseSearchQuery(query, this.knownSkus);
    if (!terms || terms.length === 0) {
      return [];
    }

    // Detect SKU intent from whether parseSearchQuery extracted any SKU tokens
    // (it only does so when the raw token matches the SKU regex), not from normalized term count.
    const isExplicitSkuQuery = Array.isArray(requiredSkus) && requiredSkus.length > 0;

    const candidateMap = new Map();
    const searchOptions = {
      fuzzy: (term) => getTermFuzziness(term, requiredSkus),
      prefix: (term, index, tList) => getTermPrefix(term, index, tList, requiredSkus),
    };

    // 1. Primary search with MiniSearch
    try {
      const primaryResults = this.index.search(normalizedQuery, searchOptions);
      for (const res of primaryResults) {
        candidateMap.set(res.id, res.score);
      }
    } catch (err) {
      logger.warn({ err: err?.message, query }, "[SearchIndex] Primary MiniSearch failed");
    }

    // 2. Search synonym variants
    const variants = [];
    if (normalizedQuery.includes("remote control")) {
      variants.push(normalizedQuery.replace(/remote\s+control/g, "rc"));
    }
    if (/\brc\b/.test(normalizedQuery)) {
      variants.push(normalizedQuery.replace(/\brc\b/g, "remote control"));
    }
    if (normalizedQuery.includes("flash drive")) {
      variants.push(normalizedQuery.replace(/flash\s+drive/g, "pendrive"));
    }
    if (normalizedQuery.includes("pendrive")) {
      variants.push(normalizedQuery.replace(/pendrive/g, "flash drive"));
    }

    for (const variant of variants) {
      try {
        const variantResults = this.index.search(variant, searchOptions);
        for (const res of variantResults) {
          const prev = candidateMap.get(res.id) || 0;
          candidateMap.set(res.id, Math.max(prev, res.score * 0.95));
        }
      } catch {
        // ignore variant search failure
      }
    }

    // 3. Fallback: if combineWith: 'AND' matched 0 results, try combining with 'OR'
    // but only keep results matching at least 60% of terms AND satisfying constraints
    if (candidateMap.size === 0 && terms.length > 1) {
      try {
        const orResults = this.index.search(normalizedQuery, {
          ...searchOptions,
          combineWith: "OR",
        });
        for (const res of orResults) {
          const doc = this.metadata.get(res.id);
          if (doc) {
            let matched = 0;
            const fullText = `${doc.normalizedTitle} ${doc.normalizedCategories} ${doc.normalizedAttributes}`;
            for (const t of terms) {
              if (fullText.includes(t)) matched++;
            }
            if (matched >= Math.ceil(terms.length * 0.6)) {
              candidateMap.set(res.id, res.score * 0.5);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 4. Secondary ranking and strict constraint enforcement
    const ranked = [];
    for (const [id, miniScore] of candidateMap.entries()) {
      const doc = this.metadata.get(id);
      if (!doc) continue;

      // Strict age constraint enforcement across all branches
      if (!this.satisfiesAgeConstraints(doc, requiredAges)) {
        continue;
      }

      // Strict numeric constraint enforcement
      if (!this.satisfiesNumericConstraints(doc, numericTokens)) {
        continue;
      }

      // Strict SKU identity enforcement
      if (!this.satisfiesSkuConstraints(doc, requiredSkus, isExplicitSkuQuery)) {
        continue;
      }

      const secondary = scoreMatch(doc, normalizedQuery, terms);
      let totalScore = miniScore * 10 + secondary;

      // Exact SKU boost
      if (requiredSkus?.length > 0) {
        for (const reqSku of requiredSkus) {
          if (doc.normalizedSku === reqSku.replace(/-/g, "") || doc.sku.toLowerCase() === reqSku) {
            totalScore += 3000;
          }
        }
      }

      if (totalScore > 0) {
        ranked.push({ id, score: totalScore });
      }
    }

    ranked.sort((a, b) => b.score - a.score || a.id - b.id);
    return ranked.map((r) => r.id);
  }

  /**
   * Public search API with bounded pagination, ordered hydration, and automatic refilling.
   */
  async search(query, { page = 1, per_page = 20 } = {}) {
    const pageNum = Math.max(1, Number(page) || 1);
    const perPageNum = Math.min(100, Math.max(1, Number(per_page) || 20));

    // Handle cold start: if index is not ready, wait briefly for in-flight build
    if (!this.index && this.isBuilding && this.buildPromise) {
      try {
        await Promise.race([
          this.buildPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Index build timeout")), 2500)
          ),
        ]);
      } catch (timeoutErr) {
        logger.warn(
          { err: timeoutErr?.message },
          "[SearchIndex] Timed out waiting for index warming"
        );
      }
    }

    if (!this.index) {
      const error = new Error("Search index is warming up. Please retry shortly.");
      error.status = 503;
      error.code = "SEARCH_INDEX_WARMING_UP";
      throw error;
    }

    let allMatchingIds = this.rankMatchingIds(query);
    const startIndex = (pageNum - 1) * perPageNum;

    if (startIndex >= allMatchingIds.length) {
      return {
        products: [],
        total: allMatchingIds.length,
        totalPages: allMatchingIds.length > 0 ? Math.ceil(allMatchingIds.length / perPageNum) : 0,
        page: pageNum,
        per_page: perPageNum,
      };
    }

    // Hydrate with automatic refilling for deleted or search-hidden products
    const hydratedProducts = [];
    let currentCursor = startIndex;
    let refillBatchCount = 0;
    const MAX_REFILL_BATCHES = 5;

    while (
      hydratedProducts.length < perPageNum &&
      currentCursor < allMatchingIds.length &&
      refillBatchCount < MAX_REFILL_BATCHES
    ) {
      refillBatchCount++;
      const needed = perPageNum - hydratedProducts.length;
      const batchIds = allMatchingIds.slice(currentCursor, currentCursor + needed);
      if (batchIds.length === 0) break;

      const hydratedResponse = await api.get("products", {
        status: "publish",
        include: batchIds.join(","),
        per_page: batchIds.length,
        _fields: CATALOG_PRODUCT_FIELDS,
      });

      if (!Array.isArray(hydratedResponse?.data)) {
        throw new Error("Invalid WooCommerce products response structure during search hydration");
      }

      const returnedMap = new Map();
      for (const p of hydratedResponse.data) {
        if (isSearchVisible(p)) {
          returnedMap.set(Number(p.id), p);
        }
      }

      // Preserve ranked order and identify pruned IDs
      for (const expectedId of batchIds) {
        if (returnedMap.has(expectedId)) {
          hydratedProducts.push(returnedMap.get(expectedId));
          currentCursor++;
        } else {
          // Stale / deleted / hidden: prune from index and remaining IDs
          this.removeProduct(expectedId);
          allMatchingIds = allMatchingIds.filter((id) => id !== expectedId);
          // Do not increment currentCursor since this element was removed from allMatchingIds
        }
      }
    }

    // Refill pagination safety check: if candidate IDs remain unhydrated after budget
    // and the page is underfilled (any shortfall, not just fully empty), throw 503 to prevent false partial page
    if (
      hydratedProducts.length < perPageNum &&
      currentCursor < allMatchingIds.length
    ) {
      const error = new Error("Search index is currently reconciling catalog changes. Please retry shortly.");
      error.status = 503;
      error.code = "SEARCH_PAGE_RECONCILING";
      throw error;
    }

    const total = allMatchingIds.length;
    const totalPages = total > 0 ? Math.ceil(total / perPageNum) : 0;

    return {
      products: hydratedProducts,
      total,
      totalPages,
      page: pageNum,
      per_page: perPageNum,
    };
  }

  /**
   * Incrementally updates or inserts a product into the index.
   */
  upsertProduct(product) {
    if (!this.index || !product || !product.id) return;
    if (!isSearchVisible(product)) {
      this.removeProduct(product.id);
      return;
    }

    const doc = transformProductToSearchDoc(product);
    if (!doc) return;

    if (this.index.has(doc.id)) {
      this.index.replace(doc);
    } else {
      this.index.add(doc);
    }
    this.metadata.set(doc.id, doc);
    if (doc.sku) {
      this.knownSkus.add(doc.sku.toLowerCase());
      if (doc.normalizedSku) {
        this.knownSkus.add(doc.normalizedSku);
      }
    }
  }

  /**
   * Removes a product from the index.
   */
  removeProduct(productId) {
    if (!this.index || !productId) return;
    const id = Number(productId);
    const doc = this.metadata.get(id);
    if (doc?.sku) {
      this.knownSkus.delete(doc.sku.toLowerCase());
      if (doc.normalizedSku) {
        this.knownSkus.delete(doc.normalizedSku);
      }
    }
    if (this.index.has(id)) {
      this.index.discard(id);
    }
    this.metadata.delete(id);
  }
}

export const searchIndexService = new SearchIndexService();
export default searchIndexService;
