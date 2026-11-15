import { X, Loader2, Check } from "lucide-react";
import { calculateStockStep } from "../../utils/productAdjuster.js";

export function ProductQuickAdjustModal({
  product,
  onClose,
  adjustForm,
  setAdjustForm,
  onSave,
  saving,
}) {
  if (!product) return null;

  const imgSrc =
    product.image ||
    product.images?.[0]?.src ||
    "https://placehold.co/44x44?text=Item";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 sm:p-6 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
        {/* Mobile Pull Handle */}
        <div className="mx-auto w-12 h-1.5 bg-gray-200 rounded-full mb-3 sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={imgSrc}
              alt={product.name}
              className="h-11 w-11 rounded-xl object-cover border border-gray-200 shrink-0"
            />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-900 truncate">{product.name}</h3>
              <p className="text-[11px] font-mono text-gray-400">{product.sku || `#${product.id}`}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-9 w-9 inline-flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer disabled:opacity-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div className="mt-4 space-y-4">
          {/* Stock Quantity */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Stock Quantity (Units)
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setAdjustForm((prev) => ({
                    ...prev,
                    stock_quantity: calculateStockStep(prev.stock_quantity, -1),
                  }))
                }
                className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-xl border border-gray-200 bg-gray-50 text-gray-700 font-bold text-lg hover:bg-gray-100 flex items-center justify-center transition cursor-pointer active:scale-95"
                aria-label="Decrease stock by 1"
              >
                -
              </button>
              <input
                type="number"
                min="0"
                step="1"
                value={adjustForm.stock_quantity}
                onChange={(e) =>
                  setAdjustForm({ ...adjustForm, stock_quantity: e.target.value })
                }
                className="flex-1 min-h-[44px] rounded-xl border border-gray-200 px-3 text-center text-base font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
              <button
                type="button"
                onClick={() =>
                  setAdjustForm((prev) => ({
                    ...prev,
                    stock_quantity: calculateStockStep(prev.stock_quantity, 1),
                  }))
                }
                className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-xl border border-gray-200 bg-gray-50 text-gray-700 font-bold text-lg hover:bg-gray-100 flex items-center justify-center transition cursor-pointer active:scale-95"
                aria-label="Increase stock by 1"
              >
                +
              </button>
            </div>
          </div>

          {/* Regular Price & Sale Price Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Regular Price (₹)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={adjustForm.regular_price}
                  onChange={(e) =>
                    setAdjustForm({ ...adjustForm, regular_price: e.target.value })
                  }
                  placeholder="0"
                  className="w-full min-h-[44px] rounded-xl border border-gray-200 pl-8 pr-4 text-sm font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Sale Price (₹)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={adjustForm.sale_price}
                  onChange={(e) =>
                    setAdjustForm({ ...adjustForm, sale_price: e.target.value })
                  }
                  placeholder="Optional"
                  className="w-full min-h-[44px] rounded-xl border border-gray-200 pl-8 pr-4 text-sm font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50 active:scale-[0.98]"
            >
              {saving ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check size={15} />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
