import { useEffect, useState, useRef, useMemo } from "react";
import { useSearchParams, useOutletContext } from "react-router-dom";
import { useVisibleRevalidation } from "../hooks/useVisibleRevalidation.js";
import {
  Boxes,
  Search,
  Edit2,
  Check,
  X,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Copy,
  Filter,
  ChevronDown,
} from "lucide-react";
import {
  getProducts,
  getProductById,
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
  buildProductAdjustmentPayload,
  applyProductAdjustment,
  matchesProductAdjustment,
} from "../utils/productAdjuster.js";
import { getProductStockDisplay } from "../utils/productStockDisplay.js";
import { ProductQuickAdjustModal } from "../components/product/ProductQuickAdjustModal.jsx";
import { ProductAddModal } from "../components/product/ProductAddModal.jsx";
import { ProductDeleteModal } from "../components/product/ProductDeleteModal.jsx";

function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const outletContext = useOutletContext();
  const setPageRefresh = outletContext?.setPageRefresh;

  const urlStockParam = searchParams.get("stock_status");
  const urlCategoryParam = searchParams.get("category");
  const urlSearchParam = searchParams.get("search");

  const [products, setProducts] = useState([]);
  const [stockCounts, setStockCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState(urlSearchParam || "");
  const [debouncedSearch, setDebouncedSearch] = useState(urlSearchParam || "");
  const [stockFilter, setStockFilter] = useState(() => {
    return ["instock", "outofstock", "lowstock", "onbackorder"].includes(urlStockParam) ? urlStockParam : "all";
  });

  // Category filter state
  const [categories, setCategories] = useState([]);
  const [categoriesError, setCategoriesError] = useState("");
  const [categoriesRetryCount, setCategoriesRetryCount] = useState(0);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState(urlCategoryParam || "all");
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const categoryDropdownRef = useRef(null);

  // Pagination & Per-Page state (20 / 50 / 100)
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [perPageDropdownOpen, setPerPageDropdownOpen] = useState(false);
  const perPageDropdownRef = useRef(null);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);

  // SKU copy feedback state
  const [copiedSkuId, setCopiedSkuId] = useState(null);

  // Quick Adjust Modal/Bottom-Sheet state (Desktop & Mobile)
  const [quickAdjustProduct, setQuickAdjustProduct] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ regular_price: "", sale_price: "", stock_quantity: "" });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const listViewKey = JSON.stringify([page, perPage, debouncedSearch, stockFilter, categoryFilter]);
  const listViewKeyRef = useRef(listViewKey);
  listViewKeyRef.current = listViewKey;

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
    department_id: "",
    subcategory_id: "",
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
  const productCreateIdempotencyRef = useRef(null);

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

  // Sync state when URL searchParams change externally (e.g. back/forward navigation or dashboard link)
  useEffect(() => {
    const stockParam = searchParams.get("stock_status");
    const catParam = searchParams.get("category");
    const searchParam = searchParams.get("search");

    const resolvedStock = ["instock", "outofstock", "lowstock", "onbackorder"].includes(stockParam) ? stockParam : "all";
    setStockFilter((prev) => (prev !== resolvedStock ? resolvedStock : prev));

    const resolvedCat = catParam || "all";
    setCategoryFilter((prev) => (prev !== resolvedCat ? resolvedCat : prev));

    if (searchParam !== null && searchParam !== undefined) {
      setSearchQuery((prev) => (prev !== searchParam ? searchParam : prev));
      setDebouncedSearch((prev) => (prev !== searchParam ? searchParam : prev));
    }
  }, [searchParams]);

  // Handle URL updates when stock filter changes
  const handleStockFilterChange = (newStock) => {
    setStockFilter(newStock);
    setPage(1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (newStock && newStock !== "all") {
          next.set("stock_status", newStock);
        } else {
          next.delete("stock_status");
        }
        return next;
      },
      { replace: true }
    );
  };

  // Handle URL updates when category filter changes
  const handleCategoryFilterChange = (newCat) => {
    setCategoryFilter(newCat);
    setPage(1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (newCat && newCat !== "all") {
          next.set("category", newCat);
        } else {
          next.delete("category");
        }
        return next;
      },
      { replace: true }
    );
  };

  // Reset all active filters
  const handleClearFilters = () => {
    setStockFilter("all");
    setCategoryFilter("all");
    setSearchQuery("");
    setDebouncedSearch("");
    setPage(1);
    setSearchParams({}, { replace: true });
  };

  // Debounce search input by 400ms and sync with URL
  useEffect(() => {
    const timer = setTimeout(() => {
      const normalized = searchQuery.trim();
      const nextSearch = normalized.length >= 2 ? normalized : "";
      setDebouncedSearch(nextSearch);
      setPage(1);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextSearch) {
            next.set("search", nextSearch);
          } else {
            next.delete("search");
          }
          return next;
        },
        { replace: true }
      );
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, setSearchParams]);

  // Fetch categories for filtering and the quick-create product category fields.
  useEffect(() => {
    let isMounted = true;
    setCategoriesLoading(true);
    setCategoriesError("");
    getCategories()
      .then((res) => {
        if (isMounted && res?.success && Array.isArray(res.categories)) {
          setCategories(res.categories);
          const hasDepartment = res.categories.some((category) =>
            (!category.parent || Number(category.parent) === 0) &&
            String(category.slug || "").toLowerCase() !== "uncategorized" &&
            String(category.name || "").toLowerCase() !== "uncategorized"
          );
          if (!hasDepartment) setCategoriesError("No product departments are available yet.");
          if (categoryFilter !== "all" && !res.categories.some((c) => String(c.id) === String(categoryFilter))) {
            setCategoryFilter("all");
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.delete("category");
                return next;
              },
              { replace: true }
            );
            showToast("The selected category filter no longer exists and has been reset.", "info");
          }
        } else if (isMounted) {
          setCategoriesError(res?.message || "Categories could not be loaded.");
        }
      })
      .catch((err) => {
        if (isMounted) setCategoriesError(err.response?.data?.message || err.message || "Categories could not be loaded.");
      })
      .finally(() => {
        if (isMounted) setCategoriesLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [categoriesRetryCount]);

  // Close category dropdown on outside click or Escape
  useEffect(() => {
    if (!isCategoryDropdownOpen) return;

    const handleClickOutside = (event) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target)) {
        setIsCategoryDropdownOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsCategoryDropdownOpen(false);
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
  }, [isCategoryDropdownOpen]);

  // Close per-page dropdown on outside click or Escape
  useEffect(() => {
    if (!perPageDropdownOpen) return;

    const handleClickOutside = (event) => {
      if (perPageDropdownRef.current && !perPageDropdownRef.current.contains(event.target)) {
        setPerPageDropdownOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setPerPageDropdownOpen(false);
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
  }, [perPageDropdownOpen]);

  const abortControllerRef = useRef(null);

  const fetchProductList = async ({ silent = false } = {}) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentRequestId = ++requestIdRef.current;
    try {
      if (!silent) {
        setLoading(true);
      }
      setError("");
      const res = await getProducts(
        {
          page,
          per_page: perPage,
          search: debouncedSearch || undefined,
          stock_status: stockFilter !== "all" ? stockFilter : undefined,
          category: categoryFilter !== "all" ? categoryFilter : undefined,
        },
        { signal: controller.signal }
      );

      // Ignore responses from outdated / superseded requests
      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      if (res.success) {
        setProducts(res.products || []);
        setStockCounts(res.counts ?? null);
        setTotalProducts(res.total !== undefined ? res.total : (res.products?.length || 0));
        setTotalPages(res.totalPages !== undefined ? res.totalPages : (Math.ceil((res.total || 1) / perPage) || 1));
      }
    } catch (err) {
      if (controller.signal.aborted || err.name === "CanceledError" || err.code === "ERR_CANCELED") {
        return;
      }
      if (currentRequestId !== requestIdRef.current) {
        return;
      }
      if (!silent) {
        setError(err.response?.data?.message || err.message || "Failed to load catalog products.");
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (currentRequestId === requestIdRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchProductList();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [page, perPage, debouncedSearch, stockFilter, categoryFilter]);

  const fetchProductListRef = useRef(fetchProductList);
  fetchProductListRef.current = fetchProductList;

  // Connect active tab / drawer re-click refresh (uses latest filters & pagination)
  useEffect(() => {
    setPageRefresh?.(() => () => fetchProductListRef.current?.({ silent: false }));
    return () => setPageRefresh?.(null);
  }, [setPageRefresh]);

  // Revalidate stock on app resume / wake-up
  useVisibleRevalidation(
    () => fetchProductListRef.current?.({ silent: true }),
    () => Boolean(abortControllerRef.current)
  );

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
      regular_price: product.regular_price ?? product.price ?? "",
      sale_price: product.sale_price ?? "",
      stock_quantity: product.stock_quantity == null ? "" : product.stock_quantity,
    });
  };

  const handleCloseQuickAdjust = () => {
    if (adjustSaving) return;
    setQuickAdjustProduct(null);
    setAdjustForm({ regular_price: "", sale_price: "", stock_quantity: "" });
  };

  const handleSaveQuickAdjust = async () => {
    if (!quickAdjustProduct || adjustSaving) return;

    const validation = validateAdjustInput(adjustForm, quickAdjustProduct);
    if (!validation.isValid) {
      if (validation.noChanges) {
        handleCloseQuickAdjust();
        return;
      }
      showToast(validation.error, "error");
      return;
    }

    const targetProductId = quickAdjustProduct.id;
    const submittedFields = validation.updateData;
    const submittedViewKey = listViewKeyRef.current;
    const payload = buildProductAdjustmentPayload(submittedFields, quickAdjustProduct);

    try {
      setAdjustSaving(true);
      const res = await updateProduct(targetProductId, payload);
      if (res.success) {
        const returnedProduct = res.product || res.data;
        if (listViewKeyRef.current === submittedViewKey) {
          setProducts((prev) =>
            prev.map((p) => {
              if (p.id !== targetProductId) return p;
              if (returnedProduct && (returnedProduct.id === p.id || returnedProduct.id === targetProductId)) {
                return { ...p, ...returnedProduct };
              }
              return applyProductAdjustment(p, submittedFields);
            })
          );
          fetchProductList({ silent: true });
        }
        showToast("Saved");
        setQuickAdjustProduct(null);
        setAdjustForm({ regular_price: "", sale_price: "", stock_quantity: "" });
      } else {
        showToast(res.message || "Failed to update product.", "error");
      }
    } catch (err) {
      const status = err.response?.status;
      const errData = err.response?.data;
      if (status === 409) {
        const latestStock = errData?.current_stock;
        if (latestStock !== undefined && latestStock !== null) {
          setQuickAdjustProduct((prev) => (prev ? { ...prev, stock_quantity: latestStock } : prev));
          setAdjustForm((prev) => ({ ...prev, stock_quantity: latestStock }));
        }
        showToast(errData?.message || "Stock changed on server. Review new quantity.", "error");
      } else if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
        showToast("Request timed out. Verifying server state...", "info");
        try {
          const verification = await getProductById(targetProductId, { timeout: 5000 });
          const verifiedProduct = verification?.product;
          if (verification?.success && matchesProductAdjustment(verifiedProduct, submittedFields)) {
            if (listViewKeyRef.current === submittedViewKey) {
              setProducts((prev) => prev.map((product) =>
                product.id === targetProductId ? { ...product, ...verifiedProduct } : product
              ));
              fetchProductList({ silent: true });
            }
            if (quickAdjustProduct?.id === targetProductId) {
              showToast("Saved");
              setQuickAdjustProduct(null);
              setAdjustForm({ regular_price: "", sale_price: "", stock_quantity: "" });
            }
            return;
          }
        } catch {
          // A failed verification is inconclusive; keep the user's edit available for review.
        }
        if (quickAdjustProduct?.id === targetProductId) {
          showToast("The save could not be confirmed. Review the product and retry.", "error");
        }
      } else {
        showToast(
          errData?.message || err.message || "Failed to update product.",
          "error"
        );
      }
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
        showToast(`Product "${product.name}" moved to Trash.`);
        setDeleteConfirmProduct(null);
        fetchProductList({ silent: true });
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
    const departmentId = Number(newProduct.department_id);
    const subcategoryId = newProduct.subcategory_id ? Number(newProduct.subcategory_id) : 0;
    const validDepartment = categories.some(
      (category) =>
        Number(category.id) === departmentId &&
        (!category.parent || Number(category.parent) === 0) &&
        String(category.slug || "").toLowerCase() !== "uncategorized" &&
        String(category.name || "").toLowerCase() !== "uncategorized"
    );
    const validSubcategory = !subcategoryId || categories.some(
      (category) => Number(category.id) === subcategoryId && Number(category.parent) === departmentId
    );
    if (!validDepartment || !validSubcategory) {
      showToast("Choose a valid department and optional subcategory before creating the product.", "error");
      return;
    }

    try {
      setCreating(true);
      const payload = {
        ...newProduct,
        department_id: departmentId,
        subcategory_id: subcategoryId || undefined,
        category_ids: [subcategoryId || departmentId],
        images: newProduct.media_id
          ? [{ id: Number(newProduct.media_id), src: newProduct.image_url }]
          : newProduct.image_url
          ? [{ src: newProduct.image_url }]
          : [],
      };
      const fingerprint = JSON.stringify(payload);
      if (productCreateIdempotencyRef.current?.fingerprint !== fingerprint) {
        const key = typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp_product_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        productCreateIdempotencyRef.current = { fingerprint, key };
      }
      const idempotencyKey = productCreateIdempotencyRef.current.key;
      const res = await createProduct(payload, { "X-Idempotency-Key": idempotencyKey });
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
          department_id: "",
          subcategory_id: "",
        });
        productCreateIdempotencyRef.current = null;
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

  // Selected category label and list helpers
  const selectedCategoryObj = categories.find((c) => String(c.id) === String(categoryFilter));
  const selectedCategoryCount = selectedCategoryObj
    ? Number(selectedCategoryObj.parent) > 0
      ? selectedCategoryObj.direct_count ?? selectedCategoryObj.count
      : selectedCategoryObj.total_count ?? selectedCategoryObj.count
    : undefined;
  const productDepartments = categories.filter((category) =>
    (!category.parent || Number(category.parent) === 0) &&
    String(category.slug || "").toLowerCase() !== "uncategorized" &&
    String(category.name || "").toLowerCase() !== "uncategorized"
  );
  const productSubcategories = newProduct.department_id
    ? categories.filter((category) =>
      Number(category.parent) === Number(newProduct.department_id) &&
      String(category.slug || "").toLowerCase() !== "uncategorized" &&
      String(category.name || "").toLowerCase() !== "uncategorized"
    )
    : [];
  const totalCategoryProductsCount = stockCounts?.all ?? null;
  const hierarchicalCategories = useMemo(() => {
    const roots = categories.filter(
      (c) =>
        (!c.parent || Number(c.parent) === 0) &&
        String(c.slug || "").toLowerCase() !== "uncategorized" &&
        String(c.name || "").toLowerCase() !== "uncategorized"
    );
    const childrenByParent = new Map();
    for (const c of categories) {
      if (c.parent && Number(c.parent) > 0) {
        const pId = Number(c.parent);
        if (!childrenByParent.has(pId)) childrenByParent.set(pId, []);
        childrenByParent.get(pId).push(c);
      }
    }
    const query = categorySearchQuery.trim().toLowerCase();
    const result = [];
    for (const root of roots) {
      const children = childrenByParent.get(Number(root.id)) || [];
      const rootMatches = !query || root.name.toLowerCase().includes(query);
      const matchingChildren = children.filter((child) => !query || child.name.toLowerCase().includes(query));
      if (rootMatches || matchingChildren.length > 0) {
        result.push({
          ...root,
          isRoot: true,
          displayCount: root.total_count ?? root.count,
        });
        for (const child of query ? matchingChildren : children) {
          result.push({
            ...child,
            isRoot: false,
            parentName: root.name,
            displayCount: child.direct_count ?? child.count,
          });
        }
      }
    }
    return result;
  }, [categories, categorySearchQuery]);

  // The three visible pill counts are catalog-wide, not current-page totals.
  const stockFilterTabs = [
    { id: "all", label: "All Items", count: stockCounts?.all },
    { id: "instock", label: "In Stock", count: stockCounts?.instock },
    { id: "outofstock", label: "Out of Stock", count: stockCounts?.outofstock },
  ];
  const stockFilterLabels = {
    all: "All Items",
    instock: "In Stock",
    outofstock: "Out of Stock",
    lowstock: "Low Stock (managed, 1–5 units)",
    onbackorder: "On Backorder",
  };

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
        {/* Stock Filter Pills: Equal 3-column grid on mobile to eliminate orphaned pills */}
        <div className="w-full sm:w-auto">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Catalog-wide counts</p>
          <div className="grid grid-cols-3 gap-1.5 w-full sm:flex sm:flex-wrap">
          {stockFilterTabs.map((tab) => {
            const isSelected = stockFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleStockFilterChange(tab.id)}
                className={`flex items-center justify-center gap-1.5 rounded-xl px-2.5 sm:px-3 py-2 sm:py-1.5 text-xs font-bold transition cursor-pointer active:scale-95 text-center ${
                  isSelected
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-xs"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span className="truncate">{tab.label}</span>
                {tab.count !== undefined && tab.count !== null && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      isSelected
                        ? "bg-emerald-200/70 text-emerald-800"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
          </div>
          {(stockFilter === "lowstock" || stockFilter === "onbackorder") && (
            <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-emerald-800" role="status">
              <span>Active filter: {stockFilterLabels[stockFilter]}</span>
              <button type="button" onClick={() => handleStockFilterChange("all")} className="underline underline-offset-2">
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Unified Category Filter Dropdown (Responsive: Mobile + Desktop) */}
        <div className="relative w-full sm:w-auto" ref={categoryDropdownRef}>
          <button
            type="button"
            onClick={() => setIsCategoryDropdownOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={isCategoryDropdownOpen}
            className={`w-full sm:w-auto min-w-[210px] h-10 flex items-center justify-between gap-2.5 rounded-xl border px-3.5 text-xs font-bold transition-all cursor-pointer shadow-2xs select-none active:scale-[0.99] ${
              categoryFilter !== "all"
                ? "border-emerald-500 bg-emerald-50/70 text-emerald-950 ring-2 ring-emerald-500/15"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50/80"
            } ${isCategoryDropdownOpen ? "ring-2 ring-emerald-500/20 border-emerald-500" : ""}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Filter
                size={14}
                className={`shrink-0 transition-colors ${
                  categoryFilter !== "all" ? "text-emerald-600" : "text-gray-400"
                }`}
              />
              <span className="truncate">
                {selectedCategoryObj ? selectedCategoryObj.name : "All Categories"}
              </span>
              {selectedCategoryCount !== undefined && (
                <span className="rounded-full bg-emerald-200/80 text-emerald-800 text-[10px] font-black px-1.5 py-0.5 shrink-0">
                  {selectedCategoryCount}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-1">
              {categoryFilter !== "all" && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCategoryFilterChange("all");
                    setIsCategoryDropdownOpen(false);
                    setCategorySearchQuery("");
                  }}
                  title="Clear category filter"
                  className="p-1 rounded-md text-emerald-700 hover:bg-emerald-200/70 hover:text-emerald-950 transition cursor-pointer"
                >
                  <X size={13} />
                </span>
              )}
              <ChevronDown
                size={14}
                className={`text-gray-400 transition-transform duration-200 ${
                  isCategoryDropdownOpen ? "rotate-180 text-emerald-600" : ""
                }`}
              />
            </div>
          </button>

          {/* Custom Dropdown Popover */}
          {isCategoryDropdownOpen && (
            <div
              role="listbox"
              aria-label="Filter by Category"
              className="absolute top-full left-0 sm:left-auto sm:right-0 z-40 mt-1.5 w-full sm:w-[280px] rounded-2xl bg-white border border-gray-200 shadow-xl overflow-hidden py-1.5 animate-in fade-in zoom-in-95 duration-150"
            >
              {/* Optional Search inside dropdown if > 5 categories */}
              {categories.length > 5 && (
                <div className="p-2 border-b border-gray-100">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={categorySearchQuery}
                      onChange={(e) => setCategorySearchQuery(e.target.value)}
                      placeholder="Search categories..."
                      className="w-full rounded-lg border border-gray-200 bg-gray-50/70 py-1.5 pl-8 pr-7 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-1 focus:ring-emerald-500/20"
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                    {categorySearchQuery && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCategorySearchQuery("");
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                {/* All Categories Option */}
                <button
                  type="button"
                  role="option"
                  aria-selected={categoryFilter === "all"}
                  onClick={() => {
                    handleCategoryFilterChange("all");
                    setIsCategoryDropdownOpen(false);
                    setCategorySearchQuery("");
                  }}
                  className={`w-full min-h-[40px] flex items-center justify-between px-3.5 py-2.5 text-xs transition cursor-pointer text-left ${
                    categoryFilter === "all"
                      ? "bg-emerald-50 text-emerald-900 font-extrabold border-l-2 border-emerald-500"
                      : "text-gray-700 font-semibold hover:bg-gray-50 active:bg-gray-100"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span>All Categories</span>
                    {totalCategoryProductsCount !== null && (
                      <span className="text-[10px] font-bold text-gray-400">
                        ({totalCategoryProductsCount})
                      </span>
                    )}
                  </div>
                  {categoryFilter === "all" && (
                    <Check size={14} className="text-emerald-600 shrink-0 ml-2" />
                  )}
                </button>

                {/* Filtered Category Items (Hierarchical) */}
                {hierarchicalCategories.map((c) => {
                  const isSelected = String(categoryFilter) === String(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        handleCategoryFilterChange(String(c.id));
                        setIsCategoryDropdownOpen(false);
                        setCategorySearchQuery("");
                      }}
                      className={`w-full min-h-[38px] flex items-center justify-between px-3.5 py-2 text-xs transition cursor-pointer text-left ${
                        isSelected
                          ? "bg-emerald-50 text-emerald-900 font-extrabold border-l-2 border-emerald-500"
                          : "text-gray-700 font-semibold hover:bg-gray-50 active:bg-gray-100"
                      } ${!c.isRoot ? "pl-7 bg-gray-50/40" : "font-bold text-gray-900 pt-2.5"}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {!c.isRoot && <span className="text-gray-300 font-mono text-[11px] shrink-0">└─</span>}
                        <span className="truncate">{c.name}</span>
                        {c.displayCount !== undefined && (
                          <span
                            className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold shrink-0 ${
                              isSelected
                                ? "bg-emerald-200/80 text-emerald-800"
                                : c.isRoot ? "bg-gray-200 text-gray-700 font-black" : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {c.displayCount}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <Check size={14} className="text-emerald-600 shrink-0 ml-2" />
                      )}
                    </button>
                  );
                })}

                {hierarchicalCategories.length === 0 && (
                  <div className="px-3.5 py-4 text-center text-xs text-gray-400">
                    No matching categories found
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Total Products Count & Add Product Button (Visible on mobile and desktop) */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 font-medium">
          Total Products: <span className="font-bold text-gray-900">{totalProducts}</span>
        </p>
        <button
          onClick={() => {
            setCategoriesRetryCount((count) => count + 1);
            setShowAddModal(true);
          }}
          className="flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-emerald-500 transition cursor-pointer shrink-0 active:scale-95"
          title="Add New Product"
        >
          <Plus size={16} />
          <span>Add Product</span>
        </button>
      </div>

      {/* Main Inventory Table */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
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
            <div className="hidden sm:block overflow-x-auto rounded-t-2xl">
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
          <div className="py-16 px-4 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 border border-gray-100 text-gray-400 shadow-2xs">
              <Boxes size={22} />
            </div>
            <p className="text-sm font-bold text-gray-800">
              No products found
            </p>
            <p className="mt-1 text-xs text-gray-500 max-w-sm mx-auto">
              {searchQuery.trim()
                ? `No products match your search "${searchQuery.trim()}".`
                : stockFilter !== "all"
                ? `There are currently no products matching the "${stockFilterLabels[stockFilter] || stockFilter}" filter.`
                : categoryFilter !== "all"
                ? "No products found in the selected category."
                : "No products found matching your filter criteria."}
            </p>
            {(stockFilter !== "all" || categoryFilter !== "all" || searchQuery.trim() !== "") && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition cursor-pointer active:scale-95 shadow-2xs"
              >
                <RotateCcw size={13} />
                <span>Clear All Filters</span>
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile Stacked Card Layout (<640px) */}
            <div className="block sm:hidden divide-y divide-gray-100">
              {displayedProducts.map((product) => {
                const stockDisplay = getProductStockDisplay(product);
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
                              stockDisplay.tone === "rose"
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : stockDisplay.tone === "amber"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : stockDisplay.tone === "blue"
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : stockDisplay.tone === "emerald"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-gray-50 text-gray-600 border border-gray-200"
                            }`}
                          >
                            {stockDisplay.statusLabel}
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
                          {stockDisplay.quantityLabel}
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
            <div className="hidden sm:block overflow-x-auto rounded-t-2xl">
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
                    const stockDisplay = getProductStockDisplay(product);
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
                            <span className="font-bold text-gray-900 text-xs">{stockDisplay.quantityLabel}</span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                stockDisplay.tone === "rose"
                                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                                  : stockDisplay.tone === "amber"
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : stockDisplay.tone === "blue"
                                  ? "bg-blue-50 text-blue-700 border border-blue-200"
                                  : stockDisplay.tone === "emerald"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-gray-50 text-gray-600 border border-gray-200"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  stockDisplay.tone === "rose" ? "bg-rose-500" : stockDisplay.tone === "amber" ? "bg-amber-500" : stockDisplay.tone === "blue" ? "bg-blue-500" : stockDisplay.tone === "emerald" ? "bg-emerald-500" : "bg-gray-500"
                                }`}
                              />
                              {stockDisplay.statusLabel}
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
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/50 px-4 sm:px-6 py-3.5 sm:py-4 rounded-b-2xl">
            {/* Left: Product count */}
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-500 font-medium">
                Showing{" "}
                <span className="font-bold text-gray-900">
                  {((page - 1) * perPage + 1).toLocaleString()}
                </span>{" "}
                to{" "}
                <span className="font-bold text-gray-900">
                  {Math.min(page * perPage, totalProducts).toLocaleString()}
                </span>{" "}
                of{" "}
                <span className="font-bold text-gray-900">
                  {totalProducts.toLocaleString()}
                </span>{" "}
                products
              </p>
            </div>

            {/* Right: Controls (Rows selector + Prev / Page indicator / Next) */}
            <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap justify-center">
              {/* Rows Per Page Custom Dropdown */}
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="font-medium text-gray-500">Rows:</span>
                <div className="relative shrink-0" ref={perPageDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setPerPageDropdownOpen((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border bg-white px-2.5 py-1.5 text-xs font-bold transition shadow-2xs cursor-pointer select-none active:scale-[0.98] ${
                      perPageDropdownOpen
                        ? "border-emerald-500 ring-2 ring-emerald-500/15 text-emerald-950 bg-emerald-50/40"
                        : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                    aria-haspopup="listbox"
                    aria-expanded={perPageDropdownOpen}
                  >
                    <span>{perPage} / page</span>
                    <ChevronDown
                      size={13}
                      className={`text-gray-400 transition-transform duration-200 ${
                        perPageDropdownOpen ? "rotate-180 text-emerald-600" : ""
                      }`}
                    />
                  </button>

                  {/* Clean Popover Menu (opens upward above footer) */}
                  {perPageDropdownOpen && (
                    <div
                      role="listbox"
                      className="absolute bottom-full right-0 sm:left-0 sm:right-auto mb-2 z-40 w-36 rounded-2xl border border-gray-100 bg-white p-1.5 shadow-2xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-gray-400 border-b border-gray-100 mb-1">
                        Rows per page
                      </div>
                      {[20, 50, 100].map((count) => {
                        const isSelected = perPage === count;
                        return (
                          <button
                            key={count}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              setPerPage(count);
                              setPage(1);
                              setPerPageDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs font-bold transition cursor-pointer text-left ${
                              isSelected
                                ? "bg-emerald-50 text-emerald-900 font-extrabold"
                                : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                            }`}
                          >
                            <span>{count} / page</span>
                            {isSelected && (
                              <Check
                                size={13}
                                className="text-emerald-600 shrink-0"
                                strokeWidth={3}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="h-4 w-px bg-gray-200 hidden sm:block" />

              {/* Pagination Prev / Page / Next */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(p - 1, 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer shadow-2xs"
                >
                  <ChevronLeft size={14} />
                  <span>Prev</span>
                </button>
                <span className="text-xs font-bold text-gray-700 px-1.5 whitespace-nowrap">
                  Page {page} of {Math.max(1, totalPages)}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer shadow-2xs"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Adjust Stock & Price Modal */}
      <ProductQuickAdjustModal
        product={quickAdjustProduct}
        onClose={handleCloseQuickAdjust}
        adjustForm={adjustForm}
        setAdjustForm={setAdjustForm}
        onSave={handleSaveQuickAdjust}
        saving={adjustSaving}
      />

      {/* Add New Product Modal */}
      <ProductAddModal
        isOpen={showAddModal}
        onClose={handleCloseAddModal}
        onSubmit={handleCreateProduct}
        newProduct={newProduct}
        setNewProduct={setNewProduct}
        creating={creating}
        productDepartments={productDepartments}
        productSubcategories={productSubcategories}
        categoriesLoading={categoriesLoading}
        categoriesError={categoriesError}
        setCategoriesRetryCount={setCategoriesRetryCount}
        galleryInputRef={galleryInputRef}
        cameraInputRef={cameraInputRef}
        handleImageFileChange={handleImageFileChange}
        imagePreview={imagePreview}
        clearImagePreview={clearImagePreview}
        uploadingImage={uploadingImage}
        uploadProgress={uploadProgress}
      />

      {/* Delete Product Confirmation Modal */}
      <ProductDeleteModal
        product={deleteConfirmProduct}
        onClose={() => setDeleteConfirmProduct(null)}
        onConfirm={() => handleDeleteProduct(deleteConfirmProduct)}
        deleting={deletingId === deleteConfirmProduct?.id}
      />
    </div>
  );
}

export default Products;
