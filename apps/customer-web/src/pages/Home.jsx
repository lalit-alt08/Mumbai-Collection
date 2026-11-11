import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import HeroBanner from "../components/home/HeroBanner";
import BackToTopButton from "../components/home/BackToTopButton";
import CategoryGrid from "../components/category/CategoryGrid";
import ProductCard from "../components/product/ProductCard";
import { getHomeShelves } from "../services/productService";
import { AlertCircle, CheckCircle2, X, ChevronRight } from "lucide-react";
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
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [flashMessage, setFlashMessage] = useState(location.state?.message || null);
  const lastHomeFetchAt = useRef(0);
  // One randomized catalog order per browser/app session; stock refreshes reuse it.
  const [shuffleSeed] = useState(() => getSessionProductOrderSeed());

  useEffect(() => {
    const prevBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#F0F8E8";
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
        setLoadError("");
        // Only trigger skeleton if we have no prior cache
        if (!cachedHomeData.shelves) {
          setLoading(true);
        }

        const [homeDataResult] = await fetchHomeSnapshot();

        if (isMounted) {
          if (homeDataResult.status === "fulfilled") {
            const data = homeDataResult.value || {};
            const shelfList = (Array.isArray(data.shelves) ? data.shelves : []).slice(0, 6);
            const catList = Array.isArray(data.categories) ? data.categories : [];
            const productMap = new Map();
            shelfList.forEach((shelf) => {
              (Array.isArray(shelf.products) ? shelf.products : []).slice(0, 6).forEach((product) => {
                if (product?.id && !productMap.has(Number(product.id))) {
                  productMap.set(Number(product.id), product);
                }
              });
            });
            const productList = [...productMap.values()];
            setHomeShelves(shelfList);
            setProducts(productList);
            if (catList.length > 0) {
              setCategories(catList);
              cachedHomeData.categories = catList;
            }
            cachedHomeData.shelves = shelfList;
            cachedHomeData.products = productList;
          } else {
            throw homeDataResult.reason || new Error("Home catalog request failed");
          }

          cachedHomeData.timestamp = Date.now();
        }
      } catch {
        if (isMounted) setLoadError("We could not refresh the store catalog. Check your connection and try again.");
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
  }, [reloadKey]);

  // The backend returns a bounded first page for each department, so a shelf
  // is not omitted just because its products fall after the global catalog page.
  const categorySections = useMemo(() => {
    if (!Array.isArray(homeShelves) || homeShelves.length === 0) return [];
    const productsById = new Map(products.map((product) => [Number(product.id), product]));
    return homeShelves.slice(0, 6).map((section) => ({
      ...section,
      products: orderProductsForSession(
        (Array.isArray(section.products) ? section.products : [])
          .map((product) => productsById.get(Number(product.id)) || product)
          .slice(0, 6),
        shuffleSeed,
        `home-category-${section.id}`
      ),
    }));
  }, [homeShelves, products, shuffleSeed]);

  // Capped at 36 products (6 shelves x 6 products) for a single fast live stock request
  const visibleHomeProducts = useMemo(
    () => categorySections.flatMap((section) => section.products.slice(0, 6)),
    [categorySections]
  );
  useLiveProductStock(visibleHomeProducts, setProducts);

  return (
    <div className="space-y-5 sm:space-y-6 md:space-y-8">
      {/* Toast Feedback */}
      {flashMessage && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#FFFFFF] border border-emerald-500 p-3 sm:p-3.5 text-xs sm:text-sm font-semibold text-emerald-300 shadow-xs animate-[slideUp_0.25s_ease-out]">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
            <span>{flashMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setFlashMessage(null)}
            className="p-1 text-[#64748B] hover:text-white transition cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Hero Promotional Banner */}
      <HeroBanner />

      {/* Compact category shortcuts on mobile and desktop */}
      <CategoryGrid categories={categories} />

      {/* Category-by-Category Responsive Product Sections */}
      <div className="space-y-6 md:space-y-8 lg:space-y-10">
        {loading ? (
          /* Responsive Loading Skeleton */
          <div className="space-y-5 md:space-y-8">
            {[1, 2].map((s) => (
              <div key={s} className="space-y-2.5 md:space-y-4 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="h-5 md:h-6 w-28 md:w-36 bg-[#FFFFFF] rounded-md" />
                  <div className="h-4 md:h-5 w-16 md:w-20 bg-[#FFFFFF] rounded-md" />
                </div>
                <div className="flex md:grid md:grid-cols-6 gap-3.5 sm:gap-4 md:gap-3.5 lg:gap-4 overflow-hidden md:overflow-visible -mx-3.5 px-3.5 sm:-mx-5 sm:px-5 md:mx-0 md:px-0">
                  {[1, 2, 3, 4, 5, 6].map((card) => (
                    <div
                      key={card}
                      className="w-[178px] sm:w-[195px] md:w-full h-52 md:h-64 shrink-0 md:shrink rounded-[18px] md:rounded-[20px] bg-[#FFFFFF] p-2.5 md:p-3.5 border border-[#E2E8F0]/50 shadow-xs"
                    >
                      <div className="aspect-square w-full rounded-[12px] md:rounded-[14px] bg-[#F0F8E8] mb-2 md:mb-3" />
                      <div className="h-3 md:h-4 w-3/4 bg-[#FFFFFF] rounded mb-1.5 md:mb-2" />
                      <div className="h-4 w-1/2 bg-[#FFFFFF] rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : loadError && categorySections.length === 0 ? (
          <div className="rounded-[18px] border border-amber-400/40 bg-[#FFFFFF] p-6 text-center shadow-xs">
            <AlertCircle className="mx-auto mb-2 text-amber-300" size={24} />
            <p className="text-sm font-semibold text-[#334155]">{loadError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="mt-4 rounded-full border border-[#42D6E8]/60 px-5 py-2 text-sm font-extrabold text-[#67E8F9] transition hover:bg-[#FFFFFF]"
            >
              Retry
            </button>
          </div>
        ) : categorySections.length > 0 ? (
          <>
            {categorySections.map((section) => (
              <section key={section.id} className="space-y-3 sm:space-y-4">
                {/* Category Header with Responsive View All Link */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 sm:gap-2.5">
                    <span className="h-5 sm:h-6 w-1 sm:w-1.5 rounded-full bg-[#22499F] shrink-0" />
                    <h2 className="text-lg sm:text-xl md:text-2xl font-bold tracking-normal text-[#1E293B]">
                      {section.name}
                    </h2>
                  </div>

                  <Link
                    to={`/category/${section.id || section.slug}`}
                    className="group inline-flex h-[30px] sm:h-[34px] min-w-[84px] sm:min-w-[94px] items-center justify-center gap-1.5 rounded-full bg-[#FFFFFF] hover:bg-[#F0F8E8] border border-[#E2E8F0] hover:border-[#22499F]/70 px-3.5 sm:px-4 text-[11.5px] sm:text-xs font-bold text-[#22499F] shadow-xs transition-all duration-200 active:scale-95 shrink-0"
                  >
                    <span className="leading-none">View All</span>
                    <ChevronRight
                      size={13}
                      strokeWidth={2.8}
                      className="transition-transform duration-200 group-hover:translate-x-0.5 text-[#22499F] shrink-0"
                    />
                  </Link>
                </div>

                {/* Single Row Product Display: Horizontal Carousel on Mobile (< md), Clean 6-col Grid on Desktop (>= md) */}
                <div className="flex overflow-x-auto pb-2 pt-1 -mx-3.5 px-3.5 sm:-mx-5 sm:px-5 scroll-px-3.5 sm:scroll-px-5 scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] snap-x snap-proximity gap-3 sm:gap-3.5 md:grid md:grid-cols-6 md:gap-3.5 lg:gap-4 md:overflow-visible md:pb-0 md:pt-0 md:mx-0 md:px-0">
                  {section.products.slice(0, 6).map((product) => (
                    <div
                      key={product.id}
                      className="w-[178px] sm:w-[195px] shrink-0 snap-start flex flex-col md:w-full md:shrink md:snap-align-none"
                    >
                      <ProductCard product={product} />
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {/* Explore All Categories Banner */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:p-6 shadow-xs mt-6 sm:mt-8">
              <div className="text-center sm:text-left">
                <h3 className="text-base sm:text-lg font-bold text-[#1E293B]">Looking for more categories?</h3>
                <p className="text-sm sm:text-base font-semibold text-[#64748B] mt-0.5">Explore every department and collection in one place</p>
              </div>
              <Link
                to="/categories"
                className="inline-flex items-center gap-2 rounded-xl bg-[#22499F] px-5 py-2.5 text-sm sm:text-base font-extrabold text-[#FFFFFF] transition hover:bg-[#22499F] active:scale-95 shadow-md shadow-[#22499F]/20 shrink-0"
              >
                <span>All Categories</span>
                <ChevronRight size={16} />
              </Link>
            </div>
          </>
        ) : (
          <div className="rounded-[18px] md:rounded-[20px] bg-[#FFFFFF] p-6 md:p-8 text-center border border-[#E2E8F0] shadow-xs">
            <p className="text-sm md:text-base font-semibold text-[#8FA4BE]">No products available at the moment.</p>
          </div>
        )}
      </div>

      {/* Floating Capsule Back to Top Button */}
      <BackToTopButton threshold={250} />
    </div>
  );
}

export default Home;
