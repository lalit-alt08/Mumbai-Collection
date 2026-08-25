import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  PackagePlus,
  ArrowLeft,
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
} from "lucide-react";
import {
  createProduct,
  uploadProductImage,
  getCategories,
} from "../services/employeeApi.js";

function AddProduct() {
  const navigate = useNavigate();
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const isSubmittingRef = useRef(false);

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    regular_price: "",
    sale_price: "",
    stock_quantity: 10,
    category_id: "",
  });

  // Categories State
  const [categories, setCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(true);

  // Media / Image Upload State
  const [images, setImages] = useState([]); // [{ file, preview, url, uploaded, uploading }]

  // Submission State
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdProduct, setCreatedProduct] = useState(null);

  // Toast Notification State
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Fetch categories on mount
  useEffect(() => {
    const fetchCats = async () => {
      try {
        setLoadingCategories(true);
        const res = await getCategories();
        if (res.success) {
          setCategories(res.categories || []);
        }
      } catch (err) {
        console.warn("Failed to load categories:", err);
      } finally {
        setLoadingCategories(false);
      }
    };
    fetchCats();
  }, []);

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
      if (!validTypes.includes(file.type)) {
        showToast(`"${file.name}" is not a valid image (JPG, PNG, WebP, GIF only).`, "error");
        continue;
      }

      if (file.size > 10 * 1024 * 1024) {
        showToast(`"${file.name}" exceeds the 10MB limit.`, "error");
        continue;
      }

      const preview = URL.createObjectURL(file);
      const newImg = {
        id: Math.random().toString(36).substring(7),
        file,
        preview,
        url: "",
        uploaded: false,
        uploading: true,
      };

      setImages((prev) => [...prev, newImg]);

      // Automatically upload file to WordPress Media Library
      try {
        const uploadRes = await uploadProductImage(file);
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
    setImages((prev) => prev.filter((img) => img.id !== imgId));
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

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);

      // 2. Build Category IDs array
      const categoryIds = formData.category_id ? [Number(formData.category_id)] : [];

      // 3. Build Image list
      const uploadedImgs = images
        .filter((img) => img.uploaded && (img.mediaId || img.url))
        .map((img) => ({
          ...(img.mediaId ? { id: Number(img.mediaId) } : {}),
          ...(img.url ? { src: img.url } : {}),
        }));

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        short_description: formData.description.trim(),
        regular_price: String(regPrice),
        sale_price: formData.sale_price ? String(formData.sale_price) : "",
        stock_quantity: stockQty,
        category_ids: categoryIds,
        image_url: uploadedImgs.length > 0 ? uploadedImgs[0].src : "",
        image_id: uploadedImgs.length > 0 ? uploadedImgs[0].id : undefined,
        images: uploadedImgs,
      };

      // 4. Generate unique idempotency key for this submission attempt
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

      // 5. Call createProduct API with idempotency key
      const res = await createProduct(payload, {
        "X-Idempotency-Key": idempotencyKey,
      });

      if (res.success && res.product) {
        setCreatedProduct(res.product);
        showToast("Product created successfully!");
      } else {
        setError(res.message || "Failed to create product in WooCommerce.");
      }
    } catch (err) {
      console.error("Create product error:", err);
      setError(
        err.response?.data?.message || err.message || "Failed to create product. Please try again."
      );
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleResetForm = () => {
    setFormData({
      name: "",
      description: "",
      regular_price: "",
      sale_price: "",
      stock_quantity: 10,
      category_id: "",
    });
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

      {/* Header & Back Navigation */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              to="/products"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 transition shadow-xs"
            >
              <ArrowLeft size={14} /> Back to Products
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-gray-900 mt-2 flex items-center gap-2">
            <PackagePlus size={24} className="text-emerald-600" />
            Add New Product
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Create a complete product and add it to the store catalog.
          </p>
        </div>
      </div>

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
            {/* LEFT COLUMN: Product Information (2 Columns) */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-xs space-y-5 lg:col-span-2">
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

              {/* Product Description */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Product Description
                </label>
                <textarea
                  rows={6}
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="Write a clear description of the product, including key features, specifications, compatibility, and other useful information..."
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-4 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition leading-relaxed"
                />
                <p className="text-[11px] text-gray-400">
                  This description is displayed on Customer Web product detail pages.
                </p>
              </div>

              {/* Product Category */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Product Category (Optional)
                </label>
                <select
                  name="category_id"
                  value={formData.category_id}
                  onChange={handleChange}
                  disabled={loadingCategories}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition cursor-pointer"
                >
                  <option value="">Select Category...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.count !== undefined ? `(${c.count})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* RIGHT COLUMN: Pricing & Inventory (1 Column) */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-xs space-y-5 flex flex-col">
              <h2 className="text-sm font-black uppercase tracking-wider text-gray-900 border-b border-gray-100 pb-3">
                Pricing & Inventory
              </h2>

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

              {/* Stock Summary Preview Badge */}
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200/60 mt-auto space-y-1.5">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Initial Inventory Status
                </span>
                <div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      Number(formData.stock_quantity) <= 0
                        ? "bg-rose-50 text-rose-700 border border-rose-200"
                        : Number(formData.stock_quantity) <= 5
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    }`}
                  >
                    {Number(formData.stock_quantity) <= 0
                      ? "Out of Stock"
                      : Number(formData.stock_quantity) <= 5
                      ? "Low Stock"
                      : "In Stock"}
                  </span>
                </div>
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
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
              />

              <input
                type="file"
                ref={cameraInputRef}
                onChange={handleImageSelect}
                capture="environment"
                accept="image/jpeg,image/png,image/webp,image/gif"
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
          <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <Link
              to="/products"
              className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition shadow-xs cursor-pointer"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-500 transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating Product...
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
    </div>
  );
}

export default AddProduct;
