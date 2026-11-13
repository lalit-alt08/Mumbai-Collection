import { Gift, Truck } from "lucide-react";

function CartSummary({
  cart,
  itemsTotal,
  discount,
  delivery,
  total,
  shortfall = 0,
  minOrderValue = 500,
  storeHours,
  onCheckout,
}) {
  const isManualClosed = storeHours?.manual_override === "closed";
  const hasScheduledOpening = Boolean(
    storeHours?.next_opening?.day && storeHours?.next_opening?.time && storeHours?.next_opening?.date
  );
  const isAfterHours = Boolean(
    storeHours &&
    (storeHours.is_after_hours || (storeHours.is_open === false && !isManualClosed)) && hasScheduledOpening
  );

  return (
    <div className="space-y-5">
      {/* Savings Card */}
      {discount > 0 && (
        <div className="flex items-center gap-3 rounded-[22px] bg-[#FFFFFF] border border-[#E2E8F0] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
          <Gift className="text-[#22499F]" size={20} />
          <span className="text-[14px] font-semibold text-[#22499F]">
            You saved ₹{discount} on this order
          </span>
        </div>
      )}

      {/* Minimum Order Value Alert (Subtotal < ₹500) */}
      {itemsTotal < minOrderValue && (
        <div className="minimum-order-notice rounded-[22px] border p-4.5 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-start gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-black font-black text-xs shadow-xs">
              ₹500
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h4 className="minimum-order-title text-xs font-extrabold uppercase tracking-wider">
                  Minimum Order Value
                </h4>
                <span className="minimum-order-badge rounded-md border px-2 py-0.5 text-[10px] font-black">
                  Required
                </span>
              </div>
              <p className="minimum-order-copy text-xs font-semibold mt-1 leading-snug">
                Add <span className="minimum-order-shortfall font-black underline decoration-2">₹{shortfall}</span> more to reach the minimum order value of ₹500.
              </p>
              <p className="minimum-order-footnote text-[11px] font-medium mt-1">
                * Delivery charges do not count toward the ₹500 product minimum.
              </p>
              {/* Dynamic progress bar */}
              <div className="minimum-order-progress mt-2.5 h-2 w-full overflow-hidden rounded-full border">
                <div
                  className="h-full rounded-full bg-[#22499F] transition-all duration-300"
                  style={{ width: `${Math.min(100, (itemsTotal / minOrderValue) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Card (Daytime standard / peak ETA) */}
      {!isAfterHours && (
        <div
          className={`rounded-[18px] bg-[#FFFFFF] border p-4 shadow-[0_6px_22px_rgba(0,0,0,0.2)] transition-all ${
            storeHours?.is_peak_hours
              ? "border-amber-800/60 bg-amber-950/20"
              : "border-[#E2E8F0]/80"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                storeHours?.is_peak_hours
                  ? "bg-amber-950/50 text-amber-400 border border-amber-800/60"
                  : "bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]"
              }`}
            >
              <Truck size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-bold text-[#1E293B] leading-tight">
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
      )}

      {storeHours?.is_open === false && !isManualClosed && !hasScheduledOpening && (
        <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-xs font-semibold text-rose-200">
          The store has no upcoming opening slot and is not accepting scheduled orders.
        </div>
      )}

      {/* Bill Details */}
      <div className="rounded-[22px] bg-[#FFFFFF] border border-[#E2E8F0]/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
        <h3 className="mb-4 text-[17px] font-bold text-[#1E293B]">
          Bill Details
        </h3>

        <div className="space-y-3.5 text-[15px] font-medium text-[#64748B]">
          <div className="flex justify-between items-center">
            <div>
              <span className="block font-semibold text-[#1E293B]">Items Total</span>
              <span className="block text-xs font-medium text-[#64748B]">Inclusive of all taxes</span>
            </div>
            <span className="font-bold text-[#1E293B]">₹{itemsTotal}</span>
          </div>

          {discount > 0 && (
            <div className="flex justify-between items-center text-[#22499F]">
              <span>Discount</span>
              <span className="font-medium">-₹{discount}</span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span>Delivery Charge</span>
            {delivery === 0 ? (
              <span className="font-bold text-[#22499F]">FREE</span>
            ) : (
              <span className="font-bold text-[#1E293B]">₹{delivery}</span>
            )}
          </div>

          <hr className="my-4 border-[#E2E8F0]/70" />

          <div className="flex justify-between items-center text-[16px] font-black text-[#1E293B]">
            <div>
              <span>Grand Total</span>
              <span className="block text-xs font-medium text-[#64748B]">Inclusive of all taxes (GST)</span>
            </div>
            <span className="text-[18px] text-[#22499F]">₹{total}</span>
          </div>
        </div>
      </div>

      {/* Policy Card */}
      <div className="rounded-[22px] bg-[#FFFFFF] border border-[#E2E8F0]/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
        <h3 className="mb-2 text-[16px] font-bold text-[#1E293B]">
          Cancellation Policy
        </h3>
        <p className="text-[15px] font-medium text-[#64748B] leading-relaxed">
          Orders cannot be cancelled once packed for delivery. In case of
          unexpected delays, a refund will be provided, if applicable.
        </p>
      </div>
    </div>
  );
}

export default CartSummary;
