import { Trash2, AlertTriangle, Loader2 } from "lucide-react";

export function ProductDeleteModal({
  product,
  onClose,
  onConfirm,
  deleting,
}) {
  if (!product) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 mb-4">
          <Trash2 size={24} />
        </div>

        <div className="text-center space-y-2">
          <h3 className="text-lg font-black text-gray-900">
            Move Product to Trash?
          </h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            Are you sure you want to move <span className="font-bold text-gray-900">"{product.name}"</span> to Trash?
          </p>

          {product.image && (
            <div className="mx-auto h-16 w-16 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-1 my-2">
              <img
                src={product.image}
                alt={product.name}
                className="h-full w-full object-contain"
              />
            </div>
          )}

          <div className="rounded-2xl bg-rose-50/60 p-3 border border-rose-100 text-left text-[11px] text-rose-700 space-y-1 mt-3">
            <div className="font-bold flex items-center gap-1.5">
              <AlertTriangle size={13} /> Remove From Storefront
            </div>
            <p className="text-rose-600/90 text-[10.5px]">
              This product will disappear from the store catalog, but can still be restored from WooCommerce Trash.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-5 border-t border-gray-100 mt-5">
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onConfirm}
            className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer active:scale-95"
          >
            {deleting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Moving...
              </>
            ) : (
              <>
                <Trash2 size={14} /> Move to Trash
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
