import { useState, useRef, useEffect, useMemo } from "react";
import {
  Edit3,
  X,
  AlertCircle,
  Check,
  RefreshCw,
  Loader2,
  Folder,
  FolderTree,
  ChevronDown,
  Search,
} from "lucide-react";
import { getCategoryImageUrl } from "../../utils/categoryImage.js";
import { compressImage, CATEGORY_MAX_DIMENSION } from "../../utils/imageCompressor.js";

function UpdateCategoryModal({
  editingCategory,
  updateName,
  setUpdateName,
  updateParentId = 0,
  setUpdateParentId,
  categories = [],
  updateImageFile,
  updateImagePreview,
  updateFileInputRef,
  onUpdateImageSelect,
  onCancelNewImage,
  updating,
  updateStatusText,
  updateError,
  setUpdateError,
  onClose,
  onSubmit,
}) {
  // Prevent circular hierarchy: collect all descendant IDs of this category
  const descendants = useMemo(() => {
    if (!editingCategory || !Array.isArray(categories)) return new Set();
    const targetId = Number(editingCategory.id);
    const childrenMap = new Map();
    for (const c of categories) {
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
    return desc;
  }, [editingCategory, categories]);

  // Eligible parents: Not itself, not its descendants, and not system uncategorized
  const hasChildren = useMemo(
    () => !!editingCategory && Array.isArray(categories) && categories.some((c) => Number(c.parent) === Number(editingCategory.id)),
    [editingCategory, categories]
  );

  const eligibleParents = useMemo(() => {
    if (!editingCategory || !Array.isArray(categories) || hasChildren) return [];
    return categories.filter(
      (c) =>
        c &&
        (!c.parent || Number(c.parent) === 0) &&
        Number(c.id) !== Number(editingCategory.id) &&
        !descendants.has(Number(c.id)) &&
        c.slug?.toLowerCase() !== "uncategorized" &&
        c.name?.toLowerCase() !== "uncategorized"
    );
  }, [categories, editingCategory, descendants, hasChildren]);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef(null);

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

  const filteredParents = useMemo(() => {
    if (!searchQuery.trim()) return eligibleParents;
    const q = searchQuery.toLowerCase().trim();
    return eligibleParents.filter((c) =>
      (c.name || "").toLowerCase().includes(q) || String(c.id).includes(q)
    );
  }, [eligibleParents, searchQuery]);

  const selectedParent = useMemo(() => {
    if (!updateParentId || Number(updateParentId) === 0) return null;
    return eligibleParents.find((c) => Number(c.id) === Number(updateParentId)) || null;
  }, [eligibleParents, updateParentId]);

  useEffect(() => {
    if (!editingCategory) {
      setDropdownOpen(false);
      setSearchQuery("");
    }
  }, [editingCategory]);

  if (!editingCategory) return null;

  const nameChanged = updateName.trim() !== (editingCategory.name || "").trim();
  const imageChanged = !!updateImageFile;
  const parentChanged = (Number(updateParentId) || 0) !== (Number(editingCategory.parent) || 0);
  const canSubmit = !updating && (nameChanged || imageChanged || parentChanged);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-5 sm:p-7 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3.5">
          <div>
            <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
              <Edit3 size={18} className="text-emerald-600" />
              Update Category
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Modifying <span className="font-bold text-gray-800">"{editingCategory.name}"</span> (WooCommerce ID #{editingCategory.id})
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
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

        <form onSubmit={onSubmit} className="space-y-5">
          <input
            type="file"
            ref={updateFileInputRef}
            onChange={onUpdateImageSelect}
            accept="image/*,image/heic,image/heif"
            className="hidden"
          />

          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
              Category Image
            </label>

            <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-3.5 sm:p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="relative h-20 w-20 sm:h-24 sm:w-24 shrink-0 overflow-hidden rounded-2xl border-2 border-emerald-200 bg-white p-1 shadow-sm flex items-center justify-center">
                {updateImagePreview ? (
                  <img
                    src={updateImagePreview}
                    alt="New Preview"
                    className="h-full w-full object-contain"
                  />
                ) : getCategoryImageUrl(editingCategory) ? (
                  <img
                    src={getCategoryImageUrl(editingCategory)}
                    alt={editingCategory.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-purple-50 text-[#7C3AED] font-black text-2xl uppercase">
                    {editingCategory.name?.charAt(0) || "C"}
                  </div>
                )}

                {updateImagePreview && (
                  <div className="absolute top-1 right-1 bg-emerald-500 text-white rounded-full p-0.5 shadow-xs" title="New image ready">
                    <Check size={12} />
                  </div>
                )}
              </div>

              <div className="space-y-2 text-center sm:text-left flex-1">
                <p className="text-xs font-bold text-gray-800">
                  {updateImagePreview ? "New Photo Selected" : "Current Category Photo"}
                </p>
                <p className="text-[11px] text-gray-400">
                  {updateImagePreview
                    ? updateImageFile?.name
                    : "Upload a fresh image to update this category across storefront."}
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1 justify-center sm:justify-start">
                  <button
                    type="button"
                    onClick={() => updateFileInputRef.current?.click()}
                    disabled={updating}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 hover:border-emerald-400 transition shadow-2xs cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw size={13} />
                    Change Image
                  </button>

                  {updateImagePreview && (
                    <button
                      type="button"
                      onClick={onCancelNewImage}
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

          {/* Category Level Switch */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-gray-800 uppercase tracking-wider">
                Category Type <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] font-semibold text-gray-500">
                {!updateParentId || Number(updateParentId) === 0 ? "Top-level department" : "Subcategory"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option 1: Top-Level Department */}
              <button
                type="button"
                disabled={updating}
                onClick={() => {
                  setUpdateParentId && setUpdateParentId(0);
                  setDropdownOpen(false);
                }}
                className={`group relative flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all cursor-pointer text-left active:scale-[0.98] disabled:opacity-50 ${
                  !updateParentId || Number(updateParentId) === 0
                    ? "border-emerald-500 bg-emerald-50/70 shadow-xs ring-2 ring-emerald-500/10"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/70"
                }`}
              >
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    !updateParentId || Number(updateParentId) === 0
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-gray-100 text-gray-500 group-hover:bg-gray-200/80"
                  }`}
                >
                  <Folder size={20} />
                </div>
                <div className="flex-1 min-w-0 pr-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs sm:text-sm font-black text-gray-900 truncate">
                      Main Department
                    </span>
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
                        !updateParentId || Number(updateParentId) === 0
                          ? "border-emerald-600 bg-emerald-600 text-white shadow-2xs"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {(!updateParentId || Number(updateParentId) === 0) && <Check size={10} strokeWidth={3} />}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">
                    Promote to top-level
                  </p>
                </div>
              </button>

              {/* Option 2: Subcategory */}
              <button
                type="button"
                disabled={updating || hasChildren || eligibleParents.length === 0}
                onClick={() => {
                  if (!updateParentId || Number(updateParentId) === 0) {
                    const first = eligibleParents[0];
                    setUpdateParentId && setUpdateParentId(first ? Number(first.id) : 0);
                  }
                }}
                title={hasChildren ? "A department with subcategories must stay at the top level." : undefined}
                className={`group relative flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all cursor-pointer text-left active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
                  updateParentId && Number(updateParentId) > 0
                    ? "border-purple-500 bg-purple-50/70 shadow-xs ring-2 ring-purple-500/10"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/70"
                }`}
              >
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    updateParentId && Number(updateParentId) > 0
                      ? "bg-purple-600 text-white shadow-sm"
                      : "bg-gray-100 text-gray-500 group-hover:bg-gray-200/80"
                  }`}
                >
                  <FolderTree size={20} />
                </div>
                <div className="flex-1 min-w-0 pr-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs sm:text-sm font-black text-gray-900 truncate">
                      Subcategory
                    </span>
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
                        updateParentId && Number(updateParentId) > 0
                          ? "border-purple-600 bg-purple-600 text-white shadow-2xs"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {updateParentId && Number(updateParentId) > 0 && <Check size={10} strokeWidth={3} />}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">
                    {hasChildren ? "Departments with subcategories stay top-level" : "Nest under a top-level department"}
                  </p>
                </div>
              </button>
            </div>

            {/* When Subcategory is selected: Custom Dropdown */}
            {updateParentId && Number(updateParentId) > 0 ? (
              <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-3.5 sm:p-4 space-y-2.5 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-purple-950 uppercase tracking-wider">
                    Parent Department <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] font-bold text-purple-800 bg-purple-100/90 px-2 py-0.5 rounded-full border border-purple-200">
                    Choose Department
                  </span>
                </div>

                {eligibleParents.length === 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    No eligible parent categories available. (Circular loops are blocked).
                  </div>
                ) : (
                  <div className="relative" ref={dropdownRef}>
                    <button
                      type="button"
                      disabled={updating}
                      onClick={() => setDropdownOpen((prev) => !prev)}
                      aria-haspopup="listbox"
                      aria-expanded={dropdownOpen}
                      className="w-full flex items-center justify-between gap-3 rounded-2xl border-2 border-purple-300 bg-white p-2.5 sm:p-3 text-left shadow-xs transition hover:border-purple-400 hover:shadow-sm focus:ring-2 focus:ring-purple-500/20 active:scale-[0.99] cursor-pointer disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-purple-100 bg-purple-50 flex items-center justify-center p-0.5">
                          {selectedParent && getCategoryImageUrl(selectedParent) ? (
                            <img
                              src={getCategoryImageUrl(selectedParent)}
                              alt={selectedParent.name}
                              className="h-full w-full object-contain rounded-lg"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center rounded-lg bg-purple-100 text-purple-700 font-black text-sm uppercase">
                              {selectedParent?.name?.charAt(0) || "D"}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs sm:text-sm font-black text-gray-900 truncate">
                            {selectedParent?.name || "Choose a Department"}
                          </p>
                          <p className="text-[11px] text-purple-700 font-semibold truncate">
                            {selectedParent
                              ? `Department #${selectedParent.id} • ${selectedParent.count ?? 0} products`
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

                    {/* Floating Dropdown List */}
                    {dropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150">
                        {eligibleParents.length > 4 && (
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
                          {filteredParents.length === 0 ? (
                            <div className="p-5 text-center text-xs text-gray-500">
                              No matching departments found.
                            </div>
                          ) : (
                            filteredParents.map((c) => {
                              const isSelected = Number(c.id) === Number(updateParentId);
                              const imgUrl = getCategoryImageUrl(c);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    setUpdateParentId && setUpdateParentId(Number(c.id));
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
                  Descendants are hidden automatically to prevent circular loops.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-2.5 text-[11px] text-emerald-800 flex items-center gap-2">
                <Folder size={14} className="shrink-0 text-emerald-600" />
                <span>Promotes this category to a top-level department on your storefront.</span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
              Category Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={updateName}
              onChange={(e) => {
                setUpdateName(e.target.value);
                if (updateError && setUpdateError) setUpdateError("");
              }}
              placeholder="e.g. Art & Artists"
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
            />
            <p className="text-[11px] text-gray-400">
              Renaming preserves WooCommerce ID #{editingCategory.id} and all assigned products.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={updating}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-500 transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {updating ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>{updateStatusText || "Updating category..."}</span>
                </>
              ) : (
                <>
                  <Check size={15} />
                  Update Category
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UpdateCategoryModal;
