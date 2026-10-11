import { Minus, Plus } from "lucide-react";
import { getCatalogImageUrl, PRODUCT_PLACEHOLDER_URL } from "../../utils/imageUtils";

function CartItem({ item, updatingKey, onDecrease, onIncrease }) {
  const price = Number(item.prices?.price) / 100;
  const regularPrice = item.prices?.regular_price
    ? Number(item.prices.regular_price) / 100
    : price;

  const isUpdating = updatingKey === item.key;
  const maxLimit = item.quantity_limits?.maximum || 99;
  const isMaxReached = item.quantity >= maxLimit;

  return (
    <div className="flex items-center gap-4 rounded-[22px] bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-0.5">
      {/* Product Image */}
      <div className="flex h-[90px] w-[90px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-[#ECECEC] bg-white p-1.5">
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
      <div className="flex flex-1 flex-col justify-between py-0.5 min-h-[90px] gap-1.5">
        <div>
          <h2 className="line-clamp-2 text-[14px] font-semibold leading-snug text-[#1E1E1E]">
            {item.name}
          </h2>
          {isMaxReached && (
            <span className="text-[10px] font-bold text-amber-700">
              Max available stock reached
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          {/* Price */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[16px] font-bold text-[#1E1E1E]">
              ₹{price}
            </span>
            {regularPrice > price && (
              <span className="text-[12px] font-medium text-[#71717A] line-through">
                ₹{regularPrice}
              </span>
            )}
          </div>

          {/* Quantity Controls */}
          <div className="flex h-[36px] w-[88px] items-center justify-between rounded-full bg-[#7C3AED] px-1 text-white shadow-sm flex-shrink-0 select-none">
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => onDecrease(item)}
              aria-label="Decrease quantity"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/15 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Minus size={15} strokeWidth={2.5} />
            </button>

            <span className="flex-1 text-center text-[14px] font-bold leading-none tabular-nums">
              {item.quantity}
            </span>

            <button
              type="button"
              disabled={isUpdating || isMaxReached}
              onClick={() => onIncrease(item)}
              aria-label="Increase quantity"
              title={isMaxReached ? `Only ${maxLimit} available in stock` : "Increase quantity"}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/15 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
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