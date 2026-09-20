import { useEffect, useState, useRef } from "react";
import {
  Boxes,
  Search,
  Edit2,
  Check,
  X,
  AlertTriangle,
  RotateCcw,
  Upload,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  Camera,
  Copy,
  Filter,
  ChevronDown,
} from "lucide-react";
import {
  getProducts,
  updateProduct,
  createProduct,
  uploadProductImage,
  deleteMedia,
  deleteProduct,
  getCategories,
} from "../services/employeeApi.js";
import {
  compressImage,
  MAX_FILE_SIZE_BYTES,
  isAcceptedImage,
  isHeicFile,
  RAW_IMAGE_MAX_INPUT_BYTES,
} from "../utils/imageCompressor.js";
import {
  validateAdjustInput,
  applyProductAdjustment,
  calculateStockStep,
} from "../utils/productAdjuster.js";

function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");

  // Category filter state
  const [categories, setCategories] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [isMobileCategoryOpen, setIsMobileCategoryOpen] = useState(false);
  const mobileCategoryRef = useRef(null);

  // Pagination & Per-Page state (20 / 50 / 100)
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);

  // SKU copy feedback state
  const [copiedSkuId, setCopiedSkuId] = useState(null);

  // Quick Adjust Modal/Bottom-Sheet state (Desktop & Mobile)
  const [quickAdjustProduct, setQuickAdjustProduct] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ regular_price: "", sale_price: "", stock_quantity: "" });
  const [adjustSaving, setAdjustSaving] = useState(false);

  // Delete product state
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const isDeletingRef = useRef(false);
  const requestIdRef = useRef(0);

  // Add Product Modal & Upload state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    regular_price: "",
    sale_price: "",
    stock_quantity: 10,
    description: "",
    image_url: "",
    media_id: null,
  });
  const [creating, setCreating] = useState(false);
  const [imagePreview, setImagePreview] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const imagePreviewRef = useRef("");
  const pendingMediaIdRef = useRef(null);
  const uploadAbortControllerRef = useRef(null);

  useEffect(() => {
    imagePreviewRef.current = imagePreview;
  }, [imagePreview]);

  useEffect(() => {
    pendingMediaIdRef.current = newProduct.media_id;
  }, [newProduct.media_id]);

  // Safely revoke object URL, abort active upload, and clear image preview state (with optional pending cleanup)
  const clearImagePreview = (shouldCleanup = false) => {
    if (uploadAbortControllerRef.current) {
      try {
        uploadAbortControllerRef.current.abort();
      } catch {}
      uploadAbortControllerRef.current = null;
    }
    setUploadingImage(false);
    setUploadProgress(0);

    if (imagePreviewRef.current && typeof imagePreviewRef.current === "string" && imagePreviewRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewRef.current);
    }
    setImagePreview("");
    if (shouldCleanup && pendingMediaIdRef.current) {
      const idToClean = pendingMediaIdRef.current;
      pendingMediaIdRef.current = null;
      deleteMedia(idToClean).catch(() => {});
      setNewProduct((prev) => ({ ...prev, image_url: "", media_id: null }));
    }
  };

  // Cleanup object URL and abort controller on unmount
  useEffect(() => {
    return () => {
      if (uploadAbortControllerRef.current) {
        try {
          uploadAbortControllerRef.current.abort();
        } catch {}
      }
      if (imagePreviewRef.current && typeof imagePreviewRef.current === "string" && imagePreviewRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreviewRef.current);
      }
    };
  }, []);

  const handleCloseAddModal = () => {
    clearImagePreview(true);
    setShowAddModal(false);
  };

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

  // Fetch categories on mount for category filtering
  useEffect(() => {
    let isMounted = true;
    getCategories()
      .then((res) => {
        if (isMounted && res?.success && Array.isArray(res.categories)) {
          setCategories(res.categories);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Close mobile category dropdown on outside click or Escape
  useEffect(() => {
    if (!isMobileCategoryOpen) return;

    const handleClickOutside = (event) => {
      if (mobileCategoryRef.current && !mobileCategoryRef.current.contains(event.target)) {
        setIsMobileCategoryOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsMobileCategoryOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileCategoryOpen]);

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
        category: categoryFilter !== "all" ? categoryFilter : undefined,
      });

      // Ignore responses from outdated / superseded requests
      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      if (res.success) {
        setProducts(res.products || []);
        setTotalProducts(res.total !== undefined ? res.total : (res.products?.length || 0));
        setTotalPages(res.totalPages !== undefined ? res.totalPages : (Math.ceil((res.total || 1) / perPage) || 1));
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
  }, [page, perPage, debouncedSearch, stockFilter, categoryFilter]);

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
            p.id === quickAdjustProduct.id
              ? applyProductAdjustment(p, adjustForm)
              : p
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

        // 1. Update product list and handle empty page edge case
        setProducts((prev) => {
          const updated = prev.filter((p) => p.id !== product.id);
          // If the page is now empty and we are beyond page 1, navigate back one page
          if (updated.length === 0 && page > 1) {
            setPage((p) => Math.max(1, p - 1));
          }
          return updated;
        });

        // 2. Decrement totalProducts and recalculate totalPages so pagination stays valid
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

  const handleImageFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isAcceptedImage(file)) {
      showToast("Only JPG, PNG, WebP, GIF, and mobile HEIC images are allowed.", "error");
      return;
    }

    if (file.size > RAW_IMAGE_MAX_INPUT_BYTES) {
      showToast("Image file size exceeds the 25MB maximum limit.", "error");
      return;
    }

    if (isHeicFile(file)) {
      showToast(
        `"${file.name}" is in HEIC format and not supported directly by your browser. Please select JPEG, PNG, or WebP.`,
        "error"
      );
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      return;
    }

    // If a previous pending image was uploaded without creating a product, safely clean it up
    if (pendingMediaIdRef.current) {
      const oldMediaId = pendingMediaIdRef.current;
      pendingMediaIdRef.current = null;
      deleteMedia(oldMediaId).catch(() => {});
    }

    // Revoke any previous preview object URL before creating a new one
    clearImagePreview(false);

    // Compress image client-side before upload (max 1600px, WebP 0.85 with JPEG fallback)
    let fileToUpload = file;
    try {
      fileToUpload = await compressImage(file);
    } catch (err) {
      if (isHeicFile(file) || err?.code === "HEIC_UNSUPPORTED") {
        showToast(
          `"${file.name}" is in HEIC format and not supported directly by your browser. Please select JPEG, PNG, or WebP.`,
          "error"
        );
        if (galleryInputRef.current) galleryInputRef.current.value = "";
        if (cameraInputRef.current) cameraInputRef.current.value = "";
        return;
      }
      // Fall back to original file if compression fails on standard images
    }

    if (isHeicFile(fileToUpload)) {
      showToast(
        `"${file.name}" is in HEIC format and cannot be uploaded. Please select JPEG, PNG, or WebP.`,
        "error"
      );
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      return;
    }

    if (fileToUpload.size > MAX_FILE_SIZE_BYTES) {
      showToast("Image file size must be less than 5MB after compression.", "error");
      return;
    }

    const previewUrl = URL.createObjectURL(fileToUpload);
    setImagePreview(previewUrl);

    const controller = new AbortController();
    uploadAbortControllerRef.current = controller;

    try {
      setUploadingImage(true);
      setUploadProgress(0);
      const res = await uploadProductImage(fileToUpload, {
        signal: controller.signal,
        onUploadProgress: (progressEvent) => {
          if (controller.signal.aborted) return;
          const percent = progressEvent.total
            ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
            : 50;
          setUploadProgress(Math.min(percent, 99));
        },
      });

      if (controller.signal.aborted) return;

      if (res.success && (res.url || res.id)) {
        setUploadProgress(100);
        setNewProduct((prev) => ({ ...prev, image_url: res.url, media_id: res.id }));
        pendingMediaIdRef.current = res.id;
        showToast("Image uploaded to WordPress Media Library!");
      }
    } catch (err) {
      if (
        controller.signal.aborted ||
        err.name === "AbortError" ||
        err.name === "CanceledError" ||
        err.code === "ERR_CANCELED"
      ) {
        return;
      }
      showToast(err.response?.data?.message || "Failed to upload image.", "error");
      clearImagePreview(false);
    } finally {
      if (uploadAbortControllerRef.current === controller) {
        uploadAbortControllerRef.current = null;
      }
      setUploadingImage(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (!newProduct.name.trim()) {
      showToast("Product name is required.", "error");
      return;
    }

    if (!newProduct.regular_price || Number(newProduct.regular_price) <= 0) {
      showToast("Please enter a valid regular price.", "error");
      return;
    }

    try {
      setCreating(true);
      const payload = {
        ...newProduct,
        images: newProduct.media_id
          ? [{ id: Number(newProduct.media_id), src: newProduct.image_url }]
          : newProduct.image_url
          ? [{ src: newProduct.image_url }]
          : [],
      };
      const res = await createProduct(payload);
      if (res.success) {
        showToast("New product created successfully!");
        setShowAddModal(false);
        // Successfully attached: clear pending ref so it is preserved
        pendingMediaIdRef.current = null;
        setNewProduct({
          name: "",
          regular_price: "",
          sale_price: "",
          stock_quantity: 10,
          description: "",
          image_url: "",
          media_id: null,
        });
        clearImagePreview(false);
        fetchProductList();
      }
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to create product.", "error");
    } finally {
      setCreating(false);
    }
  };

  // Server-side filtering and pagination are authoritative
  const displayedProducts = products;

  // Selected category label helper
  const selectedCategoryObj = categories.find((c) => String(c.id) === String(categoryFilter));
  const selectedCategoryLabel =
    categoryFilter === "all"
      ? "All Categories"
      : selectedCategoryObj
      ? `${selectedCategoryObj.name} ${selectedCategoryObj.count !== undefined ? `(${selectedCategoryObj.count})` : ""}`
      : "All Categories";

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Toast Notification */}
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

      {/* 1. Search Bar & Refresh (Above Filter Card) */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, SKU..."
            className="w-full rounded-2xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-xs sm:text-sm text-gray-900 shadow-xs outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
          />
        </div>

        <button
          onClick={fetchProductList}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-bold text-gray-700 shadow-xs hover:bg-gray-50 transition cursor-pointer disabled:opacity-50 shrink-0"
          title="Refresh Inventory"
        >
          <RotateCcw size={13} className={loading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* 2. Filter Tabs & Category Selector Card */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-gray-200 bg-white p-3.5 sm:p-4 shadow-xs">
        {/* Stock Filter Pills */}
        <div className="flex flex-wrap gap-1.5">
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
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer active:scale-95 ${
                stockFilter === tab.id
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-xs"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Mobile Custom Category Dropdown (<640px) */}
        <div className="block sm:hidden relative w-full" ref={mobileCategoryRef}>
          <button
            type="button"
            onClick={() => setIsMobileCategoryOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={isMobileCategoryOpen}
            className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-bold text-gray-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-2xs transition cursor-pointer active:scale-[0.99]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Filter size={13} className="text-gray-400 shrink-0" />
              <span className="truncate">{selectedCategoryLabel}</span>
            </div>
            <ChevronDown
              size={14}
              className={`text-gray-400 transition-transform duration-200 shrink-0 ml-2 ${
                isMobileCategoryOpen ? "rotate-180 text-emerald-600" : ""
              }`}
            />
          </button>

          {isMobileCategoryOpen && (
            <div
              role="listbox"
              aria-label="Filter by Category"
              className="absolute top-full left-0 right-0 z-30 mt-1.5 w-full rounded-2xl bg-white border border-gray-200 shadow-xl overflow-hidden py-1 max-h-60 overflow-y-auto divide-y divide-gray-50 animate-in fade-in zoom-in-95 duration-150"
            >
              <button
                type="button"
                role="option"
                aria-selected={categoryFilter === "all"}
                onClick={() => {
                  setCategoryFilter("all");
                  setPage(1);
                  setIsMobileCategoryOpen(false);
                }}
                className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 text-xs transition cursor-pointer text-left ${
                  categoryFilter === "all"
                    ? "bg-emerald-50 text-emerald-900 font-extrabold"
                    : "text-gray-700 font-semibold hover:bg-gray-50 active:bg-gray-100"
                }`}
              >
                <span>All Categories</span>
                {categoryFilter === "all" && (
                  <Check size={14} className="text-emerald-600 shrink-0 ml-2" />
                )}
              </button>

              {categories.map((c) => {
                const isSelected = String(categoryFilter) === String(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setCategoryFilter(String(c.id));
                      setPage(1);
                      setIsMobileCategoryOpen(false);
                    }}
                    className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 text-xs transition cursor-pointer text-left ${
                      isSelected
                        ? "bg-emerald-50 text-emerald-900 font-extrabold"
                        : "text-gray-700 font-semibold hover:bg-gray-50 active:bg-gray-100"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{c.name}</span>
                      {c.count !== undefined && (
                        <span className="text-[11px] font-medium text-gray-400 shrink-0">
                          ({c.count})
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <Check size={14} className="text-emerald-600 shrink-0 ml-2" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Desktop Category Selector (>=640px) */}
        <div className="hidden sm:block relative">
          <Filter
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-auto h-8.5 rounded-xl border border-gray-200 bg-white pl-8 pr-7 text-xs font-bold text-gray-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition cursor-pointer shadow-2xs"
            aria-label="Filter by Category"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name} {c.count !== undefined ? `(${c.count})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 3. Add Product Button (Below Filter Card) */}
      <div className="flex items-center justify-between sm:justify-end">
        <p className="text-xs text-gray-500 font-medium hidden sm:block">
          Total Products: <span className="font-bold text-gray-900">{totalProducts}</span>
        </p>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-3 sm:py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-emerald-500 transition cursor-pointer shrink-0 active:scale-95"
          title="Add New Product"
        >
          <Plus size={16} />
          <span>Add Product</span>
        </button>
      </div>

      {/* Main Inventory Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <>
            {/* Mobile Skeletons (<640px) */}
            <div className="block sm:hidden divide-y divide-gray-100">
              {[...Array(4)].map((_, i) => (
                <div key={`m-skel-${i}`} className="p-4 space-y-3 bg-white animate-pulse">
                  {/* Thumbnail & Title Skeleton */}
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
                  {/* Price & Stock Skeleton */}
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
                  {/* Actions Skeleton */}
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
              <RotateCcw size={14} /> Retry
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
                      <img
                        src={imgUrl}
                        alt={product.name}
                        className="h-14 w-14 rounded-xl object-cover bg-gray-100 border border-gray-200 shrink-0"
                        loading="lazy"
                      />
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
                            {isOutOfStock ? "Out of Stock" : isLowStock ? "Low Stock" : "In Stock"}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">
                          {categoryName}
                        </p>
                        <p className="font-mono text-[11px] text-gray-500 mt-0.5">
                          {product.sku || `#${product.id}`}
                        </p>
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

                    {/* Actions: Large Adjust Stock & Price button + 44x44px Touch Delete target */}
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleOpenQuickAdjust(product)}
                        className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-700 hover:bg-emerald-100 font-bold text-xs transition cursor-pointer active:scale-[0.98]"
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
                            <img
                              src={imgUrl}
                              alt={product.name}
                              className="h-12 w-12 rounded-xl object-cover bg-gray-100 border border-gray-200 shrink-0"
                              loading="lazy"
                            />
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

                        {/* SKU Column with optional copy action */}
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

                        {/* Stock Column with clear stock/status indication */}
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
                                  isOutOfStock ? "bg-rose-500" : isLowStock ? "bg-amber-500" : "bg-emerald-500"
                                }`}
                              />
                              {isOutOfStock ? "Out of Stock" : isLowStock ? "Low Stock" : "In Stock"}
                            </span>
                          </div>
                        </td>

                        {/* Actions: Quick Adjust + Delete */}
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenQuickAdjust(product)}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 transition cursor-pointer active:scale-95 shadow-2xs"
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
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-700 outline-none focus:border-emerald-500 cursor-pointer shadow-2xs"
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

      {/* Quick Adjust Stock & Price Bottom Sheet / Modal (Mobile) */}
      {quickAdjustProduct && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 sm:p-6 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            {/* Mobile Pull Handle */}
            <div className="mx-auto w-12 h-1.5 bg-gray-200 rounded-full mb-3 sm:hidden" />

            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={
                    quickAdjustProduct.image ||
                    quickAdjustProduct.images?.[0]?.src ||
                    "https://placehold.co/44x44?text=Item"
                  }
                  alt={quickAdjustProduct.name}
                  className="h-11 w-11 rounded-xl object-cover border border-gray-200 shrink-0"
                />
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
                    className="flex-1 min-h-[44px] rounded-xl border border-gray-200 px-3 text-center text-base font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
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
                      className="w-full min-h-[44px] rounded-xl border border-gray-200 pl-8 pr-4 text-sm font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
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
                      className="w-full min-h-[44px] rounded-xl border border-gray-200 pl-8 pr-4 text-sm font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
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
                  className="flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50 active:scale-[0.98]"
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

      {/* Add New Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-8 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-lg font-black text-gray-900">Add In-Store Product</h3>
                <p className="text-xs text-gray-500">
                  Register new shelf item directly to Mumbai Collection catalog
                </p>
              </div>
              <button
                onClick={handleCloseAddModal}
                className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Product Title *
                </label>
                <input
                  type="text"
                  required
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  placeholder="e.g. Traditional Bandhani Saree"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Regular Price (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    value={newProduct.regular_price}
                    onChange={(e) => setNewProduct({ ...newProduct, regular_price: e.target.value })}
                    placeholder="999"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Sale Price (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={newProduct.sale_price}
                    onChange={(e) => setNewProduct({ ...newProduct, sale_price: e.target.value })}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Initial Stock Units
                </label>
                <input
                  type="number"
                  min="0"
                  value={newProduct.stock_quantity}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, stock_quantity: Number(e.target.value) })
                  }
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                />
              </div>

              {/* Photo Upload */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Product Image (WordPress Media Upload)
                </label>
                
                {/* Hidden Inputs for Gallery and Camera */}
                <input
                  type="file"
                  ref={galleryInputRef}
                  onChange={handleImageFileChange}
                  accept="image/*,image/heic,image/heif"
                  className="hidden"
                />

                <input
                  type="file"
                  ref={cameraInputRef}
                  onChange={handleImageFileChange}
                  capture="environment"
                  accept="image/*,image/heic,image/heif"
                  className="hidden"
                />

                <div className="flex items-center gap-2.5 flex-wrap">
                  {/* Take Photo Button */}
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50 shadow-2xs active:scale-95"
                  >
                    <Camera size={14} />
                    Take Photo
                  </button>

                  {/* From Gallery Button */}
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition cursor-pointer disabled:opacity-50 active:scale-95"
                  >
                    <ImageIcon size={14} />
                    From Gallery
                  </button>

                  {imagePreview && (
                    <div className="relative group">
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="h-11 w-11 rounded-xl object-cover border border-gray-200 bg-gray-100 shadow-2xs"
                      />
                      <button
                        type="button"
                        onClick={() => clearImagePreview(true)}
                        className="absolute -top-1.5 -right-1.5 bg-black/70 hover:bg-rose-600 text-white rounded-full p-0.5 transition cursor-pointer shadow-xs"
                        title={uploadingImage ? "Cancel upload" : "Remove image"}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  )}
                </div>

                {uploadingImage && (
                  <div className="mt-2.5 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
                      <span className="flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin text-emerald-600" />
                        Uploading to Media Library...
                      </span>
                      <span className="font-bold text-gray-700">{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-150 rounded-full"
                        style={{ width: `${Math.max(5, uploadProgress)}%` }}
                      />
                    </div>
                  </div>
                )}

                {!uploadingImage && newProduct.image_url && (
                  <p className="mt-1.5 text-[11px] text-emerald-600 font-medium truncate">
                    ✓ Uploaded: {newProduct.image_url}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handleCloseAddModal}
                  className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || uploadingImage}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50"
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Create Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Product Confirmation Modal */}
      {deleteConfirmProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 mb-4">
              <Trash2 size={24} />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-black text-gray-900">
                Delete Product Permanently?
              </h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                Are you sure you want to delete <span className="font-bold text-gray-900">"{deleteConfirmProduct.name}"</span>?
              </p>

              {deleteConfirmProduct.image && (
                <div className="mx-auto h-16 w-16 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-1 my-2">
                  <img
                    src={deleteConfirmProduct.image}
                    alt={deleteConfirmProduct.name}
                    className="h-full w-full object-contain"
                  />
                </div>
              )}

              <div className="rounded-2xl bg-rose-50/60 p-3 border border-rose-100 text-left text-[11px] text-rose-700 space-y-1 mt-3">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle size={13} /> Immediate Store-Wide Removal
                </div>
                <p className="text-rose-600/90 text-[10.5px]">
                  This product will be permanently deleted from WooCommerce and will immediately disappear from the store catalog.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-5 border-t border-gray-100 mt-5">
              <button
                type="button"
                disabled={deletingId === deleteConfirmProduct.id}
                onClick={() => setDeleteConfirmProduct(null)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingId === deleteConfirmProduct.id}
                onClick={() => handleDeleteProduct(deleteConfirmProduct)}
                className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer active:scale-95"
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
