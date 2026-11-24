import { Home, Building2, Pencil, Trash2 } from "lucide-react";

export function AddressItemCard({
  address,
  onEdit,
  onDelete,
  getCleanDisplayName,
}) {
  const isHome = address.type === "home";

  return (
    <div
      key={address.id}
      className="rounded-3xl bg-[#FFFFFF] p-5 shadow-lg transition hover:border-[#22499F]/50 md:p-6 border border-[#E2E8F0]/80"
    >
      {/* CARD HEADER */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] text-[#22499F]">
            {isHome ? (
              <Home size={23} className="text-[#22499F]" />
            ) : (
              <Building2 size={23} className="text-[#22499F]" />
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold text-[#1E293B]">
                {isHome ? "Home" : "Office"}
              </h2>

              <span className="address-saved-pill rounded-full bg-[#FFFFFF] border border-[#E2E8F0] px-2.5 py-1 text-[10px] font-bold text-[#22499F]">
                SAVED
              </span>
            </div>

            <p className="mt-1 text-xs text-[#64748B] font-medium">
              Delivery address
            </p>
          </div>
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onEdit(address)}
            className="address-action-edit flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] text-[#64748B] transition hover:border-[#22499F] hover:text-[#22499F] cursor-pointer"
            title="Edit address"
          >
            <Pencil size={16} />
          </button>

          <button
            type="button"
            onClick={() => onDelete(address)}
            className="address-action-delete flex h-10 w-10 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            title="Delete address"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* ADDRESS INFORMATION */}
      <div className="border-t border-[#E2E8F0]/60 pt-5">
        <p className="font-bold text-[#1E293B]">
          {getCleanDisplayName(address.full_name, address.first_name, address.last_name)}
        </p>

        <p className="mt-1 text-sm text-[#64748B] font-medium">
          +91 {address.phone}
        </p>

        <div className="mt-4 text-[14px] leading-relaxed text-[#64748B]">
          <p>{address.address_line1}</p>

          {address.address_line2 && <p>{address.address_line2}</p>}

          <p className="font-semibold text-[#1E293B] pt-1">
            {address.city}, Maharashtra
          </p>
        </div>
      </div>
    </div>
  );
}
