import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Image as ImageIcon,
  ArrowLeft,
  Upload,
  Check,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Monitor,
  Smartphone,
  ExternalLink,
  Eye,
  Sliders,
  Sparkles,
  Info,
  Package,
  LayoutGrid,
  Search,
  Link2,
} from "lucide-react";
import {
  getBanners,
  updateBanners,
  uploadProductImage,
  getCategories,
  getProducts,
} from "../services/employeeApi.js";
import {
  compressImage,
  BANNER_MAX_DIMENSION,
  isAcceptedImage,
  isHeicFile,
  parseImageDimensionsFromHeader,
  RAW_IMAGE_MAX_INPUT_BYTES,
  MAX_FILE_SIZE_BYTES,
} from "../utils/imageCompressor.js";

function DestinationLinkSelector({
  banner,
  index,
  products = [],
  categories = [],
  loadingLookups = false,
  onUpdateLink,
  onUpdateTitle,
}) {
  const currentLink = (banner?.link || "").trim();

  // Determine current mode: "product" | "category" | "custom"
  const [mode, setMode] = useState(() => {
    if (currentLink.startsWith("/category/")) return "category";
    if (currentLink.startsWith("/product/") || currentLink.startsWith("/products/")) return "product";
    return currentLink ? "custom" : "product";
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [isChangingProduct, setIsChangingProduct] = useState(false);

  // Match selected product from link
  const productMatch = currentLink.match(/^\/products?\/(\d+)/);
  const selectedProdId = productMatch ? Number(productMatch[1]) : null;
  const selectedProduct = selectedProdId
    ? products.find((p) => Number(p.id) === selectedProdId) || {
        id: selectedProdId,
        name: `Product #${selectedProdId}`,
        price: null,
      }
    : null;

  // Match selected category from link
  const catMatch = currentLink.match(/^\/category\/(.+)$/);
  const selectedCatVal = catMatch ? catMatch[1].toLowerCase().trim() : "";
  const selectedCategory = selectedCatVal
    ? categories.find(
        (c) =>
          String(c.id) === selectedCatVal ||
          String(c.slug).toLowerCase() === selectedCatVal
      ) || { id: selectedCatVal, name: `Category (${selectedCatVal})`, slug: selectedCatVal }
    : null;

  // Filtered products list for search
  const filteredProducts = products.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      String(p.id).includes(q)
    );
  });

  const handleSelectProduct = (prod) => {
    onUpdateLink(`/product/${prod.id}`);
    setIsChangingProduct(false);
    setSearchQuery("");
    if (!banner?.title || banner.title.startsWith("Promotional Banner #")) {
      onUpdateTitle(prod.name);
    }
  };

  const handleSelectCategory = (catValue) => {
    if (!catValue) {
      onUpdateLink("");
      return;
    }
    const cat = categories.find((c) => String(c.slug || c.id) === String(catValue));
    onUpdateLink(`/category/${cat?.slug || catValue}`);
    if (!banner?.title || banner.title.startsWith("Promotional Banner #")) {
      if (cat?.name) onUpdateTitle(`${cat.name} Special`);
    }
  };

  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (newMode === "product") {
      if (!currentLink.startsWith("/product/")) {
        const first = products[0];
        if (first) {
          onUpdateLink(`/product/${first.id}`);
        } else {
          setIsChangingProduct(true);
        }
      }
    } else if (newMode === "category") {
      if (!currentLink.startsWith("/category/")) {
        const first = categories[0];
        if (first) onUpdateLink(`/category/${first.slug || first.id}`);
      }
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border border-gray-200/90 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="text-[11px] font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
          <Link2 size={13} className="text-emerald-600" />
          Destination Target
        </label>

        {/* 3 Mode Pills */}
        <div className="inline-flex items-center rounded-xl bg-gray-200/80 p-0.5 border border-gray-200">
          <button
            type="button"
            onClick={() => handleModeChange("product")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
              mode === "product"
                ? "bg-white text-emerald-800 shadow-2xs font-black"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Package size={12} />
            Specific Product
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("category")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
              mode === "category"
                ? "bg-white text-emerald-800 shadow-2xs font-black"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <LayoutGrid size={12} />
            Category
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("custom")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
              mode === "custom"
                ? "bg-white text-emerald-800 shadow-2xs font-black"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <ExternalLink size={12} />
            Custom Link
          </button>
        </div>
      </div>

      {/* Mode A: Specific Product Selector */}
      {mode === "product" && (
        <div className="space-y-2">
          {selectedProduct && !isChangingProduct ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-white p-2.5 shadow-2xs">
              <div className="flex items-center gap-2.5 min-w-0">
                {selectedProduct.image ? (
                  <img
                    src={selectedProduct.image}
                    alt=""
                    className="h-10 w-10 rounded-lg object-contain bg-gray-50 border border-gray-200 p-0.5 flex-shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                    <Package size={20} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-black text-gray-900 truncate">
                      {selectedProduct.name}
                    </span>
                    {selectedProduct.stock_status === "outofstock" && (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200">
                        Out of stock
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 font-medium flex items-center gap-1.5 mt-0.5">
                    {selectedProduct.price && (
                      <span className="font-extrabold text-emerald-700">₹{selectedProduct.price}</span>
                    )}
                    <span>• ID #{selectedProduct.id}</span>
                    <span className="font-mono text-gray-400">/product/{selectedProduct.id}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsChangingProduct(true)}
                className="flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-700 transition cursor-pointer"
              >
                Change Product
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Type product name or SKU to search..."
                  className="w-full rounded-xl border border-gray-300 bg-white pl-8 pr-8 py-2 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                  autoFocus={isChangingProduct}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <div className="max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 shadow-xs">
                {filteredProducts.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-400">
                    {loadingLookups ? "Loading products..." : `No products found matching "${searchQuery}"`}
                  </div>
                ) : (
                  filteredProducts.map((p) => {
                    const isSelected = selectedProdId === Number(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectProduct(p)}
                        className={`w-full text-left p-2.5 flex items-center justify-between gap-2.5 hover:bg-emerald-50/60 transition cursor-pointer ${
                          isSelected ? "bg-emerald-50" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {p.image ? (
                            <img
                              src={p.image}
                              alt=""
                              className="h-8 w-8 rounded-md object-contain bg-gray-50 border border-gray-200 p-0.5 flex-shrink-0"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-md bg-gray-100 text-gray-400 flex items-center justify-center flex-shrink-0">
                              <Package size={14} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-900 truncate">
                              {p.name}
                            </p>
                            <p className="text-[10px] text-gray-500 flex items-center gap-1.5">
                              {p.price && <span className="font-bold text-emerald-700">₹{p.price}</span>}
                              <span>• ID #{p.id}</span>
                              {p.sku && <span>• {p.sku}</span>}
                            </p>
                          </div>
                        </div>

                        {isSelected && (
                          <Check size={14} className="text-emerald-600 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {selectedProduct && isChangingProduct && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setIsChangingProduct(false);
                      setSearchQuery("");
                    }}
                    className="text-[11px] font-bold text-gray-500 hover:text-gray-800 underline cursor-pointer"
                  >
                    Keep current: "{selectedProduct.name}"
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mode B: Category Selector */}
      {mode === "category" && (
        <div>
          <select
            value={selectedCategory ? (selectedCategory.slug || selectedCategory.id) : selectedCatVal}
            onChange={(e) => handleSelectCategory(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition cursor-pointer"
          >
            <option value="">-- Choose Category --</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.slug || cat.id}>
                {cat.name} ({cat.count || 0} products)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Mode C: Custom Link */}
      {mode === "custom" && (
        <div>
          <input
            type="text"
            value={banner.link || ""}
            onChange={(e) => onUpdateLink(e.target.value)}
            placeholder="e.g. /favorites or /categories"
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
          />
        </div>
      )}

      {/* Destination Preview Chip */}
      <div className="flex items-center justify-between text-[11px] text-gray-500 bg-white/90 rounded-xl px-3 py-1.5 border border-gray-200/80 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 truncate">
          <span className="font-extrabold text-gray-700">Landing Path:</span>
          <code className="text-emerald-700 font-mono font-bold bg-emerald-50 px-1.5 py-0.5 rounded text-[10px] border border-emerald-200">
            {banner.link || "(No link assigned)"}
          </code>
          {mode === "product" && selectedProduct && (
            <span className="text-gray-600 truncate text-[10px]">
              (Opens "{selectedProduct.name}")
            </span>
          )}
          {mode === "category" && selectedCategory && (
            <span className="text-gray-600 truncate text-[10px]">
              (Opens "{selectedCategory.name}")
            </span>
          )}
        </div>

        {banner.link && (
          <a
            href={banner.link.startsWith("http") ? banner.link : `http://localhost:5173${banner.link}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 hover:text-emerald-800 transition"
            title="Open destination in Customer Web"
          >
            <span>Test Link</span>
            <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}

function Banners() {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);

  // Lookups for product and category selection
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loadingLookups, setLoadingLookups] = useState(false);

  // Preview Modal state
  const [previewBanner, setPreviewBanner] = useState(null);
  const [previewMode, setPreviewMode] = useState("desktop"); // "desktop" | "mobile"

  // Per-slot upload states: { [`${bannerIndex}-${slot}`]: { uploading: boolean, progress: string } }
  const [uploadingSlots, setUploadingSlots] = useState({});

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  const fetchBannerList = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await getBanners();
      if (res.success && Array.isArray(res.banners)) {
        setBanners(res.banners);
      } else if (Array.isArray(res)) {
        setBanners(res);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load homepage banners.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBannerList();

    let isMounted = true;
    const fetchLookups = async () => {
      try {
        setLoadingLookups(true);
        const [catRes, prodRes] = await Promise.allSettled([
          getCategories(),
          getProducts({ per_page: 100 }),
        ]);

        if (!isMounted) return;

        if (catRes.status === "fulfilled") {
          const list = catRes.value?.categories || catRes.value;
          if (Array.isArray(list)) setCategories(list);
        }

        if (prodRes.status === "fulfilled") {
          const list = prodRes.value?.products || prodRes.value;
          if (Array.isArray(list)) setProducts(list);
        }
      } catch {
        // Fallback: manual custom entry remains available
      } finally {
        if (isMounted) setLoadingLookups(false);
      }
    };

    fetchLookups();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleAddBanner = () => {
    if (banners.length >= 3) {
      showToast("Maximum 3 homepage banners allowed.", "error");
      return;
    }

    const firstProd = products[0];
    const newBanner = {
      id: `banner-${Date.now()}`,
      title: firstProd ? firstProd.name : `Promotional Banner #${banners.length + 1}`,
      link: firstProd ? `/product/${firstProd.id}` : "/categories",
      desktop_image: "",
      desktop_media_id: null,
      mobile_image: "",
      mobile_media_id: null,
      is_active: true,
    };

    setBanners((prev) => [...prev, newBanner]);
  };

  const handleRemoveBanner = (index) => {
    setBanners((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdateField = (index, field, value) => {
    setBanners((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: value,
      };
      return updated;
    });
  };

  const handleUploadImage = async (e, bannerIndex, slot) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const file = files[0];

    if (!isAcceptedImage(file)) {
      showToast(`"${file.name}" is not a supported image format.`, "error");
      e.target.value = "";
      return;
    }

    if (file.size > RAW_IMAGE_MAX_INPUT_BYTES) {
      showToast(`"${file.name}" exceeds the 25MB maximum limit.`, "error");
      e.target.value = "";
      return;
    }

    if (isHeicFile(file)) {
      showToast(
        `"${file.name}" is in HEIC format and not supported directly by your browser. Please select JPEG, PNG, or WebP.`,
        "error"
      );
      e.target.value = "";
      return;
    }

    const slotKey = `${bannerIndex}-${slot}`;
    setUploadingSlots((prev) => ({ ...prev, [slotKey]: { uploading: true } }));

    // Aspect ratio check: use fast header parser to avoid multi-hundred MB bitmap decoding on mobile
    try {
      const dims = await parseImageDimensionsFromHeader(file);
      if (dims && dims.width > 0 && dims.height > 0) {
        const ratio = dims.width / dims.height;
        if (slot === "desktop" && (ratio < 2.0 || ratio > 3.5)) {
          showToast(
            `Tip: Selected image ratio is ${ratio.toFixed(1)}:1. Recommended desktop ratio is 8:3 (2.67:1). It will be fitted automatically.`,
            "info"
          );
        } else if (slot === "mobile" && (ratio < 1.7 || ratio > 2.8)) {
          showToast(
            `Tip: Selected image ratio is ${ratio.toFixed(1)}:1. Recommended mobile ratio is 16:7 (2.28:1). It will be fitted automatically.`,
            "info"
          );
        }
      }
    } catch (_) {
      // Non-blocking ratio guidance fallback
    }

    // Compress banner image client-side before upload (max 1920px preserving aspect ratio, WebP 0.85 with JPEG fallback)
    let fileToUpload = file;
    try {
      fileToUpload = await compressImage(file, { maxDimension: BANNER_MAX_DIMENSION });
    } catch (err) {
      if (isHeicFile(file) || err?.code === "HEIC_UNSUPPORTED") {
        showToast(
          `"${file.name}" is in HEIC format and not supported directly by your browser. Please select JPEG, PNG, or WebP.`,
          "error"
        );
        setUploadingSlots((prev) => ({ ...prev, [slotKey]: { uploading: false } }));
        e.target.value = "";
        return;
      }
      // Fall back to original file if compression fails on standard images
    }

    if (isHeicFile(fileToUpload)) {
      showToast(
        `"${file.name}" is in HEIC format and cannot be uploaded. Please select JPEG, PNG, or WebP.`,
        "error"
      );
      setUploadingSlots((prev) => ({ ...prev, [slotKey]: { uploading: false } }));
      e.target.value = "";
      return;
    }

    if (fileToUpload.size > MAX_FILE_SIZE_BYTES) {
      showToast(`"${file.name}" exceeds the 5MB upload limit after compression.`, "error");
      setUploadingSlots((prev) => ({ ...prev, [slotKey]: { uploading: false } }));
      e.target.value = "";
      return;
    }

    try {
      const uploadRes = await uploadProductImage(fileToUpload);
      if (uploadRes.success && (uploadRes.url || uploadRes.id)) {
        setBanners((prev) =>
          prev.map((b, idx) => {
            if (idx !== bannerIndex) return b;
            return {
              ...b,
              ...(slot === "desktop"
                ? { desktop_image: uploadRes.url, desktop_media_id: uploadRes.id }
                : { mobile_image: uploadRes.url, mobile_media_id: uploadRes.id }),
            };
          })
        );
        showToast(`Banner ${slot} image uploaded to WordPress Media Library!`);
      } else {
        showToast("Upload failed. Please try again.", "error");
      }
    } catch (err) {
      showToast(err.response?.data?.message || err.message || "Failed to upload image.", "error");
    } finally {
      setUploadingSlots((prev) => {
        const next = { ...prev };
        delete next[slotKey];
        return next;
      });
      e.target.value = "";
    }
  };

  const handleRemoveSlotImage = (bannerIndex, slot) => {
    setBanners((prev) =>
      prev.map((b, idx) => {
        if (idx !== bannerIndex) return b;
        return {
          ...b,
          ...(slot === "desktop"
            ? { desktop_image: "", desktop_media_id: null }
            : { mobile_image: "", mobile_media_id: null }),
        };
      })
    );
  };

  const handleSaveAllBanners = async () => {
    if (saving) return;

    if (banners.length === 0) {
      showToast("At least 1 banner is required.", "error");
      return;
    }

    if (banners.length > 3) {
      showToast("Maximum 3 banners allowed.", "error");
      return;
    }

    // Verify each banner has at least one image
    for (let i = 0; i < banners.length; i++) {
      const b = banners[i];
      if (!b.desktop_image && !b.mobile_image) {
        showToast(`Banner #${i + 1} (${b.title || "Untitled"}) must have at least a desktop or mobile photo.`, "error");
        return;
      }
    }

    try {
      setSaving(true);
      setError("");

      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp_bnr_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

      const res = await updateBanners(banners, {
        "X-Idempotency-Key": idempotencyKey,
      });

      if (res.success && Array.isArray(res.banners)) {
        setBanners(res.banners);
        showToast("Homepage banners saved & published to WordPress!");
      } else {
        showToast("Banners updated successfully!");
        fetchBannerList();
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to persist banners in WordPress.");
      showToast("Failed to save banners.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 max-w-5xl mx-auto pb-16 px-1 sm:px-0">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 flex items-center gap-2.5 rounded-2xl px-5 py-3.5 text-xs font-bold text-white shadow-xl animate-in slide-in-from-top duration-300 ${
            toast.type === "error"
              ? "bg-rose-600 shadow-rose-600/30"
              : toast.type === "info"
              ? "bg-sky-600 shadow-sky-600/30"
              : "bg-emerald-600 shadow-emerald-600/30"
          }`}
        >
          {toast.type === "error" ? (
            <AlertCircle size={16} />
          ) : toast.type === "info" ? (
            <Info size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-gray-200 pb-4 sm:pb-5">
        <div>
          <div className="hidden sm:flex items-center gap-2">
            <Link
              to="/products"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 transition shadow-xs"
            >
              <ArrowLeft size={14} /> Back to Products
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-gray-900 sm:mt-2 flex items-center gap-2">
            <Sliders size={24} className="text-emerald-600" />
            Homepage Banners
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage up to 3 hero promotional slides displayed on the Customer Web homepage.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleAddBanner}
            disabled={banners.length >= 3 || loading}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-extrabold text-white shadow-sm transition active:scale-95 cursor-pointer ${
              banners.length >= 3
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            <Plus size={15} />
            {banners.length >= 3 ? "3 / 3 (Max Reached)" : "Add Banner"}
          </button>

          <button
            type="button"
            onClick={handleSaveAllBanners}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-[#0F172A] px-5 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-slate-800 transition active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 size={15} className="animate-spin text-emerald-400" />
                <span>Saving to WordPress...</span>
              </>
            ) : (
              <>
                <Check size={15} className="text-emerald-400" />
                <span>Save & Publish</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Banner Sizing & Aspect Ratio Guidelines Card */}
      <div className="rounded-3xl border border-sky-100 bg-gradient-to-r from-sky-50/60 to-indigo-50/40 p-4 sm:p-5 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500 text-white shrink-0 shadow-xs">
            <Sparkles size={16} />
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-black uppercase tracking-wider text-sky-950">
              Required Banner Dimensions & Responsive Ratios
            </h3>
            <p className="text-xs text-sky-800/80 leading-relaxed">
              Customer Web serves optimized banners per viewport. Please crop your promotional creatives to the recommended ratios before uploading:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
              <div className="flex items-center gap-2.5 rounded-xl border border-sky-200/80 bg-white/90 p-2.5 text-xs shadow-2xs">
                <Monitor size={18} className="text-sky-600 shrink-0" />
                <div>
                  <span className="font-bold text-gray-900 block">Desktop Banner</span>
                  <span className="text-[11px] text-gray-500">
                    Recommended: <strong className="text-sky-700">1600 × 600 px</strong> (Ratio: <strong>8:3 / 16:6</strong>)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 rounded-xl border border-indigo-200/80 bg-white/90 p-2.5 text-xs shadow-2xs">
                <Smartphone size={18} className="text-indigo-600 shrink-0" />
                <div>
                  <span className="font-bold text-gray-900 block">Mobile Banner</span>
                  <span className="text-[11px] text-gray-500">
                    Recommended: <strong className="text-indigo-700">800 × 350 px</strong> (Ratio: <strong>16:7</strong>)
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
          <AlertCircle size={16} className="shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Banner List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-44 rounded-3xl border border-gray-200 bg-white p-5 shadow-xs animate-pulse"
            />
          ))}
        </div>
      ) : banners.length === 0 ? (
        <div className="rounded-3xl border border-gray-200 bg-white p-12 text-center space-y-4 shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
            <ImageIcon size={28} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">No Banners Configured</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Click "+ Add Banner" above to create up to 3 custom promotional slides.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {banners.map((banner, index) => {
            const isDesktopUploading = uploadingSlots[`${index}-desktop`]?.uploading;
            const isMobileUploading = uploadingSlots[`${index}-mobile`]?.uploading;

            return (
              <div
                key={banner.id || index}
                className={`rounded-3xl border transition-all duration-200 bg-white shadow-xs p-4 sm:p-6 space-y-4 ${
                  banner.is_active
                    ? "border-gray-200/90 hover:border-emerald-300"
                    : "border-gray-200 bg-gray-50/50 opacity-75"
                }`}
              >
                {/* Banner Card Header */}
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-600 text-white font-mono font-black text-xs shadow-2xs">
                      #{index + 1}
                    </span>
                    <h2 className="text-sm font-black text-gray-900">
                      {banner.title || `Slide #${index + 1}`}
                    </h2>
                    {banner.is_active ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Active on Homepage
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                        Inactive / Hidden
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Live Preview Button */}
                    <button
                      type="button"
                      onClick={() => setPreviewBanner(banner)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition shadow-2xs cursor-pointer"
                    >
                      <Eye size={13} />
                      Preview
                    </button>

                    {/* Active Toggle */}
                    <button
                      type="button"
                      onClick={() => handleUpdateField(index, "is_active", !banner.is_active)}
                      className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold transition shadow-2xs cursor-pointer ${
                        banner.is_active
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-gray-100 text-gray-600 border border-gray-200"
                      }`}
                    >
                      {banner.is_active ? "Active" : "Disabled"}
                    </button>

                    {/* Delete Banner */}
                    <button
                      type="button"
                      onClick={() => handleRemoveBanner(index)}
                      className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                      title="Remove banner"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Banner Title & Destination Link Inputs */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700">
                      Banner Title / Internal Name
                    </label>
                    <input
                      type="text"
                      value={banner.title}
                      onChange={(e) => handleUpdateField(index, "title", e.target.value)}
                      placeholder="e.g. Toys and Fun Special Sale"
                      className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
                    />
                  </div>

                  <div>
                    <DestinationLinkSelector
                      banner={banner}
                      index={index}
                      products={products}
                      categories={categories}
                      loadingLookups={loadingLookups}
                      onUpdateLink={(newLink) => handleUpdateField(index, "link", newLink)}
                      onUpdateTitle={(newTitle) => handleUpdateField(index, "title", newTitle)}
                    />
                  </div>
                </div>

                {/* Dual Image Slots: Desktop & Mobile */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  {/* Slot A: Desktop Banner */}
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Monitor size={15} className="text-sky-600" />
                        <span className="text-xs font-black uppercase tracking-wider text-gray-800">
                          Desktop Image
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                        1600 × 600 px (8:3)
                      </span>
                    </div>

                    <input
                      type="file"
                      id={`file-desktop-${index}`}
                      onChange={(e) => handleUploadImage(e, index, "desktop")}
                      accept="image/*,image/heic,image/heif"
                      className="hidden"
                    />

                    {banner.desktop_image ? (
                      <div className="space-y-2">
                        <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-white aspect-[16/6] flex items-center justify-center">
                          <img
                            src={banner.desktop_image}
                            alt="Desktop Banner"
                            className="h-full w-full object-cover"
                          />

                          {isDesktopUploading && (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white gap-2 text-xs font-bold">
                              <Loader2 size={18} className="animate-spin text-emerald-400" />
                              <span>Uploading to WordPress...</span>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRemoveSlotImage(index, "desktop")}
                            className="absolute top-2 right-2 bg-black/70 hover:bg-rose-600 text-white rounded-full p-1.5 transition cursor-pointer shadow-xs"
                            title="Remove desktop image"
                          >
                            <X size={12} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1">
                          <label
                            htmlFor={`file-desktop-${index}`}
                            className="inline-flex items-center gap-1.5 font-bold text-emerald-700 hover:text-emerald-800 transition cursor-pointer"
                          >
                            <RefreshCw size={12} /> Replace Image
                          </label>
                          {banner.desktop_media_id && (
                            <span className="text-[10px] text-gray-400 font-mono">
                              WP Media #{banner.desktop_media_id}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <label
                        htmlFor={`file-desktop-${index}`}
                        className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-white p-5 text-center hover:border-sky-400 hover:bg-sky-50/20 transition cursor-pointer aspect-[16/6]"
                      >
                        {isDesktopUploading ? (
                          <div className="flex flex-col items-center gap-2 text-xs font-bold text-gray-600">
                            <Loader2 size={20} className="animate-spin text-sky-600" />
                            <span>Uploading to WordPress...</span>
                          </div>
                        ) : (
                          <>
                            <Upload size={20} className="text-gray-400 mb-1" />
                            <span className="text-xs font-bold text-gray-700">Choose Desktop Creative</span>
                            <span className="text-[10px] text-gray-400">1600 × 600 px • WebP, JPG, PNG</span>
                          </>
                        )}
                      </label>
                    )}
                  </div>

                  {/* Slot B: Mobile Banner */}
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Smartphone size={15} className="text-indigo-600" />
                        <span className="text-xs font-black uppercase tracking-wider text-gray-800">
                          Mobile Image
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                        800 × 350 px (16:7)
                      </span>
                    </div>

                    <input
                      type="file"
                      id={`file-mobile-${index}`}
                      onChange={(e) => handleUploadImage(e, index, "mobile")}
                      accept="image/*,image/heic,image/heif"
                      className="hidden"
                    />

                    {banner.mobile_image ? (
                      <div className="space-y-2">
                        <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-white aspect-[16/7] flex items-center justify-center">
                          <img
                            src={banner.mobile_image}
                            alt="Mobile Banner"
                            className="h-full w-full object-cover"
                          />

                          {isMobileUploading && (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white gap-2 text-xs font-bold">
                              <Loader2 size={18} className="animate-spin text-emerald-400" />
                              <span>Uploading to WordPress...</span>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRemoveSlotImage(index, "mobile")}
                            className="absolute top-2 right-2 bg-black/70 hover:bg-rose-600 text-white rounded-full p-1.5 transition cursor-pointer shadow-xs"
                            title="Remove mobile image"
                          >
                            <X size={12} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1">
                          <label
                            htmlFor={`file-mobile-${index}`}
                            className="inline-flex items-center gap-1.5 font-bold text-emerald-700 hover:text-emerald-800 transition cursor-pointer"
                          >
                            <RefreshCw size={12} /> Replace Image
                          </label>
                          {banner.mobile_media_id && (
                            <span className="text-[10px] text-gray-400 font-mono">
                              WP Media #{banner.mobile_media_id}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <label
                        htmlFor={`file-mobile-${index}`}
                        className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-white p-5 text-center hover:border-indigo-400 hover:bg-indigo-50/20 transition cursor-pointer aspect-[16/7]"
                      >
                        {isMobileUploading ? (
                          <div className="flex flex-col items-center gap-2 text-xs font-bold text-gray-600">
                            <Loader2 size={20} className="animate-spin text-indigo-600" />
                            <span>Uploading to WordPress...</span>
                          </div>
                        ) : (
                          <>
                            <Upload size={20} className="text-gray-400 mb-1" />
                            <span className="text-xs font-bold text-gray-700">Choose Mobile Creative</span>
                            <span className="text-[10px] text-gray-400">800 × 350 px • WebP, JPG, PNG</span>
                          </>
                        )}
                      </label>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Live Preview Modal */}
      {previewBanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl rounded-3xl bg-white p-5 sm:p-7 shadow-2xl border border-gray-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                  <Eye size={18} className="text-emerald-600" />
                  Storefront Banner Preview
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {previewBanner.title || "Promotional Banner"} &bull; Links to: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700 font-mono text-[11px]">{previewBanner.link}</code>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPreviewBanner(null)}
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Device Switcher */}
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewMode("desktop")}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  previewMode === "desktop"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                <Monitor size={14} /> Desktop (8:3)
              </button>

              <button
                type="button"
                onClick={() => setPreviewMode("mobile")}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  previewMode === "mobile"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                <Smartphone size={14} /> Mobile (16:7)
              </button>
            </div>

            {/* Rendered Preview Box */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex items-center justify-center min-h-[220px]">
              {previewMode === "desktop" ? (
                <div className="w-full max-w-xl overflow-hidden rounded-[20px] shadow-sm border border-gray-200">
                  <img
                    src={previewBanner.desktop_image || previewBanner.mobile_image || "/banner/Art.webp"}
                    alt="Desktop Preview"
                    className="aspect-[16/6] w-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-72 overflow-hidden rounded-[18px] shadow-sm border-2 border-gray-300 bg-white">
                  <img
                    src={previewBanner.mobile_image || previewBanner.desktop_image || "/banner/Art.webp"}
                    alt="Mobile Preview"
                    className="aspect-[16/7] w-full object-cover"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setPreviewBanner(null)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition shadow-xs cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Banners;
