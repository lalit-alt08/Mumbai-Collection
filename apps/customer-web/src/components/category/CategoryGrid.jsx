import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import CategoryCard from "./CategoryCard";
import { ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { triggerHaptic } from "../../utils/haptics";

const HOME_CATEGORY_PREVIEW_LIMIT = 12;
const EMPTY_CATEGORIES = [];

function CategoryGrid({ categories: propCategories = EMPTY_CATEGORIES }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef(null);
  const hasAutoTriggeredRef = useRef(false);

  const categories = useMemo(
    () => (Array.isArray(propCategories) ? propCategories : EMPTY_CATEGORIES),
    [propCategories]
  );

  // Filter out system "Uncategorized", subcategories, and empty categories (count === 0)
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
        (c.has_products === true || !hasCountData || populatedRootIds.has(Number(c.id)))
    );
  }, [categories]);

  const hasMore = displayCategories.length > HOME_CATEGORY_PREVIEW_LIMIT;

  const handleExpand = useCallback(() => {
    if (isLoadingMore || isExpanded) return;
    setIsLoadingMore(true);
    triggerHaptic("selection");
    setTimeout(() => {
      setIsExpanded(true);
      setIsLoadingMore(false);
    }, 220);
  }, [isLoadingMore, isExpanded]);

  const handleCollapse = useCallback(() => {
    triggerHaptic("light");
    setIsExpanded(false);
  }, []);

  // Smooth sentinel trigger when shopper scrolls near the bottom of the initial preview batch
  useEffect(() => {
    if (!hasMore || isExpanded || isLoadingMore || hasAutoTriggeredRef.current) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          hasAutoTriggeredRef.current = true;
          handleExpand();
        }
      },
      { rootMargin: "100px 0px", threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isExpanded, isLoadingMore, handleExpand]);

  const visibleCategories = isExpanded
    ? displayCategories
    : displayCategories.slice(0, HOME_CATEGORY_PREVIEW_LIMIT);

  if (visibleCategories.length === 0) return null;

  return (
    <section className="w-full">
      <div className="mb-2.5 sm:mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <span className="h-5 sm:h-6 w-1 sm:w-1.5 rounded-full bg-gradient-to-b from-[#22499F] to-[#2563EB] shrink-0" />
          <h2 className="text-base sm:text-xl md:text-2xl font-bold tracking-normal text-[#1E293B]">
            Shop by Category
          </h2>
          {displayCategories.length > 0 && (
            <span className="text-xs font-semibold text-[#64748B] ml-1">
              ({isExpanded ? displayCategories.length : `${visibleCategories.length}/${displayCategories.length}`})
            </span>
          )}
        </div>
        <Link
          to="/categories"
          className="group flex items-center gap-0.5 sm:gap-1 shrink-0 text-xs sm:text-sm font-bold text-[#22499F] hover:text-[#1B3A7F] transition"
        >
          <span>All categories</span>
          <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Responsive Grid: 4 columns on mobile, 6 columns on desktop */}
      <div className="grid grid-cols-4 md:grid-cols-6 gap-2 sm:gap-3.5 md:gap-4 transition-all duration-300">
        {visibleCategories.map((category, index) => {
          const isInitialDesktopHidden = !isExpanded && index >= 8;
          return (
            <div
              key={category.id}
              className={`${isInitialDesktopHidden ? "hidden md:block" : "block"} transition-opacity duration-300`}
            >
              <CategoryCard category={category} />
            </div>
          );
        })}
      </div>

      {/* Sentinel trigger element placed at the end of initial batch */}
      {hasMore && !isExpanded && (
        <div ref={sentinelRef} className="h-2 w-full pointer-events-none" aria-hidden="true" />
      )}

      {/* Spinner & Show More / Less Controls */}
      {hasMore && (
        <div className="mt-3.5 sm:mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
          {isLoadingMore ? (
            <div className="flex items-center gap-2.5 py-2 px-4 rounded-full bg-[#FFFFFF] border border-[#E2E8F0] shadow-xs text-xs sm:text-sm font-medium text-[#22499F]">
              <div className="h-4 w-4 sm:h-5 sm:w-5 animate-spin rounded-full border-2 border-[#22499F]/20 border-t-[#22499F]" />
              <span>Loading more categories...</span>
            </div>
          ) : !isExpanded ? (
            <button
              type="button"
              onClick={handleExpand}
              className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-2 sm:py-2.5 rounded-full bg-[#FFFFFF] border border-[#22499F]/30 hover:border-[#22499F] text-[#22499F] text-xs sm:text-sm font-semibold shadow-xs hover:bg-[#F0F8E8] transition-all cursor-pointer active:scale-98"
            >
              <span>Show More Categories ({displayCategories.length - visibleCategories.length} more)</span>
              <ChevronDown size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCollapse}
              className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-1.5 sm:py-2 rounded-full bg-[#FFFFFF] border border-[#E2E8F0] hover:border-[#64748B] text-[#64748B] hover:text-[#1E293B] text-xs font-medium shadow-xs transition-all cursor-pointer active:scale-98"
            >
              <span>Show Less</span>
              <ChevronUp size={14} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default CategoryGrid;
