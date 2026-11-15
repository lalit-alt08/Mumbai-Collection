import {
  Edit3,
  X,
  AlertCircle,
  RefreshCw,
  Check,
  ChevronDown,
  Search,
  Loader2,
} from "lucide-react";
import { getCategoryImageUrl } from "../../utils/categoryImage.js";

export function UpdateSubcategoryModal({
  editingSubcategory,
  onClose,
  updateError,
  setUpdateError,
  updateName,
  setUpdateName,
  updateParentId,
  setUpdateParentId,
  updateImagePreview,
  setUpdateImagePreview,
  updateImageFile,
  setUpdateImageFile,
  updateFileInputRef,
  handleUpdateImageSelect,
  selectedUpdateParent,
  updateDropdownOpen,
  setUpdateDropdownOpen,
  updateDropdownRef,
  updateSearchQuery,
  setUpdateSearchQuery,
  eligibleUpdateParents,
  filteredUpdateParents,
  handleUpdateSubmit,
  updating,
  updateStatusText,
}) {
  if (!editingSubcategory) return null;

  return (
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
              onClick={onClose}
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
  );
}
