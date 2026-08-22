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
          src={item.images?.[0]?.src}
          alt={item.name}
          className="h-full w-full object-contain"
        />
      </div>

      {/* Product Details */}
      <div className="flex flex-1 flex-col justify-between py-1 h-[90px]">
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

        <div className="flex items-center justify-between">
          {/* Price */}
          <div className="flex flex-col">
            <span className="text-[16px] font-bold text-[#1E1E1E]">
              ₹{price}
            </span>
            {regularPrice > price && (
              <span className="text-[12px] font-medium text-[#666666] line-through">
                ₹{regularPrice}
              </span>
            )}
          </div>

          {/* Quantity Controls */}
          <div className="flex h-[36px] w-[86px] items-center justify-between rounded-full bg-[#7C3AED] px-1 text-white shadow-sm">
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => onDecrease(item)}
              aria-label="Decrease quantity"
              className="flex h-full w-8 items-center justify-center text-lg active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              −
            </button>

            <span className="text-[14px] font-bold">
              {isUpdating ? (
                <span className="animate-pulse">...</span>
              ) : (
                item.quantity
              )}
            </span>

            <button
              type="button"
              disabled={isUpdating || isMaxReached}
              onClick={() => onIncrease(item)}
              aria-label="Increase quantity"
              title={isMaxReached ? `Only ${maxLimit} available in stock` : "Increase quantity"}
              className="flex h-full w-8 items-center justify-center text-lg active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CartItem;