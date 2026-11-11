import { useMemo } from "react";
import { Link } from "react-router-dom";
import CategoryCard from "./CategoryCard";
import { ChevronRight } from "lucide-react";

const HOME_CATEGORY_PREVIEW_LIMIT = 12;
const EMPTY_CATEGORIES = [];

function CategoryGrid({ categories: propCategories = EMPTY_CATEGORIES }) {
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

  const visibleCategories = displayCategories.slice(0, HOME_CATEGORY_PREVIEW_LIMIT);

  if (visibleCategories.length === 0) return null;

  return (
    <section className="hidden md:block">
      <div className="mb-2.5 sm:mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <span className="h-5 sm:h-6 w-1 sm:w-1.5 rounded-full bg-gradient-to-b from-[#22499F] to-[#2563EB] shrink-0" />
          <h2 className="text-base sm:text-xl md:text-2xl font-bold tracking-normal text-[#1E293B]">
            Shop by Category
          </h2>
        </div>
        <Link
          to="/categories"
          className="group flex items-center gap-0.5 sm:gap-1 shrink-0 text-xs sm:text-sm font-bold text-[#22499F] hover:text-[#22499F] transition"
        >
          <span>All categories</span>
          <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Responsive Grid: 4 columns on mobile (showing top 8), 6 columns on desktop (showing 12) */}
      <div className="grid grid-cols-4 md:grid-cols-6 gap-2 sm:gap-3.5 md:gap-4">
        {visibleCategories.map((category, index) => (
          <div
            key={category.id}
            className={index >= 8 ? "hidden md:block" : ""}
          >
            <CategoryCard category={category} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default CategoryGrid;
