import { useEffect, useState, useMemo } from "react";
import staticCategories from "../../data/category.js";
import CategoryCard from "./CategoryCard";
import { getCategories } from "../../services/productService.js";

function CategoryGrid() {
  const [categories, setCategories] = useState(staticCategories);

  useEffect(() => {
    let isMounted = true;
    const loadCategories = async () => {
      try {
        const liveData = await getCategories();
        if (isMounted && Array.isArray(liveData) && liveData.length > 0) {
          setCategories(liveData);
        }
      } catch (err) {
        console.warn("Using fallback category list:", err.message);
      }
    };
    loadCategories();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter out system "Uncategorized" and empty categories (count === 0) from customer category browsing
  const displayCategories = useMemo(() => {
    return categories.filter(
      (c) =>
        c &&
        c.slug?.toLowerCase() !== "uncategorized" &&
        c.name?.toLowerCase() !== "uncategorized" &&
        Number(c.count) > 0
    );
  }, [categories]);

  if (displayCategories.length === 0) return null;

  return (
    <section className="hidden md:block">
      <h2 className="mb-3 sm:mb-4 text-base sm:text-lg md:text-xl font-extrabold text-[#111827] tracking-tight">
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