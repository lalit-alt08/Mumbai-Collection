import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import staticCategories from "../data/category.js";
import { getCategories } from "../services/productService.js";
import { getCategoryImageUrl } from "../utils/categoryImage.js";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";

function Categories() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState(staticCategories);

  // Category subtitles / highlights for rich cards
  const categoryMeta = {
    17: {
      subtitle: "Learning & fun toys",
      badge: "Popular",
      accent: "from-[#F5F3FF] to-[#EDE9FE]",
    },
    18: {
      subtitle: "Pens, art & office supplies",
      badge: "Essential",
      accent: "from-[#FAF5FF] to-[#F3E8FF]",
    },
    19: {
      subtitle: "Audio, cables & accessories",
      badge: "Trending",
      accent: "from-[#F5F3FF] to-[#E9D5FF]",
    },
  };

  useEffect(() => {
    let isMounted = true;
    const loadCategories = async () => {
      try {
        const liveData = await getCategories();
        if (isMounted && Array.isArray(liveData) && liveData.length > 0) {
          setCategories(liveData);
        }
      } catch (err) {
        console.warn("Using static category fallback:", err.message);
      }
    };
    loadCategories();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter out system "Uncategorized" and empty categories (count === 0) from customer browsing
  const displayCategories = useMemo(() => {
    return categories.filter(
      (c) =>
        c &&
        c.slug?.toLowerCase() !== "uncategorized" &&
        c.name?.toLowerCase() !== "uncategorized" &&
        Number(c.count) > 0
    );
  }, [categories]);

  return (
    <div className="min-h-screen bg-[#F8F9FD] text-[#111827] px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-4xl space-y-4 sm:space-y-5">
        {/* ────────────────────────────────────────────────────────── */}
        {/* COMPACT TOP BAR                                            */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            aria-label="Back to Home"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#1F2937] shadow-xs border border-gray-200 transition-all hover:border-[#7C3AED]/40 hover:bg-[#F5F3FF] hover:text-[#7C3AED] active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={17} strokeWidth={2.4} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-[#111827] sm:text-2xl">
            Categories
          </h1>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* LAVENDER THEME HERO BANNER                                 */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-[22px] border border-[#7C3AED]/20 bg-gradient-to-r from-[#FAF5FF] via-[#F5F3FF] to-[#EDE9FE] p-4 sm:p-5 shadow-[0_6px_25px_rgba(124,58,237,0.04)]">
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#7C3AED]/15 blur-xl" />

          <div className="relative z-10">
            <h2 className="text-lg sm:text-xl font-extrabold text-[#111827] tracking-tight">
              Shop by Department
            </h2>
            <p className="text-xs sm:text-sm font-semibold text-[#4B5563] mt-1">
              Explore toys, stationery, art, gadgets & everyday essentials.
            </p>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* 2-COLUMN OPTIMIZED CATEGORY GRID                           */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {displayCategories.map((category) => {
            const meta = categoryMeta[category.id] || {
              subtitle: "Explore collection",
              badge: "Explore",
              accent: "from-[#F5F3FF] to-[#EDE9FE]",
            };

            const imageUrl = getCategoryImageUrl(category);
            const linkUrl = category.link || `/category/${category.id || category.slug}`;

            return (
              <Link
                key={category.id}
                to={linkUrl}
                className="group relative flex flex-col justify-between overflow-hidden rounded-[22px] bg-white p-3.5 sm:p-4.5 border border-gray-200/90 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-1 hover:border-[#7C3AED]/40 hover:shadow-[0_12px_32px_rgba(124,58,237,0.12)] active:scale-[0.98]"
              >
                {/* Category Image Viewport */}
                <div
                  className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[18px] bg-gradient-to-br ${meta.accent} p-3 transition-transform duration-300 group-hover:scale-[1.02] border border-purple-100/70`}
                >
                  <img
                    src={imageUrl}
                    alt={category.name}
                    className="h-full w-full object-contain drop-shadow-xs transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />

                  {/* Badge */}
                  <span className="absolute top-2 right-2 rounded-full bg-white/95 px-2.5 py-0.5 text-[10px] sm:text-xs font-extrabold text-[#6D28D9] shadow-xs backdrop-blur-xs border border-purple-100">
                    {meta.badge}
                  </span>
                </div>

                {/* Content */}
                <div className="mt-3 flex flex-col">
                  <div className="flex items-center justify-between gap-1">
                    <h3 className="text-base font-extrabold text-[#111827] group-hover:text-[#6D28D9] transition-colors truncate">
                      {category.name}
                    </h3>
                    <ChevronRight
                      size={16}
                      className="text-gray-400 group-hover:text-[#6D28D9] group-hover:translate-x-0.5 transition-all shrink-0"
                    />
                  </div>

                  <p className="text-xs font-semibold text-[#4B5563] mt-0.5 line-clamp-1">
                    {meta.subtitle}
                  </p>

                  <div className="mt-2.5 flex items-center justify-between rounded-xl bg-[#EDE9FE] px-3 py-1.5 text-xs font-extrabold text-[#6D28D9] group-hover:bg-[#7C3AED] group-hover:text-white transition-colors">
                    <span>View items</span>
                    <ArrowRight size={13} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Categories;
