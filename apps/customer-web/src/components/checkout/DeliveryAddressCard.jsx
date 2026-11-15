import { MapPin, Plus, Building2, Home } from "lucide-react";

export function DeliveryAddressCard({
  addresses,
  selectedAddress,
  loading,
  onOpenAddressModal,
  navigate,
}) {
  return (
    <div className="rounded-[22px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
      <div className="flex items-center justify-between border-b border-[#E2E8F0]/70 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
            <MapPin size={16} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-[#1E293B]">
              Delivery Address
            </h2>
            <p className="text-[11px] font-medium text-[#64748B]">
              Where your order will be delivered
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (addresses.length === 0) {
              navigate("/account/addresses", { state: { from: "/cart", selectNew: true } });
            } else {
              onOpenAddressModal();
            }
          }}
          disabled={loading}
          className="flex items-center gap-1 text-xs font-bold text-[#22499F] hover:underline cursor-pointer disabled:opacity-50"
        >
          {addresses.length === 0 ? (
            <>
              <Plus size={13} />
              <span>Add Address</span>
            </>
          ) : (
            <span>Change</span>
          )}
        </button>
      </div>

      {/* Selected Address Preview or Empty State */}
      {addresses.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#F0F8E8] p-4 text-center">
          <p className="text-xs font-bold text-[#1E293B]">No saved address found</p>
          <p className="mt-0.5 text-[11px] text-[#64748B] font-medium">
            Please add a delivery address to proceed.
          </p>
          <button
            type="button"
            onClick={() => navigate("/account/addresses", { state: { from: "/cart", selectNew: true } })}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-[#22499F] px-3.5 py-1.5 text-xs font-black text-[#FFFFFF] shadow-xs hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-95 transition cursor-pointer"
          >
            <Plus size={13} />
            <span>Add Address</span>
          </button>
        </div>
      ) : selectedAddress ? (
        <div
          onClick={() => !loading && onOpenAddressModal()}
          className="mt-3 flex items-start gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] p-3 sm:p-3.5 hover:border-[#22499F]/60 transition cursor-pointer"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0] shadow-xs">
            {selectedAddress.type === "office" || selectedAddress.type === "work" ? (
              <Building2 size={16} />
            ) : (
              <Home size={16} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-extrabold text-[#1E293B] truncate">
                {selectedAddress.first_name || ""} {selectedAddress.last_name || ""}
              </span>
              <span className="rounded-full bg-[#FFFFFF] px-2 py-0.5 text-[9px] font-extrabold uppercase text-[#22499F] border border-[#E2E8F0]">
                {selectedAddress.type ? selectedAddress.type.toUpperCase() : "HOME"}
              </span>
            </div>

            <p className="mt-1 text-xs font-medium text-[#64748B] line-clamp-2">
              {selectedAddress.address_line1 || ""}
              {selectedAddress.address_line2 ? `, ${selectedAddress.address_line2}` : ""}
              , {selectedAddress.city || ""}, {selectedAddress.state || "MH"}
              {selectedAddress.pincode ? ` - ${selectedAddress.pincode}` : ""}
            </p>

            {selectedAddress.phone && (
              <p className="mt-1 text-xs font-semibold text-[#22499F]">
                📞 {selectedAddress.phone}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
