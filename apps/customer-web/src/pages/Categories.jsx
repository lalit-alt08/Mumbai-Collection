import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCachedCategories, getCategories } from "../services/productService.js";
import { getCategoryImageUrl } from "../utils/categoryImage.js";
import { useCart } from "../context/CartContext";
import { triggerHaptic } from "../utils/haptics";
import { AlertCircle, ArrowLeft, ArrowRight, ChevronRight, ChevronLeft, ShoppingCart } from "lucide-react";

const CATEGORY_PAGE_SIZE = 24;
let cachedVisibleCategoryCount = CATEGORY_PAGE_SIZE;

const SESSION_SCROLL_KEY = "mc_categories_scroll_session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle expiration

function getSavedSessionScroll() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_SCROLL_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.scrollY !== "number") return null;
    if (Date.now() - (data.timestamp || 0) > SESSION_TIMEOUT_MS) {
      sessionStorage.removeItem(SESSION_SCROLL_KEY);
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

function Categories() {
  const navigate = useNavigate();
  const { cart } = useCart();
  const totalCartCount =
    cart?.items?.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0
    ) || 0;
  const [categories, setCategories] = useState(() => {
    const cachedCategories = getCachedCategories();
    return Array.isArray(cachedCategories) ? cachedCategories : [];
  });
  const [loading, setLoading] = useState(() => categories.length === 0);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const hasCachedCategoriesRef = useRef(categories.length > 0);
  const savedSessionRef = useRef(getSavedSessionScroll());
  const hasRestoredScrollRef = useRef(false);
  const [visibleCategoryCount, setVisibleCategoryCount] = useState(() => {
    const savedCount = savedSessionRef.current?.visibleCount;
    if (typeof savedCount === "number" && savedCount > cachedVisibleCategoryCount) {
      return savedCount;
    }
    return cachedVisibleCategoryCount;
  });
  const sentinelRef = useRef(null);
  const supportsAutoLoad = typeof window !== "undefined" && "IntersectionObserver" in window;

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

  // Restore scroll position within the active session once categories are ready
  useEffect(() => {
    if (hasRestoredScrollRef.current) return;
    const targetY = savedSessionRef.current?.scrollY;
    if (typeof targetY === "number" && targetY > 0 && displayCategories.length > 0) {
      hasRestoredScrollRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
        });
      });
    }
  }, [displayCategories]);

  // Continuously record scroll position and timestamp in sessionStorage for the active session
  useEffect(() => {
    let ticking = false;
    const savePosition = () => {
      if (window.scrollY > 0) {
        try {
          sessionStorage.setItem(
            SESSION_SCROLL_KEY,
            JSON.stringify({
              scrollY: Math.round(window.scrollY),
              visibleCount: cachedVisibleCategoryCount,
              timestamp: Date.now(),
            })
          );
        } catch (_) {}
      }
    };

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          savePosition();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      savePosition();
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Silent incremental prefetching for all categories as user scrolls
  useEffect(() => {
    cachedVisibleCategoryCount = visibleCategoryCount;
    if (!supportsAutoLoad || visibleCategoryCount >= displayCategories.length) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCategoryCount((count) => Math.min(count + CATEGORY_PAGE_SIZE, displayCategories.length));
        }
      },
      { rootMargin: "600px 0px" }
    );

    const target = sentinelRef.current;
    if (target) observer.observe(target);
    return () => {
      if (target) observer.unobserve(target);
      observer.disconnect();
    };
  }, [supportsAutoLoad, visibleCategoryCount, displayCategories.length]);

  return (
    <div className="min-h-screen bg-[#F0F8E8] text-white px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-4xl space-y-4 sm:space-y-5">
        {/* ────────────────────────────────────────────────────────── */}
        {/* TOP BAR / NAVIGATION                                       */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2.5 sm:gap-3">
          {/* Left: Circular Back Button */}
          <button
            onClick={() => {
              triggerHaptic("light");
              navigate(-1);
            }}
            aria-label="Back"
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#22499F] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={23} strokeWidth={2.5} />
          </button>

          {/* Center: Capsule utilizing available space with full descender clearance */}
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-full bg-[#FFFFFF]/95 backdrop-blur-md border border-[#E2E8F0] px-5 sm:px-7 py-2.5 sm:py-3 min-h-[48px] sm:min-h-[52px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.3)]">
            <span className="text-[19px] sm:text-[20px] font-extrabold text-[#1E293B] tracking-[-0.01em] leading-normal antialiased select-none">
              Categories
            </span>
          </div>

          {/* Right: Circular Cart Button with Live Item Badge */}
          <Link
            to="/cart"
            onClick={() => triggerHaptic("light")}
            aria-label="Shopping Cart"
            className="relative flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#22499F] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 hover:text-white active:scale-95 cursor-pointer"
          >
            <ShoppingCart size={21} strokeWidth={2.2} />
            {totalCartCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[#22499F] px-1 text-[9px] font-black text-[#FFFFFF] shadow-sm ring-2 ring-[#F0F8E8]">
                {totalCartCount > 99 ? "99+" : totalCartCount}
              </span>
            )}
          </Link>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* COMPACT CATEGORY BANNER STRIP                               */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-xl sm:rounded-2xl border border-[#E2E8F0] bg-gradient-to-r from-[#22499F] to-[#1B3B82] px-4 py-3.5 sm:px-5 sm:py-4 text-white shadow-sm">
          <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[#22499F]/15 blur-xl" />

          <div className="relative z-10 space-y-0.5">
            <h2 className="text-base sm:text-lg md:text-xl font-bold tracking-normal text-white">
              Explore Collections
            </h2>
            <p className="text-xs sm:text-sm font-medium text-[#FFFFFF]">
              Find toys, stationery & everyday essentials.
            </p>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* 2-COLUMN OPTIMIZED CATEGORY GRID                           */}
        {/* ────────────────────────────────────────────────────────── */}
        {loadError && categories.length === 0 ? (
          <div className="rounded-[20px] border border-amber-400/40 bg-[#FFFFFF] p-7 text-center">
            <AlertCircle className="mx-auto mb-2 text-amber-300" size={24} />
            <p className="text-sm font-semibold text-[#334155]">{loadError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="mt-4 rounded-full border border-[#22499F]/60 px-5 py-2 text-sm font-extrabold text-[#22499F]"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="aspect-[0.78] animate-pulse rounded-[22px] border border-[#E2E8F0]/60 bg-[#FFFFFF]" />
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
                className="group relative flex flex-col overflow-hidden rounded-[22px] bg-[#FFFFFF] p-3 sm:p-4 border border-[#E2E8F0]/80 shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-300 hover:-translate-y-1 hover:border-[#22499F]/60 hover:shadow-[0_12px_32px_rgba(66,214,232,0.15)] active:scale-[0.98]"
              >
                {/* Category Image Viewport */}
                <div className="relative aspect-square w-full overflow-hidden rounded-[18px] bg-[#F0F8E8] border border-[#E2E8F0]">
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
                      <h3 className="text-sm sm:text-base font-bold tracking-normal text-[#1E293B] group-hover:text-[#22499F] transition-colors truncate">
                        {category.name}
                      </h3>
                      <ChevronRight
                        size={15}
                        className="text-[#64748B] group-hover:text-[#22499F] group-hover:translate-x-0.5 transition-all shrink-0"
                      />
                    </div>

                    <p className="text-xs font-semibold text-[#64748B] mt-0.5 line-clamp-1">
                      {meta.subtitle}
                    </p>

                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-xl bg-[#FFFFFF] px-3 py-1.5 text-xs font-extrabold text-[#22499F] group-hover:bg-[#22499F] group-hover:text-[#FFFFFF] transition-colors">
                    <span>View items</span>
                    <ArrowRight size={13} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        )}

        {!loading && displayCategories.length > 0 && visibleCategoryCount < displayCategories.length && (
          <div className="flex flex-col items-center gap-2 pt-3 pb-4">
            {supportsAutoLoad ? (
              <div ref={sentinelRef} className="h-10 flex items-center justify-center" aria-live="polite">
                <span className="text-xs font-medium text-[#64748B] animate-pulse">
                  Loading more categories...
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setVisibleCategoryCount((count) =>
                    Math.min(count + CATEGORY_PAGE_SIZE, displayCategories.length)
                  )
                }
                className="rounded-full border border-[#22499F]/60 px-5 py-2 text-xs font-extrabold text-[#22499F] transition hover:bg-[#FFFFFF]"
              >
                Show more categories
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Categories;
