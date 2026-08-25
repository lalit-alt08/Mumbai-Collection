import { useEffect, useState, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import HeroBanner from "../components/home/HeroBanner";
import CategoryGrid from "../components/category/CategoryGrid";
import ProductCard from "../components/product/ProductCard";
import { getProducts, getCategories } from "../services/productService";
import { CheckCircle2, X, ChevronRight } from "lucide-react";

function Home() {
  const location = useLocation();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flashMessage, setFlashMessage] = useState(location.state?.message || null);

  useEffect(() => {
    if (location.state?.message) {
      setFlashMessage(location.state.message);
      window.history.replaceState({}, document.title);
      const timer = setTimeout(() => setFlashMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [location.state]);

  useEffect(() => {
    let isMounted = true;
    const loadHomeData = async () => {
      try {
        setLoading(true);
        const [productsData, categoriesData] = await Promise.allSettled([
          getProducts(),
          getCategories(),
        ]);

        if (isMounted) {
          if (productsData.status === "fulfilled" && Array.isArray(productsData.value)) {
            setProducts(productsData.value);
          }
          if (categoriesData.status === "fulfilled" && Array.isArray(categoriesData.value)) {
            setCategories(categoriesData.value);
          }
        }
      } catch (err) {
        console.error("Failed to load home data:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadHomeData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Dynamically group products by WooCommerce categories (Preserves persistent merchandising order)
  const categorySections = useMemo(() => {
    if (!Array.isArray(products) || products.length === 0) return [];

    const map = new Map();

    products.forEach((product) => {
      if (!Array.isArray(product.categories) || product.categories.length === 0) {
        return;
      }

      product.categories.forEach((cat) => {
        if (!cat || !cat.id) return;
        const catKey = String(cat.id);

        if (!map.has(catKey)) {
          map.set(catKey, {
            id: cat.id,
            name: cat.name || "Category",
            slug: cat.slug || String(cat.id),
            products: [],
          });
        }
        map.get(catKey).products.push(product);
      });
    });

    const activeSections = Array.from(map.values()).filter((section) => section.products.length > 0);

    // Sort sections by persistent WooCommerce merchandising order
    if (categories.length > 0) {
      const orderMap = new Map(categories.map((c, idx) => [String(c.id), idx]));
      activeSections.sort((a, b) => {
        const orderA = orderMap.has(String(a.id)) ? orderMap.get(String(a.id)) : 9999;
        const orderB = orderMap.has(String(b.id)) ? orderMap.get(String(b.id)) : 9999;
        return orderA - orderB;
      });
    }

    return activeSections;
  }, [products, categories]);

  return (
    <div className="space-y-5 sm:space-y-6 md:space-y-8">
      {/* Toast Feedback */}
      {flashMessage && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-200/80 p-3 sm:p-3.5 text-xs sm:text-sm font-semibold text-emerald-800 shadow-xs animate-[slideUp_0.25s_ease-out]">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
            <span>{flashMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setFlashMessage(null)}
            className="p-1 text-gray-400 hover:text-gray-600 transition cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Hero Promotional Banner */}
      <HeroBanner />

      {/* Desktop Only: Shop by Category Grid */}
      <CategoryGrid />

      {/* ================= MOBILE VIEW (< md) ================= */}
      {/* Dynamic Category-by-Category Horizontal Product Carousels */}
      <div className="space-y-6 md:hidden">
        {loading ? (
          /* Mobile Loading Skeleton */
          <div className="space-y-5">
            {[1, 2].map((s) => (
              <div key={s} className="space-y-2.5 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="h-5 w-28 bg-gray-200 rounded-md" />
                  <div className="h-4 w-16 bg-gray-200 rounded-md" />
                </div>
                <div className="flex gap-3.5 sm:gap-4 overflow-hidden -mx-3.5 px-3.5 sm:-mx-5 sm:px-5">
                  {[1, 2, 3].map((card) => (
                    <div
                      key={card}
                      className="w-[160px] sm:w-[175px] h-52 shrink-0 rounded-[18px] bg-white p-2.5 border border-gray-100 shadow-xs"
                    >
                      <div className="aspect-square w-full rounded-[12px] bg-gray-100 mb-2" />
                      <div className="h-3 w-3/4 bg-gray-100 rounded mb-1.5" />
                      <div className="h-4 w-1/2 bg-gray-100 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : categorySections.length > 0 ? (
          categorySections.map((section) => (
            <section key={section.id} className="space-y-2.5">
              {/* Category Header with View All Link */}
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-extrabold text-[#111827] tracking-tight">
                  {section.name}
                </h2>

                <Link
                  to={`/category/${section.id || section.slug}`}
                  className="flex items-center gap-0.5 text-xs font-bold text-[#7C3AED] transition-colors hover:text-[#6D28D9] active:scale-95"
                >
                  <span>View All</span>
                  <ChevronRight size={14} strokeWidth={2.5} />
                </Link>
              </div>

              {/* Horizontal Scroll Product Carousel */}
              <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 pt-1 -mx-3.5 px-3.5 sm:-mx-5 sm:px-5 scroll-px-3.5 sm:scroll-px-5 scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] snap-x snap-mandatory">
                {section.products.map((product) => (
                  <div
                    key={product.id}
                    className="w-[160px] sm:w-[175px] shrink-0 snap-start flex flex-col"
                  >
                    <ProductCard product={product} />
                  </div>
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="rounded-[18px] bg-white p-6 text-center border border-gray-100 shadow-xs">
            <p className="text-sm font-semibold text-gray-500">No products available at the moment.</p>
          </div>
        )}
      </div>

      {/* ================= DESKTOP VIEW (>= md) ================= */}
      {/* Dynamic Category-by-Category Product Grids */}
      <div className="hidden md:block space-y-8 lg:space-y-10">
        {loading ? (
          <div className="space-y-8">
            {[1, 2].map((s) => (
              <div key={s} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="h-6 w-36 bg-gray-200 rounded-md" />
                  <div className="h-5 w-20 bg-gray-200 rounded-md" />
                </div>
                <div className="grid grid-cols-3 lg:grid-cols-4 gap-4">
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="h-64 rounded-[20px] bg-white p-3.5 border border-gray-100 animate-pulse"
                    >
                      <div className="aspect-square w-full rounded-[14px] bg-gray-100 mb-3" />
                      <div className="h-4 w-3/4 bg-gray-100 rounded mb-2" />
                      <div className="h-4 w-1/2 bg-gray-100 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : categorySections.length > 0 ? (
          categorySections.map((section) => (
            <section key={section.id} className="space-y-3.5">
              {/* Category Header with View All Link */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg sm:text-xl font-extrabold text-[#111827] tracking-tight">
                  {section.name}
                </h2>

                <Link
                  to={`/category/${section.id || section.slug}`}
                  className="flex items-center gap-1 text-sm font-bold text-[#7C3AED] transition-colors hover:text-[#6D28D9] active:scale-95 group"
                >
                  <span>View All ({section.products.length})</span>
                  <ChevronRight
                    size={16}
                    strokeWidth={2.5}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </div>

              {/* Desktop Product Grid */}
              <div className="grid grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-4 md:gap-4.5">
                {section.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="rounded-[20px] bg-white p-8 text-center border border-gray-100 shadow-xs">
            <p className="text-base font-semibold text-gray-500">No products available at the moment.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;