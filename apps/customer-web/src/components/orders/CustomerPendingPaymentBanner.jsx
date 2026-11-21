import { Clock } from "lucide-react";
import { Link } from "react-router-dom";

export function CustomerPendingPaymentBanner({
  pendingPayment,
  pendingFeedback,
  checkingPending,
  cancellingPending,
  canCancelPending,
  isPaymentUnpaid,
  onCheckPending,
  onCancelPending,
}) {
  if (!pendingPayment) return null;

  const isSupport = Boolean(pendingPayment.support_required);

  return (
    <div className="mb-6 rounded-[24px] border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 flex-1 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
            {checkingPending ? (
              <div
                className="payment-status-spinner h-5 w-5 rounded-full border-2 border-[#22499F] border-t-transparent animate-spin"
                style={{ animationDuration: "900ms" }}
              />
            ) : (
              <Clock size={22} className="text-[#22499F]" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between sm:justify-start gap-2 flex-wrap">
              <h3 role="status" aria-live="polite" className="text-sm font-extrabold text-[#1E293B] whitespace-nowrap">
                {checkingPending
                  ? "Verifying payment"
                  : isSupport
                  ? "Payment Needs Review"
                  : isPaymentUnpaid
                  ? "No Payment Received"
                  : "Payment pending"}
              </h3>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold border whitespace-nowrap ${
                checkingPending
                  ? "bg-blue-50 text-[#22499F] border-[#22499F]/40"
                  : isSupport
                  ? "bg-amber-50 text-amber-800 border-amber-300"
                  : isPaymentUnpaid
                  ? "bg-amber-50 text-amber-800 border-amber-300"
                  : "bg-blue-50 text-[#22499F] border-blue-200"
              }`}>
                {checkingPending ? "VERIFYING" : isSupport ? "NEEDS REVIEW" : isPaymentUnpaid ? "UNPAID" : "PENDING"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#64748B] leading-relaxed">
              {isSupport
                ? "Payment needs staff confirmation. If debited, please do not pay again."
                : isPaymentUnpaid
                ? (pendingFeedback || "No money was charged. You can try paying again or cancel this attempt.")
                : (pendingFeedback || "Confirming with your bank. If money was debited, please do not pay again.")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {isPaymentUnpaid && (
            <Link
              to="/cart"
              className="rounded-full bg-[#22499F] px-4 py-2 text-xs font-black text-[#FFFFFF] shadow-xs hover:bg-[#1B3B82] active:scale-95 cursor-pointer"
            >
              Try Paying in Cart
            </Link>
          )}
          <button
            type="button"
            onClick={() => onCheckPending(pendingPayment.razorpay_order_id)}
            disabled={checkingPending || cancellingPending}
            className={`rounded-full px-4 py-2 text-xs font-black shadow-xs active:scale-95 cursor-pointer disabled:opacity-50 ${
              isPaymentUnpaid
                ? "border border-[#E2E8F0] bg-white text-[#1E293B] hover:bg-slate-50"
                : "bg-[#22499F] text-[#FFFFFF] hover:bg-[#1B3B82]"
            }`}
          >
            {checkingPending ? "Checking payment…" : isPaymentUnpaid ? "Check Status Again" : "Check payment"}
          </button>
          {!isSupport && canCancelPending && onCancelPending && (
            <button
              type="button"
              onClick={() => onCancelPending(pendingPayment.razorpay_order_id)}
              disabled={cancellingPending || checkingPending}
              className="pending-cancel-pill active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {cancellingPending ? "Ending attempt…" : "Cancel checkout"}
            </button>
          )}
          <a
            href="https://wa.me/918793601567?text=Hi%2C%20I%20have%20a%20question%20about%20my%20pending%20payment%20on%20Mumbai%20Collection"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[#E2E8F0] bg-[#FFFFFF] px-3.5 py-2 text-xs font-bold text-[#1E293B] hover:bg-[#F1F5F9]"
          >
            Help (+91 87936 01567)
          </a>
        </div>
      </div>
    </div>
  );
}
