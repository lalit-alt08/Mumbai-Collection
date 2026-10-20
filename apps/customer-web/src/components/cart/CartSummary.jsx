import { Gift, Truck } from "lucide-react";

function CartSummary({
  cart,
  itemsTotal,
  discount,
  delivery,
  tax,
  total,
  shortfall = 0,
  minOrderValue = 500,
  storeHours,
  onCheckout,
}) {
  return (
    <div className="space-y-5">
      {/* Savings Card */}
      {discount > 0 && (
        <div className="flex items-center gap-3 rounded-[22px] bg-[#132B45] border border-[#1E3252] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
          <Gift className="text-[#42D6E8]" size={20} />
          <span className="text-[14px] font-semibold text-[#42D6E8]">
            You saved ₹{discount} on this order
          </span>
        </div>
      )}

      {/* Minimum Order Value Alert (Subtotal < ₹500) */}
      {itemsTotal < minOrderValue && (
        <div className="rounded-[22px] border border-amber-800/60 bg-amber-950/30 p-4.5 shadow-[0_4px_20px_rgba(0,0,0,0.2)] animate-in fade-in duration-200">
          <div className="flex items-start gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-black font-black text-xs shadow-xs">
              ₹500
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-300">
                  Minimum Order Value
                </h4>
                <span className="rounded-md bg-amber-900/60 border border-amber-700/60 px-2 py-0.5 text-[10px] font-black text-amber-300">
                  Required
                </span>
              </div>
              <p className="text-xs font-semibold text-amber-200 mt-1 leading-snug">
                Add <span className="font-black text-amber-300 underline decoration-amber-400 decoration-2">₹{shortfall}</span> more to reach the minimum order value of ₹500.
              </p>
              <p className="text-[11px] font-medium text-amber-400/80 mt-1">
                * Delivery charges do not count toward the ₹500 product minimum.
              </p>
              {/* Dynamic progress bar */}
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-amber-950/80 border border-amber-800/40">
                <div
                  className="h-full rounded-full bg-[#42D6E8] transition-all duration-300"
                  style={{ width: `${Math.min(100, (itemsTotal / minOrderValue) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Card */}
      <div
        className={`rounded-[18px] bg-[#111F36] border border-[#1E3252]/80 p-4 shadow-[0_6px_22px_rgba(0,0,0,0.2)] transition-all ${
          storeHours?.is_peak_hours
            ? "border-amber-800/60 bg-amber-950/20"
            : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
              storeHours?.is_peak_hours
                ? "bg-amber-950/50 text-amber-400 border border-amber-800/60"
                : "bg-[#132B45] text-[#42D6E8] border border-[#1E3252]"
            }`}
          >
            <Truck size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-bold text-[#F1F5F9] leading-tight">
                {storeHours?.delivery_eta_text ||
                  (storeHours?.is_peak_hours
                    ? "Delivery in 2–3 hours"
                    : "Delivery in 60–90 mins")}
              </h3>
              {storeHours?.is_peak_hours && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-950/50 px-2.5 py-0.5 text-[11px] font-black text-amber-300 border border-amber-800/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  ⚡ High Demand
                </span>
              )}
            </div>
            {storeHours?.is_peak_hours && (
              <p className="mt-1 text-xs font-semibold text-amber-300 leading-snug">
                {storeHours?.peak_notice ||
                  storeHours?.peak_notice_message ||
                  "High order volume in progress. Deliveries may take 2–3 hours today."}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Bill Details */}
      <div className="rounded-[22px] bg-[#111F36] border border-[#1E3252]/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
        <h3 className="mb-4 text-[16px] font-bold text-[#F1F5F9]">
          Bill Details
        </h3>

        <div className="space-y-3.5 text-[14px] text-[#8FA4BE]">
          <div className="flex justify-between items-center">
            <span>Items Total</span>
            <span className="font-medium text-[#F1F5F9]">₹{itemsTotal}</span>
          </div>

          {discount > 0 && (
            <div className="flex justify-between items-center text-[#42D6E8]">
              <span>Discount</span>
              <span className="font-medium">-₹{discount}</span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span>Delivery Charge</span>
            {delivery === 0 ? (
              <span className="font-bold text-[#42D6E8]">FREE</span>
            ) : (
              <span className="font-medium text-[#F1F5F9]">₹{delivery}</span>
            )}
          </div>

          {tax > 0 && (
            <div className="flex justify-between items-center">
              <span>Tax</span>
              <span className="font-medium text-[#F1F5F9]">₹{tax}</span>
            </div>
          )}

          <hr className="my-4 border-[#1E3252]/70" />

          <div className="flex justify-between items-center text-[16px] font-black text-white">
            <span>Grand Total</span>
            <span>₹{total}</span>
          </div>
        </div>
      </div>

      {/* Policy Card */}
      <div className="rounded-[22px] bg-[#111F36] border border-[#1E3252]/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
        <h3 className="mb-2 text-[14px] font-bold text-[#F1F5F9]">
          Cancellation Policy
        </h3>
        <p className="text-[14px] font-medium text-[#8FA4BE] leading-relaxed">
          Orders cannot be cancelled once packed for delivery. In case of
          unexpected delays, a refund will be provided, if applicable.
        </p>
      </div>
    </div>
  );
}

export default CartSummary;
