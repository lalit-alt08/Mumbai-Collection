import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProductsByCategory, getCategories } from "../services/productService";
import ProductCard from "../components/product/ProductCard";
import staticCategories from "../data/category.js";
import { ArrowLeft, ShoppingBag, Loader2 } from "lucide-react";
import { getSessionProductOrderSeed, orderProductsForSession } from "../utils/productUtils";
import { useLiveProductStock } from "../hooks/useLiveProductStock";
import { getCategoryImageUrl } from "../utils/categoryImage";

const PER_PAGE = 20;

function Category() {
  const { categoryId } = useParams();
  const navigate = useNavigate();

  const [allCategories, setAllCategories] = useState(staticCategories);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [categoryTreeError, setCategoryTreeError] = useState("");
  const [categoryTreeLoaded, setCategoryTreeLoaded] = useState(false);
  const [productRetryCount, setProductRetryCount] = useState(0);
  const [categoryRetryCount, setCategoryRetryCount] = useState(0);
  const categoryRequestIdRef = useRef(0);
  const loadMoreControllerRef = useRef(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [categoryTitle, setCategoryTitle] = useState("");
  useLiveProductStock(products, setProducts);

  // Fetch full category tree on mount to establish parent-child relationships
  useEffect(() => {
    let isMounted = true;
    setCategoryTreeError("");
    getCategories()
      .then((data) => {
        if (isMounted && Array.isArray(data) && data.length > 0) {
          setAllCategories(data);
          setCategoryTreeLoaded(true);
        } else if (isMounted) {
          setCategoryTreeError("Category navigation could not be loaded.");
        }
      })
      .catch(() => {
        if (isMounted) setCategoryTreeError("Subcategories could not be loaded. Retry to see the full category menu.");
      });
    return () => {
      isMounted = false;
    };
  }, [categoryRetryCount]);

  // Determine current department, child subcategories, and active selection
  const currentCategoryInfo = useMemo(() => {
    const matched = allCategories.find(
      (c) => String(c.id) === String(categoryId) || c.slug?.toLowerCase() === String(categoryId).toLowerCase()
    );

    if (!matched) {
      return {
        department: null,
        children: [],
        initialSubcatId: null,
      };
    }

    // If user navigated directly to a child subcategory, determine its parent department
    if (matched.parent && Number(matched.parent) > 0) {
      const parentCat = allCategories.find((c) => Number(c.id) === Number(matched.parent)) || {
        id: matched.parent,
        name: "Department",
      };
      const hasCountData = allCategories.some((category) => category?.count !== undefined && category?.count !== null);
      const children = allCategories.filter(
        (c) =>
          Number(c.parent) === Number(parentCat.id) &&
          (!hasCountData || Number(c.count) > 0) &&
          c.slug?.toLowerCase() !== "uncategorized" &&
          c.name?.toLowerCase() !== "uncategorized"
      );
      return {
        department: parentCat,
        children,
        initialSubcatId: matched.id,
      };
    }

    // Otherwise, this is a top-level department
    const hasCountData = allCategories.some((category) => category?.count !== undefined && category?.count !== null);
    const children = allCategories.filter(
      (c) =>
        Number(c.parent) === Number(matched.id) &&
        (!hasCountData || Number(c.count) > 0) &&
        c.slug?.toLowerCase() !== "uncategorized" &&
        c.name?.toLowerCase() !== "uncategorized"
    );
    return {
      department: matched,
      children,
      initialSubcatId: null,
    };
  }, [allCategories, categoryId]);

  // The route is the source of truth so selected subcategories survive refresh, sharing, and browser Back.
  const activeSubcategoryId = currentCategoryInfo.initialSubcatId;

  useEffect(() => {
    if (!categoryTreeLoaded) return;
    const selectedSubcategory = allCategories.find(
      (category) =>
        String(category.id) === String(categoryId) ||
        category.slug?.toLowerCase() === String(categoryId).toLowerCase()
    );
    if (!selectedSubcategory || Number(selectedSubcategory.parent) <= 0) return;
    if (selectedSubcategory.count === undefined || selectedSubcategory.count === null) return;
    const count = Number(selectedSubcategory.count);
    if (!Number.isFinite(count) || count > 0) return;

    const parent = allCategories.find(
      (category) => Number(category.id) === Number(selectedSubcategory.parent)
    );
    if (parent) {
      navigate(`/category/${parent.slug || parent.id}`, { replace: true });
    } else {
      navigate("/categories", { replace: true });
    }
  }, [allCategories, categoryId, categoryTreeLoaded, navigate]);

  // Determine effective category to query: selected child or department root
  const effectiveCategoryId = useMemo(() => {
    return String(activeSubcategoryId ?? currentCategoryInfo.department?.id ?? categoryId);
  }, [activeSubcategoryId, currentCategoryInfo.department?.id, categoryId]);
  const effectiveCategoryIdRef = useRef(effectiveCategoryId);
  effectiveCategoryIdRef.current = effectiveCategoryId;

  const activeSubcategoryObj = useMemo(() => {
    if (!activeSubcategoryId) return null;
    return allCategories.find((c) => Number(c.id) === Number(activeSubcategoryId));
  }, [allCategories, activeSubcategoryId]);

  const categoryName =
    currentCategoryInfo.department?.name ||
    activeSubcategoryObj?.name ||
    categoryTitle ||
    "Category Products";

  useEffect(() => {
    document.title = `${categoryName} | Mumbai Collection`;
    return () => {
      document.title = "Mumbai Collection | Toys & Stationery Store";
    };
  }, [categoryName]);

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;
    const requestId = ++categoryRequestIdRef.current;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    const loadInitialProducts = async () => {
      try {
        setLoading(true);
        setLoadingMore(false);
        setLoadError("");
        setLoadMoreError("");
        setCategoryTitle("");
        setPage(1);
        const data = await getProductsByCategory(
          effectiveCategoryId,
          { page: 1, per_page: PER_PAGE },
          { signal: controller.signal }
        );
        if (isMounted && !controller.signal.aborted) {
          const prods = Array.isArray(data)
            ? data
            : Array.isArray(data?.products)
            ? data.products
            : [];
          const count = typeof data?.total === "number" ? data.total : prods.length;
          const pages = typeof data?.totalPages === "number" ? data.totalPages : (prods.length > 0 ? 1 : 0);

          // Deduplicate products by id
          const seen = new Set();
          const uniqueProds = [];
          for (const p of prods) {
            if (p && p.id && !seen.has(p.id)) {
              seen.add(p.id);
              uniqueProds.push(p);
            }
          }

          setProducts(orderProductsForSession(uniqueProds, getSessionProductOrderSeed(), `category-${effectiveCategoryId}`, { retainUnseen: true }));
          setTotalCount(count);
          setTotalPages(pages);

          if (uniqueProds.length > 0) {
            for (const p of uniqueProds) {
              const matched = p.categories?.find(
                (c) =>
                  String(c.id) === String(effectiveCategoryId) ||
                  c.slug?.toLowerCase() === String(effectiveCategoryId).toLowerCase()
              );
              if (matched?.name) {
                setCategoryTitle(matched.name);
                break;
              }
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted || err.name === "CanceledError" || err.code === "ERR_CANCELED") return;
        if (isMounted && requestId === categoryRequestIdRef.current) {
          setProducts([]);
          setLoadError("We couldn't load products for this category. Check your connection and try again.");
        }
      } finally {
        if (isMounted && !controller.signal.aborted) setLoading(false);
      }
    };

    loadInitialProducts();
    return () => {
      isMounted = false;
      controller.abort();
      loadMoreControllerRef.current?.abort();
      if (categoryRequestIdRef.current === requestId) categoryRequestIdRef.current += 1;
    };
  }, [effectiveCategoryId, productRetryCount]);

  const handleLoadMore = async () => {
    if (loadingMore || page >= totalPages) return;

    const requestId = categoryRequestIdRef.current;
    const requestedCategoryId = effectiveCategoryId;
    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = controller;
    try {
      setLoadingMore(true);
      setLoadMoreError("");
      const nextPage = page + 1;
      const data = await getProductsByCategory(
        requestedCategoryId,
        { page: nextPage, per_page: PER_PAGE },
        { signal: controller.signal }
      );
      if (
        controller.signal.aborted ||
        requestId !== categoryRequestIdRef.current ||
        requestedCategoryId !== effectiveCategoryIdRef.current
      ) return;
      const pageProducts = Array.isArray(data)
        ? data
        : Array.isArray(data?.products)
        ? data.products
        : [];
      const nextProds = orderProductsForSession(pageProducts, getSessionProductOrderSeed(), `category-${effectiveCategoryId}`, { retainUnseen: true });
      const count = typeof data?.total === "number" ? data.total : totalCount;
      const pages = typeof data?.totalPages === "number" ? data.totalPages : totalPages;

      setProducts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const filteredNew = nextProds.filter((p) => {
          if (!p?.id || existingIds.has(p.id)) return false;
          existingIds.add(p.id);
          return true;
        });
        return [...prev, ...filteredNew];
      });
      setPage(nextPage);
      setTotalCount(count);
      setTotalPages(pages);
    } catch {
      if (
        !controller.signal.aborted &&
        requestId === categoryRequestIdRef.current &&
        requestedCategoryId === effectiveCategoryIdRef.current
      ) {
        setLoadMoreError("More products couldn't be loaded. Try again.");
      }
    } finally {
      if (requestId === categoryRequestIdRef.current && requestedCategoryId === effectiveCategoryIdRef.current) {
        setLoadingMore(false);
      }
      if (loadMoreControllerRef.current === controller) loadMoreControllerRef.current = null;
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

  const productContent = loading ? (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <div
          key={n}
          className="h-72 rounded-[20px] bg-[#111F36] p-3.5 shadow-xs border border-[#1E3252]/60 animate-pulse"
        >
          <div className="aspect-square w-full rounded-[14px] bg-[#080F1C] mb-3" />
          <div className="h-4 w-3/4 bg-[#162744] rounded mb-2" />
          <div className="h-4 w-1/2 bg-[#162744] rounded" />
        </div>
      ))}
    </div>
  ) : loadError ? (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-[24px] border border-rose-400/30 bg-[#111F36] p-8 text-center">
      <h3 className="text-base font-bold text-white">Products couldn’t be loaded</h3>
      <p role="alert" className="mt-2 mb-5 text-xs text-[#8FA4BE]">{loadError}</p>
      <button
        type="button"
        onClick={() => setProductRetryCount((count) => count + 1)}
        className="rounded-full bg-[#42D6E8] px-5 py-2 text-xs font-bold text-[#061220] hover:bg-[#2CC4D8]"
      >
        Retry
      </button>
    </div>
  ) : products.length === 0 ? (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-[24px] bg-[#111F36] p-8 text-center shadow-[0_8px_30px_rgba(0,0,0,0.3)] border border-[#1E3252]">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#132B45] text-[#42D6E8]">
        <ShoppingBag size={24} />
      </div>
      <h3 className="text-base font-bold text-white">No products found</h3>
      <p className="text-xs text-[#8FA4BE] mt-1 mb-5">
        Check back soon for new arrivals in this department.
      </p>
      <button
        onClick={() => navigate("/categories")}
        className="rounded-full bg-[#42D6E8] px-5 py-2 text-xs font-bold text-[#061220] shadow-xs hover:bg-[#2CC4D8] transition active:scale-95 cursor-pointer"
      >
        Browse Other Categories
      </button>
    </div>
  ) : (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {page < totalPages && (
        <div className="pt-6 pb-2 flex flex-col items-center justify-center gap-2">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="flex items-center justify-center gap-2 rounded-full bg-[#42D6E8] px-6 py-2.5 text-xs sm:text-sm font-bold text-[#061220] shadow-sm hover:bg-[#2CC4D8] transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
          <p className="text-[11px] font-medium text-[#8FA4BE]">
            Showing {products.length} of {totalCount} products
          </p>
          {loadMoreError && <p role="alert" className="text-xs text-rose-300">{loadMoreError}</p>}
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-[#0B1425] text-white px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
        {/* ────────────────────────────────────────────────────────── */}
        {/* TOP BAR / NAVIGATION                                       */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              aria-label="Back"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111F36] text-white shadow-xs border border-[#1E3252] transition-all hover:border-[#42D6E8] hover:bg-[#162744] hover:text-[#42D6E8] active:scale-95 cursor-pointer"
            >
              <ArrowLeft size={17} strokeWidth={2.2} />
            </button>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
                {categoryName}
              </h1>
            </div>
          </div>

          <span className="text-xs font-bold text-[#42D6E8] bg-[#132B45] px-3 py-1 rounded-full border border-[#1E3E63]">
            {displayCount}
          </span>
        </div>

        {categoryTreeError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-100">
            <span>{categoryTreeError}</span>
            <button
              type="button"
              onClick={() => setCategoryRetryCount((count) => count + 1)}
              className="shrink-0 rounded-lg border border-amber-300/40 px-3 py-1.5 font-bold hover:bg-amber-300/10"
            >
              Retry
            </button>
          </div>
        )}

        {currentCategoryInfo.children.length > 0 ? (
          <div className="grid grid-cols-[68px_minmax(0,1fr)] gap-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4 md:grid-cols-[112px_minmax(0,1fr)]">
            <aside
              aria-label={`${currentCategoryInfo.department?.name || "Category"} subcategories`}
              className="sticky top-3 max-h-[calc(100vh-1.5rem)] self-start overflow-y-auto overscroll-contain rounded-2xl border border-[#1E3252]/70 bg-[#0E1A2E] p-1.5 sm:p-2"
            >
              <nav className="flex flex-col gap-1.5 sm:gap-2" aria-label="Subcategories">
                <button
                  type="button"
                  aria-current={activeSubcategoryId === null ? "page" : undefined}
                  onClick={() => navigate(`/category/${currentCategoryInfo.department?.id || categoryId}`)}
                  className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition-colors active:scale-[0.98] ${
                    activeSubcategoryId === null
                      ? "border border-[#42D6E8]/60 bg-[#132B45] text-[#42D6E8]"
                      : "border border-transparent text-[#8FA4BE] hover:bg-[#111F36] hover:text-white"
                  }`}
                >
                  <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-[#1E3252] bg-[#080F1C] p-1 sm:h-12 sm:w-12">
                    <img
                      src={getCategoryImageUrl(currentCategoryInfo.department)}
                      alt=""
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </span>
                  <span className="w-full break-words text-[10px] font-bold leading-tight sm:text-xs">All</span>
                </button>

                {currentCategoryInfo.children.map((sub) => {
                  const isSelected = String(activeSubcategoryId) === String(sub.id);
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      aria-current={isSelected ? "page" : undefined}
                      aria-label={`Show ${sub.name} products`}
                      onClick={() => navigate(`/category/${sub.id}`)}
                      className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition-colors active:scale-[0.98] ${
                        isSelected
                          ? "border border-[#42D6E8]/60 bg-[#132B45] text-[#42D6E8]"
                          : "border border-transparent text-[#8FA4BE] hover:bg-[#111F36] hover:text-white"
                      }`}
                    >
                      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-[#1E3252] bg-[#080F1C] p-1 sm:h-12 sm:w-12">
                        <img
                          src={getCategoryImageUrl(sub)}
                          alt=""
                          className="h-full w-full object-contain"
                          loading="lazy"
                          onError={(event) => {
                            if (event.currentTarget.dataset.fallback !== "true") {
                              event.currentTarget.dataset.fallback = "true";
                              event.currentTarget.src = "/categories/category-placeholder.svg";
                            } else {
                              event.currentTarget.style.display = "none";
                            }
                          }}
                        />
                      </span>
                      <span className="w-full break-words text-[10px] font-semibold leading-tight sm:text-xs">
                        {sub.name}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </aside>
            <section aria-label={`${activeSubcategoryObj?.name || currentCategoryInfo.department?.name || "Category"} products`} className="min-w-0">
              {productContent}
            </section>
          </div>
        ) : (
          productContent
        )}
      </div>
    </div>
  );
}

export default Category;
