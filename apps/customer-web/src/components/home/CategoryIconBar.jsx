import { useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingBag,
  Sparkles,
  Zap,
  Laptop,
  Smile,
  Gift,
  Watch,
  BookOpen,
  Shirt,
  Heart,
  Palette,
  Baby,
  Coffee,
  Package,
  LayoutGrid,
  Flame,
  Globe,
} from "lucide-react";
import { triggerHaptic } from "../../utils/haptics";

/**
 * Maps category names or slugs to intuitive Lucide icons.
 */
function getCategoryIcon(name = "", slug = "") {
  const text = `${name} ${slug}`.toLowerCase();
  if (text.includes("trend") || text.includes("hot") || text.includes("viral")) return Flame;
  if (text.includes("import") || text.includes("global") || text.includes("world")) return Globe;
  if (text.includes("winter") || text.includes("season") || text.includes("fest")) return Sparkles;
  if (text.includes("electr") || text.includes("gadget") || text.includes("phone") || text.includes("tech")) return Laptop;
  if (text.includes("beauty") || text.includes("cosmetic") || text.includes("care") || text.includes("skin")) return Sparkles;
  if (text.includes("gift")) return Gift;
  if (text.includes("toy") || text.includes("kid") || text.includes("game")) return Smile;
  if (text.includes("station") || text.includes("book") || text.includes("pen") || text.includes("school")) return BookOpen;
  if (text.includes("art") || text.includes("paint") || text.includes("craft")) return Palette;
  if (text.includes("cloth") || text.includes("wear") || text.includes("fashion") || text.includes("shirt")) return Shirt;
  if (text.includes("watch") || text.includes("time") || text.includes("smart")) return Watch;
  if (text.includes("food") || text.includes("snack") || text.includes("bev") || text.includes("tea")) return Coffee;
  if (text.includes("baby")) return Baby;
  if (text.includes("deal") || text.includes("offer") || text.includes("flash")) return Zap;
  return Package;
}

export default function CategoryIconBar({
  categories = [],
  selectedCategoryId = null,
  onSelectCategory,
  className = "",
}) {
  const scrollContainerRef = useRef(null);

  // Strictly 4 categories in requested order: 1. Trending, 2. Toys, 3. Electronics, 4. Imported (Followed by "View All")
  const rootCategories = useMemo(() => {
    if (!Array.isArray(categories)) return [];

    const findCat = (regex) =>
      categories.find(
        (c) =>
          c &&
          (!c.parent || Number(c.parent) === 0) &&
          c.slug?.toLowerCase() !== "uncategorized" &&
          c.name?.toLowerCase() !== "uncategorized" &&
          regex.test(`${c.name || ""} ${c.slug || ""}`)
      );

    // 1. Trending (replacing stationery, strictly first)
    const trending = findCat(/\btrend/i) || {
      id: "trending",
      slug: "trending",
      name: "Trending",
    };

    // 2. Toys (strictly second, clean name)
    const toysRaw = findCat(/\b(toy|game)/i);
    const toys = toysRaw
      ? { ...toysRaw, name: "Toys" }
      : { id: 17, slug: "toys", name: "Toys" };

    // 3. Electronics (strictly third)
    const electronics = findCat(/\b(electr|gadget|tech)/i) || {
      id: 19,
      slug: "electronics",
      name: "Electronics",
    };

    // 4. Imported (strictly fourth)
    const imported = findCat(/\bimport/i) || {
      id: "imported",
      slug: "imported",
      name: "Imported",
    };

    return [trending, toys, electronics, imported];
  }, [categories]);

  const isAllActive = selectedCategoryId === null || selectedCategoryId === "all";

  const handleCategoryClick = (catId) => {
    triggerHaptic("selection");
    if (onSelectCategory) {
      onSelectCategory(catId);
    }
  };

  return (
    <div className={`w-full pt-1 pb-1 relative ${className}`}>
      <div
        ref={scrollContainerRef}
        className="flex items-start justify-between gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] w-full px-1.5 scroll-smooth"
      >
        {/* Item 1: "All" */}
        <button
          type="button"
          onClick={() => handleCategoryClick("all")}
          className="group relative flex flex-col items-center justify-between min-w-[58px] sm:min-w-[68px] flex-1 shrink-0 cursor-pointer pt-0.5 pb-2 transition-all outline-hidden focus:outline-hidden"
        >
          <div className="relative flex items-center justify-center h-7 w-7 mb-1">
            <ShoppingBag
              size={21}
              strokeWidth={isAllActive ? 2.5 : 2}
              className={`transition-colors ${
                isAllActive ? "text-[#22499F]" : "text-[#64748B] group-hover:text-[#1E293B]"
              }`}
            />
          </div>
          <span
            className={`text-[10px] sm:text-xs tracking-tight transition-colors text-center whitespace-nowrap px-0.5 ${
              isAllActive ? "font-bold text-[#1E293B]" : "font-semibold text-[#64748B] group-hover:text-[#1E293B]"
            }`}
          >
            All
          </span>

          {/* Active bottom underline indicator */}
          {isAllActive && (
            <span className="absolute bottom-0 left-1 right-1 h-[2.5px] rounded-full bg-[#22499F] transition-all" />
          )}
        </button>

        {/* Items 2-5: Dynamic Categories (Strictly Top 4) */}
        {rootCategories.map((category) => {
          const catId = category.id || category.slug;
          const isActive = String(selectedCategoryId) === String(catId);
          const IconComponent = getCategoryIcon(category.name, category.slug);
          const isWinterOrNew =
            category.is_new ||
            category.name?.toLowerCase().includes("winter") ||
            category.slug?.toLowerCase().includes("winter") ||
            category.slug?.toLowerCase().includes("new");

          return (
            <Link
              key={catId}
              to={`/category/${catId}`}
              onClick={() => triggerHaptic("light")}
              className="group relative flex flex-col items-center justify-between min-w-[58px] sm:min-w-[68px] flex-1 shrink-0 cursor-pointer pt-0.5 pb-2 transition-all outline-hidden focus:outline-hidden"
            >
              <div className="relative flex items-center justify-center h-7 w-7 mb-1">
                <IconComponent
                  size={21}
                  strokeWidth={isActive ? 2.5 : 2}
                  className={`transition-colors ${
                    isActive ? "text-[#22499F]" : "text-[#64748B] group-hover:text-[#1E293B]"
                  }`}
                />
                {isWinterOrNew && (
                  <span className="absolute -top-1 -right-3.5 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-wider rounded-full bg-[#EF4444] text-white shadow-xs leading-none pointer-events-none">
                    New
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] sm:text-xs tracking-tight transition-colors text-center whitespace-nowrap px-0.5 ${
                  isActive ? "font-bold text-[#1E293B]" : "font-semibold text-[#64748B] group-hover:text-[#1E293B]"
                }`}
                title={category.name}
              >
                {category.name}
              </span>

              {isActive && (
                <span className="absolute bottom-0 left-1 right-1 h-[2.5px] rounded-full bg-[#22499F] transition-all" />
              )}
            </Link>
          );
        })}

        {/* Item 6: Directly visible "View All" */}
        <Link
          to="/categories"
          onClick={() => triggerHaptic("light")}
          className="group relative flex flex-col items-center justify-between min-w-[58px] sm:min-w-[68px] flex-1 shrink-0 cursor-pointer pt-0.5 pb-2 transition-all outline-hidden focus:outline-hidden"
        >
          <div className="relative flex items-center justify-center h-7 w-7 mb-1 rounded-full bg-[#22499F]/10 group-hover:bg-[#22499F]/20 transition-colors">
            <LayoutGrid
              size={18}
              strokeWidth={2.2}
              className="text-[#22499F] transition-transform group-hover:scale-110"
            />
          </div>
          <span className="text-[10px] sm:text-xs tracking-tight transition-colors text-center font-bold text-[#22499F] group-hover:text-[#1E293B] whitespace-nowrap px-0.5">
            View All
          </span>
        </Link>
      </div>
    </div>
  );
}
