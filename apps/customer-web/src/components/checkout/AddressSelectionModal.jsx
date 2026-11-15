import { X, Home, Building2, Check, Plus } from "lucide-react";

export function AddressSelectionModal({
  isOpen,
  onClose,
  addresses,
  selectedAddressId,
  onSelectAddress,
  onAddNewAddress,
}) {
  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[520px] max-h-[85vh] flex-col rounded-t-[28px] sm:rounded-[24px] bg-[#FFFFFF] border border-[#E2E8F0] p-5 sm:p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#E2E8F0]/70 pb-3">
          <div>
            <h3 className="text-base font-extrabold text-[#1E293B]">
              Select Delivery Address
            </h3>
            <p className="text-xs font-medium text-[#64748B]">
              Where should we send your order?
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#64748B] hover:bg-[#FFFFFF] hover:text-white transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3.5 space-y-2.5 overflow-y-auto pr-1 flex-1 max-h-[50vh]">
          {addresses.map((addr) => {
            const isSelected = String(selectedAddressId) === String(addr.id);
            const isHome = addr.type === "home";

            return (
              <div
                key={addr.id}
                onClick={() => onSelectAddress(String(addr.id))}
                className={`flex items-start gap-3 rounded-2xl border p-3.5 transition-all cursor-pointer ${
                  isSelected
                    ? "border-[#22499F] bg-[#FFFFFF]/70 ring-2 ring-[#22499F]/20 shadow-xs"
                    : "border-[#E2E8F0] bg-[#F0F8E8] hover:border-[#22499F]/50"
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                    isSelected
                      ? "bg-[#FFFFFF] text-[#22499F] border-[#22499F]/50"
                      : "bg-[#FFFFFF] text-[#64748B] border-[#E2E8F0]"
                  }`}
                >
                  {isHome ? <Home size={15} /> : <Building2 size={15} />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs sm:text-sm font-extrabold text-[#1E293B] truncate">
                      {addr.first_name || ""} {addr.last_name || ""}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide border ${
                        isSelected
                          ? "bg-[#FFFFFF] text-[#22499F] border-[#E2E8F0]"
                          : "bg-[#FFFFFF] text-[#64748B] border-[#E2E8F0]"
                      }`}
                    >
                      {addr.type ? addr.type.toUpperCase() : "HOME"}
                    </span>
                  </div>

                  <p className="mt-1 text-xs font-medium text-[#64748B] line-clamp-2">
                    {addr.address_line1 || ""}
                    {addr.address_line2 ? `, ${addr.address_line2}` : ""}
                    , {addr.city || ""}, {addr.state || "MH"}
                    {addr.pincode ? ` - ${addr.pincode}` : ""}
                  </p>

                  {addr.phone && (
                    <p className="mt-1 text-xs font-semibold text-[#22499F]">
                      📞 {addr.phone}
                    </p>
                  )}
                </div>

                {isSelected && (
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#22499F] text-[#FFFFFF] self-center">
                    <Check size={12} strokeWidth={3} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-[#E2E8F0]/70">
          <button
            type="button"
            onClick={onAddNewAddress}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#22499F]/40 bg-[#FFFFFF]/30 py-3 text-xs font-extrabold text-[#22499F] hover:bg-[#FFFFFF]/50 active:scale-[0.99] transition cursor-pointer"
          >
            <Plus size={15} />
            <span>Add New Address</span>
          </button>
        </div>
      </div>
    </div>
  );
}
