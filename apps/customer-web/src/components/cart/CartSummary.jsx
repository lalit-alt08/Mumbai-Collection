import { Gift, Truck, AlertCircle } from "lucide-react";

function CartSummary({
  cart,
  itemsTotal,
  discount,
  delivery,
  tax,
  total,
  canCheckout = true,
  shortfall = 0,
  minOrderValue = 500,
  onCheckout,
}) {
  return (
    <div className="space-y-5">
      {/* Savings Card */}
      {discount > 0 && (
        <div className="flex items-center gap-3 rounded-[22px] bg-[#EEF4FF] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.03)]">
          <Gift className="text-blue-600" size={20} />
          <span className="text-[14px] font-semibold text-blue-700">
            You saved ₹{discount} on this order
          </span>
        </div>
      )}

      {/* Minimum Order Value Alert (Subtotal < ₹500) */}
      {!canCheckout && (
        <div className="rounded-[22px] border border-amber-300/80 bg-gradient-to-r from-amber-50 via-amber-50/80 to-orange-50/70 p-4.5 shadow-[0_4px_20px_rgba(245,158,11,0.08)] animate-in fade-in duration-200">
          <div className="flex items-start gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white font-black text-xs shadow-xs">
              ₹500
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-900">
                  Minimum Order Value
                </h4>
                <span className="rounded-md bg-amber-200/90 px-2 py-0.5 text-[10px] font-black text-amber-900">
                  Required
                </span>
              </div>
              <p className="text-xs font-semibold text-amber-900 mt-1 leading-snug">
                Add <span className="font-black text-amber-950 underline decoration-amber-500 decoration-2">₹{shortfall}</span> more to reach the minimum order value of ₹500.
              </p>
              <p className="text-[11px] font-medium text-amber-700 mt-1">
                * Delivery charges do not count toward the ₹500 product minimum.
              </p>
              {/* Dynamic progress bar */}
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-amber-200/70">
                <div
                  className="h-full rounded-full bg-[#7C3AED] transition-all duration-300"
                  style={{ width: `${Math.min(100, (itemsTotal / minOrderValue) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Card */}
      <div className="rounded-[22px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F1ECFF]">
            <Truck size={22} className="text-[#7C3AED]" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-[#1E1E1E]">
              Delivery in 20-30 mins
            </h3>
            <p className="text-[13px] font-medium text-[#666666] mt-0.5">
              Shipment of {cart.items_count} item
              {cart.items_count !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Bill Details */}
      <div className="rounded-[22px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)]">
        <h3 className="mb-4 text-[16px] font-bold text-[#1E1E1E]">
          Bill Details
        </h3>

        <div className="space-y-3.5 text-[14px] text-[#666666]">
          <div className="flex justify-between items-center">
            <span>Items Total</span>
            <span className="font-medium text-[#1E1E1E]">₹{itemsTotal}</span>
          </div>

          {discount > 0 && (
            <div className="flex justify-between items-center text-blue-600">
              <span>Discount</span>
              <span className="font-medium">-₹{discount}</span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span>Delivery Charge</span>
            {delivery === 0 ? (
              <span className="font-bold text-[#7C3AED]">FREE</span>
            ) : (
              <span className="font-medium text-[#1E1E1E]">₹{delivery}</span>
            )}
          </div>

          {tax > 0 && (
            <div className="flex justify-between items-center">
              <span>Tax</span>
              <span className="font-medium text-[#1E1E1E]">₹{tax}</span>
            </div>
          )}

          <hr className="my-4 border-[#E8E8E8]" />

          <div className="flex justify-between items-center text-[16px] font-bold text-[#1E1E1E]">
            <span>Grand Total</span>
            <span>₹{total}</span>
          </div>
        </div>
      </div>

      {/* Policy Card */}
      <div className="rounded-[22px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)]">
        <h3 className="mb-2 text-[14px] font-bold text-[#1E1E1E]">
          Cancellation Policy
        </h3>
        <p className="text-[13px] text-[#666666] leading-relaxed">
          Orders cannot be cancelled once packed for delivery. In case of
          unexpected delays, a refund will be provided, if applicable.
        </p>
      </div>

      {/* Floating Checkout Bar */}
      <div className="fixed bottom-[18px] left-1/2 z-50 flex h-[78px] w-[calc(100%-32px)] max-w-[700px] -translate-x-1/2 items-center justify-between rounded-[30px] bg-white px-5 shadow-[0_12px_40px_rgba(0,0,0,0.12)] border border-[#ECECEC]">
        <div className="flex flex-col pl-1">
          <span className="text-[11px] font-bold text-[#666666] tracking-wider mb-0.5">
            TOTAL
          </span>
          <span className="text-[20px] font-bold text-[#1E1E1E] leading-none">
            ₹{total}
          </span>
        </div>

        {canCheckout ? (
          <button
            onClick={onCheckout}
            className="flex h-[52px] w-[55%] items-center justify-center rounded-[20px] bg-[#7C3AED] text-[15px] font-bold text-white transition-all duration-300 hover:bg-[#6C35E8] hover:shadow-[0_4px_20px_rgba(124,58,237,0.25)] active:scale-95 cursor-pointer"
          >
            Proceed to Checkout &rarr;
          </button>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            title={`Add ₹${shortfall} more to reach minimum order value of ₹500`}
            className="flex h-[52px] w-[55%] flex-col items-center justify-center rounded-[20px] bg-gray-100 text-gray-400 font-bold border border-gray-200 cursor-not-allowed opacity-90 transition-all duration-200"
          >
            <span className="text-[12px] font-black text-gray-600 leading-tight">
              Min. Order ₹500
            </span>
            <span className="text-[10px] font-bold text-amber-700 leading-tight">
              Add ₹{shortfall} more
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export default CartSummary;