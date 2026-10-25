import { useMemo } from "react";
import staticCategories from "../../data/category.js";
import CategoryCard from "./CategoryCard";

function CategoryGrid({ categories: propCategories = [] }) {
  // Use categories passed from Home.jsx or fallback to static data
  const categories = propCategories.length > 0 ? propCategories : staticCategories;

  // Filter out system "Uncategorized", subcategories, and empty categories (count === 0) from customer category browsing
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

  if (displayCategories.length === 0) return null;

  return (
    <section className="hidden md:block">
      <h2 className="mb-3 sm:mb-4 text-base sm:text-lg md:text-xl font-extrabold text-white tracking-tight">
        Shop by Category
      </h2>

      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3.5 md:gap-4">
        {displayCategories.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
          />
        ))}
      </div>
    </section>
  );
}

export default CategoryGrid;
