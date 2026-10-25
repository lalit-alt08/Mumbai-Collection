import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import HeroBanner from "../components/home/HeroBanner";
import CategoryGrid from "../components/category/CategoryGrid";
import ProductCard from "../components/product/ProductCard";
import { getHomeShelves } from "../services/productService";
import { CheckCircle2, X, ChevronRight } from "lucide-react";
import { getSessionProductOrderSeed, orderProductsForSession } from "../utils/productUtils";
import { useLiveProductStock } from "../hooks/useLiveProductStock";

// In-memory module cache for SWR (Stale-While-Revalidate) catalog rendering
let cachedHomeData = {
  products: null,
  categories: null,
  shelves: null,
  timestamp: 0,
};
let homeDataRequest = null;
const HOME_RESUME_REFRESH_COOLDOWN_MS = 15_000;

function fetchHomeSnapshot() {
  if (!homeDataRequest) {
    homeDataRequest = Promise.allSettled([getHomeShelves()]).finally(() => {
      homeDataRequest = null;
    });
  }
  return homeDataRequest;
}

function Home() {
  const location = useLocation();
  const [products, setProducts] = useState(() => cachedHomeData.products || []);
  const [categories, setCategories] = useState(() => cachedHomeData.categories || []);
  const [homeShelves, setHomeShelves] = useState(() => cachedHomeData.shelves || []);
  // Instant hydration: If cached data exists in memory, skip initial loading skeleton
  const [loading, setLoading] = useState(() => !cachedHomeData.shelves);
  const [flashMessage, setFlashMessage] = useState(location.state?.message || null);
  const lastHomeFetchAt = useRef(0);
  // One randomized catalog order per browser/app session; stock refreshes reuse it.
  const [shuffleSeed] = useState(() => getSessionProductOrderSeed());

  useEffect(() => {
    const prevBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#132238";
    return () => {
      document.body.style.backgroundColor = prevBg;
    };
  }, []);

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
    const loadHomeData = async ({ force = false } = {}) => {
      if (!force && Date.now() - lastHomeFetchAt.current < HOME_RESUME_REFRESH_COOLDOWN_MS) return;
      lastHomeFetchAt.current = Date.now();
      try {
        // Only trigger skeleton if we have no prior cache
        if (!cachedHomeData.shelves) {
          setLoading(true);
        }

        const [homeDataResult] = await fetchHomeSnapshot();

        if (isMounted) {
          if (homeDataResult.status === "fulfilled") {
            const data = homeDataResult.value || {};
            const shelfList = Array.isArray(data.shelves) ? data.shelves : [];
            const catList = Array.isArray(data.categories) ? data.categories : [];
            const productMap = new Map();
            shelfList.forEach((shelf) => {
              (Array.isArray(shelf.products) ? shelf.products : []).forEach((product) => {
                if (product?.id && !productMap.has(Number(product.id))) {
                  productMap.set(Number(product.id), product);
                }
              });
            });
            const productList = [...productMap.values()];
            setHomeShelves(shelfList);
            setProducts(productList);
            setCategories(catList);
            cachedHomeData.shelves = shelfList;
            cachedHomeData.products = productList;
            cachedHomeData.categories = catList;
          }

          cachedHomeData.timestamp = Date.now();
        }
      } catch {
        // Fallback or empty home state
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadHomeData();
    };
    const refreshOnPageShow = () => loadHomeData();

    loadHomeData({ force: true });
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pageshow", refreshOnPageShow);
    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshOnPageShow);
    };
  }, []);

  // The backend returns a bounded first page for each department, so a shelf
  // is not omitted just because its products fall after the global catalog page.
  const categorySections = useMemo(() => {
    if (!Array.isArray(homeShelves) || homeShelves.length === 0) return [];
    const productsById = new Map(products.map((product) => [Number(product.id), product]));
    return homeShelves.map((section) => ({
      ...section,
      products: orderProductsForSession(
        (Array.isArray(section.products) ? section.products : [])
          .map((product) => productsById.get(Number(product.id)) || product)
          .slice(0, 10),
        shuffleSeed,
        `home-category-${section.id}`
      ),
    }));
  }, [homeShelves, products, shuffleSeed]);

  // Only poll stock for cards currently displayed on the home shelves. The
  // full category pages still fetch their own live stock as customers browse.
  const visibleHomeProducts = useMemo(
    () => categorySections.flatMap((section) => section.products.slice(0, 10)),
    [categorySections]
  );
  useLiveProductStock(visibleHomeProducts, setProducts);

  return (
    <div className="space-y-5 sm:space-y-6 md:space-y-8">
      {/* Toast Feedback */}
      {flashMessage && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#132B45] border border-emerald-500 p-3 sm:p-3.5 text-xs sm:text-sm font-semibold text-emerald-300 shadow-xs animate-[slideUp_0.25s_ease-out]">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
            <span>{flashMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setFlashMessage(null)}
            className="p-1 text-[#8FA4BE] hover:text-white transition cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Hero Promotional Banner */}
      <HeroBanner />

      {/* Desktop Only: Shop by Category Grid */}
      <CategoryGrid categories={categories} />

      {/* Category-by-Category Responsive Product Sections */}
      <div className="space-y-6 md:space-y-8 lg:space-y-10">
        {loading ? (
          /* Responsive Loading Skeleton */
          <div className="space-y-5 md:space-y-8">
            {[1, 2].map((s) => (
              <div key={s} className="space-y-2.5 md:space-y-4 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="h-5 md:h-6 w-28 md:w-36 bg-[#162744] rounded-md" />
                  <div className="h-4 md:h-5 w-16 md:w-20 bg-[#162744] rounded-md" />
                </div>
                <div className="flex md:grid md:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-4 md:gap-4.5 overflow-hidden md:overflow-visible -mx-3.5 px-3.5 sm:-mx-5 sm:px-5 md:mx-0 md:px-0">
                  {[1, 2, 3, 4].map((card) => (
                    <div
                      key={card}
                      className={`w-[160px] sm:w-[175px] md:w-full h-52 md:h-64 shrink-0 md:shrink rounded-[18px] md:rounded-[20px] bg-[#111F36] p-2.5 md:p-3.5 border border-[#1E3252]/50 shadow-xs ${
                        card === 4 ? "hidden md:block" : ""
                      }`}
                    >
                      <div className="aspect-square w-full rounded-[12px] md:rounded-[14px] bg-[#080F1C] mb-2 md:mb-3" />
                      <div className="h-3 md:h-4 w-3/4 bg-[#162744] rounded mb-1.5 md:mb-2" />
                      <div className="h-4 w-1/2 bg-[#162744] rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : categorySections.length > 0 ? (
          categorySections.map((section) => (
            <section key={section.id} className="space-y-2.5 md:space-y-3.5">
              {/* Category Header with Responsive View All Link */}
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg md:text-xl font-extrabold text-white tracking-tight">
                  {section.name}
                </h2>

                <Link
                  to={`/category/${section.id || section.slug}`}
                  className="flex items-center gap-0.5 md:gap-1 text-xs md:text-sm font-bold text-[#42D6E8] transition-colors hover:text-[#67E8F9] active:scale-95 group"
                >
                  <span>View All</span>
                  <ChevronRight
                    size={14}
                    strokeWidth={2.5}
                    className="md:w-4 md:h-4 transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </div>

              {/* Single Unified Product Display: Horizontal Carousel on Mobile (< md), Grid on Desktop (>= md) */}
              <div className="flex overflow-x-auto pb-2 pt-1 -mx-3.5 px-3.5 sm:-mx-5 sm:px-5 scroll-px-3.5 sm:scroll-px-5 scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] snap-x snap-mandatory gap-3.5 sm:gap-4 md:grid md:grid-cols-3 lg:grid-cols-4 md:gap-4 md:gap-4.5 md:overflow-visible md:pb-0 md:pt-0 md:mx-0 md:px-0">
                {section.products.slice(0, 10).map((product) => (
                  <div
                    key={product.id}
                    className="w-[160px] sm:w-[175px] shrink-0 snap-start flex flex-col md:w-full md:shrink md:snap-align-none"
                  >
                    <ProductCard product={product} />
                  </div>
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="rounded-[18px] md:rounded-[20px] bg-[#111F36] p-6 md:p-8 text-center border border-[#1E3252] shadow-xs">
            <p className="text-sm md:text-base font-semibold text-[#8FA4BE]">No products available at the moment.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;
