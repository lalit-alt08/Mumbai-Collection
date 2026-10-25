import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Upload,
  Image as ImageIcon,
  Check,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Boxes,
  Plus,
  Trash2,
  Camera,
  ChevronDown,
  Maximize2,
  Tag,
} from "lucide-react";
import {
  createProduct,
  uploadProductImage,
  getCategories,
} from "../services/employeeApi.js";
import {
  compressImage,
  isAcceptedImage,
  isHeicFile,
  RAW_IMAGE_MAX_INPUT_BYTES,
  MAX_FILE_SIZE_BYTES,
} from "../utils/imageCompressor.js";

function AddProduct() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedCategoryId = searchParams.get("category_id");
  const initialCategoryId = /^\d+$/.test(requestedCategoryId || "") ? requestedCategoryId : "";
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const isSubmittingRef = useRef(false);
  const hasLoadedCategoriesRef = useRef(false);
  const generateIdempotencyKey = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const idempotencyKeyRef = useRef(null);
  const categoryTriggerRef = useRef(null);
  const subcategoryTriggerRef = useRef(null);
  const categoryMenuRef = useRef(null);
  const subcategoryMenuRef = useRef(null);

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    regular_price: "",
    sale_price: "",
    stock_quantity: 10,
    category_id: initialCategoryId,
  });
  const [subcategoryId, setSubcategoryId] = useState("");

  // Categories State
  const [categories, setCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categoriesError, setCategoriesError] = useState("");
  const [categoryRetryCount, setCategoryRetryCount] = useState(0);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [subcategoryMenuOpen, setSubcategoryMenuOpen] = useState(false);

  // Media / Image Upload State
  const [images, setImages] = useState([]); // [{ file, preview, url, uploaded, uploading }]

  // Submission State
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdProduct, setCreatedProduct] = useState(null);

  // Toast Notification State
  const [toast, setToast] = useState(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  const fetchCategories = useCallback(async (initializeFromUrl = false) => {
    try {
      if (!hasLoadedCategoriesRef.current) setLoadingCategories(true);
      setCategoriesError("");
      const res = await getCategories();
      const fetchedCategories = Array.isArray(res?.categories)
        ? res.categories
        : Array.isArray(res)
          ? res
          : [];
      const hasSelectableDepartment = fetchedCategories.some((category) =>
        (!category.parent || Number(category.parent) === 0) &&
        String(category.slug || "").toLowerCase() !== "uncategorized" &&
        String(category.name || "").toLowerCase() !== "uncategorized"
      );
      if (res?.success === false || !hasSelectableDepartment) {
        setCategoriesError(res?.message || "Categories could not be loaded. Retry to choose a product category.");
        if (initializeFromUrl) {
          setFormData((previous) => ({ ...previous, category_id: "" }));
          setSubcategoryId("");
        }
        return;
      }

      setCategories(fetchedCategories);
      hasLoadedCategoriesRef.current = true;
      if (initializeFromUrl && requestedCategoryId) {
        const requestedCategory = fetchedCategories.find(
          (category) => String(category.id) === requestedCategoryId
        );
        if (requestedCategory && Number(requestedCategory.parent) > 0) {
          setFormData((previous) => ({ ...previous, category_id: String(requestedCategory.parent) }));
          setSubcategoryId(String(requestedCategory.id));
        } else if (requestedCategory) {
          setFormData((previous) => ({ ...previous, category_id: String(requestedCategory.id) }));
          setSubcategoryId("");
        } else {
          setFormData((previous) => ({ ...previous, category_id: "" }));
          setSubcategoryId("");
        }
      }
    } catch (err) {
      setCategoriesError(err.response?.data?.message || err.message || "Categories could not be loaded. Retry to continue.");
      if (initializeFromUrl) {
        setFormData((previous) => ({ ...previous, category_id: "" }));
        setSubcategoryId("");
      }
    } finally {
      setLoadingCategories(false);
    }
  }, [requestedCategoryId]);

  useEffect(() => {
    fetchCategories(true);
  }, [fetchCategories, categoryRetryCount]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") fetchCategories(false);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [fetchCategories]);

  const handleOptionKeyDown = (event, menuType) => {
    const isCategoryMenu = menuType === "category";
    const menuRef = isCategoryMenu ? categoryMenuRef : subcategoryMenuRef;
    const triggerRef = isCategoryMenu ? categoryTriggerRef : subcategoryTriggerRef;
    const setMenuOpen = isCategoryMenu ? setCategoryMenuOpen : setSubcategoryMenuOpen;
    const options = Array.from(menuRef.current?.querySelectorAll('[role="option"]') || []);
    const currentIndex = options.indexOf(event.currentTarget);
    let nextIndex = currentIndex;

    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % options.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + options.length) % options.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
      return;
    } else return;

    event.preventDefault();
    options[nextIndex]?.focus();
  };

  const openMenuFromKeyboard = (event, menuType) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const isCategoryMenu = menuType === "category";
    (isCategoryMenu ? setCategoryMenuOpen : setSubcategoryMenuOpen)(true);
    requestAnimationFrame(() => {
      const menu = (isCategoryMenu ? categoryMenuRef : subcategoryMenuRef).current;
      const options = menu?.querySelectorAll('[role="option"]');
      options?.[event.key === "ArrowUp" ? options.length - 1 : 0]?.focus();
    });
  };

  const rootCategories = useMemo(
    () => categories.filter((category) =>
      (!category.parent || Number(category.parent) === 0) &&
      String(category.slug || "").toLowerCase() !== "uncategorized" &&
      String(category.name || "").toLowerCase() !== "uncategorized"
    ),
    [categories]
  );

  const availableSubcategories = useMemo(
    () =>
      formData.category_id
        ? categories.filter((category) =>
          Number(category.parent) === Number(formData.category_id) &&
          String(category.slug || "").toLowerCase() !== "uncategorized" &&
          String(category.name || "").toLowerCase() !== "uncategorized"
        )
        : [],
    [categories, formData.category_id]
  );

  useEffect(() => {
    const selectedDepartmentExists = rootCategories.some(
      (category) => String(category.id) === String(formData.category_id)
    );
    if (formData.category_id && !selectedDepartmentExists) {
      setFormData((previous) => ({ ...previous, category_id: "" }));
      setSubcategoryId("");
      return;
    }
    if (subcategoryId && !availableSubcategories.some((category) => String(category.id) === String(subcategoryId))) {
      setSubcategoryId("");
    }
  }, [availableSubcategories, formData.category_id, rootCategories, subcategoryId]);

  const selectedCategoryLabel = useMemo(() => {
    if (!formData.category_id) return categories.length ? "Select a category" : "No categories available";
    const matched = rootCategories.find((c) => String(c.id) === String(formData.category_id));
    if (!matched) return "Category #" + formData.category_id;
    return matched.name;
  }, [formData.category_id, rootCategories, categories]);

  // Handle Form Change
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  // Handle Image File Selection (Max 3 Images)
  const handleImageSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const availableSlots = 3 - images.length;
    if (availableSlots <= 0) {
      showToast("Maximum of 3 images allowed per product.", "error");
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      return;
    }

    if (files.length > availableSlots) {
      showToast(`Only ${availableSlots} more image(s) allowed (maximum 3 total).`, "warning");
    }

    const filesToProcess = files.slice(0, availableSlots);
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    for (const file of filesToProcess) {
      if (!isAcceptedImage(file)) {
        showToast(`"${file.name}" is not a supported image format.`, "error");
        continue;
      }

      if (file.size > RAW_IMAGE_MAX_INPUT_BYTES) {
        showToast(`"${file.name}" exceeds the 25MB maximum limit.`, "error");
        continue;
      }

      // Automatically compress client-side before upload (handles iPhone HEIC/high-res camera captures cleanly)
      let fileToUpload = file;
      try {
        fileToUpload = await compressImage(file, { maxDimension: 1600 });
      } catch (err) {
        if (isHeicFile(file) || err?.code === "HEIC_UNSUPPORTED") {
          showToast(
            `"${file.name}" is in HEIC format and not supported directly by your browser. Please select JPEG, PNG, or WebP.`,
            "error"
          );
          continue;
        }
        // Fall back to original file if compression encounters an error
      }

      if (isHeicFile(fileToUpload)) {
        showToast(
          `"${file.name}" is in HEIC format and cannot be uploaded. Please select JPEG, PNG, or WebP.`,
          "error"
        );
        continue;
      }

      if (fileToUpload.size > MAX_FILE_SIZE_BYTES) {
        showToast(`"${file.name}" exceeds the 5MB upload limit after compression.`, "error");
        continue;
      }

      const preview = URL.createObjectURL(fileToUpload);
      const newImg = {
        id: Math.random().toString(36).substring(7),
        file: fileToUpload,
        preview,
        url: "",
        uploaded: false,
        uploading: true,
      };

      setImages((prev) => [...prev, newImg]);

      // Automatically upload compressed file to WordPress Media Library
      try {
        const uploadRes = await uploadProductImage(fileToUpload);
        if (uploadRes.success && (uploadRes.url || uploadRes.id)) {
          setImages((prev) =>
            prev.map((img) =>
              img.id === newImg.id
                ? {
                    ...img,
                    url: uploadRes.url,
                    mediaId: uploadRes.id,
                    uploaded: true,
                    uploading: false,
                  }
                : img
            )
          );
          showToast("Image uploaded to WordPress Media Library!");
        } else {
          setImages((prev) =>
            prev.map((img) =>
              img.id === newImg.id
                ? { ...img, uploading: false, error: "Upload failed" }
                : img
            )
          );
          showToast("Failed to upload image.", "error");
        }
      } catch (err) {
        setImages((prev) =>
          prev.map((img) =>
            img.id === newImg.id
              ? { ...img, uploading: false, error: err.message }
              : img
          )
        );
        showToast(err.response?.data?.message || "Failed to upload image.", "error");
      }
    }

    if (galleryInputRef.current) {
      galleryInputRef.current.value = "";
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
  };

  // Remove Image from list
  const handleRemoveImage = (imgId) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === imgId);
      if (target?.preview) {
        try {
          URL.revokeObjectURL(target.preview);
        } catch {}
      }
      return prev.filter((img) => img.id !== imgId);
    });
  };

  // Handle Form Submission with Concurrency Lock
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate invocations while request is processing
    if (isSubmittingRef.current || submitting) {
      return;
    }

    setError("");

    // 1. Validation
    if (!formData.name.trim()) {
      setError("Product Name is required.");
      return;
    }

    if (!formData.category_id) {
      setError("Please select a product category.");
      return;
    }

    const regPrice = Number(formData.regular_price);
    if (isNaN(regPrice) || regPrice < 0) {
      setError("Please enter a valid regular price.");
      return;
    }

    if (formData.sale_price !== "") {
      const sPrice = Number(formData.sale_price);
      if (isNaN(sPrice) || sPrice < 0) {
        setError("Sale price must be a valid positive number.");
        return;
      }
      if (sPrice >= regPrice) {
        setError("Sale price should be less than regular price.");
        return;
      }
    }

    const stockQty = Number(formData.stock_quantity);
    if (isNaN(stockQty) || stockQty < 0 || !Number.isInteger(stockQty)) {
      setError("Stock Quantity must be a valid non-negative whole number.");
      return;
    }

    // Check if any images are still in uploading state
    const isStillUploading = images.some((img) => img.uploading);
    if (isStillUploading) {
      setError("Please wait for images to finish uploading before creating the product.");
      return;
    }

    // Check if any images failed to upload
    const hasFailedImages = images.some((img) => !img.uploaded && img.error);
    if (hasFailedImages) {
      setError("Some images failed to upload. Please remove failed images or retry before submitting.");
      return;
    }

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);

      // 2. Build Category IDs array
      const productCategoryId = subcategoryId || formData.category_id;
      const categoryIds = productCategoryId ? [Number(productCategoryId)] : [];

      // 3. Build Image list
      const uploadedImgs = images
        .filter((img) => img.uploaded && (img.mediaId || img.url))
        .map((img) => {
          if (img.mediaId) {
            return { id: Number(img.mediaId) };
          }
          return { src: img.url };
        });

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        short_description: formData.description.trim(),
        regular_price: String(regPrice),
        sale_price: formData.sale_price ? String(formData.sale_price) : "",
        stock_quantity: stockQty,
        category_ids: categoryIds,
        department_id: Number(formData.category_id),
        subcategory_id: subcategoryId ? Number(subcategoryId) : undefined,
        image_id: uploadedImgs.length > 0 && uploadedImgs[0].id ? uploadedImgs[0].id : undefined,
        images: uploadedImgs,
      };

      // 4. Use stable form-level idempotency key (preserved across retry clicks / timeouts)
      const fingerprint = JSON.stringify(payload);
      if (idempotencyKeyRef.current?.fingerprint !== fingerprint) {
        idempotencyKeyRef.current = {
          fingerprint,
          key: generateIdempotencyKey(),
        };
      }
      const idempotencyKey = idempotencyKeyRef.current.key;

      // 5. Call createProduct API with idempotency key
      const res = await createProduct(payload, {
        "X-Idempotency-Key": idempotencyKey,
      });

      if (res.success && res.product) {
        // Form submitted successfully: rotate idempotency key for next product
        idempotencyKeyRef.current = null;
        setCreatedProduct(res.product);
        showToast("Product created successfully!");
      } else {
        setError(res.message || "Failed to create product in WooCommerce.");
      }
    } catch (err) {
      setError(
        err.response?.data?.message || err.message || "Failed to create product. Please try again."
      );
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleResetForm = () => {
    idempotencyKeyRef.current = null;
    setFormData({
      name: "",
      description: "",
      regular_price: "",
      sale_price: "",
      stock_quantity: 10,
      category_id: "",
    });
    setSubcategoryId("");
    setImages([]);
    setCreatedProduct(null);
    setError("");
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
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

      {/* Success Banner if Product Created */}
      {createdProduct ? (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50/80 p-6 sm:p-8 text-center space-y-4 shadow-sm animate-in zoom-in-95 duration-200">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-md">
            <CheckCircle2 size={32} />
          </div>

          <div>
            <h2 className="text-lg font-black text-gray-900">
              Product Successfully Created!
            </h2>
            <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto">
              <span className="font-bold text-gray-900">"{createdProduct.name}"</span> has been registered into the catalog (ID #{createdProduct.id}) with {createdProduct.stock_quantity || formData.stock_quantity} units in stock.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={handleResetForm}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 transition cursor-pointer active:scale-95"
            >
              <Plus size={16} /> Add Another Product
            </button>
            <Link
              to="/products"
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition shadow-xs"
            >
              <Boxes size={16} /> View in Products & Stock
            </Link>
          </div>
        </div>
      ) : (
        /* PRODUCT CREATION FORM */
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Alert */}
          {error && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700 animate-in fade-in duration-200">
              <AlertCircle size={16} className="shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* TWO-COLUMN GRID */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Product Information */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-xs space-y-5 lg:col-span-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-gray-900 border-b border-gray-100 pb-3">
                General Product Information
              </h2>

              {/* Product Name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Product Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g. Traditional Silk Bandhani Saree"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
                />
              </div>

              {/* Regular Price */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Regular Price (₹) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    name="regular_price"
                    value={formData.regular_price}
                    onChange={handleChange}
                    placeholder="999"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2.5 pl-8 pr-4 text-xs font-bold text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
                  />
                </div>
              </div>

              {/* Sale Price */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Sale Price (₹) (Optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    name="sale_price"
                    value={formData.sale_price}
                    onChange={handleChange}
                    placeholder="Discounted Price"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2.5 pl-8 pr-4 text-xs font-bold text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
                  />
                </div>
              </div>

              {/* Product Category */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                  Product Category <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <button
                    type="button"
                    ref={categoryTriggerRef}
                    aria-haspopup="listbox"
                    aria-expanded={categoryMenuOpen}
                    aria-required="true"
                    disabled={loadingCategories || rootCategories.length === 0}
                    onClick={() => setCategoryMenuOpen((open) => !open)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setCategoryMenuOpen(false);
                      else openMenuFromKeyboard(event, "category");
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl border bg-white px-3.5 py-3 text-left shadow-xs outline-none transition focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-wait disabled:bg-gray-50 ${
                      categoryMenuOpen
                        ? "border-emerald-500"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                      <Tag size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-semibold ${formData.category_id ? "text-gray-900" : "text-gray-500"}`}>
                        {loadingCategories ? "Loading categories…" : selectedCategoryLabel}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-gray-400">
                        {formData.category_id ? "Selected department" : "Choose a department for this product"}
                      </span>
                    </span>
                    <ChevronDown
                      size={16}
                      className={`shrink-0 text-gray-400 transition-transform ${categoryMenuOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {categoryMenuOpen && (
                    <div
                      ref={categoryMenuRef}
                      role="listbox"
                      aria-label="Product categories"
                      className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl shadow-gray-900/10"
                    >
                      {rootCategories.map((category) => {
                        const selected = String(category.id) === String(formData.category_id);
                        return (
                          <button
                            key={category.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            tabIndex={selected || (!formData.category_id && category.id === rootCategories[0]?.id) ? 0 : -1}
                            onKeyDown={(event) => handleOptionKeyDown(event, "category")}
                            onClick={() => {
                              setFormData((previous) => ({ ...previous, category_id: String(category.id) }));
                              setSubcategoryId("");
                              setSubcategoryMenuOpen(false);
                              setCategoryMenuOpen(false);
                              requestAnimationFrame(() => categoryTriggerRef.current?.focus());
                              if (error) setError("");
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                              selected ? "bg-emerald-50 text-emerald-800" : "text-gray-700 hover:bg-gray-50"
                            }`}
                          >
                            <span className={`h-2 w-2 shrink-0 rounded-full ${selected ? "bg-emerald-600" : "bg-gray-300"}`} />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {category.name}
                            </span>
                            {category.count !== undefined && (
                              <span className="shrink-0 text-xs text-gray-400">{category.count}</span>
                            )}
                            {selected && <Check size={15} className="shrink-0 text-emerald-700 ml-1" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {categoriesError && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    <span role="alert">{categoriesError}</span>
                    <button
                      type="button"
                      onClick={() => setCategoryRetryCount((count) => count + 1)}
                      disabled={loadingCategories}
                      className="shrink-0 font-bold underline disabled:opacity-50"
                    >
                      {loadingCategories ? "Retrying…" : "Retry"}
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3 space-y-1.5">
                <label htmlFor="product-subcategory" className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Product Subcategory <span className="font-medium normal-case text-gray-400">(Optional)</span>
                </label>
                <div className="relative">
                  {loadingCategories || !formData.category_id || availableSubcategories.length === 0 ? (
                    <div className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 text-sm font-medium text-gray-400">
                      <span>
                        {loadingCategories
                          ? "Loading subcategories…"
                          : !formData.category_id
                            ? "Select a category first"
                            : "No subcategories for this category"}
                      </span>
                      <ChevronDown size={16} className="shrink-0 text-gray-300" />
                    </div>
                  ) : (
                    <>
                      <button
                        id="product-subcategory"
                        type="button"
                        ref={subcategoryTriggerRef}
                        aria-haspopup="listbox"
                        aria-expanded={subcategoryMenuOpen}
                        onClick={() => setSubcategoryMenuOpen((open) => !open)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setSubcategoryMenuOpen(false);
                          else openMenuFromKeyboard(event, "subcategory");
                        }}
                        className={`flex w-full items-center justify-between rounded-xl border bg-white px-3.5 py-3 text-left text-sm font-semibold shadow-xs outline-none transition focus:ring-4 focus:ring-emerald-500/10 ${
                          subcategoryMenuOpen
                            ? "border-emerald-500"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <span className={subcategoryId ? "text-gray-900" : "text-gray-600"}>
                          {subcategoryId
                            ? availableSubcategories.find((item) => String(item.id) === subcategoryId)?.name || "Select a subcategory"
                            : `No subcategory — use ${selectedCategoryLabel}`}
                        </span>
                        <ChevronDown
                          size={16}
                          className={`ml-3 shrink-0 text-gray-400 transition-transform ${subcategoryMenuOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                      {subcategoryMenuOpen && (
                        <div
                          ref={subcategoryMenuRef}
                          role="listbox"
                          aria-label="Product subcategories"
                          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl shadow-gray-900/10"
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={!subcategoryId}
                            tabIndex={!subcategoryId ? 0 : -1}
                            onKeyDown={(event) => handleOptionKeyDown(event, "subcategory")}
                            onClick={() => {
                              setSubcategoryId("");
                              setSubcategoryMenuOpen(false);
                              requestAnimationFrame(() => subcategoryTriggerRef.current?.focus());
                              if (error) setError("");
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                              !subcategoryId ? "bg-emerald-50 text-emerald-800" : "text-gray-700 hover:bg-gray-50"
                            }`}
                          >
                            <span className="min-w-0 flex-1">No subcategory — use {selectedCategoryLabel}</span>
                            {!subcategoryId && <Check size={15} className="shrink-0 text-emerald-700" />}
                          </button>
                          {availableSubcategories.map((subcategory) => {
                            const selected = String(subcategory.id) === subcategoryId;
                            return (
                              <button
                                key={subcategory.id}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                tabIndex={selected ? 0 : -1}
                                onKeyDown={(event) => handleOptionKeyDown(event, "subcategory")}
                                onClick={() => {
                                  setSubcategoryId(String(subcategory.id));
                                  setSubcategoryMenuOpen(false);
                                  requestAnimationFrame(() => subcategoryTriggerRef.current?.focus());
                                  if (error) setError("");
                                }}
                                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                                  selected ? "bg-emerald-50 text-emerald-800" : "text-gray-700 hover:bg-gray-50"
                                }`}
                              >
                                <span className="min-w-0 flex-1">{subcategory.name}</span>
                                {selected && <Check size={15} className="shrink-0 text-emerald-700" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <p className="text-[11px] text-gray-400">
                  {subcategoryId
                    ? `This product will be placed in ${availableSubcategories.find((item) => String(item.id) === subcategoryId)?.name || "the selected subcategory"}.`
                    : !formData.category_id
                      ? "Choose a category above to see its subcategories."
                      : availableSubcategories.length === 0
                        ? "This category has no subcategories, so the product will use the main category."
                        : "Choose a subcategory to place this product more specifically, or leave it under the main category."}
                </p>
              </div>

              {/* Stock Quantity */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Initial Stock Quantity <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="1"
                  name="stock_quantity"
                  value={formData.stock_quantity}
                  onChange={handleChange}
                  placeholder="10"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-xs font-bold text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
                />
                <p className="text-[11px] text-gray-400">
                  Items with 1 to 5 units are marked "Low Stock". 0 units are "Out of Stock".
                </p>
              </div>

              {/* Product Description */}
              <div className="space-y-1.5">
                <label htmlFor="product-description" className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Product Description
                </label>
                <div className="relative">
                  <textarea
                    id="product-description"
                    rows={2}
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    placeholder="Add a short product description..."
                    className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 py-3 pl-3.5 pr-12 text-xs font-medium leading-relaxed text-gray-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setIsDescriptionExpanded(true)}
                    aria-label="Open full description editor"
                    title="Expand description"
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-xs transition hover:border-emerald-300 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">
                  Shown on product details. Use the expand button for the full editor.
                </p>
              </div>
            </div>

          </div>

          {/* PRODUCT IMAGE UPLOAD SECTION (Max 3 Images) */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-black uppercase tracking-wider text-gray-900">
                    Product Images
                  </h2>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                    images.length >= 3
                      ? "bg-amber-100 text-amber-800 border border-amber-200"
                      : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                  }`}>
                    {images.length}/3 uploaded
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Take live photos or upload up to 3 photos to the WordPress Media Library (JPG, PNG, WebP up to 10MB).
                </p>
              </div>

              {/* Hidden Inputs for Gallery (Multiple) and Camera (Capture) */}
              <input
                type="file"
                ref={galleryInputRef}
                onChange={handleImageSelect}
                multiple
                accept="image/*,image/heic,image/heif"
                className="hidden"
              />

              <input
                type="file"
                ref={cameraInputRef}
                onChange={handleImageSelect}
                capture="environment"
                accept="image/*,image/heic,image/heif"
                className="hidden"
              />

              {/* Top Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Take Photo Button */}
                <button
                  type="button"
                  disabled={images.length >= 3}
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 transition cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Camera size={15} /> Take Photo
                </button>

                {/* From Gallery Button */}
                <button
                  type="button"
                  disabled={images.length >= 3}
                  onClick={() => galleryInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ImageIcon size={15} /> From Gallery
                </button>
              </div>
            </div>

            {/* Thumbnail Grid & Dropzones */}
            {images.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* 1. Camera Option Card */}
                <div
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 p-6 text-center hover:border-emerald-500 hover:bg-emerald-50/70 transition cursor-pointer group"
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 group-hover:scale-110 transition duration-200 mb-2 shadow-2xs">
                    <Camera size={24} />
                  </div>
                  <p className="text-xs font-black text-gray-900">Take Photo with Camera</p>
                  <p className="text-[11px] text-emerald-700 font-medium mt-0.5">Capture product in-shop directly</p>
                </div>

                {/* 2. Gallery Option Card */}
                <div
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-6 text-center hover:border-sky-400 hover:bg-sky-50/30 transition cursor-pointer group"
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-500 group-hover:scale-110 transition duration-200 mb-2 shadow-2xs">
                    <ImageIcon size={24} />
                  </div>
                  <p className="text-xs font-black text-gray-900">Choose from Gallery / Files</p>
                  <p className="text-[11px] text-gray-500 font-medium mt-0.5">Browse high-res photos from device</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {images.map((img, idx) => (
                    <div
                      key={img.id}
                      className="relative group rounded-xl overflow-hidden border border-gray-200 bg-gray-100 aspect-square"
                    >
                      <img
                        src={img.preview}
                        alt="Thumbnail"
                        className="h-full w-full object-cover"
                      />

                      {/* Status Badge on thumbnail */}
                      {img.uploading ? (
                        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white gap-1 text-[10px] font-bold">
                          <Loader2 size={16} className="animate-spin" />
                          <span>Uploading...</span>
                        </div>
                      ) : img.uploaded ? (
                        <div className="absolute top-1.5 left-1.5 bg-emerald-500 text-white rounded-full p-0.5 shadow-xs">
                          <Check size={10} />
                        </div>
                      ) : null}

                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(img.id)}
                        className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-rose-600 text-white rounded-full p-1 transition cursor-pointer shadow-xs"
                        title="Remove image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}

                  {/* Add more buttons if less than 3 */}
                  {images.length < 3 && (
                    <div className="flex flex-col gap-1.5 justify-center">
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 p-2 text-emerald-700 hover:bg-emerald-100/60 transition cursor-pointer text-[10px] font-bold"
                        title="Take another photo"
                      >
                        <Camera size={13} className="mb-0.5" />
                        + Camera
                      </button>

                      <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 p-2 text-gray-600 hover:bg-gray-100 transition cursor-pointer text-[10px] font-bold"
                        title="Add from gallery"
                      >
                        <ImageIcon size={13} className="mb-0.5" />
                        + Gallery
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* FORM ACTIONS FOOTER */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <Link
              to="/products"
              className="w-full sm:w-auto text-center rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition shadow-xs cursor-pointer"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={submitting || images.some((img) => img.uploading)}
              className="mx-auto inline-flex w-[94%] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-xs font-extrabold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:mx-0 sm:w-auto"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating Product...
                </>
              ) : images.some((img) => img.uploading) ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Uploading Images...
                </>
              ) : (
                <>
                  <Plus size={16} />
                  Create Product
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {isDescriptionExpanded && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          onClick={() => setIsDescriptionExpanded(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setIsDescriptionExpanded(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="description-editor-title"
            className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="description-editor-title" className="text-base font-bold text-gray-900">
                  Product description
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Add the details customers need to know about this product.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDescriptionExpanded(false)}
                aria-label="Close description editor"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:bg-gray-50 hover:text-gray-800"
              >
                <X size={17} />
              </button>
            </div>
            <textarea
              autoFocus
              rows={12}
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Write a clear description, including key features, specifications, compatibility, and other useful information…"
              className="w-full resize-y rounded-xl border border-gray-200 bg-gray-50/50 p-4 text-sm leading-6 text-gray-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
            />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setIsDescriptionExpanded(false)}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default AddProduct;
