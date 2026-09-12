import { useEffect, useState, useRef } from "react";
import {
  Boxes,
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
} from "lucide-react";
import {
  getProducts,
  updateProduct,
  deleteProduct,
} from "../services/adminApi";
import {
  validateAdjustInput,
  applyProductAdjustment,
  calculateStockStep,
} from "../utils/productAdjuster";

function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");

  // Pagination & Per-Page state (20 / 50 / 100)
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);

  // SKU copy feedback state
  const [copiedSkuId, setCopiedSkuId] = useState(null);

  // Quick Adjust Modal/Bottom-Sheet state (Desktop & Mobile)
  const [quickAdjustProduct, setQuickAdjustProduct] = useState(null);
  const [adjustForm, setAdjustForm] = useState({
    regular_price: "",
    sale_price: "",
    stock_quantity: "",
  });
  const [adjustSaving, setAdjustSaving] = useState(false);

  // Deletion state
  const [deletingId, setDeletingId] = useState(null);
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState(null);
  const isDeletingRef = useRef(false);
  const requestIdRef = useRef(0);

  // Toast Notification state
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Debounce search input by 400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      const normalized = searchQuery.trim();
      setDebouncedSearch(normalized.length >= 2 ? normalized : "");
      setPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchProductList = async () => {
    const currentRequestId = ++requestIdRef.current;
    try {
      setLoading(true);
      setError("");
      const res = await getProducts({
        page,
        per_page: perPage,
        search: debouncedSearch || undefined,
        stock_status: stockFilter !== "all" ? stockFilter : undefined,
      });

      // Ignore responses from outdated / superseded requests
      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      if (res.success) {
        setProducts(res.products || []);
        setTotalProducts(res.total !== undefined ? res.total : res.products?.length || 0);
        setTotalPages(
          res.totalPages !== undefined
            ? res.totalPages
            : Math.ceil((res.total || 1) / perPage) || 1
        );
      }
    } catch (err) {
      if (currentRequestId !== requestIdRef.current) {
        return;
      }
      setError(err.response?.data?.message || err.message || "Failed to load catalog products.");
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchProductList();
  }, [page, perPage, debouncedSearch, stockFilter]);

  const handleCopySku = (product, e) => {
    e?.stopPropagation?.();
    const skuToCopy = product.sku || `#${product.id}`;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(skuToCopy).catch(() => {});
    }
    setCopiedSkuId(product.id);
    showToast(`SKU "${skuToCopy}" copied!`, "success");
    setTimeout(() => {
      setCopiedSkuId((curr) => (curr === product.id ? null : curr));
    }, 2000);
  };

  const handleOpenQuickAdjust = (product) => {
    setQuickAdjustProduct(product);
    setAdjustForm({
      regular_price: product.regular_price || product.price || "",
      sale_price: product.sale_price || "",
      stock_quantity: product.stock_quantity ?? 0,
    });
  };

  const handleCloseQuickAdjust = () => {
    if (adjustSaving) return;
    setQuickAdjustProduct(null);
    setAdjustForm({ regular_price: "", sale_price: "", stock_quantity: "" });
  };

  const handleSaveQuickAdjust = async () => {
    if (!quickAdjustProduct || adjustSaving) return;

    const validation = validateAdjustInput(adjustForm);
    if (!validation.isValid) {
      showToast(validation.error, "error");
      return;
    }

    try {
      setAdjustSaving(true);
      const res = await updateProduct(quickAdjustProduct.id, validation.updateData);
      if (res.success) {
        setProducts((prev) =>
          prev.map((p) =>
            p.id === quickAdjustProduct.id ? applyProductAdjustment(p, adjustForm) : p
          )
        );
        showToast("Product updated successfully!");
        handleCloseQuickAdjust();
      } else {
        showToast(res.message || "Failed to update product.", "error");
      }
    } catch (err) {
      showToast(
        err.response?.data?.message || err.message || "Failed to update product.",
        "error"
      );
    } finally {
      setAdjustSaving(false);
    }
  };

  const handleDeleteProduct = async (product) => {
    if (!product || isDeletingRef.current || deletingId) return;

    try {
      isDeletingRef.current = true;
      setDeletingId(product.id);
      const res = await deleteProduct(product.id);
      if (res.success) {
        showToast(`Product "${product.name}" deleted successfully.`);
        setDeleteConfirmProduct(null);

        // Update product list and handle empty page edge case
        setProducts((prev) => {
          const updated = prev.filter((p) => p.id !== product.id);
          if (updated.length === 0 && page > 1) {
            setPage((p) => Math.max(1, p - 1));
          }
          return updated;
        });

        // Decrement totalProducts and recalculate totalPages
        setTotalProducts((t) => {
          const newTotal = Math.max(0, t - 1);
          const newTotalPages = Math.ceil(newTotal / perPage) || 1;
          setTotalPages(newTotalPages);
          return newTotal;
        });
      } else {
        showToast(res.message || "Failed to delete product.", "error");
      }
    } catch (err) {
      showToast(
        err.response?.data?.message || err.message || "Failed to delete product.",
        "error"
      );
    } finally {
      isDeletingRef.current = false;
      setDeletingId(null);
    }
  };

  const displayedProducts = products;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Floating Toast Notification */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 flex items-center gap-2.5 rounded-2xl px-5 py-3.5 text-xs font-bold text-white shadow-xl animate-in slide-in-from-top duration-300 ${
            toast.type === "error"
              ? "bg-rose-600 shadow-rose-600/30"
              : "bg-emerald-600 shadow-emerald-600/30"
          }`}
        >
          {toast.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
          Inventory &amp; Stock Manager
        </h1>
        <p className="text-xs font-medium text-gray-500 mt-1">
          Server-side stock control, instant price editing, and catalog management
        </p>
      </div>

      {/* Integrated Search & Filter Card */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-white p-3.5 sm:p-4 shadow-sm border border-gray-100">
        {/* Stock Filter Pills */}
        <div className="flex overflow-x-auto pb-0.5 scrollbar-none gap-1.5 sm:gap-2">
          {[
            { id: "all", label: "All Items" },
            { id: "instock", label: "In Stock" },
            { id: "lowstock", label: "Low Stock" },
            { id: "outofstock", label: "Out of Stock" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setStockFilter(tab.id);
                setPage(1);
              }}
              className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer active:scale-95 ${
                stockFilter === tab.id
                  ? "bg-[#1E1E1E] text-white shadow-sm font-extrabold"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Server Search */}
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all products (server-side)..."
            className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-xs font-medium text-gray-800 placeholder-gray-400 focus:border-[#FF8A00] focus:bg-white focus:outline-none transition"
          />
        </div>
      </div>

      {/* Main Inventory Container */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <>
            {/* Mobile Skeletons (<640px) */}
            <div className="block sm:hidden divide-y divide-gray-100">
              {[...Array(4)].map((_, i) => (
                <div key={`m-skel-${i}`} className="p-4 space-y-3 bg-white animate-pulse">
                  <div className="flex items-start gap-3">
                    <div className="h-14 w-14 rounded-xl bg-gray-200 shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="h-4 w-36 bg-gray-200 rounded-md" />
                        <div className="h-4 w-16 bg-gray-200 rounded-full" />
                      </div>
                      <div className="h-3 w-20 bg-gray-100 rounded-md" />
                      <div className="h-3 w-16 bg-gray-100 rounded-md" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-gray-50/90 rounded-xl px-3.5 py-2.5 border border-gray-100">
                    <div>
                      <div className="h-2.5 w-8 bg-gray-200 rounded mb-1" />
                      <div className="h-5 w-14 bg-gray-200 rounded-md" />
                    </div>
                    <div className="text-right">
                      <div className="h-2.5 w-14 bg-gray-200 rounded mb-1 ml-auto" />
                      <div className="h-4 w-12 bg-gray-200 rounded-md ml-auto" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <div className="flex-1 min-h-[44px] rounded-xl bg-gray-100 border border-gray-200" />
                    <div className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-xl bg-gray-100 border border-gray-200 shrink-0" />
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table Skeletons (>=640px) */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50/95 text-[11px] font-bold uppercase tracking-wider text-gray-500 backdrop-blur-xs">
                  <tr>
                    <th className="px-6 py-3.5">Product</th>
                    <th className="px-6 py-3.5">SKU / ID</th>
                    <th className="px-6 py-3.5">Price</th>
                    <th className="px-6 py-3.5">Stock &amp; Status</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...Array(6)].map((_, i) => (
                    <tr key={`d-skel-${i}`} className="animate-pulse">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3.5">
                          <div className="h-12 w-12 rounded-xl bg-gray-200 shrink-0" />
                          <div className="space-y-1.5">
                            <div className="h-3.5 w-44 bg-gray-200 rounded-md" />
                            <div className="h-2.5 w-24 bg-gray-100 rounded-md" />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-3.5 w-20 bg-gray-100 rounded-md" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 w-14 bg-gray-200 rounded-md" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-14 bg-gray-200 rounded-md" />
                          <div className="h-3 w-16 bg-gray-100 rounded-full" />
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-7.5 w-24 rounded-xl bg-gray-100 border border-gray-200" />
                          <div className="h-8 w-8 rounded-xl bg-gray-100 border border-gray-200" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : error ? (
          <div className="p-8 text-center text-rose-600">
            <p className="text-sm font-bold">{error}</p>
            <button
              onClick={fetchProductList}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition"
            >
              Retry
            </button>
          </div>
        ) : displayedProducts.length === 0 ? (
          <div className="py-16 text-center text-xs font-medium text-gray-400">
            No products found matching your filter criteria.
          </div>
        ) : (
          <>
            {/* Mobile Stacked Card Layout (<640px) */}
            <div className="block sm:hidden divide-y divide-gray-100">
              {displayedProducts.map((product) => {
                const stock = product.stock_quantity ?? 0;
                const isOutOfStock = product.stock_status === "outofstock" || stock <= 0;
                const isLowStock = !isOutOfStock && stock > 0 && stock <= 5;
                const imgUrl =
                  product.image ||
                  product.images?.[0]?.src ||
                  "https://placehold.co/56x56?text=Item";
                const categoryName =
                  product.categories?.map((c) => c.name).join(", ") || "General";
                const displayPrice = product.regular_price || product.price || 0;

                return (
                  <div
                    key={`mobile-${product.id}`}
                    className="p-4 space-y-3 bg-white hover:bg-gray-50/50 transition"
                  >
                    {/* Top Row: Thumbnail + Title + Category + SKU + Status */}
                    <div className="flex items-start gap-3">
                      <div className="h-14 w-14 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center">
                        {product.image ? (
                          <img
                            src={imgUrl}
                            alt={product.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Boxes size={22} className="text-gray-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">
                            {product.name}
                          </h4>
                          <span
                            className={`inline-flex items-center shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              isOutOfStock
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : isLowStock
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            }`}
                          >
                            {isOutOfStock ? "Out of Stock" : isLowStock ? `Low Stock (${stock})` : "In Stock"}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">
                          {categoryName}
                        </p>
                        <div className="inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-500 mt-0.5">
                          <span>{product.sku || `#${product.id}`}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopySku(product, e)}
                            className="p-0.5 rounded text-gray-400 hover:text-gray-700"
                            title="Copy SKU"
                          >
                            {copiedSkuId === product.id ? (
                              <Check size={11} className="text-emerald-600" />
                            ) : (
                              <Copy size={11} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Metrics Row: Price & Stock Level */}
                    <div className="flex items-center justify-between bg-gray-50/90 rounded-xl px-3.5 py-2.5 border border-gray-100">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-gray-400 block tracking-wider">
                          Price
                        </span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-base font-extrabold text-gray-900">
                            ₹{displayPrice}
                          </span>
                          {product.sale_price && Number(product.sale_price) < Number(displayPrice) && (
                            <span className="text-[11px] font-bold text-rose-600">
                              (Sale: ₹{product.sale_price})
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-gray-400 block tracking-wider">
                          Stock Level
                        </span>
                        <span className="text-xs font-bold text-gray-800">
                          {stock} units
                        </span>
                      </div>
                    </div>

                    {/* Actions: Large Adjust Stock & Price button + Touch Delete button */}
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleOpenQuickAdjust(product)}
                        className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-orange-50 border border-orange-200 text-[#FF8A00] hover:bg-orange-100 font-bold text-xs transition cursor-pointer active:scale-[0.98]"
                      >
                        <Edit2 size={15} />
                        <span>Adjust Stock &amp; Price</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmProduct(product)}
                        disabled={deletingId === product.id}
                        className="h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 transition cursor-pointer disabled:opacity-50 active:scale-95"
                        title="Delete Product"
                        aria-label="Delete Product"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Inventory Table (>=640px) */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50/95 text-[11px] font-bold uppercase tracking-wider text-gray-500 backdrop-blur-xs">
                  <tr>
                    <th className="px-6 py-3.5">Product</th>
                    <th className="px-6 py-3.5">SKU / ID</th>
                    <th className="px-6 py-3.5">Price</th>
                    <th className="px-6 py-3.5">Stock &amp; Status</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                  {displayedProducts.map((product) => {
                    const stock = product.stock_quantity ?? 0;
                    const isOutOfStock = product.stock_status === "outofstock" || stock <= 0;
                    const isLowStock = !isOutOfStock && stock > 0 && stock <= 5;
                    const imgUrl =
                      product.image ||
                      product.images?.[0]?.src ||
                      "https://placehold.co/50x50?text=Item";
                    const categoryName =
                      product.categories?.map((c) => c.name).join(", ") || "General";
                    const displayPrice = product.regular_price || product.price || 0;

                    return (
                      <tr key={product.id} className="hover:bg-slate-50/80 transition">
                        {/* Product Column: Thumbnail, Name, Category */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3.5">
                            <div className="h-12 w-12 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center">
                              {product.image ? (
                                <img
                                  src={imgUrl}
                                  alt={product.name}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <Boxes size={20} className="text-gray-400" />
                              )}
                            </div>
                            <div className="min-w-0 max-w-xs lg:max-w-md">
                              <p className="font-bold text-gray-900 truncate" title={product.name}>
                                {product.name}
                              </p>
                              <p className="text-[11px] text-gray-400 truncate mt-0.5">
                                {categoryName}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* SKU Column with copy action */}
                        <td className="px-6 py-4">
                          <div className="inline-flex items-center gap-1.5 group font-mono text-xs text-gray-600">
                            <span>{product.sku || `#${product.id}`}</span>
                            <button
                              type="button"
                              onClick={(e) => handleCopySku(product, e)}
                              className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer opacity-60 group-hover:opacity-100"
                              title="Copy SKU"
                              aria-label="Copy SKU"
                            >
                              {copiedSkuId === product.id ? (
                                <Check size={12} className="text-emerald-600" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* Price Column */}
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-gray-900 text-xs">
                              ₹{displayPrice}
                            </span>
                            {product.sale_price && Number(product.sale_price) < Number(displayPrice) && (
                              <span className="text-[10px] text-rose-600 font-bold">
                                Sale: ₹{product.sale_price}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Stock Column with status badge */}
                        <td className="px-6 py-4">
                          <div className="flex flex-col items-start gap-1">
                            <span className="font-bold text-gray-900 text-xs">{stock} units</span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                isOutOfStock
                                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                                  : isLowStock
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  isOutOfStock
                                    ? "bg-rose-500"
                                    : isLowStock
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                                }`}
                              />
                              {isOutOfStock ? "Out of Stock" : isLowStock ? `Low Stock (${stock})` : "In Stock"}
                            </span>
                          </div>
                        </td>

                        {/* Actions: Quick Adjust + Delete */}
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenQuickAdjust(product)}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-[#FF8A00] hover:bg-orange-100 hover:border-orange-300 transition cursor-pointer active:scale-95 shadow-2xs"
                            >
                              <Edit2 size={12} />
                              <span>Quick Adjust</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmProduct(product)}
                              disabled={deletingId === product.id}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 transition cursor-pointer disabled:opacity-50 active:scale-95 shadow-2xs"
                              title="Delete Product"
                              aria-label="Delete Product"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Pagination Bar with Per-Page Selector */}
        {!loading && totalProducts > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 border-t border-gray-100 bg-gray-50/50 px-4 sm:px-6 py-3.5 sm:py-4">
            <div className="flex items-center gap-3 sm:gap-4 flex-wrap justify-center sm:justify-start">
              <p className="text-xs text-gray-500 font-medium">
                Showing <span className="font-bold text-gray-900">{(page - 1) * perPage + 1}</span> to{" "}
                <span className="font-bold text-gray-900">
                  {Math.min(page * perPage, totalProducts)}
                </span>{" "}
                of <span className="font-bold text-gray-900">{totalProducts}</span> products
              </p>

              {/* Rows Per Page Selector (20 / 50 / 100) */}
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="hidden sm:inline">Rows:</span>
                <select
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-700 outline-none focus:border-[#FF8A00] cursor-pointer shadow-2xs"
                  aria-label="Rows per page"
                >
                  <option value={20}>20 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer shadow-2xs"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="text-xs font-bold text-gray-700 px-2">
                Page {page} of {Math.max(1, totalPages)}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer shadow-2xs"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick Adjust Stock & Price Bottom Sheet / Modal */}
      {quickAdjustProduct && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 sm:p-6 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            {/* Mobile Pull Handle */}
            <div className="mx-auto w-12 h-1.5 bg-gray-200 rounded-full mb-3 sm:hidden" />

            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-11 w-11 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center">
                  {quickAdjustProduct.image ? (
                    <img
                      src={
                        quickAdjustProduct.image ||
                        quickAdjustProduct.images?.[0]?.src ||
                        "https://placehold.co/44x44?text=Item"
                      }
                      alt={quickAdjustProduct.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Boxes size={20} className="text-gray-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-gray-900 truncate">
                    {quickAdjustProduct.name}
                  </h3>
                  <p className="text-[11px] font-mono text-gray-400">
                    {quickAdjustProduct.sku || `#${quickAdjustProduct.id}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseQuickAdjust}
                disabled={adjustSaving}
                className="h-9 w-9 inline-flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer disabled:opacity-50"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <div className="mt-4 space-y-4">
              {/* Stock Quantity */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Stock Quantity (Units)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setAdjustForm((prev) => ({
                        ...prev,
                        stock_quantity: calculateStockStep(prev.stock_quantity, -1),
                      }))
                    }
                    className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-xl border border-gray-200 bg-gray-50 text-gray-700 font-bold text-lg hover:bg-gray-100 flex items-center justify-center transition cursor-pointer active:scale-95"
                    aria-label="Decrease stock by 1"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={adjustForm.stock_quantity}
                    onChange={(e) =>
                      setAdjustForm({ ...adjustForm, stock_quantity: e.target.value })
                    }
                    className="flex-1 min-h-[44px] rounded-xl border border-gray-200 px-3 text-center text-base font-bold text-gray-900 outline-none focus:border-[#FF8A00] focus:ring-2 focus:ring-[#FF8A00]/20"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setAdjustForm((prev) => ({
                        ...prev,
                        stock_quantity: calculateStockStep(prev.stock_quantity, 1),
                      }))
                    }
                    className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-xl border border-gray-200 bg-gray-50 text-gray-700 font-bold text-lg hover:bg-gray-100 flex items-center justify-center transition cursor-pointer active:scale-95"
                    aria-label="Increase stock by 1"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Regular Price & Sale Price Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Regular Price */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    Regular Price (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">
                      ₹
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={adjustForm.regular_price}
                      onChange={(e) =>
                        setAdjustForm({ ...adjustForm, regular_price: e.target.value })
                      }
                      placeholder="0"
                      className="w-full min-h-[44px] rounded-xl border border-gray-200 pl-8 pr-4 text-sm font-bold text-gray-900 outline-none focus:border-[#FF8A00] focus:ring-2 focus:ring-[#FF8A00]/20"
                    />
                  </div>
                </div>

                {/* Sale Price */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    Sale Price (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">
                      ₹
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={adjustForm.sale_price}
                      onChange={(e) =>
                        setAdjustForm({ ...adjustForm, sale_price: e.target.value })
                      }
                      placeholder="Optional"
                      className="w-full min-h-[44px] rounded-xl border border-gray-200 pl-8 pr-4 text-sm font-bold text-gray-900 outline-none focus:border-[#FF8A00] focus:ring-2 focus:ring-[#FF8A00]/20"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleCloseQuickAdjust}
                  disabled={adjustSaving}
                  className="flex-1 min-h-[44px] rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveQuickAdjust}
                  disabled={adjustSaving}
                  className="flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-[#FF8A00] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#FF7300] transition cursor-pointer disabled:opacity-50 active:scale-[0.98]"
                >
                  {adjustSaving ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check size={15} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Product Confirmation Modal */}
      {deleteConfirmProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 mb-4">
              <Trash2 size={24} />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-black text-gray-900">Delete Product Permanently?</h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                Are you sure you want to delete{" "}
                <span className="font-bold text-gray-900">"{deleteConfirmProduct.name}"</span>?
              </p>
              <div className="rounded-2xl bg-rose-50/60 p-3 border border-rose-100 text-left text-[11px] text-rose-700 space-y-1 mt-3">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle size={13} /> Immediate Store-Wide Removal
                </div>
                <p className="text-rose-600/90 text-[10.5px]">
                  This product will be permanently deleted from WooCommerce and will immediately disappear from the Customer Web catalog.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-5 border-t border-gray-100 mt-5">
              <button
                type="button"
                disabled={deletingId === deleteConfirmProduct.id}
                onClick={() => setDeleteConfirmProduct(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingId === deleteConfirmProduct.id}
                onClick={() => handleDeleteProduct(deleteConfirmProduct)}
                className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer"
              >
                {deletingId === deleteConfirmProduct.id ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={14} /> Delete Product
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Products;
