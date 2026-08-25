import {
  Edit3,
  X,
  AlertCircle,
  Check,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { getCategoryImageUrl } from "../../utils/categoryImage.js";

function UpdateCategoryModal({
  editingCategory,
  updateName,
  setUpdateName,
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
  if (!editingCategory) return null;

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
            accept="image/jpeg,image/png,image/webp,image/gif"
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
              disabled={updating || (!updateImageFile && updateName.trim() === editingCategory.name)}
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
