import { useEffect } from "react";
import { PackageX, Loader2, ArrowLeft, Trash2 } from "lucide-react";
import { getCatalogImageUrl, PRODUCT_PLACEHOLDER_URL } from "../../utils/imageUtils";
import { cleanProductTitle } from "../../utils/productUtils";

/**
 * Mobile-responsive notification modal displayed during checkout when
 * items in the cart are detected to be out of stock.
 *
 * Replaces the raw inline card error block with an actionable notification.
 */
function StockNotificationModal({
  isOpen,
  onClose,
  items = [],
  cartItems = [],
  onRemoveAndContinue,
  onReturnToCart,
  removing = false,
}) {
  // Lock body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = origOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const shortageCount = Array.isArray(items) ? items.length : 0;
  const hasRemainingItems = Array.isArray(cartItems) && cartItems.some((cartItem) => {
    const affected = items.find((item) =>
      (item?.key && item.key === cartItem.key) ||
      (item?.id && Number(item.id) === Number(cartItem.id)) ||
      (item?.name && item.name === cartItem.name)
    );
    if (!affected) return true;
    return Number(affected.available) > 0;
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-alert-title"
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        onClick={() => {
          if (!removing && typeof onClose === "function") onClose();
        }}
        className="fixed inset-0 bg-black/45 backdrop-blur-xs transition-opacity animate-[fadeIn_0.2s_ease-out]"
      />

      {/* Modal Dialog Card */}
      <div className="relative z-10 w-full max-w-[480px] overflow-hidden rounded-[24px] sm:rounded-[28px] border border-[#1E3252] bg-[#111F36] p-5 sm:p-7 shadow-[0_25px_65px_rgba(0,0,0,0.6)] animate-[scaleUp_0.2s_ease-out] flex flex-col max-h-[90vh]">
        {/* Header with Warning Icon */}
        <div className="flex items-start gap-3.5 mb-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-950/60 text-rose-300 border border-rose-800/60 shadow-xs">
            <PackageX size={22} strokeWidth={2.2} />
          </div>

          <div className="flex-1 min-w-0 pt-0.5">
            <h3
              id="stock-alert-title"
              className="text-[17px] sm:text-[19px] font-black leading-tight text-[#F1F5F9]"
            >
              {shortageCount > 1 ? "Stock Needs Updating" : "Stock Changed"}
            </h3>
            <p className="mt-1 text-xs sm:text-[13px] text-[#8FA4BE] leading-snug">
              {hasRemainingItems
                ? "Some quantities exceed the available stock. Update them and continue with the rest of your order:"
                : "Please review the stock availability for these cart items:"}
            </p>
          </div>
        </div>

        {/* Scrollable list of unavailable items */}
        <div className="my-2 max-h-[240px] overflow-y-auto space-y-2.5 pr-1">
          {items.map((item, idx) => {
            const rawTitle = typeof item === "string" ? item : item?.name || `Product #${item?.id || idx + 1}`;
            const cleanTitle = cleanProductTitle(rawTitle);
            const matchedCartItem = Array.isArray(cartItems)
              ? cartItems.find(
                  (c) =>
                    (item.key && c.key === item.key) ||
                    (item.id && Number(c.id) === Number(item.id)) ||
                    c.name === rawTitle ||
                    c.name === cleanTitle
                )
              : null;

            const imageUrl = matchedCartItem ? getCatalogImageUrl(matchedCartItem) : PRODUCT_PLACEHOLDER_URL;
            const requested = item.requested || matchedCartItem?.quantity || 1;
            const available = typeof item.available === "number" ? item.available : 0;

            return (
              <div
                key={item.key || item.id || idx}
                className="flex items-center gap-3 rounded-2xl border border-rose-800/60 bg-rose-950/30 p-2.5 sm:p-3 transition-colors"
              >
                {/* Thumbnail */}
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#1E3252]/60 bg-[#080F1C] p-1">
                  <img
                    src={imageUrl}
                    alt={cleanTitle}
                    className="h-full w-full object-contain"
                    onError={(e) => {
                      if (e.currentTarget.getAttribute("data-fallback") !== "true") {
                        e.currentTarget.setAttribute("data-fallback", "true");
                        e.currentTarget.src = PRODUCT_PLACEHOLDER_URL;
                      }
                    }}
                  />
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <h4 className="line-clamp-2 text-xs sm:text-[13px] font-bold text-[#F1F5F9] leading-snug">
                    {cleanTitle}
                  </h4>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-950/60 border border-rose-800/60 px-2 py-0.5 text-[10px] font-extrabold text-rose-300">
                      {available > 0 ? "Limited Stock" : "Sold Out"}
                    </span>
                    <span className="text-[11px] text-[#8FA4BE] font-medium">
                      Qty in cart: {requested}
                      {available > 0 ? ` (Only ${available} available)` : ""}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="mt-5 flex flex-col gap-2.5 pt-2 border-t border-[#1E3252]/70">
          {hasRemainingItems ? (
            <button
              type="button"
              disabled={removing}
              onClick={onRemoveAndContinue}
              className="flex h-[46px] sm:h-[48px] w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl bg-[#42D6E8] px-4 text-xs sm:text-sm font-black text-[#061220] shadow-[0_4px_16px_rgba(66,214,232,0.3)] transition-all hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {removing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Updating your cart...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
              Update Cart & Continue
                </>
              )}
            </button>
          ) : null}

          <button
            type="button"
            disabled={removing}
            onClick={onReturnToCart}
            className={`flex h-[44px] w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl border border-[#1E3252] bg-transparent px-4 text-xs sm:text-sm font-bold text-[#8FA4BE] transition-all hover:bg-[#162744] active:scale-[0.98] cursor-pointer ${
              !hasRemainingItems ? "bg-[#42D6E8] text-[#061220] font-black border-transparent hover:bg-[#2CC4D8] hover:text-[#061220]" : ""
            }`}
          >
            <ArrowLeft size={16} />
            {hasRemainingItems ? "Return to Cart" : "Return to Cart to Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default StockNotificationModal;
