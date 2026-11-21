import { Clock } from "lucide-react";

export function CheckoutPendingBanner({
  pendingPayment,
  sessionExpiredPending,
  isPersistentPending,
  checkingPendingStatus,
  cancellingPending,
  pendingStatusFeedback,
  canCancelPending,
  isPaymentUnpaid,
  onRetryPayment,
  verifyPendingOrder,
  handleCancelUnpaidCheckout,
  navigate,
}) {
  if (pendingPayment?.support_required) {
    const refId = pendingPayment?.orderId || pendingPayment?.razorpay_order_id || "";
    return (
      <div className="rounded-[20px] border border-amber-500/70 bg-amber-950/60 p-4 text-xs text-amber-200 shadow-md">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-600/30 text-amber-300">
            <Clock size={18} />
          </div>
          <div className="flex-1">
            <h4 className="font-extrabold text-amber-100 text-sm">
              Payment Under Staff Review — Do Not Pay Again
            </h4>
            <p className="mt-1 leading-relaxed text-amber-300/90 text-[12px]">
              {pendingPayment.message || "This payment requires staff review. If amount was debited from your account, please do not attempt to pay again."}
            </p>
            {refId && (
              <div className="mt-2 rounded-lg bg-amber-900/40 px-2.5 py-1 text-[11px] font-mono text-amber-200 inline-block border border-amber-700/50">
                Checkout Reference: <span className="font-bold select-all">{refId}</span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => verifyPendingOrder(true)}
                disabled={checkingPendingStatus}
                className="rounded-xl bg-[#22499F] px-3.5 py-1.5 font-bold text-[#FFFFFF] shadow-xs hover:bg-[#1B3B82] active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {checkingPendingStatus ? "Checking..." : "Check Status Again"}
              </button>
              <a
                href={`https://wa.me/918793601567?text=${encodeURIComponent(`Hi, my payment is under review for checkout reference: ${refId}. Could you please assist?`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-emerald-700/80 bg-emerald-950/60 px-3.5 py-1.5 font-bold text-emerald-400 hover:bg-emerald-900/70"
              >
                WhatsApp Support (+91 87936 01567)
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (sessionExpiredPending) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-amber-800/60 bg-amber-950/40 px-3.5 py-2.5 text-xs text-amber-200">
        <span className="font-semibold">
          Your session expired while confirming payment. Sign in to resume your order.
        </span>
        <button
          type="button"
          onClick={() => navigate("/login", { state: { from: "/cart" } })}
          className="rounded-lg bg-[#22499F] px-3 py-1 font-bold text-[#FFFFFF] hover:bg-[#1B3B82] hover:text-[#FFFFFF] cursor-pointer"
        >
          Sign In
        </button>
      </div>
    );
  }

  return null;
}
