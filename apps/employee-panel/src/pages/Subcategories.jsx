import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  FolderTree,
  Folder,
  Plus,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  Edit3,
  Check,
  X,
  Image as ImageIcon,
  PackagePlus,
} from "lucide-react";
import {
  getCategories,
  createCategory,
  updateCategory,
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
import { getCategoryImageUrl } from "../utils/categoryImage.js";

function Subcategories() {
  const fileInputRef = useRef(null);
  const updateFileInputRef = useRef(null);
  const addDropdownRef = useRef(null);
  const updateDropdownRef = useRef(null);
  const filterDropdownRef = useRef(null);
  const categoryListRequestIdRef = useRef(0);
  const createIdempotencyRef = useRef(null);
  const updateIdempotencyRef = useRef(null);

  const getStableIdempotencyKey = (keyRef, payload) => {
    const fingerprint = JSON.stringify(payload);
    if (keyRef.current?.fingerprint !== fingerprint) {
      const key = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `idemp_category_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      keyRef.current = { fingerprint, key };
    }
    return keyRef.current.key;
  };

  // Categories list
  const [categoriesList, setCategoriesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Toast state
  const [toast, setToast] = useState(null);
  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Add Subcategory form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [parentId, setParentId] = useState(0);
  const [name, setName] = useState("");
  const [image, setImage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [createdCategory, setCreatedCategory] = useState(null);
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState("");

  // Update Subcategory modal state
  const [editingSubcategory, setEditingSubcategory] = useState(null);
  const [updateName, setUpdateName] = useState("");
  const [updateParentId, setUpdateParentId] = useState(0);
  const [updateImageFile, setUpdateImageFile] = useState(null);
  const [updateImagePreview, setUpdateImagePreview] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState("");
  const [updateError, setUpdateError] = useState("");
  const [updateDropdownOpen, setUpdateDropdownOpen] = useState(false);
  const [updateSearchQuery, setUpdateSearchQuery] = useState("");

  // Department filter dropdown state (NO "All Departments" option)
  const [departmentFilter, setDepartmentFilter] = useState(0);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const isUncategorized = (category) => {
    return (
      String(category?.slug || "").toLowerCase() === "uncategorized" ||
      String(category?.name || "").toLowerCase() === "uncategorized"
    );
  };

  // Live categories fetch
  const fetchCategoryList = async () => {
    const requestId = ++categoryListRequestIdRef.current;
    try {
      setLoading(true);
      setError("");
      const res = await getCategories();
      if (res.success && Array.isArray(res.categories)) {
        if (requestId === categoryListRequestIdRef.current) setCategoriesList(res.categories);
      } else if (Array.isArray(res)) {
        if (requestId === categoryListRequestIdRef.current) setCategoriesList(res);
      } else if (requestId === categoryListRequestIdRef.current) {
        setError(res?.message || "Failed to load categories.");
      }
    } catch (err) {
      if (requestId === categoryListRequestIdRef.current) {
        setError(err.response?.data?.message || err.message || "Failed to load categories.");
      }
    } finally {
      if (requestId === categoryListRequestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategoryList();
  }, []);

  // Root departments (parent === 0)
  const rootDepartments = useMemo(() => {
    return (categoriesList || []).filter(
      (c) => !isUncategorized(c) && (!c.parent || Number(c.parent) === 0)
    );
  }, [categoriesList]);

  // All subcategories (parent > 0)
  const allSubcategories = useMemo(() => {
    return (categoriesList || []).filter(
      (c) => !isUncategorized(c) && Number(c.parent) > 0
    );
  }, [categoriesList]);

  // Set default parentId and default departmentFilter to the first department with subcategories
  useEffect(() => {
    if (rootDepartments.length > 0) {
      if (!parentId || Number(parentId) === 0) {
        setParentId(Number(rootDepartments[0].id));
      }
      if (!departmentFilter || departmentFilter === 0) {
        const firstWithSubs = rootDepartments.find((d) =>
          allSubcategories.some((s) => Number(s.parent) === Number(d.id))
        );
        setDepartmentFilter(Number(firstWithSubs ? firstWithSubs.id : rootDepartments[0].id));
      }
    }
  }, [rootDepartments, allSubcategories, parentId, departmentFilter]);

  // Outside click listener for all floating dropdowns
  useEffect(() => {
    function handleClickOutside(e) {
      if (addDropdownRef.current && !addDropdownRef.current.contains(e.target)) {
        setAddDropdownOpen(false);
      }
      if (updateDropdownRef.current && !updateDropdownRef.current.contains(e.target)) {
        setUpdateDropdownOpen(false);
      }
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target)) {
        setFilterDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  // Currently selected department in filter
  const currentFilterDept = useMemo(() => {
    return rootDepartments.find((d) => Number(d.id) === Number(departmentFilter)) || rootDepartments[0] || null;
  }, [rootDepartments, departmentFilter]);

  // Subcategories belonging to the currently selected department
  const departmentSubcategories = useMemo(() => {
    if (!departmentFilter) return [];
    return allSubcategories.filter((c) => Number(c.parent) === Number(departmentFilter));
  }, [allSubcategories, departmentFilter]);

  // Filtered subcategories within this department (if user searches)
  const filteredSubcategories = useMemo(() => {
    if (!searchQuery.trim()) return departmentSubcategories;
    const q = searchQuery.toLowerCase().trim();
    return departmentSubcategories.filter((c) => {
      const catName = (c.name || "").toLowerCase();
      return catName.includes(q) || String(c.id).includes(q);
    });
  }, [departmentSubcategories, searchQuery]);

  // Filtered eligible parents for Add Subcategory dropdown
  const filteredAddParents = useMemo(() => {
    if (!addSearchQuery.trim()) return rootDepartments;
    const q = addSearchQuery.toLowerCase().trim();
    return rootDepartments.filter(
      (c) => (c.name || "").toLowerCase().includes(q) || String(c.id).includes(q)
    );
  }, [rootDepartments, addSearchQuery]);

  const selectedParentCategory = useMemo(() => {
    return rootDepartments.find((c) => Number(c.id) === Number(parentId)) || null;
  }, [rootDepartments, parentId]);

  // Image upload handler for Add Subcategory
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
      showToast(`"${file.name}" exceeds 25MB maximum limit.`, "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (isHeicFile(file)) {
      showToast(`HEIC format not supported. Please select JPEG, PNG, or WebP.`, "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (image?.preview && typeof image.preview === "string" && image.preview.startsWith("blob:")) {
      URL.revokeObjectURL(image.preview);
    }

    let fileToUpload = file;
    try {
      fileToUpload = await compressImage(file, { maxDimension: CATEGORY_MAX_DIMENSION });
    } catch {
      // Fallback to original file
    }

    if (fileToUpload.size > MAX_FILE_SIZE_BYTES) {
      showToast(`"${file.name}" exceeds 5MB upload limit.`, "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const preview = URL.createObjectURL(fileToUpload);
    setImage({
      file: fileToUpload,
      preview,
      url: "",
      mediaId: null,
      uploaded: false,
      uploading: true,
      error: null,
    });
    setFormError("");

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
        showToast("Subcategory photo uploaded to Media Library!");
      } else {
        setImage({
          file: fileToUpload,
          preview,
          url: "",
          mediaId: null,
          uploaded: false,
          uploading: false,
          error: "Upload failed.",
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
      showToast("Failed to upload image.", "error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveImage = () => {
    if (image?.preview && typeof image.preview === "string" && image.preview.startsWith("blob:")) {
      URL.revokeObjectURL(image.preview);
    }
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setFormError("");

    if (!name.trim()) {
      setFormError("Subcategory Name is required.");
      return;
    }

    if (!parentId || Number(parentId) === 0) {
      setFormError("Please select a valid parent department.");
      return;
    }

    const mediaId = Number(image?.mediaId);
    const hasMediaId = Number.isInteger(mediaId) && mediaId > 0;
    if (!image || !image.uploaded || (!hasMediaId && !image.url)) {
      setFormError("A category photo is required. Please choose and upload a photo.");
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        name: name.trim(),
        parent: Number(parentId),
      };
      if (hasMediaId) payload.image_id = mediaId;
      if (image.url) payload.image_url = image.url;

      const idempotencyKey = getStableIdempotencyKey(createIdempotencyRef, payload);

      const res = await createCategory(payload, {
        "X-Idempotency-Key": idempotencyKey,
      });

      if (res.success && res.category) {
        setCreatedCategory(res.category);
        setDepartmentFilter(Number(res.category.parent));
        showToast(`Subcategory "${res.category.name}" created successfully!`);
        await fetchCategoryList();
      } else {
        setFormError(res.message || "Failed to create subcategory.");
      }
    } catch (err) {
      setFormError(err.response?.data?.message || err.message || "Failed to create subcategory.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetCreateForm = () => {
    if (image?.preview?.startsWith("blob:")) URL.revokeObjectURL(image.preview);
    setName("");
    setImage(null);
    setCreatedCategory(null);
    setFormError("");
    createIdempotencyRef.current = null;
  };

  // ─────────────────────────────────────────────────────────────
  // UPDATE SUBCATEGORY HANDLERS
  // ─────────────────────────────────────────────────────────────
  const handleOpenUpdateModal = (sub) => {
    setEditingSubcategory(sub);
    setUpdateName(sub.name || "");
    setUpdateParentId(Number(sub.parent) || 0);
    setUpdateImageFile(null);
    setUpdateImagePreview("");
    setUpdateError("");
    setUpdateStatusText("");
    setUpdateDropdownOpen(false);
  };

  const handleCloseUpdateModal = () => {
    if (updating) return;
    if (updateImagePreview && typeof updateImagePreview === "string" && updateImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(updateImagePreview);
    }
    setEditingSubcategory(null);
    setUpdateName("");
    setUpdateParentId(0);
    setUpdateImageFile(null);
    setUpdateImagePreview("");
    setUpdateError("");
    setUpdateStatusText("");
  };

  // Eligible parents for Update modal: Exclude itself and any descendants
  const eligibleUpdateParents = useMemo(() => {
    if (!editingSubcategory || !Array.isArray(categoriesList)) return [];
    const targetId = Number(editingSubcategory.id);
    const childrenMap = new Map();
    for (const c of categoriesList) {
      const pId = Number(c.parent) || 0;
      if (!childrenMap.has(pId)) childrenMap.set(pId, []);
      childrenMap.get(pId).push(Number(c.id));
    }
    const desc = new Set();
    const queue = [targetId];
    while (queue.length > 0) {
      const curr = queue.shift();
      const children = childrenMap.get(curr) || [];
      for (const chId of children) {
        if (!desc.has(chId)) {
          desc.add(chId);
          queue.push(chId);
        }
      }
    }
    return rootDepartments.filter(
      (c) => Number(c.id) !== targetId && !desc.has(Number(c.id))
    );
  }, [editingSubcategory, categoriesList, rootDepartments]);

  const filteredUpdateParents = useMemo(() => {
    if (!updateSearchQuery.trim()) return eligibleUpdateParents;
    const q = updateSearchQuery.toLowerCase().trim();
    return eligibleUpdateParents.filter(
      (c) => (c.name || "").toLowerCase().includes(q) || String(c.id).includes(q)
    );
  }, [eligibleUpdateParents, updateSearchQuery]);

  const selectedUpdateParent = useMemo(() => {
    return eligibleUpdateParents.find((c) => Number(c.id) === Number(updateParentId)) || null;
  }, [eligibleUpdateParents, updateParentId]);

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
      showToast(`"${file.name}" exceeds 25MB maximum limit.`, "error");
      if (updateFileInputRef.current) updateFileInputRef.current.value = "";
      return;
    }

    if (isHeicFile(file)) {
      showToast(`HEIC format not supported. Please select JPEG, PNG, or WebP.`, "error");
      if (updateFileInputRef.current) updateFileInputRef.current.value = "";
      return;
    }

    if (updateImagePreview && typeof updateImagePreview === "string" && updateImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(updateImagePreview);
    }

    let fileToUpload = file;
    try {
      fileToUpload = await compressImage(file, { maxDimension: CATEGORY_MAX_DIMENSION });
    } catch {
      // Fallback
    }

    if (fileToUpload.size > MAX_FILE_SIZE_BYTES) {
      showToast(`"${file.name}" exceeds 5MB limit.`, "error");
      if (updateFileInputRef.current) updateFileInputRef.current.value = "";
      return;
    }

    setUpdateImageFile(fileToUpload);
    setUpdateImagePreview(URL.createObjectURL(fileToUpload));
    if (updateFileInputRef.current) updateFileInputRef.current.value = "";
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    if (updating || !editingSubcategory) return;

    const nameChanged = updateName.trim() !== editingSubcategory.name;
    const imageChanged = !!updateImageFile;
    const parentChanged = Number(updateParentId) !== Number(editingSubcategory.parent);

    if (!nameChanged && !imageChanged && !parentChanged) {
      handleCloseUpdateModal();
      return;
    }

    try {
      setUpdating(true);
      setUpdateError("");
      const payload = {};

      if (nameChanged) {
        payload.name = updateName.trim();
      }
      if (parentChanged) {
        payload.parent = Number(updateParentId);
      }
      if (imageChanged) {
        setUpdateStatusText("Uploading image to Media Library...");
        const uploadRes = await uploadProductImage(updateImageFile);
        if (uploadRes.success && (uploadRes.url || uploadRes.id)) {
          const mediaId = Number(uploadRes.id);
          if (Number.isInteger(mediaId) && mediaId > 0) payload.image_id = mediaId;
          if (uploadRes.url) payload.image_url = uploadRes.url;
          if (!payload.image_id && !payload.image_url) {
            setUpdateError("Uploaded image did not include a valid media ID or URL.");
            return;
          }
        } else {
          setUpdateError("Failed to upload image.");
          return;
        }
      }

      setUpdateStatusText("Updating subcategory in WooCommerce...");
      const idempotencyKey = getStableIdempotencyKey(updateIdempotencyRef, payload);

      const res = await updateCategory(editingSubcategory.id, payload, {
        "X-Idempotency-Key": idempotencyKey,
      });

      if (res.success && res.category) {
        showToast(`Subcategory "${res.category.name}" updated successfully!`);
        if (parentChanged) {
          setDepartmentFilter(Number(updateParentId));
        }
        handleCloseUpdateModal();
        await fetchCategoryList();
        updateIdempotencyRef.current = null;
      } else {
        setUpdateError(res.message || "Failed to update subcategory.");
      }
    } catch (err) {
      setUpdateError(err.response?.data?.message || err.message || "Failed to update subcategory.");
    } finally {
      setUpdating(false);
      setUpdateStatusText("");
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto pb-16 px-1 sm:px-0">
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

      {/* TOP ACTION TOOLBAR (Full-width, properly organized and aligned) */}
      <div className="flex items-center gap-2.5 w-full">
        <button
          type="button"
          disabled={rootDepartments.length === 0}
          title={rootDepartments.length === 0 ? "Create a department first in Categories." : undefined}
          onClick={() => {
            setShowAddForm((prev) => !prev);
            if (!showAddForm && rootDepartments.length > 0) {
              setParentId(Number(departmentFilter || rootDepartments[0].id));
            }
          }}
          className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-2xl text-xs font-black shadow-xs transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            showAddForm
              ? "bg-gray-100 text-gray-700 border-2 border-gray-300 hover:bg-gray-200"
              : "bg-purple-600 text-white border-2 border-purple-600 hover:bg-purple-500 shadow-purple-600/20"
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
              <span>Add Subcategory</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={fetchCategoryList}
          disabled={loading}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-gray-200 bg-white text-gray-600 shadow-xs hover:border-purple-300 hover:text-purple-600 active:scale-95 transition cursor-pointer shrink-0"
          title="Refresh List"
        >
          <RefreshCw size={15} className={loading ? "animate-spin text-purple-600" : ""} />
        </button>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SECTION 1: ADD SUBCATEGORY FORM                               */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showAddForm && (
        <div className="space-y-4 rounded-3xl border border-purple-200 bg-gradient-to-b from-purple-50/50 to-white p-4 sm:p-7 shadow-xs animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between border-b border-purple-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-600 text-white font-bold text-xs">
                +
              </span>
              <h2 className="text-sm font-black uppercase tracking-wider text-gray-900">
                Add Subcategory
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-gray-400 hover:text-gray-600 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <ChevronUp size={16} /> Collapse
            </button>
          </div>

          {createdCategory ? (
            <div className="rounded-2xl border border-purple-200 bg-purple-50/90 p-5 sm:p-6 text-center space-y-4 shadow-sm animate-in zoom-in-95 duration-200">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-600 text-white shadow-md">
                <CheckCircle2 size={28} />
              </div>

              <div>
                <h3 className="text-base font-black text-gray-900">
                  Subcategory Successfully Created!
                </h3>
                <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto">
                  <span className="font-bold text-gray-900">"{createdCategory.name}"</span> (ID #{createdCategory.id}) is now nested inside{" "}
                  <span className="font-bold text-purple-900">
                    "{rootDepartments.find((p) => Number(p.id) === Number(createdCategory.parent))?.name || "Department"}"
                  </span>.
                </p>
              </div>

              {createdCategory.image?.src && (
                <div className="mx-auto h-20 w-20 overflow-hidden rounded-2xl border-2 border-purple-300 shadow-sm bg-white p-1">
                  <img
                    src={createdCategory.image.src}
                    alt={createdCategory.name}
                    className="h-full w-full object-contain"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleResetCreateForm}
                  className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-purple-500 transition cursor-pointer active:scale-95"
                >
                  <Plus size={15} /> Add Another Subcategory
                </button>
                <Link
                  to={`/products/add?category_id=${createdCategory.id}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-purple-300 bg-white px-4 py-2 text-xs font-bold text-purple-700 hover:bg-purple-50 transition shadow-xs"
                >
                  <PackagePlus size={15} /> Add Product to this Subcategory
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateSubmit} className="space-y-5">
              {formError && (
                <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-bold text-rose-700 animate-in fade-in duration-200">
                  <AlertCircle size={16} className="shrink-0 text-rose-600" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
                  {/* Parent Department Selector */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Parent Department <span className="text-rose-500">*</span>
                    </label>

                    {rootDepartments.length === 0 ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        No departments found. Please create a main department in "Categories" first.
                      </div>
                    ) : (
                      <div className="relative" ref={addDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setAddDropdownOpen((prev) => !prev)}
                          aria-haspopup="listbox"
                          aria-expanded={addDropdownOpen}
                          className="w-full flex items-center justify-between gap-3 rounded-2xl border-2 border-purple-200 bg-white p-2.5 sm:p-3 text-left shadow-xs transition hover:border-purple-400 focus:ring-2 focus:ring-purple-500/20 active:scale-[0.99] cursor-pointer"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-purple-100 bg-purple-50 flex items-center justify-center p-0.5">
                              {selectedParentCategory && getCategoryImageUrl(selectedParentCategory) ? (
                                <img
                                  src={getCategoryImageUrl(selectedParentCategory)}
                                  alt={selectedParentCategory.name}
                                  className="h-full w-full object-contain rounded-lg"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center rounded-lg bg-purple-100 text-purple-700 font-black text-sm uppercase">
                                  {selectedParentCategory?.name?.charAt(0) || "D"}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs sm:text-sm font-black text-gray-900 truncate">
                                {selectedParentCategory?.name || "Choose a Department"}
                              </p>
                              <p className="text-[11px] text-purple-700 font-semibold truncate">
                                {selectedParentCategory
                                  ? `Department #${selectedParentCategory.id} • ${selectedParentCategory.count ?? 0} products`
                                  : "Tap to select parent department"}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 pl-1">
                            <span className="text-[11px] font-bold text-purple-700 hidden sm:inline">
                              {addDropdownOpen ? "Close" : "Change"}
                            </span>
                            <div
                              className={`p-1.5 rounded-xl transition-all duration-200 ${
                                addDropdownOpen ? "rotate-180 bg-purple-100 text-purple-800" : "bg-purple-50 text-purple-600"
                              }`}
                            >
                              <ChevronDown size={15} />
                            </div>
                          </div>
                        </button>

                        {/* Floating Options Menu */}
                        {addDropdownOpen && (
                          <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150">
                            {rootDepartments.length > 4 && (
                              <div className="p-2.5 border-b border-gray-100 bg-gray-50/80">
                                <div className="relative">
                                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                  <input
                                    type="text"
                                    value={addSearchQuery}
                                    onChange={(e) => setAddSearchQuery(e.target.value)}
                                    placeholder="Search departments..."
                                    className="w-full pl-8.5 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
                                    autoFocus
                                  />
                                </div>
                              </div>
                            )}

                            <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 overscroll-contain">
                              {filteredAddParents.length === 0 ? (
                                <div className="p-5 text-center text-xs text-gray-500">
                                  No matching departments found.
                                </div>
                              ) : (
                                filteredAddParents.map((c) => {
                                  const isSelected = Number(c.id) === Number(parentId);
                                  const imgUrl = getCategoryImageUrl(c);
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => {
                                        setParentId(Number(c.id));
                                        setAddDropdownOpen(false);
                                        setAddSearchQuery("");
                                      }}
                                      className={`w-full flex items-center justify-between gap-3 p-3 text-left transition cursor-pointer active:scale-[0.99] ${
                                        isSelected
                                          ? "bg-purple-50/90 hover:bg-purple-50"
                                          : "hover:bg-gray-50"
                                      }`}
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white flex items-center justify-center p-0.5 shadow-2xs">
                                          {imgUrl ? (
                                            <img
                                              src={imgUrl}
                                              alt={c.name}
                                              className="h-full w-full object-contain rounded-lg"
                                            />
                                          ) : (
                                            <div className="flex h-full w-full items-center justify-center rounded-lg bg-purple-50 text-purple-700 font-bold text-xs uppercase">
                                              {c.name?.charAt(0) || "D"}
                                            </div>
                                          )}
                                        </div>
                                        <div className="min-w-0">
                                          <p className={`text-xs sm:text-sm font-bold truncate ${isSelected ? "text-purple-950 font-black" : "text-gray-900"}`}>
                                            {c.name}
                                          </p>
                                          <p className="text-[11px] text-gray-500 truncate">
                                            Department #{c.id} • {c.count ?? 0} products
                                          </p>
                                        </div>
                                      </div>

                                      {isSelected && (
                                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white shadow-xs">
                                          <Check size={12} strokeWidth={3} />
                                        </div>
                                      )}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Subcategory Name */}
                  <div className="space-y-1.5 pt-2">
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Subcategory Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (formError) setFormError("");
                      }}
                      placeholder="e.g. Action Figures, Keyboards, Art Paper"
                      className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-xs font-medium text-gray-900 outline-none focus:border-purple-500 focus:bg-white focus:ring-2 focus:ring-purple-500/20 transition"
                    />
                  </div>
                </div>

                {/* Subcategory Image Upload */}
                <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-xs space-y-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                      Subcategory Photo <span className="text-rose-500">*</span>
                    </h3>
                    {image?.uploaded && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        <Check size={11} /> Ready
                      </span>
                    )}
                  </div>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                    accept="image/*,image/heic,image/heif"
                    className="hidden"
                  />

                  {!image ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 p-5 text-center hover:border-purple-400 hover:bg-purple-50/20 transition cursor-pointer min-h-[140px]"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 mb-2">
                        <ImageIcon size={20} />
                      </div>
                      <p className="text-xs font-bold text-gray-700">Click to choose 1 subcategory photo</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">JPG, PNG, WebP (auto-optimized max 1200px)</p>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col justify-between space-y-3">
                      <div className="relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 aspect-video max-h-40 flex items-center justify-center">
                        <img
                          src={image.preview}
                          alt="Subcategory Preview"
                          className="h-full w-full object-contain"
                        />
                        {image.uploading && (
                          <div className="absolute inset-0 bg-black/40 backdrop-blur-2xs flex flex-col items-center justify-center text-white gap-1.5">
                            <Loader2 size={24} className="animate-spin text-purple-400" />
                            <span className="text-xs font-bold">Uploading to Media Library...</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={image.uploading}
                          className="text-xs font-bold text-purple-700 hover:text-purple-900 transition cursor-pointer disabled:opacity-50"
                        >
                          Change Photo
                        </button>
                        <button
                          type="button"
                          onClick={handleRemoveImage}
                          disabled={image.uploading}
                          className="text-xs font-bold text-rose-600 hover:text-rose-800 transition cursor-pointer disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || (image && image.uploading)}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-purple-600 py-3 text-xs font-black text-white shadow-sm hover:bg-purple-500 transition active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Creating Subcategory...</span>
                      </>
                    ) : (
                      <>
                        <Plus size={16} strokeWidth={2.5} />
                        <span>Create Subcategory</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SECTION 2: SEARCH & CUSTOM DEPARTMENT FILTER DROPDOWN         */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-2xl border border-gray-200 shadow-xs">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search subcategories..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2.5 pl-10 pr-4 text-xs font-medium text-gray-900 outline-none focus:border-purple-500 focus:bg-white focus:ring-2 focus:ring-purple-500/20 transition"
          />
        </div>

        {/* Polished Floating Department Selector Dropdown (NO "All Departments" option) */}
        {rootDepartments.length > 0 && (
          <div className="relative shrink-0" ref={filterDropdownRef}>
            <button
              type="button"
              onClick={() => setFilterDropdownOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={filterDropdownOpen}
              className="w-full sm:w-auto min-w-[200px] flex items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-left shadow-2xs transition hover:border-purple-400 focus:ring-2 focus:ring-purple-500/20 active:scale-[0.99] cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 shrink-0 overflow-hidden rounded-lg border border-purple-100 bg-purple-50 flex items-center justify-center p-0.5">
                  {currentFilterDept && getCategoryImageUrl(currentFilterDept) ? (
                    <img
                      src={getCategoryImageUrl(currentFilterDept)}
                      alt={currentFilterDept.name}
                      className="h-full w-full object-contain rounded-md"
                    />
                  ) : (
                    <Folder size={14} className="text-purple-600" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-gray-900 truncate">
                    {currentFilterDept?.name || "Choose Department"}
                  </p>
                  <p className="text-[10px] text-purple-700 font-semibold truncate">
                    {departmentSubcategories.length} {departmentSubcategories.length === 1 ? "subcategory" : "subcategories"}
                  </p>
                </div>
              </div>

              <div
                className={`p-1 rounded-md transition-all duration-200 shrink-0 ${
                  filterDropdownOpen ? "rotate-180 bg-purple-100 text-purple-800" : "bg-purple-50 text-purple-600"
                }`}
              >
                <ChevronDown size={14} />
              </div>
            </button>

            {/* Floating Dropdown Listbox */}
            {filterDropdownOpen && (
              <div className="absolute top-full left-0 right-0 sm:right-0 sm:left-auto sm:w-72 mt-2 z-40 rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150">
                <div className="p-2 border-b border-gray-100 bg-gray-50/70 text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3">
                  Switch Department
                </div>

                <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 overscroll-contain">
                  {rootDepartments.map((dept) => {
                    const isSelected = Number(dept.id) === Number(departmentFilter);
                    const imgUrl = getCategoryImageUrl(dept);
                    const count = allSubcategories.filter((s) => Number(s.parent) === Number(dept.id)).length;
                    return (
                      <button
                        key={dept.id}
                        type="button"
                        onClick={() => {
                          setDepartmentFilter(Number(dept.id));
                          setFilterDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-3 p-3 text-left transition cursor-pointer active:scale-[0.99] ${
                          isSelected ? "bg-purple-50/90 hover:bg-purple-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white flex items-center justify-center p-0.5 shadow-2xs">
                            {imgUrl ? (
                              <img src={imgUrl} alt={dept.name} className="h-full w-full object-contain rounded-lg" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center rounded-lg bg-purple-50 text-purple-700 font-bold text-xs uppercase">
                                {dept.name?.charAt(0) || "D"}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className={`text-xs font-bold truncate ${isSelected ? "text-purple-950 font-black" : "text-gray-900"}`}>
                              {dept.name}
                            </p>
                            <p className="text-[10px] text-gray-500 truncate">
                              {count} {count === 1 ? "subcategory" : "subcategories"}
                            </p>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white shadow-xs">
                            <Check size={12} strokeWidth={3} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SECTION 3: SUBCATEGORIES LISTING                              */}
      {/* ───────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-20 rounded-2xl border border-gray-200 bg-white p-4 shadow-xs animate-pulse flex items-center gap-4"
            >
              <div className="h-12 w-12 rounded-xl bg-gray-100 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 bg-gray-100 rounded" />
                <div className="h-3 w-1/4 bg-gray-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
          <AlertCircle size={16} className="shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      ) : allSubcategories.length === 0 ? (
        <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center space-y-3 shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-purple-600">
            <FolderTree size={28} />
          </div>
          <h3 className="text-sm font-bold text-gray-900">No Subcategories Created Yet</h3>
          {rootDepartments.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowAddForm(true);
                setParentId(Number(rootDepartments[0].id));
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-black text-white hover:bg-purple-500 transition shadow-sm cursor-pointer"
            >
              <Plus size={15} /> Add First Subcategory
            </button>
          )}
        </div>
      ) : departmentSubcategories.length === 0 ? (
        <div className="rounded-3xl border border-gray-200 bg-white p-8 text-center space-y-3 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-50 text-purple-600">
            <FolderTree size={22} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-800">
              No subcategories in "{currentFilterDept?.name}"
            </h4>
            <p className="text-xs text-gray-500 mt-0.5">
              Create subcategories to organize products inside this department.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowAddForm(true);
              setParentId(Number(currentFilterDept?.id || rootDepartments[0]?.id));
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-black text-white hover:bg-purple-500 transition shadow-sm cursor-pointer"
          >
            <Plus size={14} /> Add Subcategory in {currentFilterDept?.name}
          </button>
        </div>
      ) : filteredSubcategories.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center space-y-2">
          <p className="text-xs font-bold text-gray-700">No matching subcategories found in this department.</p>
          <p className="text-[11px] text-gray-400">Try adjusting your search query.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredSubcategories.map((sub) => {
            const imgUrl = getCategoryImageUrl(sub);
            return (
              <div
                key={sub.id}
                className="group flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-3.5 shadow-xs hover:border-purple-300 hover:shadow-sm transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-gray-100 bg-gray-50 flex items-center justify-center p-1">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={sub.name}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-lg bg-purple-50 text-purple-700 font-black text-sm uppercase">
                        {sub.name?.charAt(0) || "S"}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-black text-gray-900 truncate">
                      {sub.name}
                    </h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        {sub.count ?? 0} products
                      </span>
                      <span className="font-mono text-[10px] text-gray-400">
                        #{sub.id}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenUpdateModal(sub)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50/80 px-3 py-2 text-xs font-black text-purple-700 transition hover:bg-purple-600 hover:text-white cursor-pointer active:scale-95"
                >
                  <Edit3 size={12} />
                  <span>Update</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SECTION 4: UPDATE SUBCATEGORY MODAL                           */}
      {/* ───────────────────────────────────────────────────────────── */}
      {editingSubcategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg rounded-3xl bg-white p-5 sm:p-7 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3.5">
              <div>
                <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                  <Edit3 size={18} className="text-purple-600" />
                  Update Subcategory
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Modifying <span className="font-bold text-gray-800">"{editingSubcategory.name}"</span> (ID #{editingSubcategory.id})
                </p>
              </div>

              <button
                type="button"
                onClick={handleCloseUpdateModal}
                disabled={updating}
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition cursor-pointer disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            {updateError && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-bold text-rose-700">
                <AlertCircle size={16} className="shrink-0 text-rose-600" />
                <span>{updateError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateSubmit} className="space-y-5">
              <input
                type="file"
                ref={updateFileInputRef}
                onChange={handleUpdateImageSelect}
                accept="image/*,image/heic,image/heif"
                className="hidden"
              />

              {/* Subcategory Image */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Subcategory Photo
                </label>

                <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-3.5 sm:p-4 flex flex-col sm:flex-row items-center gap-4">
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-purple-200 bg-white p-1 shadow-sm flex items-center justify-center">
                    {updateImagePreview ? (
                      <img
                        src={updateImagePreview}
                        alt="New Preview"
                        className="h-full w-full object-contain"
                      />
                    ) : getCategoryImageUrl(editingSubcategory) ? (
                      <img
                        src={getCategoryImageUrl(editingSubcategory)}
                        alt={editingSubcategory.name}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-purple-50 text-purple-700 font-black text-2xl uppercase">
                        {editingSubcategory.name?.charAt(0) || "S"}
                      </div>
                    )}
                    {updateImagePreview && (
                      <div className="absolute top-1 right-1 bg-emerald-500 text-white rounded-full p-0.5 shadow-xs">
                        <Check size={12} />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 text-center sm:text-left flex-1">
                    <p className="text-xs font-bold text-gray-800">
                      {updateImagePreview ? "New Photo Selected" : "Current Subcategory Photo"}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {updateImagePreview
                        ? updateImageFile?.name
                        : "Upload a fresh image to update across storefront."}
                    </p>
                    <div className="flex items-center gap-2 pt-1 justify-center sm:justify-start">
                      <button
                        type="button"
                        onClick={() => updateFileInputRef.current?.click()}
                        disabled={updating}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 hover:border-purple-400 transition shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw size={13} />
                        Change Photo
                      </button>
                      {updateImagePreview && (
                        <button
                          type="button"
                          onClick={() => {
                            if (updateImagePreview.startsWith("blob:")) URL.revokeObjectURL(updateImagePreview);
                            setUpdateImageFile(null);
                            setUpdateImagePreview("");
                          }}
                          disabled={updating}
                          className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                        >
                          <X size={13} /> Revert
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Parent Department Selector */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Parent Department <span className="text-rose-500">*</span>
                </label>

                <div className="relative" ref={updateDropdownRef}>
                  <button
                    type="button"
                    disabled={updating}
                    onClick={() => setUpdateDropdownOpen((prev) => !prev)}
                    className="w-full flex items-center justify-between gap-3 rounded-2xl border-2 border-purple-200 bg-white p-2.5 sm:p-3 text-left shadow-xs transition hover:border-purple-400 focus:ring-2 focus:ring-purple-500/20 active:scale-[0.99] cursor-pointer disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-purple-100 bg-purple-50 flex items-center justify-center p-0.5">
                        {selectedUpdateParent && getCategoryImageUrl(selectedUpdateParent) ? (
                          <img
                            src={getCategoryImageUrl(selectedUpdateParent)}
                            alt={selectedUpdateParent.name}
                            className="h-full w-full object-contain rounded-lg"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center rounded-lg bg-purple-100 text-purple-700 font-black text-sm uppercase">
                            {selectedUpdateParent?.name?.charAt(0) || "D"}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-black text-gray-900 truncate">
                          {selectedUpdateParent?.name || "Choose Department"}
                        </p>
                        <p className="text-[11px] text-purple-700 font-semibold truncate">
                          {selectedUpdateParent
                            ? `Department #${selectedUpdateParent.id} • ${selectedUpdateParent.count ?? 0} products`
                            : "Tap to change parent department"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 pl-1">
                      <span className="text-[11px] font-bold text-purple-700 hidden sm:inline">
                        {updateDropdownOpen ? "Close" : "Change"}
                      </span>
                      <div
                        className={`p-1.5 rounded-xl transition-all duration-200 ${
                          updateDropdownOpen ? "rotate-180 bg-purple-100 text-purple-800" : "bg-purple-50 text-purple-600"
                        }`}
                      >
                        <ChevronDown size={15} />
                      </div>
                    </div>
                  </button>

                  {/* Floating Options Menu */}
                  {updateDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150">
                      {eligibleUpdateParents.length > 4 && (
                        <div className="p-2.5 border-b border-gray-100 bg-gray-50/80">
                          <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="text"
                              value={updateSearchQuery}
                              onChange={(e) => setUpdateSearchQuery(e.target.value)}
                              placeholder="Search departments..."
                              className="w-full pl-8.5 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
                              autoFocus
                            />
                          </div>
                        </div>
                      )}

                      <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 overscroll-contain">
                        {filteredUpdateParents.length === 0 ? (
                          <div className="p-5 text-center text-xs text-gray-500">
                            No matching departments found.
                          </div>
                        ) : (
                          filteredUpdateParents.map((c) => {
                            const isSelected = Number(c.id) === Number(updateParentId);
                            const imgUrl = getCategoryImageUrl(c);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setUpdateParentId(Number(c.id));
                                  setUpdateDropdownOpen(false);
                                  setUpdateSearchQuery("");
                                }}
                                className={`w-full flex items-center justify-between gap-3 p-3 text-left transition cursor-pointer active:scale-[0.99] ${
                                  isSelected ? "bg-purple-50/90 hover:bg-purple-50" : "hover:bg-gray-50"
                                }`}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white flex items-center justify-center p-0.5 shadow-2xs">
                                    {imgUrl ? (
                                      <img src={imgUrl} alt={c.name} className="h-full w-full object-contain rounded-lg" />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center rounded-lg bg-purple-50 text-purple-700 font-bold text-xs uppercase">
                                        {c.name?.charAt(0) || "D"}
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className={`text-xs sm:text-sm font-bold truncate ${isSelected ? "text-purple-950 font-black" : "text-gray-900"}`}>
                                      {c.name}
                                    </p>
                                    <p className="text-[11px] text-gray-500 truncate">
                                      Department #{c.id} • {c.count ?? 0} products
                                    </p>
                                  </div>
                                </div>

                                {isSelected && (
                                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white shadow-xs">
                                    <Check size={12} strokeWidth={3} />
                                  </div>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Subcategory Name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Subcategory Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={updateName}
                  onChange={(e) => {
                    setUpdateName(e.target.value);
                    if (updateError) setUpdateError("");
                  }}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-xs font-medium text-gray-900 outline-none focus:border-purple-500 focus:bg-white focus:ring-2 focus:ring-purple-500/20 transition"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handleCloseUpdateModal}
                  disabled={updating}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 transition shadow-xs cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={updating}
                  className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2 text-xs font-extrabold text-white shadow-sm hover:bg-purple-500 transition active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {updating ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>{updateStatusText || "Saving Changes..."}</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Subcategories;
