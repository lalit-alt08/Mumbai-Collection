import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCachedCategories, getCategories } from "../services/productService.js";
import { getCategoryImageUrl } from "../utils/categoryImage.js";
import { AlertCircle, ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";

const CATEGORY_PAGE_SIZE = 24;

function Categories() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState(() => {
    const cachedCategories = getCachedCategories();
    return Array.isArray(cachedCategories) ? cachedCategories : [];
  });
  const [loading, setLoading] = useState(() => categories.length === 0);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const hasCachedCategoriesRef = useRef(categories.length > 0);
  const [visibleCategoryCount, setVisibleCategoryCount] = useState(CATEGORY_PAGE_SIZE);

  // Category subtitles / highlights for rich cards
  const categoryMeta = {
    17: {
      subtitle: "Learning & fun toys",
      accent: "from-[#0A1D15] to-[#0E261D]",
    },
    18: {
      subtitle: "Pens, art & office supplies",
      accent: "from-[#0C241B] to-[#102E23]",
    },
    19: {
      subtitle: "Audio, cables & accessories",
      accent: "from-[#0E281F] to-[#143B2E]",
    },
  };

  useEffect(() => {
    let isMounted = true;
    const loadCategories = async () => {
      try {
        setLoadError("");
        if (!hasCachedCategoriesRef.current) setLoading(true);
        const liveData = await getCategories();
        if (isMounted && Array.isArray(liveData)) {
          setCategories(liveData);
          hasCachedCategoriesRef.current = true;
        }
      } catch {
        if (isMounted) setLoadError("Categories could not be loaded. Check your connection and try again.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadCategories();
    return () => {
      isMounted = false;
    };
  }, [reloadKey]);

  // Filter out system "Uncategorized", subcategories, and empty categories (count === 0) from top-level customer browsing
  const displayCategories = useMemo(() => {
    const hasCountData = categories.some((category) => category?.count !== undefined && category?.count !== null);
    const populatedRootIds = new Set();

    if (hasCountData) {
      const categoryById = new Map(categories.filter((category) => category?.id).map((category) => [Number(category.id), category]));
      for (const category of categories) {
        if (!category?.id || !Number.isFinite(Number(category.count)) || Number(category.count) <= 0) continue;
        let current = category;
        const visited = new Set();
        while (current?.id && !visited.has(Number(current.id))) {
          const currentId = Number(current.id);
          visited.add(currentId);
          const parentId = Number(current.parent) || 0;
          if (parentId <= 0) {
            populatedRootIds.add(currentId);
            break;
          }
          current = categoryById.get(parentId);
        }
      }
    }

    return categories.filter(
      (c) =>
        c &&
        (!c.parent || Number(c.parent) === 0) &&
        c.slug?.toLowerCase() !== "uncategorized" &&
        c.name?.toLowerCase() !== "uncategorized" &&
        (!hasCountData || populatedRootIds.has(Number(c.id)))
    );
  }, [categories]);

  return (
    <div className="min-h-screen bg-[#0B1425] text-white px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-4xl space-y-4 sm:space-y-5">
        {/* ────────────────────────────────────────────────────────── */}
        {/* COMPACT TOP BAR                                            */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            aria-label="Back to Home"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111F36] text-white shadow-xs border border-[#1E3252] transition-all hover:border-[#42D6E8] hover:bg-[#162744] hover:text-[#42D6E8] active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={17} strokeWidth={2.4} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
            Categories
          </h1>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* COMPACT CATEGORY BANNER STRIP                               */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-xl sm:rounded-2xl border border-[#22446B] bg-gradient-to-r from-[#0D1C34] via-[#102444] to-[#162D52] px-4 py-3.5 sm:px-5 sm:py-4 shadow-sm">
          <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[#42D6E8]/15 blur-xl" />

          <div className="relative z-10 space-y-0.5">
            <h2 className="text-base sm:text-lg md:text-xl font-bold tracking-normal text-white">
              Explore Collections
            </h2>
            <p className="text-xs sm:text-sm font-medium text-[#C8D9ED]">
              Find toys, stationery & everyday essentials.
            </p>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* 2-COLUMN OPTIMIZED CATEGORY GRID                           */}
        {/* ────────────────────────────────────────────────────────── */}
        {loadError && categories.length === 0 ? (
          <div className="rounded-[20px] border border-amber-400/40 bg-[#111F36] p-7 text-center">
            <AlertCircle className="mx-auto mb-2 text-amber-300" size={24} />
            <p className="text-sm font-semibold text-[#D8E5F3]">{loadError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="mt-4 rounded-full border border-[#42D6E8]/60 px-5 py-2 text-sm font-extrabold text-[#67E8F9]"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="aspect-[0.78] animate-pulse rounded-[22px] border border-[#1E3252]/60 bg-[#111F36]" />
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {displayCategories.slice(0, visibleCategoryCount).map((category) => {
            const meta = categoryMeta[category.id] || {
              subtitle: "Explore collection",
              accent: "from-[#0A1D15] to-[#0E261D]",
            };

            const imageUrl = getCategoryImageUrl(category);
            const linkUrl = category.link || `/category/${category.id || category.slug}`;

            return (
              <Link
                key={category.id}
                to={linkUrl}
                className="group relative flex flex-col overflow-hidden rounded-[22px] bg-[#111F36] p-3 sm:p-4 border border-[#1E3252]/80 shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-300 hover:-translate-y-1 hover:border-[#42D6E8]/60 hover:shadow-[0_12px_32px_rgba(66,214,232,0.15)] active:scale-[0.98]"
              >
                {/* Category Image Viewport */}
                <div className="relative aspect-square w-full overflow-hidden rounded-[18px] bg-[#080F1C] border border-[#1E3252]">
                  <img
                    src={imageUrl}
                    alt={category.name}
                    width="480"
                    height="480"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                  />

                </div>

                {/* Content */}
                <div className="mt-3 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <h3 className="text-sm sm:text-base font-bold tracking-normal text-white group-hover:text-[#42D6E8] transition-colors truncate">
                        {category.name}
                      </h3>
                      <ChevronRight
                        size={15}
                        className="text-[#6E84A3] group-hover:text-[#42D6E8] group-hover:translate-x-0.5 transition-all shrink-0"
                      />
                    </div>

                    <p className="text-xs font-semibold text-[#8FA4BE] mt-0.5 line-clamp-1">
                      {meta.subtitle}
                    </p>

                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-xl bg-[#132B45] px-3 py-1.5 text-xs font-extrabold text-[#42D6E8] group-hover:bg-[#42D6E8] group-hover:text-[#061220] transition-colors">
                    <span>View items</span>
                    <ArrowRight size={13} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        )}

        {!loading && displayCategories.length > 0 && (
          <div className="flex flex-col items-center gap-2 pt-1">
            <p className="text-xs font-medium text-[#8FA4BE]">
              Showing {Math.min(visibleCategoryCount, displayCategories.length)} of {displayCategories.length} categories
            </p>
            {visibleCategoryCount < displayCategories.length && (
              <button
                type="button"
                onClick={() => setVisibleCategoryCount((current) => current + CATEGORY_PAGE_SIZE)}
                className="rounded-xl border border-[#1E3252] bg-[#111F36] px-5 py-2.5 text-sm font-bold text-[#42D6E8] transition hover:border-[#42D6E8]/60 hover:bg-[#162744] active:scale-[0.98]"
              >
                Load more categories
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Categories;
