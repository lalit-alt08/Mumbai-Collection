import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getProductsByCategory, getCategories, getCachedCategories } from "../services/productService";
import ProductCard from "../components/product/ProductCard";
import { ChevronLeft, ChevronDown, ChevronRight, Share, Search, ShoppingBag, Loader2, MapPin, Home, Building2, Phone, X, CheckCircle2 } from "lucide-react";
import { getSessionProductOrderSeed, orderProductsForSession, formatSubcategoryName } from "../utils/productUtils";
import { useLiveProductStock } from "../hooks/useLiveProductStock";
import { getCategoryImageUrl } from "../utils/categoryImage";
import { safeStorage } from "../utils/safeStorage";
import API_URL from "../config/api.js";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

const PER_PAGE = 20;

function Category() {
  const { user, isAuthenticated } = useAuth();
  const { categoryId } = useParams();
  const navigate = useNavigate();

  const [allCategories, setAllCategories] = useState(() => getCachedCategories() || []);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [categoryTreeError, setCategoryTreeError] = useState("");
  const [categoryTreeLoaded, setCategoryTreeLoaded] = useState(
    () => Array.isArray(getCachedCategories()) && getCachedCategories().length > 0
  );
  const [productRetryCount, setProductRetryCount] = useState(0);
  const [categoryRetryCount, setCategoryRetryCount] = useState(0);
  const productsContainerRef = useRef(null);
  const subcategoryRailRef = useRef(null);
  const categoryRequestIdRef = useRef(0);
  const loadMoreControllerRef = useRef(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [categoryTitle, setCategoryTitle] = useState("");
  // Keep polling bounded as more pages are appended. Checkout and add-to-cart
  // still perform authoritative server validation for every item.
  const liveProducts = useMemo(() => products.slice(-40), [products]);
  useLiveProductStock(liveProducts, setProducts);

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
          const cached = getCachedCategories();
          if (Array.isArray(cached) && cached.length > 0) {
            setAllCategories((current) => (current.length > 0 ? current : cached));
            setCategoryTreeLoaded(true);
            console.warn("[Category] Category sync returned no data; continuing with cached navigation.");
          } else {
            setCategoryTreeError("Category navigation could not be loaded.");
          }
        }
      })
      .catch((error) => {
        if (!isMounted) return;
        const cached = getCachedCategories();
        if (Array.isArray(cached) && cached.length > 0) {
          setAllCategories((current) => (current.length > 0 ? current : cached));
          setCategoryTreeLoaded(true);
          console.warn(
            "[Category] Background category sync failed; continuing with cached navigation.",
            error?.response?.status || error?.code || "network_error"
          );
          return;
        }
        setCategoryTreeError("Subcategories could not be loaded. Retry to see the full category menu.");
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

  const departmentName = currentCategoryInfo.department?.name || categoryTitle || "Category Products";
  const activeSubcategoryTitle = activeSubcategoryObj
    ? formatSubcategoryName(activeSubcategoryObj.name, departmentName)
    : "All Products";

  const categoryName = activeSubcategoryObj
    ? activeSubcategoryTitle
    : departmentName;

  useEffect(() => {
    const pageTitle = activeSubcategoryObj
      ? `${activeSubcategoryTitle} • ${departmentName}`
      : departmentName;
    document.title = `${pageTitle} | Mumbai Collection`;
    return () => {
      document.title = "Mumbai Collection | Toys & Stationery Store";
    };
  }, [activeSubcategoryTitle, departmentName, activeSubcategoryObj]);

  // Lock body overflow so window scrolling doesn't push the category header or rail around
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // When switching subcategory or department, reset products scroll to top
  useEffect(() => {
    productsContainerRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [effectiveCategoryId]);

  // Auto-scroll the active subcategory into view within the rail if needed
  useEffect(() => {
    if (!activeSubcategoryId || !subcategoryRailRef.current) return;
    const activeEl = subcategoryRailRef.current.querySelector('[aria-current="page"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [activeSubcategoryId, currentCategoryInfo.children]);


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

  const [copiedShare, setCopiedShare] = useState(false);
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState(() => {
    try {
      const cached = safeStorage.getJSON("saved_addresses_cache", []);
      return Array.isArray(cached) ? cached : [];
    } catch {
      return [];
    }
  });
  const [selectedAddressId, setSelectedAddressId] = useState(() => {
    try {
      return safeStorage.getItem("selected_address_id") || null;
    } catch {
      return null;
    }
  });

  // Fetch saved addresses in background to keep data fresh (only if authenticated)
  useEffect(() => {
    if (!isAuthenticated && !user) {
      setSavedAddresses([]);
      return;
    }

    let isMounted = true;
    axios
      .get(`${API_URL}/addresses`, { withCredentials: true })
      .then((res) => {
        if (isMounted && res.data?.addresses && Array.isArray(res.data.addresses)) {
          setSavedAddresses(res.data.addresses);
          safeStorage.setJSON("saved_addresses_cache", res.data.addresses);
        }
      })
      .catch(() => {
        // Fallback to cached on network failure
      });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, user]);

  // Close address modal on Escape & signal modal state to layout (hiding floating cart bar)
  useEffect(() => {
    if (!showAddressModal) {
      delete document.body.dataset.modalOpen;
      window.dispatchEvent(new CustomEvent("mc-modal-state", { detail: { open: false } }));
      return;
    }

    document.body.dataset.modalOpen = "true";
    window.dispatchEvent(new CustomEvent("mc-modal-state", { detail: { open: true } }));

    const handleKeyDown = (e) => {
      if (e.key === "Escape") setShowAddressModal(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      delete document.body.dataset.modalOpen;
      window.dispatchEvent(new CustomEvent("mc-modal-state", { detail: { open: false } }));
    };
  }, [showAddressModal]);

  const activeAddress = useMemo(() => {
    if (savedAddresses.length > 0) {
      if (selectedAddressId) {
        const found = savedAddresses.find((a) => String(a.id) === String(selectedAddressId));
        if (found) return found;
      }
      return savedAddresses[0];
    }
    return null;
  }, [savedAddresses, selectedAddressId]);

  const deliveryLocationText = useMemo(() => {
    if (activeAddress) {
      const line = activeAddress.address_line1 || activeAddress.city || "Mumbai";
      const rawType = activeAddress.type || "Home";
      const type = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
      return `Delivering to ${type}: ${line}`;
    }
    return "Delivering to Home: Mumbai";
  }, [activeAddress]);

  const handleShare = async () => {
    const shareData = {
      title: `${departmentName} | Mumbai Collection`,
      text: `Check out ${departmentName} on Mumbai Collection!`,
      url: window.location.href,
    };
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (_) {
        // user dismissed share sheet
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2000);
      } catch (_) {
        // fallback
      }
    }
  };

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
        <div className="pt-6 pb-6 flex flex-col items-center justify-center gap-2">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full max-w-sm flex items-center justify-center gap-2 rounded-2xl bg-[#132238] hover:bg-[#182C4A] border border-[#1F365A] py-3.5 px-6 text-xs sm:text-sm font-bold text-[#E2E8F0] shadow-sm transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loadingMore ? (
              <>
                <Loader2 size={16} className="animate-spin text-[#42D6E8]" />
                <span>Loading products...</span>
              </>
            ) : (
              <>
                <span>See all products</span>
                <ChevronRight size={16} strokeWidth={2.4} className="text-[#8FA4BE]" />
              </>
            )}
          </button>

          {loadMoreError && <p role="alert" className="text-xs text-rose-300">{loadMoreError}</p>}
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--safe-area-top,env(safe-area-inset-top,0px)))] max-h-[calc(100dvh-var(--safe-area-top,env(safe-area-inset-top,0px)))] bg-[#0B1425] text-white overflow-hidden">
      {/* ────────────────────────────────────────────────────────── */}
      {/* FIXED TOP BAR / NAVIGATION (Exact Blinkit-style)            */}
      {/* ────────────────────────────────────────────────────────── */}
      <header className="shrink-0 z-30 bg-[#0B1425] px-2.5 sm:px-4 py-2 sm:py-2.5">
        <div className="mx-auto max-w-7xl flex items-center justify-between gap-2 sm:gap-2.5">
          {/* Left: Circular Back Button */}
          <button
            onClick={handleBack}
            aria-label="Back"
            className="flex h-10 w-10 sm:h-10.5 sm:w-10.5 shrink-0 items-center justify-center rounded-full bg-[#122038]/90 backdrop-blur-md text-white border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#1A2E4C] hover:border-white/20 active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={21} strokeWidth={2.4} />
          </button>

          {/* Center: Elongated Capsule with Title + Delivery Address (Shows in-place address info on click) */}
          <button
            onClick={() => setShowAddressModal(true)}
            aria-label="View complete delivery address"
            className="flex-1 min-w-0 flex flex-col justify-center rounded-full bg-[#122038]/90 backdrop-blur-md border border-white/10 px-3.5 sm:px-4 py-1.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#1A2E4C] hover:border-white/20 active:scale-[0.99] text-left cursor-pointer"
          >
            <span className="text-[13px] sm:text-[14px] font-bold text-white truncate leading-tight tracking-tight">
              {departmentName}
            </span>
            <div className="flex items-center gap-1 min-w-0 mt-0.5">
              <span className="text-[10px] sm:text-[11px] font-semibold text-[#8FE3D9] truncate leading-tight">
                {deliveryLocationText}
              </span>
              <ChevronDown size={11} strokeWidth={2.8} className="text-[#8FE3D9] shrink-0" />
            </div>
          </button>

          {/* Right: Two Circular Buttons (Share & Search) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleShare}
              aria-label="Share category"
              title={copiedShare ? "Link copied!" : "Share"}
              className="relative flex h-10 w-10 sm:h-10.5 sm:w-10.5 shrink-0 items-center justify-center rounded-full bg-[#122038]/90 backdrop-blur-md text-white border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#1A2E4C] hover:border-white/20 active:scale-95 cursor-pointer"
            >
              <Share size={17} strokeWidth={2.2} />
              {copiedShare && (
                <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/90 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 shadow-md">
                  Copied!
                </span>
              )}
            </button>

            <Link
              to="/search"
              aria-label="Search"
              className="flex h-10 w-10 sm:h-10.5 sm:w-10.5 shrink-0 items-center justify-center rounded-full bg-[#122038]/90 backdrop-blur-md text-white border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#1A2E4C] hover:border-white/20 active:scale-95"
            >
              <Search size={18} strokeWidth={2.2} />
            </Link>
          </div>
        </div>
      </header>

      {/* ────────────────────────────────────────────────────────── */}
      {/* DELIVERY ADDRESS INFORMATION MODAL (IN-PLACE POPUP)        */}
      {/* ────────────────────────────────────────────────────────── */}
      {showAddressModal && (
        <div
          role="dialog"
          aria-modal="true"
          data-modal="true"
          aria-labelledby="delivery-info-title"
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
          onClick={() => setShowAddressModal(false)}
        >
          <div
            className="w-full max-w-md rounded-t-[28px] sm:rounded-3xl bg-[#0F1C31] border border-[#1E365A] p-5 sm:p-6 text-white shadow-2xl relative animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile Drag Pill */}
            <div className="mx-auto mb-3.5 h-1.5 w-10 rounded-full bg-white/20 sm:hidden" />

            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-[#1A2E4C]">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#42D6E8]/15 text-[#42D6E8] border border-[#42D6E8]/30">
                  <MapPin size={18} strokeWidth={2.4} />
                </div>
                <div>
                  <h3 id="delivery-info-title" className="text-base font-bold text-white leading-tight">
                    Delivery Address
                  </h3>
                  <p className="text-[11px] text-[#8FA4BE] mt-0.5">
                    Order destination details
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddressModal(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition active:scale-95 cursor-pointer"
              >
                <X size={16} strokeWidth={2.4} />
              </button>
            </div>

            {/* Address Details Body */}
            <div className="mt-4 space-y-3">
              {activeAddress ? (
                <div className="rounded-2xl bg-[#091322] border border-[#1A3154] p-4">
                  {/* Tag & Recipient Name */}
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase bg-[#42D6E8]/15 text-[#42D6E8] border border-[#42D6E8]/30">
                      {activeAddress.type?.toLowerCase() === "office" ? (
                        <Building2 size={12} strokeWidth={2.4} />
                      ) : (
                        <Home size={12} strokeWidth={2.4} />
                      )}
                      {activeAddress.type || "Home"}
                    </span>
                    {(activeAddress.first_name || activeAddress.name) && (
                      <span className="text-xs font-semibold text-white/90 truncate">
                        {activeAddress.first_name ? `${activeAddress.first_name} ${activeAddress.last_name || ""}`.trim() : activeAddress.name}
                      </span>
                    )}
                  </div>

                  {/* Complete Address Lines */}
                  <div className="text-xs sm:text-[13px] text-[#CBD5E1] space-y-1">
                    <p className="font-semibold text-white text-sm">
                      {activeAddress.address_line1}
                    </p>
                    {activeAddress.address_line2 && (
                      <p className="text-[#94A3B8]">{activeAddress.address_line2}</p>
                    )}
                    <p className="text-[#94A3B8]">
                      {activeAddress.city}
                      {activeAddress.state ? `, ${activeAddress.state}` : ""}
                      {activeAddress.pincode || activeAddress.postal_code ? ` - ${activeAddress.pincode || activeAddress.postal_code}` : ""}
                    </p>
                  </div>

                  {/* Phone */}
                  {activeAddress.phone && (
                    <div className="mt-3 pt-2.5 border-t border-[#162744] flex items-center gap-2 text-xs text-[#8FA4BE]">
                      <Phone size={13} className="text-[#42D6E8] shrink-0" />
                      <span>Contact: <span className="text-white font-medium">{activeAddress.phone}</span></span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl bg-[#091322] border border-[#1A3154] p-4 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-[#42D6E8]/15 text-[#42D6E8] border border-[#42D6E8]/30">
                      <Home size={12} strokeWidth={2.4} /> Home
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">Mumbai, Maharashtra</p>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Active delivery region: Delivering toys, stationery, games & gifts across Mumbai with fast standard & express dispatch.
                  </p>
                </div>
              )}

              {/* If user has multiple saved addresses (Home & Office), allow selecting between them in-place */}
              {savedAddresses.length > 1 && (
                <div className="pt-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8FA4BE] mb-2">
                    Switch Saved Address
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {savedAddresses.map((addr) => {
                      const isSelected = String(addr.id) === String(activeAddress?.id);
                      return (
                        <button
                          key={addr.id}
                          type="button"
                          onClick={() => {
                            setSelectedAddressId(addr.id);
                            safeStorage.setItem("selected_address_id", addr.id);
                          }}
                          className={`flex items-center gap-2 rounded-xl p-2.5 text-left border text-xs transition cursor-pointer ${
                            isSelected
                              ? "bg-[#10233D] border-[#42D6E8] text-white shadow-xs"
                              : "bg-[#091424] border-[#182C4A] text-[#8FA4BE] hover:text-white"
                          }`}
                        >
                          {addr.type?.toLowerCase() === "office" ? (
                            <Building2 size={14} className={isSelected ? "text-[#42D6E8]" : "text-[#8FA4BE]"} />
                          ) : (
                            <Home size={14} className={isSelected ? "text-[#42D6E8]" : "text-[#8FA4BE]"} />
                          )}
                          <span className="truncate font-semibold capitalize">
                            {addr.type || "Address"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="mt-5 flex items-center justify-between pt-3 border-t border-[#1A2E4C] text-[11px] text-[#8FA4BE]">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                Verified delivery zone
              </span>
              <button
                type="button"
                onClick={() => setShowAddressModal(false)}
                className="rounded-full bg-[#1A3154] hover:bg-[#22406D] text-[#42D6E8] font-bold px-4 py-1.5 text-xs transition active:scale-95 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {categoryTreeError && allCategories.length === 0 && currentCategoryInfo.children.length === 0 && (
        <div className="shrink-0 mx-3.5 my-2 flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-100">
          <span>{categoryTreeError}</span>
          <button
            type="button"
            onClick={() => setCategoryRetryCount((count) => count + 1)}
            className="shrink-0 rounded-lg border border-amber-300/40 px-3 py-1 font-bold hover:bg-amber-300/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────── */}
      {/* MAIN TWO-COLUMN CONTENT AREA (FIXED HEIGHT, INDEPENDENT SCROLL) */}
      {/* ────────────────────────────────────────────────────────── */}
      {currentCategoryInfo.children.length > 0 ? (
        <div className="flex-1 min-h-0 flex mx-auto max-w-7xl w-full overflow-hidden">
          {/* LEFT: Blinkit-style Subcategory Rail */}
          <aside
            ref={subcategoryRailRef}
            aria-label={`${departmentName} subcategories`}
            className="w-[80px] sm:w-[88px] md:w-[100px] shrink-0 h-full overflow-y-auto overscroll-contain border-r border-[#162744]/70 bg-[#0B1425] py-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] touch-pan-y select-none"
          >
            <nav className="flex flex-col gap-1 pb-44 sm:pb-48 lg:pb-16" aria-label="Subcategories">
              {/* "All" button */}
              <button
                type="button"
                aria-current={activeSubcategoryId === null ? "page" : undefined}
                onClick={() => navigate(`/category/${currentCategoryInfo.department?.id || categoryId}`)}
                className="group relative flex flex-col items-center justify-center py-2.5 px-1 text-center transition-all duration-150 active:scale-95 cursor-pointer"
              >
                {/* Active Indicator Bar (Blinkit style on right edge) */}
                {activeSubcategoryId === null && (
                  <span className="absolute right-0 top-1/2 -translate-y-1/2 w-[3.5px] h-8 rounded-l-full bg-[#42D6E8] shadow-[0_0_8px_rgba(66,214,232,0.6)]" />
                )}

                <span className={`flex h-12 w-12 sm:h-13 sm:w-13 items-center justify-center overflow-hidden rounded-full border p-1 transition-all ${
                  activeSubcategoryId === null
                    ? "border-2 border-[#42D6E8] bg-[#122238] shadow-[0_0_12px_rgba(66,214,232,0.25)] scale-105"
                    : "border border-[#1A2E4C] bg-[#0E1B2E] group-hover:border-[#2B4772]"
                }`}>
                  <img
                    src={getCategoryImageUrl(currentCategoryInfo.department)}
                    alt=""
                    width="48"
                    height="48"
                    className="h-full w-full object-contain"
                    loading="lazy"
                    decoding="async"
                  />
                </span>

                <span className={`w-full line-clamp-2 text-[10.5px] sm:text-[11px] leading-tight tracking-tight mt-1.5 ${
                  activeSubcategoryId === null ? "font-black text-[#42D6E8]" : "font-medium text-[#8FA4BE] group-hover:text-white"
                }`}>
                  All
                </span>
              </button>

              {/* Subcategory buttons */}
              {currentCategoryInfo.children.map((sub) => {
                const isSelected = String(activeSubcategoryId) === String(sub.id);
                const subName = formatSubcategoryName(sub.name, departmentName);

                return (
                  <button
                    key={sub.id}
                    type="button"
                    aria-current={isSelected ? "page" : undefined}
                    aria-label={`Show ${subName} products`}
                    onClick={() => navigate(`/category/${sub.id}`)}
                    className="group relative flex flex-col items-center justify-center py-2.5 px-1 text-center transition-all duration-150 active:scale-95 cursor-pointer"
                  >
                    {/* Active Indicator Bar (Blinkit style on right edge) */}
                    {isSelected && (
                      <span className="absolute right-0 top-1/2 -translate-y-1/2 w-[3.5px] h-8 rounded-l-full bg-[#42D6E8] shadow-[0_0_8px_rgba(66,214,232,0.6)]" />
                    )}

                    <span className={`flex h-12 w-12 sm:h-13 sm:w-13 items-center justify-center overflow-hidden rounded-full border p-1 transition-all ${
                      isSelected
                        ? "border-2 border-[#42D6E8] bg-[#122238] shadow-[0_0_12px_rgba(66,214,232,0.25)] scale-105"
                        : "border border-[#1A2E4C] bg-[#0E1B2E] group-hover:border-[#2B4772]"
                    }`}>
                      <img
                        src={getCategoryImageUrl(sub)}
                        alt=""
                        width="48"
                        height="48"
                        className="h-full w-full object-contain"
                        loading="lazy"
                        decoding="async"
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

                    <span className={`w-full line-clamp-2 text-[10.5px] sm:text-[11px] leading-tight tracking-tight mt-1.5 ${
                      isSelected ? "font-black text-[#42D6E8]" : "font-medium text-[#8FA4BE] group-hover:text-white"
                    }`}>
                      {subName}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* RIGHT: Independent Products Scroll View */}
          <section
            ref={productsContainerRef}
            aria-label={`${activeSubcategoryTitle} products`}
            className="flex-1 min-w-0 h-full overflow-y-auto overscroll-contain px-2.5 pt-3 pb-44 sm:px-4 sm:pt-3.5 sm:pb-48 lg:pb-16 touch-pan-y"
          >
            {/* Blinkit-style Subcategory Hero Banner */}
            <div className="mb-3 relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0E2038] via-[#0B182B] to-[#071220] border border-[#182F4E] p-3 sm:p-3.5 shadow-xs flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 z-10">
                <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight leading-tight truncate">
                  {activeSubcategoryTitle}
                </h2>
              </div>
              <div className="shrink-0 h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-[#091526] border border-[#1C3559] p-1 flex items-center justify-center overflow-hidden shadow-xs">
                <img
                  src={getCategoryImageUrl(activeSubcategoryObj || currentCategoryInfo.department)}
                  alt=""
                  className="h-full w-full object-contain"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              </div>
            </div>

            {productContent}
          </section>
        </div>
      ) : (
        <section
          ref={productsContainerRef}
          aria-label={`${categoryName} products`}
          className="flex-1 min-w-0 h-full overflow-y-auto overscroll-contain mx-auto max-w-7xl w-full px-4 pt-4 pb-44 sm:px-6 sm:pb-48 lg:pb-16 touch-pan-y"
        >
          {productContent}
        </section>
      )}
    </div>
  );
}

export default Category;
