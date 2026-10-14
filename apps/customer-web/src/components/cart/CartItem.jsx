import { Minus, Plus } from "lucide-react";
import { getCatalogImageUrl, PRODUCT_PLACEHOLDER_URL } from "../../utils/imageUtils";
import { cleanProductTitle } from "../../utils/productUtils";

function CartItem({ item, updatingKey, onDecrease, onIncrease }) {
  const price = Number(item.prices?.price) / 100;
  const regularPrice = item.prices?.regular_price
    ? Number(item.prices.regular_price) / 100
    : price;

  const isUpdating = updatingKey === item.key;
  const maxLimit = typeof item.quantity_limits?.maximum === "number" ? item.quantity_limits.maximum : 99;
  const isOutOfStock =
    maxLimit === 0 ||
    item.stock_status === "outofstock" ||
    item.is_in_stock === false ||
    Boolean(item.isOutOfStock);
  const isMaxReached = item.quantity >= maxLimit && maxLimit > 0;

  return (
    <div
      className={`flex items-center gap-3 rounded-[18px] p-3 shadow-[0_6px_22px_rgba(0,0,0,0.045)] transition-all duration-300 hover:shadow-[0_10px_30px_rgba(0,0,0,0.07)] hover:-translate-y-0.5 ${
        isOutOfStock ? "bg-rose-50/20 border border-rose-200" : "bg-white"
      }`}
    >
      {/* Product Image */}
      <div className="flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[15px] border border-[#ECECEC] bg-white p-1.5">
        <img
          src={getCatalogImageUrl(item)}
          alt={item.name || "Cart item"}
          className="h-full w-full object-contain"
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
          <h2 className="line-clamp-2 text-[13px] font-semibold leading-snug text-[#1E1E1E]">
            {cleanProductTitle(item.name)}
          </h2>
          {isOutOfStock ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-extrabold text-rose-700 border border-rose-200">
              ● Out of Stock
            </span>
          ) : isMaxReached ? (
            <span className="text-[10px] font-bold text-amber-700">
              Max available stock reached
            </span>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2">
          {/* Price */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[15px] font-bold text-[#1E1E1E]">
              ₹{price}
            </span>
            {regularPrice > price && (
              <span className="text-[12px] font-medium text-[#71717A] line-through">
                ₹{regularPrice}
              </span>
            )}
          </div>

          {/* Quantity Controls */}
          <div
            className={`flex h-[32px] w-[78px] items-center justify-between rounded-full px-1 text-white shadow-sm flex-shrink-0 select-none transition-colors ${
              isOutOfStock ? "bg-rose-600/90" : "bg-[#7C3AED]"
            }`}
          >
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => onDecrease(item)}
              aria-label="Decrease quantity"
              title={item.quantity <= 1 ? "Remove item" : "Decrease quantity"}
              className="flex h-6 w-6 items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/15 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Minus size={15} strokeWidth={2.5} />
            </button>

            <span className="flex-1 text-center text-[13px] font-bold leading-none tabular-nums">
              {item.quantity}
            </span>

            <button
              type="button"
              disabled={isUpdating || isMaxReached || isOutOfStock}
              onClick={() => onIncrease(item)}
              aria-label="Increase quantity"
              title={
                isOutOfStock
                  ? "Item is out of stock"
                  : isMaxReached
                  ? `Only ${maxLimit} available in stock`
                  : "Increase quantity"
              }
              className="flex h-6 w-6 items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/15 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus size={15} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CartItem;
