import { Clock } from "lucide-react";

export function CustomerPendingPaymentBanner({
  pendingPayment,
  pendingFeedback,
  checkingPending,
  onCheckPending,
}) {
  if (!pendingPayment) return null;

  return (
    <div className="mb-6 rounded-[24px] border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
            <Clock size={22} className="animate-spin" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-extrabold text-[#1E293B]">
                Payment Pending Confirmation
              </h3>
              <span className="rounded-full bg-[#FFFFFF] px-2.5 py-0.5 text-[10px] font-bold text-[#22499F] border border-[#E2E8F0]">
                VERIFYING
              </span>
            </div>
            <p className="mt-1 text-xs text-[#64748B] leading-relaxed">
              We&apos;re confirming your payment with your bank. If money was debited from your account, please do not pay again.
            </p>
            {pendingFeedback && (
              <p className="mt-1.5 text-xs font-semibold text-[#22499F]">
                {pendingFeedback}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <button
            type="button"
            onClick={() => onCheckPending(pendingPayment.razorpay_order_id)}
            disabled={checkingPending}
            className="rounded-xl bg-[#22499F] px-4 py-2 text-xs font-black text-[#FFFFFF] shadow-xs hover:bg-[#1B3B82] active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {checkingPending ? "Checking..." : "Check payment"}
          </button>
          <a
            href="https://wa.me/918793601567?text=Hi%2C%20I%20have%20a%20question%20about%20my%20pending%20payment%20on%20Mumbai%20Collection"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-3.5 py-2 text-xs font-bold text-[#1E293B] hover:bg-[#1C3358]"
          >
            Help (+91 87936 01567)
          </a>
        </div>
      </div>
    </div>
  );
}
