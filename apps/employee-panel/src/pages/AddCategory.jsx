import { useState, useRef, useEffect, useMemo } from "react";
import {
  FolderPlus,
  FolderTree,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Layers,
  Lock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  getCategories,
  createCategory,
  updateCategory,
  reorderCategories,
  uploadProductImage,
} from "../services/employeeApi.js";
import {
  compressImage,
  CATEGORY_MAX_DIMENSION,
  isAcceptedImage,
  isHeicFile,
  RAW_IMAGE_MAX_INPUT_BYTES,
  MAX_FILE_SIZE_BYTES,
} from "../utils/imageCompressor.js";

import AddCategoryForm from "../components/category/AddCategoryForm.jsx";
import CategoryOrderItem from "../components/category/CategoryOrderItem.jsx";
import UpdateCategoryModal from "../components/category/UpdateCategoryModal.jsx";
import SystemCategoryCard from "../components/category/SystemCategoryCard.jsx";
import { getCategoryImageUrl } from "../utils/categoryImage.js";

function AddCategory() {
  const fileInputRef = useRef(null);
  const updateFileInputRef = useRef(null);
  const isSubmittingRef = useRef(false);
  const isUpdatingRef = useRef(false);
  const isReorderingRef = useRef(false);

  // Drag and Drop refs & state
  const draggedIndexRef = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  // Existing Categories State
  const [categoriesList, setCategoriesList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");

  // Add Category Toggle & Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState(0);
  const [image, setImage] = useState(null); // { file, preview, url, mediaId, uploaded, uploading, error }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdCategory, setCreatedCategory] = useState(null);

  // Update Category Modal State
  const [editingCategory, setEditingCategory] = useState(null); // null or category object
  const [updateName, setUpdateName] = useState("");
  const [updateParentId, setUpdateParentId] = useState(0);
  const [updateImageFile, setUpdateImageFile] = useState(null);
  const [updateImagePreview, setUpdateImagePreview] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState("");
  const [updateError, setUpdateError] = useState("");

  // Toast Notification State
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  const isUncategorized = (category) => {
    return (
      String(category?.slug || "").toLowerCase() === "uncategorized" ||
      String(category?.name || "").toLowerCase() === "uncategorized"
    );
  };

  // Only top-level departments belong in the storefront category navigation
  // and merchandising order. Child categories remain separately manageable.
  const storefrontCategories = useMemo(
    () => categoriesList.filter((category) => !isUncategorized(category) && (!category.parent || Number(category.parent) === 0)),
    [categoriesList]
  );

  const subcategoryCategories = useMemo(
    () => categoriesList.filter((category) => !isUncategorized(category) && Number(category.parent) > 0),
    [categoriesList]
  );

  const topLevelCategories = storefrontCategories;

  const systemCategories = useMemo(() => {
    return categoriesList.filter((c) => isUncategorized(c));
  }, [categoriesList]);

  // Fetch live categories from WooCommerce
  const fetchCategoryList = async () => {
    try {
      setLoadingList(true);
      setListError("");
      const res = await getCategories();
      if (res.success && Array.isArray(res.categories)) {
        setCategoriesList(res.categories);
      } else if (Array.isArray(res)) {
        setCategoriesList(res);
      }
    } catch (err) {
      setListError(err.response?.data?.message || err.message || "Failed to load store categories.");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchCategoryList();
  }, []);

  // ─────────────────────────────────────────────────────────────
  // REORDERING (DRAG & DROP + TOUCH BUTTONS + PERSISTENCE)
  // ─────────────────────────────────────────────────────────────
  const handleDragStart = (e, storefrontIndex) => {
    draggedIndexRef.current = storefrontIndex;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(storefrontIndex));
  };

  const handleDragOver = (e, storefrontIndex) => {
    e.preventDefault();
    if (dragOverIndex !== storefrontIndex) {
      setDragOverIndex(storefrontIndex);
    }
  };

  const handleDrop = async (e, targetStorefrontIndex) => {
    e.preventDefault();
    const sourceStorefrontIndex = draggedIndexRef.current;
    setDragOverIndex(null);
    draggedIndexRef.current = null;

    if (
      sourceStorefrontIndex === null ||
      sourceStorefrontIndex === undefined ||
      sourceStorefrontIndex === targetStorefrontIndex ||
      targetStorefrontIndex >= storefrontCategories.length
    ) {
      return;
    }

    // Reorder storefront array
    const updatedStorefront = [...storefrontCategories];
    const [movedItem] = updatedStorefront.splice(sourceStorefrontIndex, 1);
    updatedStorefront.splice(targetStorefrontIndex, 0, movedItem);

    // Recombine with system categories
    const fullUpdatedList = [...updatedStorefront, ...subcategoryCategories, ...systemCategories];
    setCategoriesList(fullUpdatedList);
    await persistCategoryOrder(fullUpdatedList);
  };

  const handleDragEnd = () => {
    draggedIndexRef.current = null;
    setDragOverIndex(null);
  };

  // Move up/down handler for mobile touch controls
  const handleMoveCategory = async (storefrontIndex, direction) => {
    const newIndex = direction === "up" ? storefrontIndex - 1 : storefrontIndex + 1;
    if (newIndex < 0 || newIndex >= storefrontCategories.length) return;

    const updatedStorefront = [...storefrontCategories];
    const [movedItem] = updatedStorefront.splice(storefrontIndex, 1);
    updatedStorefront.splice(newIndex, 0, movedItem);

    const fullUpdatedList = [...updatedStorefront, ...subcategoryCategories, ...systemCategories];
    setCategoriesList(fullUpdatedList);
    await persistCategoryOrder(fullUpdatedList);
  };

  // Persist order array to WooCommerce
  const persistCategoryOrder = async (orderedList) => {
    if (isReorderingRef.current) return;

    try {
      isReorderingRef.current = true;
      setIsSavingOrder(true);

      const validIds = orderedList
        .filter((category) => !isUncategorized(category) && (!category.parent || Number(category.parent) === 0))
        .map((c) => c.id);

      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp_cat_ord_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

      await reorderCategories(validIds, {
        "X-Idempotency-Key": idempotencyKey,
      });

      showToast("Merchandising order saved & published!");
    } catch {
      showToast("Failed to save category order. Refreshing list...", "error");
      fetchCategoryList();
    } finally {
      isReorderingRef.current = false;
      setIsSavingOrder(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // ADD CATEGORY HANDLERS
  // ─────────────────────────────────────────────────────────────
  const handleImageSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const file = files[0];

    if (!isAcceptedImage(file)) {
      showToast(`"${file.name}" is not a supported image format.`, "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > RAW_IMAGE_MAX_INPUT_BYTES) {
      showToast(`"${file.name}" exceeds the 25MB maximum limit.`, "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (isHeicFile(file)) {
      showToast(
        `"${file.name}" is in HEIC format and not supported directly by your browser. Please select JPEG, PNG, or WebP.`,
        "error"
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Compress category image client-side before upload (max 1200px preserving aspect ratio, WebP 0.85 with JPEG fallback)
    let fileToUpload = file;
    try {
      fileToUpload = await compressImage(file, { maxDimension: CATEGORY_MAX_DIMENSION });
    } catch (err) {
      if (isHeicFile(file) || err?.code === "HEIC_UNSUPPORTED") {
        showToast(
          `"${file.name}" is in HEIC format and not supported directly by your browser. Please select JPEG, PNG, or WebP.`,
          "error"
        );
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      // Fall back to original file if compression fails on standard images
    }

    if (isHeicFile(fileToUpload)) {
      showToast(
        `"${file.name}" is in HEIC format and cannot be uploaded. Please select JPEG, PNG, or WebP.`,
        "error"
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (fileToUpload.size > MAX_FILE_SIZE_BYTES) {
      showToast(`"${file.name}" exceeds the 5MB upload limit after compression.`, "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const preview = URL.createObjectURL(fileToUpload);
    const newImgState = {
      file: fileToUpload,
      preview,
      url: "",
      mediaId: null,
      uploaded: false,
      uploading: true,
      error: null,
    };

    setImage(newImgState);
    if (error) setError("");

    try {
      const uploadRes = await uploadProductImage(fileToUpload);
      if (uploadRes.success && (uploadRes.url || uploadRes.id)) {
        setImage({
          file: fileToUpload,
          preview,
          url: uploadRes.url,
          mediaId: uploadRes.id,
          uploaded: true,
          uploading: false,
          error: null,
        });
        showToast("Category image uploaded to WordPress Media Library!");
      } else {
        setImage({
          file: fileToUpload,
          preview,
          url: "",
          mediaId: null,
          uploaded: false,
          uploading: false,
          error: "Upload failed. Please try again.",
        });
        showToast("Failed to upload image.", "error");
      }
    } catch (err) {
      setImage({
        file: fileToUpload,
        preview,
        url: "",
        mediaId: null,
        uploaded: false,
        uploading: false,
        error: err.response?.data?.message || err.message || "Upload failed.",
      });
      showToast(err.response?.data?.message || "Failed to upload image.", "error");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveImage = () => {
    if (image?.preview && typeof image.preview === "string" && image.preview.startsWith("blob:")) {
      URL.revokeObjectURL(image.preview);
    }
    setImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();

    if (isSubmittingRef.current || submitting) {
      return;
    }

    setError("");

    if (!name.trim()) {
      setError("Category Name is required.");
      return;
    }

    if (!image) {
      setError("Category image is required.");
      return;
    }

    if (image.uploading) {
      setError("Please wait for the image to finish uploading.");
      return;
    }

    const mediaId = Number(image.mediaId);
    const hasMediaId = Number.isInteger(mediaId) && mediaId > 0;
    if (!image.uploaded || (!hasMediaId && !image.url)) {
      setError("Category image upload failed. Please choose another image or retry.");
      return;
    }

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);

      const payload = {
        name: name.trim(),
        description: description.trim(),
        parent: Number(parentId) || 0,
      };
      if (hasMediaId) payload.image_id = mediaId;
      if (image.url) payload.image_url = image.url;

      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp_cat_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

      const res = await createCategory(payload, {
        "X-Idempotency-Key": idempotencyKey,
      });

      if (res.success && res.category) {
        setCreatedCategory(res.category);
        showToast(`Category "${res.category.name}" created successfully!`);
        fetchCategoryList();
      } else {
        setError(res.message || "Failed to create category in WooCommerce.");
      }
    } catch (err) {
      setError(
        err.response?.data?.message || err.message || "Failed to create category. Please try again."
      );
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleResetCreateForm = () => {
    setName("");
    setDescription("");
    setParentId(0);
    setImage(null);
    setCreatedCategory(null);
    setError("");
  };

  // ─────────────────────────────────────────────────────────────
  // UPDATE CATEGORY HANDLERS
  // ─────────────────────────────────────────────────────────────
  const handleOpenUpdateModal = (cat) => {
    setEditingCategory(cat);
    setUpdateName(cat.name || "");
    setUpdateParentId(typeof cat.parent === "number" ? cat.parent : 0);
    setUpdateImageFile(null);
    setUpdateImagePreview("");
    setUpdateError("");
    setUpdateStatusText("");
  };

  const handleCloseUpdateModal = () => {
    if (updating) return;
    if (updateImagePreview && typeof updateImagePreview === "string" && updateImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(updateImagePreview);
    }
    setEditingCategory(null);
    setUpdateName("");
    setUpdateParentId(0);
    setUpdateImageFile(null);
    setUpdateImagePreview("");
    setUpdateError("");
    setUpdateStatusText("");
  };

  const handleUpdateImageSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const file = files[0];

    if (!isAcceptedImage(file)) {
      showToast(`"${file.name}" is not a supported image format.`, "error");
      if (updateFileInputRef.current) updateFileInputRef.current.value = "";
      return;
    }

    if (file.size > RAW_IMAGE_MAX_INPUT_BYTES) {
      showToast(`"${file.name}" exceeds the 25MB maximum limit.`, "error");
      if (updateFileInputRef.current) updateFileInputRef.current.value = "";
      return;
    }

    if (isHeicFile(file)) {
      showToast(
        `"${file.name}" is in HEIC format and not supported directly by your browser. Please select JPEG, PNG, or WebP.`,
        "error"
      );
      if (updateFileInputRef.current) updateFileInputRef.current.value = "";
      return;
    }

    if (updateImagePreview && typeof updateImagePreview === "string" && updateImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(updateImagePreview);
    }

    // Compress category update image client-side (max 1200px preserving aspect ratio, WebP 0.85 with JPEG fallback)
    let fileToUpload = file;
    try {
      fileToUpload = await compressImage(file, { maxDimension: CATEGORY_MAX_DIMENSION });
    } catch (err) {
      if (isHeicFile(file) || err?.code === "HEIC_UNSUPPORTED") {
        showToast(
          `"${file.name}" is in HEIC format and not supported directly by your browser. Please select JPEG, PNG, or WebP.`,
          "error"
        );
        if (updateFileInputRef.current) updateFileInputRef.current.value = "";
        return;
      }
      // Fall back to original file if compression fails on standard images
    }

    if (isHeicFile(fileToUpload)) {
      showToast(
        `"${file.name}" is in HEIC format and cannot be uploaded. Please select JPEG, PNG, or WebP.`,
        "error"
      );
      if (updateFileInputRef.current) updateFileInputRef.current.value = "";
      return;
    }

    if (fileToUpload.size > MAX_FILE_SIZE_BYTES) {
      showToast(`"${file.name}" exceeds the 5MB upload limit after compression.`, "error");
      if (updateFileInputRef.current) updateFileInputRef.current.value = "";
      return;
    }

    setUpdateImageFile(fileToUpload);
    setUpdateImagePreview(URL.createObjectURL(fileToUpload));
    if (updateError) setUpdateError("");
  };

  const handleCancelNewImage = () => {
    if (updateImagePreview && typeof updateImagePreview === "string" && updateImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(updateImagePreview);
    }
    setUpdateImageFile(null);
    setUpdateImagePreview("");
    if (updateFileInputRef.current) updateFileInputRef.current.value = "";
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();

    if (isUpdatingRef.current || updating || !editingCategory) {
      return;
    }

    setUpdateError("");

    const trimmedName = updateName.trim();
    if (!trimmedName) {
      setUpdateError("Category Name cannot be empty.");
      return;
    }

    const nameChanged = trimmedName !== editingCategory.name;
    const imageChanged = !!updateImageFile;
    const parentChanged = (Number(updateParentId) || 0) !== (Number(editingCategory.parent) || 0);

    // If no changes were made, close modal cleanly
    if (!nameChanged && !imageChanged && !parentChanged) {
      handleCloseUpdateModal();
      return;
    }

    try {
      isUpdatingRef.current = true;
      setUpdating(true);

      const payload = {};

      if (nameChanged) {
        payload.name = trimmedName;
      }

      if (parentChanged) {
        payload.parent = Number(updateParentId) || 0;
      }

      if (imageChanged) {
        setUpdateStatusText("Uploading new image to WordPress...");
        const uploadRes = await uploadProductImage(updateImageFile);
        if (!uploadRes.success || (!uploadRes.id && !uploadRes.url)) {
          throw new Error(uploadRes.message || "Failed to upload new category image.");
        }
        const mediaId = Number(uploadRes.id);
        if (Number.isInteger(mediaId) && mediaId > 0) payload.image_id = mediaId;
        if (uploadRes.url) payload.image_url = uploadRes.url;
      }

      setUpdateStatusText("Updating WooCommerce category...");
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp_cat_up_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

      const res = await updateCategory(editingCategory.id, payload, {
        "X-Idempotency-Key": idempotencyKey,
      });

      if (res.success && res.category) {
        showToast(`Category "${res.category.name}" updated successfully!`);
        handleCloseUpdateModal();
        fetchCategoryList();
      } else {
        setUpdateError(res.message || "Failed to update category.");
      }
    } catch (err) {
      setUpdateError(
        err.response?.data?.message || err.message || "Failed to update category. Please try again."
      );
    } finally {
      isUpdatingRef.current = false;
      setUpdating(false);
      setUpdateStatusText("");
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
              : "bg-emerald-600 shadow-emerald-600/30"
          }`}
        >
          {toast.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Action Toolbar */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => {
            setParentId(0);
            setShowAddForm((prev) => !prev);
          }}
          className={`inline-flex items-center gap-2 rounded-2xl py-2.5 px-5 text-xs font-black shadow-xs transition-all active:scale-95 cursor-pointer ${
            showAddForm
              ? "bg-gray-100 text-gray-700 border-2 border-gray-300 hover:bg-gray-200"
              : "bg-emerald-600 text-white border-2 border-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20"
          }`}
        >
          {showAddForm ? (
            <>
              <ChevronUp size={16} />
              <span>Hide Form</span>
            </>
          ) : (
            <>
              <Plus size={16} strokeWidth={2.5} />
              <span>Add Category</span>
            </>
          )}
        </button>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SECTION 1: ADD NEW CATEGORY FORM COMPONENT                    */}
      {/* ───────────────────────────────────────────────────────────── */}
      <AddCategoryForm
        show={showAddForm}
        onClose={() => setShowAddForm(false)}
        name={name}
        setName={setName}
        description={description}
        setDescription={setDescription}
        parentId={parentId}
        setParentId={setParentId}
        categories={categoriesList}
        image={image}
        onImageSelect={handleImageSelect}
        onRemoveImage={handleRemoveImage}
        fileInputRef={fileInputRef}
        submitting={submitting}
        error={error}
        setError={setError}
        createdCategory={createdCategory}
        onSubmit={handleCreateSubmit}
        onReset={handleResetCreateForm}
      />

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SECTION 2: STOREFRONT CATEGORIES (MERCHANDISING REORDERABLE)  */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-gray-700" />
            <h2 className="text-sm font-black uppercase tracking-wider text-gray-900">
              Storefront Categories
            </h2>
            <span className="rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 text-xs font-extrabold">
              {storefrontCategories.length}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {isSavingOrder && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg animate-pulse">
                <Loader2 size={13} className="animate-spin" />
                Saving order...
              </span>
            )}

            <button
              type="button"
              onClick={fetchCategoryList}
              disabled={loadingList}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-800 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={13} className={loadingList ? "animate-spin text-emerald-600" : ""} />
              Refresh
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          💡 <span className="font-semibold text-gray-700">Desktop:</span> drag cards to reorder. <span className="font-semibold text-gray-700">Mobile:</span> tap [ ↑ ] / [ ↓ ] buttons to move departments up or down.
        </p>

        {listError && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
            <AlertCircle size={16} className="shrink-0 text-rose-600" />
            <span>{listError}</span>
          </div>
        )}

        {loadingList ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-20 rounded-2xl border border-gray-200 bg-white p-3.5 shadow-xs animate-pulse flex items-center gap-4"
              >
                <div className="h-12 w-12 rounded-xl bg-gray-100 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 bg-gray-100 rounded" />
                  <div className="h-3 w-1/4 bg-gray-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : storefrontCategories.length === 0 ? (
          <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center space-y-3 shadow-xs">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
              <FolderPlus size={24} />
            </div>
            <h3 className="text-sm font-bold text-gray-900">No storefront categories found</h3>
            <p className="text-xs text-gray-500">
              Click "+ Add Category" above to create your first department.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {storefrontCategories.map((category, index) => (
              <CategoryOrderItem
                key={category.id}
                category={category}
                index={index}
                totalCount={storefrontCategories.length}
                allCategories={categoriesList}
                isOver={dragOverIndex === index}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                onMoveUp={(idx) => handleMoveCategory(idx, "up")}
                onMoveDown={(idx) => handleMoveCategory(idx, "down")}
                onOpenUpdateModal={handleOpenUpdateModal}
              />
            ))}
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SECTION 4: SYSTEM PROTECTED CATEGORIES (UNCATEGORIZED)        */}
      {/* ───────────────────────────────────────────────────────────── */}
      {systemCategories.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-amber-600" />
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-600">
              System Category (Protected)
            </h3>
          </div>

          <div className="space-y-2">
            {systemCategories.map((category) => (
              <SystemCategoryCard key={category.id} category={category} />
            ))}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* UPDATE CATEGORY MODAL COMPONENT                               */}
      {/* ───────────────────────────────────────────────────────────── */}
      <UpdateCategoryModal
        editingCategory={editingCategory}
        updateName={updateName}
        setUpdateName={setUpdateName}
        updateParentId={updateParentId}
        setUpdateParentId={setUpdateParentId}
        categories={categoriesList}
        updateImageFile={updateImageFile}
        updateImagePreview={updateImagePreview}
        updateFileInputRef={updateFileInputRef}
        onUpdateImageSelect={handleUpdateImageSelect}
        onCancelNewImage={handleCancelNewImage}
        updating={updating}
        updateStatusText={updateStatusText}
        updateError={updateError}
        setUpdateError={setUpdateError}
        onClose={handleCloseUpdateModal}
        onSubmit={handleUpdateSubmit}
      />
    </div>
  );
}

export default AddCategory;
