import { Minus, Plus } from "lucide-react";
import { getCatalogImageUrl, PRODUCT_PLACEHOLDER_URL } from "../../utils/imageUtils";
import { cleanProductTitle } from "../../utils/productUtils";

function CartItem({ item, updatingKey, onDecrease, onIncrease, onResolveStock }) {
  const price = Number(item.prices?.price) / 100;
  const regularPrice = item.prices?.regular_price
    ? Number(item.prices.regular_price) / 100
    : price;

  const isUpdating = updatingKey === item.key;
  const maxLimit = item.backordersAllowed
    ? 99
    : typeof item.availableStock === "number"
    ? item.availableStock
    : typeof item.quantity_limits?.maximum === "number" ? item.quantity_limits.maximum : 99;
  const isFullyOutOfStock = !item.backordersAllowed && (
    maxLimit === 0 ||
    (typeof item.availableStock !== "number" && (
      item.stock_status === "outofstock" ||
      item.is_in_stock === false ||
      Boolean(item.isOutOfStock)
    ))
  );
  const isQuantityShort = !item.backordersAllowed && maxLimit > 0 && item.quantity > maxLimit;
  const isOutOfStock = isFullyOutOfStock || isQuantityShort;
  const isMaxReached = item.quantity >= maxLimit && maxLimit > 0;

  return (
    <div
      data-stock-issue={isOutOfStock ? "true" : undefined}
      tabIndex={isOutOfStock ? -1 : undefined}
      className={`flex items-center gap-3 rounded-[18px] p-3 shadow-[0_6px_22px_rgba(0,0,0,0.2)] transition-all duration-300 hover:-translate-y-0.5 ${
        isOutOfStock
          ? "cart-item-stock-issue border"
          : "bg-[#FFFFFF] border border-[#E2E8F0]/80 hover:border-[#22499F]/50"
      }`}
    >
      {/* Product Image */}
      <div className="store-product-image flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[15px] border border-[#E2E8F0]/60 bg-[#F0F8E8] p-1.5">
        <img
          src={getCatalogImageUrl(item)}
          alt={item.name || "Cart item"}
          width="72"
          height="72"
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            if (e.currentTarget.getAttribute("data-fallback") !== "true") {
              e.currentTarget.setAttribute("data-fallback", "true");
              e.currentTarget.src = PRODUCT_PLACEHOLDER_URL;
            }
          }}
        />
      </div>

      {/* Product Details */}
      <div className="flex min-h-[72px] min-w-0 flex-1 flex-col justify-between gap-1 py-0.5">
        <div>
          <h2 className="line-clamp-2 text-[14px] font-bold leading-snug text-[#1E293B]">
            {cleanProductTitle(item.name)}
          </h2>
          {isFullyOutOfStock ? (
            <span className="cart-item-sold-out mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-extrabold">
              Sold out
            </span>
          ) : isQuantityShort ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-950/40 px-2 py-0.5 text-[10px] font-extrabold text-amber-300 border border-amber-800/60">
              Only {maxLimit} left
            </span>
          ) : isMaxReached ? (
            <span className="text-[10px] font-bold text-amber-400">
              Max available stock reached
            </span>
          ) : null}
          {isOutOfStock && (
            <button type="button" disabled={isUpdating} onClick={() => onResolveStock(item, isFullyOutOfStock ? 0 : maxLimit)} className="ml-2 text-xs font-bold text-[#22499F] underline disabled:opacity-50">
              {isFullyOutOfStock ? "Remove" : `Change to ${maxLimit}`}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          {/* Price */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[15px] font-bold text-[#1E293B]">
              ₹{price}
            </span>
            {regularPrice > price && (
              <span className="text-[12px] font-medium text-[#64748B] line-through">
                ₹{regularPrice}
              </span>
            )}
          </div>

          {/* Quantity Controls */}
          <div
            className={`flex h-[38px] w-[96px] items-center justify-between rounded-full px-1 shadow-sm flex-shrink-0 select-none transition-colors ${
              isOutOfStock
                ? "bg-rose-700 text-white"
                : "bg-[#22499F] text-[#FFFFFF] shadow-[0_2px_10px_rgba(66,214,232,0.3)]"
            }`}
          >
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => onDecrease(item)}
                aria-label="Decrease quantity"
                title={item.quantity <= 1 ? "Remove item" : "Decrease quantity"}
                className={`relative flex h-8 w-8 items-center justify-center rounded-full active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                  isOutOfStock
                    ? "text-white/90 hover:text-white hover:bg-white/15"
                    : "text-[#FFFFFF] hover:bg-black/15"
                }`}
              >
                <Minus size={17} strokeWidth={2.8} />
              </button>

            <span className="flex-1 text-center text-[14px] font-black leading-none tabular-nums">
              {item.quantity}
            </span>

              <button
                type="button"
                disabled={isUpdating || isMaxReached || isOutOfStock}
                onClick={() => onIncrease(item)}
                aria-label="Increase quantity"
                title={
                  isFullyOutOfStock
                    ? "Item is out of stock"
                    : isQuantityShort || isMaxReached
                    ? `Only ${maxLimit} available in stock`
                    : "Increase quantity"
                }
                className={`relative flex h-8 w-8 items-center justify-center rounded-full active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                  isOutOfStock
                    ? "text-white/90 hover:text-white hover:bg-white/15"
                    : "text-[#FFFFFF] hover:bg-black/15"
                }`}
              >
                <Plus size={17} strokeWidth={2.8} />
              </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CartItem;
