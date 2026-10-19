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
      accent: "from-[#0A1D15] to-[#0E261D]",
    },
    18: {
      subtitle: "Pens, art & office supplies",
      badge: "Essential",
      accent: "from-[#0C241B] to-[#102E23]",
    },
    19: {
      subtitle: "Audio, cables & accessories",
      badge: "Trending",
      accent: "from-[#0E281F] to-[#143B2E]",
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
      } catch {
        // Fallback handled seamlessly
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
        {/* MIDNIGHT NAVY HERO BANNER                                   */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-[22px] border border-[#1E3252]/70 bg-gradient-to-r from-[#0E1B30] via-[#111F36] to-[#162A48] p-4 sm:p-5 shadow-[0_6px_25px_rgba(66,214,232,0.06)]">
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#42D6E8]/15 blur-xl" />

          <div className="relative z-10">
            <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
              Shop by Department
            </h2>
            <p className="text-xs sm:text-sm font-semibold text-[#8FA4BE] mt-1">
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
              accent: "from-[#0A1D15] to-[#0E261D]",
            };

            const imageUrl = getCategoryImageUrl(category);
            const linkUrl = category.link || `/category/${category.id || category.slug}`;

            return (
              <Link
                key={category.id}
                to={linkUrl}
                className="group relative flex flex-col justify-between overflow-hidden rounded-[22px] bg-[#111F36] p-3.5 sm:p-4.5 border border-[#1E3252]/80 shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-300 hover:-translate-y-1 hover:border-[#42D6E8]/60 hover:shadow-[0_12px_32px_rgba(66,214,232,0.15)] active:scale-[0.98]"
              >
                {/* Category Image Viewport */}
                <div
                  className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[18px] bg-[#080F1C] p-3 transition-transform duration-300 group-hover:scale-[1.02] border border-[#1E3252]"
                >
                  <img
                    src={imageUrl}
                    alt={category.name}
                    className="h-full w-full object-contain drop-shadow-xs transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />

                  {/* Badge */}
                  <span className="absolute top-2 right-2 rounded-full bg-[#132B45] px-2.5 py-0.5 text-[10px] sm:text-xs font-extrabold text-[#42D6E8] shadow-xs backdrop-blur-xs border border-[#1E3E63]">
                    {meta.badge}
                  </span>
                </div>

                {/* Content */}
                <div className="mt-3 flex flex-col">
                  <div className="flex items-center justify-between gap-1">
                    <h3 className="text-base font-extrabold text-white group-hover:text-[#42D6E8] transition-colors truncate">
                      {category.name}
                    </h3>
                    <ChevronRight
                      size={16}
                      className="text-[#6E84A3] group-hover:text-[#42D6E8] group-hover:translate-x-0.5 transition-all shrink-0"
                    />
                  </div>

                  <p className="text-xs font-semibold text-[#8FA4BE] mt-0.5 line-clamp-1">
                    {meta.subtitle}
                  </p>

                  <div className="mt-2.5 flex items-center justify-between rounded-xl bg-[#132B45] px-3 py-1.5 text-xs font-extrabold text-[#42D6E8] group-hover:bg-[#42D6E8] group-hover:text-[#061220] transition-colors">
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
