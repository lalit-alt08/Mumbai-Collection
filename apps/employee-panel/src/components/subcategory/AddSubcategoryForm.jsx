import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Plus,
  PackagePlus,
  AlertCircle,
  Search,
  Check,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { getCategoryImageUrl } from "../../utils/categoryImage.js";

export function AddSubcategoryForm({
  createdCategory,
  rootDepartments,
  handleResetCreateForm,
  handleCreateSubmit,
  formError,
  setFormError,
  parentId,
  setParentId,
  selectedAddParent,
  addDropdownOpen,
  setAddDropdownOpen,
  addDropdownRef,
  addSearchQuery,
  setAddSearchQuery,
  filteredAddParents,
  name,
  setName,
  image,
  fileInputRef,
  handleImageSelect,
  handleRemoveImage,
  submitting,
}) {
  if (createdCategory) {
    return (
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
    );
  }

  return (
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
                Please create at least one main Department before creating subcategories.
              </div>
            ) : (
              <div className="relative" ref={addDropdownRef}>
                <button
                  type="button"
                  onClick={() => setAddDropdownOpen((prev) => !prev)}
                  className="w-full flex items-center justify-between gap-3 rounded-2xl border-2 border-purple-200 bg-white p-2.5 sm:p-3 text-left shadow-xs transition hover:border-purple-400 focus:ring-2 focus:ring-purple-500/20 active:scale-[0.99] cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-purple-100 bg-purple-50 flex items-center justify-center p-0.5">
                      {selectedAddParent && getCategoryImageUrl(selectedAddParent) ? (
                        <img
                          src={getCategoryImageUrl(selectedAddParent)}
                          alt={selectedAddParent.name}
                          className="h-full w-full object-contain rounded-lg"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center rounded-lg bg-purple-100 text-purple-700 font-black text-sm uppercase">
                          {selectedAddParent?.name?.charAt(0) || "D"}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-black text-gray-900 truncate">
                        {selectedAddParent?.name || "Choose Department"}
                      </p>
                      <p className="text-[11px] text-purple-700 font-semibold truncate">
                        {selectedAddParent
                          ? `Department #${selectedAddParent.id} • ${selectedAddParent.count ?? 0} products`
                          : "Tap to select parent department"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 pl-1">
                    <span className="text-[11px] font-bold text-purple-700 hidden sm:inline">
                      {addDropdownOpen ? "Close" : "Select"}
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
  );
}
