import { useState, useEffect } from "react";
import { ShoppingBag, Loader2, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { getCatalogImageUrl, PRODUCT_PLACEHOLDER_URL } from "../../utils/imageUtils";

function SharedCartModal({
  isOpen,
  onClose,
  sharedItems = [],
  catalogProducts = [],
  loading = false,
  error = "",
  onAddToCart,
  hasExistingCart = false,
  existingCartCount = 0,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");

  // Lock background scroll when modal open
  useEffect(() => {
    if (!isOpen) return;
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = origOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirmAdd = async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      setActionSuccess("");
      await onAddToCart({ replace: replaceExisting });
      setActionSuccess("Items added to your cart!");
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch {
      // error handled in caller
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shared-cart-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        onClick={() => {
          if (!submitting) onClose();
        }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity animate-[fadeIn_0.2s_ease-out]"
      />

      {/* Modal Container */}
      <div className="relative z-10 w-full max-w-[500px] overflow-hidden rounded-[26px] border border-gray-100 bg-white p-5 shadow-[0_25px_65px_rgba(0,0,0,0.18)] animate-[scaleUp_0.2s_ease-out] sm:p-7 max-h-[90vh] flex flex-col">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close modal"
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 cursor-pointer"
        >
          <X size={20} />
        </button>

        {/* Icon & Title */}
        <div className="flex items-center gap-3.5 pb-3 border-b border-gray-100">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20">
            <ShoppingBag size={24} />
          </div>
          <div>
            <h3
              id="shared-cart-title"
              className="text-lg font-black tracking-tight text-[#1F2937] sm:text-xl"
            >
              Shared Cart
            </h3>
            <p className="text-xs text-gray-500 font-medium">
              Someone shared {sharedItems.length} item{sharedItems.length === 1 ? "" : "s"} with you
            </p>
          </div>
        </div>

        {/* Feedback / Error notifications */}
        {error && (
          <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-600 border border-red-200 flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {actionSuccess && (
          <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 border border-emerald-200 flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Items List (Validated from live catalog) */}
        <div className="my-4 flex-1 overflow-y-auto space-y-2.5 pr-1">
          {loading ? (
            <div className="py-12 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
              <Loader2 size={24} className="animate-spin text-[#7C3AED]" />
              <span>Verifying product availability...</span>
            </div>
          ) : catalogProducts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center bg-gray-50">
              <p className="text-xs font-bold text-gray-700">No items available</p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                The shared items may have been discontinued or are currently out of stock.
              </p>
            </div>
          ) : (
            catalogProducts.map(({ product, quantity, isAvailable, outOfStockMessage, variation }) => {
              const livePrice = Number(product.price || product.regular_price || 0);

              return (
                <div
                  key={product.id + (variation && variation.length ? JSON.stringify(variation) : "")}
                  className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${
                    isAvailable
                      ? "border-gray-100 bg-[#FAFBFD]"
                      : "border-amber-200 bg-amber-50/50 opacity-70"
                  }`}
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white p-1">
                    <img
                      src={getCatalogImageUrl(product)}
                      alt={product.name}
                      className="h-full w-full object-contain"
                      onError={(e) => {
                        if (e.currentTarget.getAttribute("data-fallback") !== "true") {
                          e.currentTarget.setAttribute("data-fallback", "true");
                          e.currentTarget.src = PRODUCT_PLACEHOLDER_URL;
                        }
                      }}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-[#1F2937] truncate">
                      {product.name}
                    </h4>
                    {/* Variation Attributes Badge */}
                    {Array.isArray(variation) && variation.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {variation.map((v, i) => (
                          <span
                            key={i}
                            className="inline-block rounded-md bg-purple-50 px-1.5 py-0.2 text-[10px] font-semibold text-[#7C3AED] border border-purple-100"
                          >
                            {v.attribute?.replace(/^pa_/, "")}: {v.value}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-extrabold text-[#7C3AED]">
                        ₹{livePrice}
                      </span>
                      <span className="text-[11px] font-medium text-gray-400">
                        Qty: {quantity}
                      </span>
                    </div>
                    {outOfStockMessage && (
                      <p className="text-[10px] font-bold text-amber-600 mt-0.5">
                        {outOfStockMessage}
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Existing Cart Notice & Choice */}
        {hasExistingCart && (
          <div className="mb-4 rounded-xl bg-purple-50/80 border border-[#7C3AED]/20 p-3 text-xs text-gray-700 space-y-2">
            <p className="font-semibold text-purple-950">
              You already have {existingCartCount} item{existingCartCount === 1 ? "" : "s"} in your cart.
            </p>
            <div className="flex flex-col gap-1.5 text-[11px]">
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input
                  type="radio"
                  name="cartAction"
                  checked={!replaceExisting}
                  onChange={() => setReplaceExisting(false)}
                  className="accent-[#7C3AED]"
                />
                <span>Merge with my existing items (Keep both)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input
                  type="radio"
                  name="cartAction"
                  checked={replaceExisting}
                  onChange={() => setReplaceExisting(true)}
                  className="accent-[#7C3AED]"
                />
                <span>Replace my current cart items</span>
              </label>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2.5 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={handleConfirmAdd}
            disabled={submitting || loading || catalogProducts.filter((p) => p.isAvailable).length === 0}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-5 text-xs font-extrabold text-white shadow-md transition hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Adding to Cart...</span>
              </>
            ) : (
              <span>Add Available Items to My Cart</span>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex h-10 w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default SharedCartModal;
