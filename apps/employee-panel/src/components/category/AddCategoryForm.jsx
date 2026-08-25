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
} from "lucide-react";

function AddCategoryForm({
  show,
  onClose,
  name,
  setName,
  description,
  setDescription,
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
              to="/products/add"
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

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Description (Optional)
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of items included in this category..."
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-3 text-xs font-medium text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition leading-relaxed"
                />
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
                accept="image/jpeg,image/png,image/webp,image/gif"
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
                  <p className="text-[10px] text-gray-400 mt-0.5">JPG, PNG, WebP up to 10MB</p>
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
