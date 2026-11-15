import { X, Camera, Image as ImageIcon, Loader2, Check } from "lucide-react";

export function ProductAddModal({
  isOpen,
  onClose,
  onSubmit,
  newProduct,
  setNewProduct,
  creating,
  productDepartments,
  productSubcategories,
  categoriesLoading,
  categoriesError,
  setCategoriesRetryCount,
  galleryInputRef,
  cameraInputRef,
  handleImageFileChange,
  imagePreview,
  clearImagePreview,
  uploadingImage,
  uploadProgress,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-8 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-lg font-black text-gray-900">Add In-Store Product</h3>
            <p className="text-xs text-gray-500">
              Register new shelf item directly to Mumbai Collection catalog
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              Product Title *
            </label>
            <input
              type="text"
              required
              value={newProduct.name}
              onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
              placeholder="e.g. Traditional Bandhani Saree"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Regular Price (₹) *
              </label>
              <input
                type="number"
                required
                min="0"
                step="1"
                value={newProduct.regular_price}
                onChange={(e) => setNewProduct({ ...newProduct, regular_price: e.target.value })}
                placeholder="999"
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Sale Price (₹)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={newProduct.sale_price}
                onChange={(e) => setNewProduct({ ...newProduct, sale_price: e.target.value })}
                placeholder="Optional"
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              Initial Stock Units
            </label>
            <input
              type="number"
              min="0"
              value={newProduct.stock_quantity}
              onChange={(e) =>
                setNewProduct({ ...newProduct, stock_quantity: Number(e.target.value) })
              }
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
            />
          </div>

          <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
            <div>
              <label htmlFor="quick-product-department" className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Product Department *
              </label>
              <select
                id="quick-product-department"
                required
                value={newProduct.department_id}
                disabled={categoriesLoading || productDepartments.length === 0}
                onChange={(event) => setNewProduct({
                  ...newProduct,
                  department_id: event.target.value,
                  subcategory_id: "",
                })}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-gray-100"
              >
                <option value="">{categoriesLoading ? "Loading departments…" : "Choose a department"}</option>
                {productDepartments.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="quick-product-subcategory" className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Product Subcategory <span className="font-medium normal-case text-gray-400">(Optional)</span>
              </label>
              <select
                id="quick-product-subcategory"
                value={newProduct.subcategory_id}
                disabled={!newProduct.department_id || productSubcategories.length === 0}
                onChange={(event) => setNewProduct({ ...newProduct, subcategory_id: event.target.value })}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-gray-100"
              >
                <option value="">
                  {!newProduct.department_id
                    ? "Choose a department first"
                    : productSubcategories.length
                      ? "No subcategory — use department"
                      : "No subcategories for this department"}
                </option>
                {productSubcategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            {categoriesError && (
              <div className="flex items-center justify-between gap-2 text-[11px] text-rose-700">
                <span role="alert">{categoriesError}</span>
                <button
                  type="button"
                  onClick={() => setCategoriesRetryCount((count) => count + 1)}
                  disabled={categoriesLoading}
                  className="shrink-0 font-bold underline disabled:opacity-50"
                >
                  {categoriesLoading ? "Retrying…" : "Retry"}
                </button>
              </div>
            )}
          </div>

          {/* Photo Upload */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Product Image (WordPress Media Upload)
            </label>
            <input
              type="file"
              ref={galleryInputRef}
              onChange={handleImageFileChange}
              accept="image/*,image/heic,image/heif"
              className="hidden"
            />
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleImageFileChange}
              capture="environment"
              accept="image/*,image/heic,image/heif"
              className="hidden"
            />

            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={uploadingImage}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50 shadow-2xs active:scale-95"
              >
                <Camera size={14} />
                Take Photo
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={uploadingImage}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition cursor-pointer disabled:opacity-50 active:scale-95"
              >
                <ImageIcon size={14} />
                From Gallery
              </button>

              {imagePreview && (
                <div className="relative group">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="h-11 w-11 rounded-xl object-cover border border-gray-200 bg-gray-100 shadow-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => clearImagePreview(true)}
                    className="absolute -top-1.5 -right-1.5 bg-black/70 hover:bg-rose-600 text-white rounded-full p-0.5 transition cursor-pointer shadow-xs"
                    title={uploadingImage ? "Cancel upload" : "Remove image"}
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
            </div>

            {uploadingImage && (
              <div className="mt-2.5 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
                  <span className="flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin text-emerald-600" />
                    Uploading to Media Library...
                  </span>
                  <span className="font-bold text-gray-700">{uploadProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-150 rounded-full"
                    style={{ width: `${Math.max(5, uploadProgress)}%` }}
                  />
                </div>
              </div>
            )}

            {!uploadingImage && newProduct.image_url && (
              <p className="mt-1.5 text-[11px] text-emerald-600 font-medium truncate">
                ✓ Uploaded: {newProduct.image_url}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || uploadingImage}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Create Product
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
