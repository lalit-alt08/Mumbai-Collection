import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Upload,
  Image as ImageIcon,
  Check,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  PackagePlus,
  RefreshCw,
  ChevronUp,
  Folder,
  ChevronDown,
  Search,
} from "lucide-react";
import { getCategoryImageUrl } from "../../utils/categoryImage.js";
import { compressImage, CATEGORY_MAX_DIMENSION } from "../../utils/imageCompressor.js";

function AddCategoryForm({
  show,
  onClose,
  name,
  setName,
  description,
  setDescription,
  parentId = 0,
  setParentId,
  categories = [],
  image,
  onImageSelect,
  onRemoveImage,
  fileInputRef,
  submitting,
  error,
  setError,
  createdCategory,
  onSubmit,
  onReset,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef(null);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  const eligibleParentCategories = useMemo(() => {
    return (categories || []).filter(
      (c) =>
        c &&
        (!c.parent || Number(c.parent) === 0) &&
        c.slug?.toLowerCase() !== "uncategorized" &&
        c.name?.toLowerCase() !== "uncategorized"
    );
  }, [categories]);

  const filteredParentCategories = useMemo(() => {
    if (!searchQuery.trim()) return eligibleParentCategories;
    const q = searchQuery.toLowerCase().trim();
    return eligibleParentCategories.filter((c) =>
      (c.name || "").toLowerCase().includes(q) || String(c.id).includes(q)
    );
  }, [eligibleParentCategories, searchQuery]);

  const selectedParentCategory = useMemo(() => {
    if (!parentId || Number(parentId) === 0) return null;
    return eligibleParentCategories.find((c) => Number(c.id) === Number(parentId)) || null;
  }, [eligibleParentCategories, parentId]);

  useEffect(() => {
    if (!show) {
      setDropdownOpen(false);
      setSearchQuery("");
    }
  }, [show]);

  if (!show) return null;

  return (
    <div className="space-y-4 rounded-3xl border border-emerald-100 bg-gradient-to-b from-emerald-50/40 to-white p-4 sm:p-7 shadow-xs">
      <div className="flex items-center justify-between border-b border-emerald-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-xs">
            +
          </span>
          <h2 className="text-sm font-black uppercase tracking-wider text-gray-900">
            Add New Category
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xs font-semibold flex items-center gap-1 cursor-pointer"
        >
          <ChevronUp size={16} /> Collapse
        </button>
      </div>

      {createdCategory ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6 text-center space-y-4 shadow-sm animate-in zoom-in-95 duration-200">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-md">
            <CheckCircle2 size={28} />
          </div>

          <div>
            <h3 className="text-base font-black text-gray-900">
              Category Successfully Created!
            </h3>
            <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto">
              <span className="font-bold text-gray-900">"{createdCategory.name}"</span> (ID #{createdCategory.id}, slug: <code className="bg-emerald-100 px-1 py-0.5 rounded text-emerald-800 font-mono">{createdCategory.slug}</code>) has been registered in WooCommerce.
            </p>
          </div>

          {createdCategory.image?.src && (
            <div className="mx-auto h-20 w-20 overflow-hidden rounded-2xl border-2 border-emerald-300 shadow-sm bg-white p-1">
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
              onClick={onReset}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 transition cursor-pointer active:scale-95"
            >
              <Plus size={15} /> Add Another Category
            </button>
            <Link
              to={`/products/add?category_id=${createdCategory.id}`}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition shadow-xs"
            >
              <PackagePlus size={15} /> Add Product to this Category
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          {error && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-bold text-rose-700 animate-in fade-in duration-200">
              <AlertCircle size={16} className="shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
              {/* Parent selector appears only when the top toolbar chose Subcategory. */}
              {parentId && Number(parentId) > 0 ? (
                  <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-3.5 sm:p-4 space-y-2.5 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-black text-purple-950 uppercase tracking-wider">
                        Parent Department <span className="text-rose-500">*</span>
                      </label>
                      <span className="text-[10px] font-bold text-purple-800 bg-purple-100/90 px-2 py-0.5 rounded-full border border-purple-200">
                        Choose Department
                      </span>
                    </div>

                    {eligibleParentCategories.length === 0 ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        No main departments available yet. Please create a main department first.
                      </div>
                    ) : (
                      <div className="relative" ref={dropdownRef}>
                        <button
                          type="button"
                          onClick={() => setDropdownOpen((prev) => !prev)}
                          aria-haspopup="listbox"
                          aria-expanded={dropdownOpen}
                          className="w-full flex items-center justify-between gap-3 rounded-2xl border-2 border-purple-300 bg-white p-2.5 sm:p-3 text-left shadow-xs transition hover:border-purple-400 hover:shadow-sm focus:ring-2 focus:ring-purple-500/20 active:scale-[0.99] cursor-pointer"
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
                              {dropdownOpen ? "Close" : "Change"}
                            </span>
                            <div
                              className={`p-1.5 rounded-xl transition-all duration-200 ${
                                dropdownOpen ? "rotate-180 bg-purple-100 text-purple-800" : "bg-purple-50 text-purple-600"
                              }`}
                            >
                              <ChevronDown size={15} />
                            </div>
                          </div>
                        </button>

                        {/* Floating Polished Dropdown Menu */}
                        {dropdownOpen && (
                          <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150">
                            {eligibleParentCategories.length > 4 && (
                              <div className="p-2.5 border-b border-gray-100 bg-gray-50/80">
                                <div className="relative">
                                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                  <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search departments..."
                                    className="w-full pl-8.5 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
                                    autoFocus
                                  />
                                </div>
                              </div>
                            )}

                            <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 overscroll-contain">
                              {filteredParentCategories.length === 0 ? (
                                <div className="p-5 text-center text-xs text-gray-500">
                                  No matching departments found.
                                </div>
                              ) : (
                                filteredParentCategories.map((c) => {
                                  const isSelected = Number(c.id) === Number(parentId);
                                  const imgUrl = getCategoryImageUrl(c);
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => {
                                        setParentId && setParentId(Number(c.id));
                                        setDropdownOpen(false);
                                        setSearchQuery("");
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

                                      {isSelected ? (
                                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white shadow-xs">
                                          <Check size={12} strokeWidth={3} />
                                        </div>
                                      ) : (
                                        <span className="text-[11px] text-gray-400 font-medium">
                                          Select
                                        </span>
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

                    <p className="text-[11px] text-purple-800">
                      This subcategory will appear inside the selected department on your storefront navigation.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-2.5 text-[11px] text-emerald-800 flex items-center gap-2">
                    <Folder size={14} className="shrink-0 text-emerald-600" />
                    <span>Creates a primary top-level department visible directly on your home page & categories grid.</span>
                  </div>
                )}

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Category Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="e.g. Artist, Sports, Home & Kitchen"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
                />
                <p className="text-[11px] text-gray-400">
                  Canonical department name displayed across storefront and employee forms.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-xs space-y-4 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                  Category Image <span className="text-rose-500">*</span>
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
                onChange={onImageSelect}
                accept="image/*,image/heic,image/heif"
                className="hidden"
              />

              {!image ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 p-5 text-center hover:border-emerald-400 hover:bg-emerald-50/20 transition cursor-pointer min-h-[130px]"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 mb-2">
                    <ImageIcon size={20} />
                  </div>
                  <p className="text-xs font-bold text-gray-700">Click to choose 1 category photo</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">JPG, PNG, WebP (auto-optimized to max 1200px)</p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col justify-between space-y-3">
                  <div className="relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 aspect-video max-h-40 flex items-center justify-center">
                    <img
                      src={image.preview}
                      alt="Category Preview"
                      className="h-full w-full object-contain p-2"
                    />

                    {image.uploading ? (
                      <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white gap-2 text-xs font-bold">
                        <Loader2 size={20} className="animate-spin text-emerald-400" />
                        <span>Uploading to WordPress Media...</span>
                      </div>
                    ) : image.uploaded ? (
                      <div className="absolute top-2 left-2 bg-emerald-500 text-white rounded-full px-2 py-0.5 text-[10px] font-bold shadow-xs flex items-center gap-1">
                        <Check size={10} /> Uploaded (ID #{image.mediaId})
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={onRemoveImage}
                      className="absolute top-2 right-2 bg-black/70 hover:bg-rose-600 text-white rounded-full p-1.5 transition cursor-pointer shadow-xs"
                      title="Remove image"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition cursor-pointer"
                    >
                      <RefreshCw size={12} /> Choose Different Image
                    </button>
                    <span className="text-[10px] text-gray-400">1 image attached</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 transition shadow-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (image && image.uploading)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-500 transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Creating Category...
                </>
              ) : (
                <>
                  <Plus size={15} />
                  Create Category
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default AddCategoryForm;
