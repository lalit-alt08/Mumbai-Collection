import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProductsByCategory } from "../services/productService";
import ProductCard from "../components/product/ProductCard";
import categories from "../data/category.js";
import { ArrowLeft, ShoppingBag, Loader2 } from "lucide-react";

const PER_PAGE = 20;

function Category() {
  const { categoryId } = useParams();
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [categoryTitle, setCategoryTitle] = useState("");

  const staticCategory = categories.find(
    (c) => String(c.id) === String(categoryId) || c.slug?.toLowerCase() === String(categoryId).toLowerCase()
  );
  const categoryName = categoryTitle || staticCategory?.name || "Category Products";

  useEffect(() => {
    let isMounted = true;
    const loadInitialProducts = async () => {
      try {
        setLoading(true);
        setPage(1);
        const data = await getProductsByCategory(categoryId, { page: 1, per_page: PER_PAGE });
        if (isMounted) {
          const prods = Array.isArray(data)
            ? data
            : Array.isArray(data?.products)
            ? data.products
            : [];
          const count = typeof data?.total === "number" ? data.total : prods.length;
          const pages = typeof data?.totalPages === "number" ? data.totalPages : (prods.length > 0 ? 1 : 0);

          setProducts(prods);
          setTotalCount(count);
          setTotalPages(pages);

          if (prods.length > 0) {
            for (const p of prods) {
              const matched = p.categories?.find(
                (c) =>
                  String(c.id) === String(categoryId) ||
                  c.slug?.toLowerCase() === String(categoryId).toLowerCase()
              );
              if (matched?.name) {
                setCategoryTitle(matched.name);
                break;
              }
            }
          }
        }
      } catch {
        // Handled by loading state
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadInitialProducts();
    return () => {
      isMounted = false;
    };
  }, [categoryId]);

  const handleLoadMore = async () => {
    if (loadingMore || page >= totalPages) return;

    try {
      setLoadingMore(true);
      const nextPage = page + 1;
      const data = await getProductsByCategory(categoryId, { page: nextPage, per_page: PER_PAGE });
      const nextProds = Array.isArray(data)
        ? data
        : Array.isArray(data?.products)
        ? data.products
        : [];
      const count = typeof data?.total === "number" ? data.total : totalCount;
      const pages = typeof data?.totalPages === "number" ? data.totalPages : totalPages;

      setProducts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const filteredNew = nextProds.filter((p) => !existingIds.has(p.id));
        return [...prev, ...filteredNew];
      });
      setPage(nextPage);
      setTotalCount(count);
      setTotalPages(pages);
    } catch {
      // Handled by loadingMore state
    } finally {
      setLoadingMore(false);
    }
  };

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const displayCount = loading ? "Loading..." : `${totalCount} ${totalCount === 1 ? "item" : "items"}`;

  return (
    <div className="min-h-screen bg-[#F8F9FD] text-[#1E1E1E] px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
        {/* ────────────────────────────────────────────────────────── */}
        {/* TOP BAR / NAVIGATION                                       */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              aria-label="Back"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-700 shadow-xs border border-gray-200/70 transition-all hover:border-[#7C3AED]/30 hover:bg-[#F5F3FF] hover:text-[#7C3AED] active:scale-95 cursor-pointer"
            >
              <ArrowLeft size={17} strokeWidth={2.2} />
            </button>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-[#1E1E1E] sm:text-xl">
                {categoryName}
              </h1>
            </div>
          </div>

          <span className="text-xs font-bold text-[#7C3AED] bg-[#F5F3FF] px-3 py-1 rounded-full border border-[#7C3AED]/15">
            {displayCount}
          </span>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* PRODUCTS GRID                                              */}
        {/* ────────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3.5 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="h-72 rounded-[20px] bg-white p-3.5 shadow-xs border border-gray-100 animate-pulse"
              >
                <div className="aspect-square w-full rounded-[14px] bg-gray-100 mb-3" />
                <div className="h-4 w-3/4 bg-gray-100 rounded mb-2" />
                <div className="h-4 w-1/2 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-[24px] bg-white p-8 text-center shadow-[0_8px_30px_rgba(0,0,0,0.02)] border border-gray-100">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#F5F3FF] text-[#7C3AED]">
              <ShoppingBag size={24} />
            </div>
            <h3 className="text-base font-bold text-[#1E1E1E]">
              No products found
            </h3>
            <p className="text-xs text-gray-500 mt-1 mb-5">
              Check back soon for new arrivals in this department.
            </p>
            <button
              onClick={() => navigate("/categories")}
              className="rounded-full bg-[#7C3AED] px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#6C35E8] transition active:scale-95 cursor-pointer"
            >
              Browse Other Categories
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3.5 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {/* Load More Button */}
            {page < totalPages && (
              <div className="pt-6 pb-2 flex flex-col items-center justify-center gap-2">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="flex items-center justify-center gap-2 rounded-full bg-[#7C3AED] px-6 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-[#6C35E8] transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Loading more...</span>
                    </>
                  ) : (
                    <span>Load More Products</span>
                  )}
                </button>
                <p className="text-[11px] font-medium text-gray-500">
                  Showing {products.length} of {totalCount} products
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Category;