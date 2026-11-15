import { CreditCard } from "lucide-react";

export function PaymentMethodCard() {
  return (
    <div className="rounded-[22px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
      <div className="flex items-center justify-between border-b border-[#E2E8F0]/70 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
            <CreditCard size={16} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-[#1E293B]">
              Payment Method
            </h2>
            <p className="text-[11px] font-medium text-[#64748B]">
              Pay securely online
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] p-3 sm:p-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0] shadow-xs">
            <CreditCard size={18} />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs sm:text-sm font-extrabold text-[#1E293B]">
              Pay Online
            </h4>
            <p className="text-[11px] font-medium text-[#64748B] truncate">
              UPI, Cards, NetBanking, Wallets
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
