import { Link } from "react-router-dom";
import {
  MapPin,
  Home,
  Building2,
  Pencil,
  Trash2,
  Plus,
  AlertCircle,
} from "lucide-react";

export function ProfileAddressCard({
  requiresAddress,
  addresses,
  isEditingAddress,
  hasHome,
  hasOffice,
  startEditAddress,
  handleDeleteAddress,
  startNewAddress,
  addressForm,
  setAddressForm,
  errors,
  setErrors,
  handleAddressChange,
  DELIVERY_REGIONS,
  setMessage,
  editingAddressId,
  setIsEditingAddress,
  setEditingAddressId,
}) {
  return (
    <div className="rounded-[20px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-4.5 sm:p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[#E2E8F0]/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#22499F]/10 text-[#22499F] border border-[#22499F]/20">
            <MapPin size={16} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-[#1E293B]">
              Delivery Address
            </h2>
            <p className="text-[11px] font-medium text-[#64748B]">
              Where your orders will be delivered
            </p>
          </div>
        </div>

        <span className="rounded-full bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0] px-2.5 py-0.5 text-[10px] font-bold">
          Step 2 of 2 {requiresAddress ? "• Required" : ""}
        </span>
      </div>

      {/* If existing addresses exist and user is not currently editing */}
      {addresses.length > 0 && !isEditingAddress ? (
        <div className="space-y-2.5">
          {addresses.map((address) => {
            const isHome = address.type === "home";
            return (
              <div
                key={address.id}
                className="rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] p-3.5 transition hover:border-[#22499F]/50"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFFFFF] text-[#22499F] shadow-xs border border-[#E2E8F0]">
                      {isHome ? <Home size={15} /> : <Building2 size={15} />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-xs sm:text-sm font-extrabold text-[#1E293B] capitalize">
                          {address.type} Address
                        </h4>
                        <span className="rounded bg-[#FFFFFF] border border-[#E2E8F0] px-1.5 py-0.2 text-[9px] font-bold uppercase text-[#22499F]">
                          Saved
                        </span>
                      </div>
                      <p className="text-xs font-medium text-[#64748B] line-clamp-2 mt-0.5">
                        {address.address_line1}
                        {address.address_line2 ? `, ${address.address_line2}` : ""}
                        , {address.city}, Maharashtra
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEditAddress(address)}
                      className="flex h-7 px-2.5 items-center gap-1 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] text-xs font-bold text-[#64748B] hover:text-[#22499F] hover:border-[#22499F]/40 transition cursor-pointer"
                    >
                      <Pencil size={12} />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAddress(address.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] text-rose-400 hover:text-white hover:bg-rose-600 hover:border-rose-600 transition cursor-pointer"
                      title="Delete address"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Add second address toggle if only 1 saved */}
          <div className="flex gap-2 pt-1">
            {!hasHome && (
              <button
                type="button"
                onClick={() => startNewAddress("home")}
                className="flex items-center gap-1.5 text-xs font-bold text-[#22499F] hover:underline cursor-pointer"
              >
                <Plus size={13} />
                <span>Add Home Address</span>
              </button>
            )}
            {!hasOffice && (
              <button
                type="button"
                onClick={() => startNewAddress("office")}
                className="flex items-center gap-1.5 text-xs font-bold text-[#22499F] hover:underline cursor-pointer"
              >
                <Plus size={13} />
                <span>Add Office Address</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Inline Address Fields */
        <div className="space-y-3">
          {/* Address Type Toggle (Home / Office) */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-[#64748B]">
              Address Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAddressForm((prev) => ({ ...prev, type: "home" }))}
                className={`flex h-10 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  addressForm.type === "home"
                    ? "border-[#22499F] bg-[#FFFFFF] text-[#22499F] ring-2 ring-[#22499F]/20 font-extrabold"
                    : "border-[#E2E8F0] bg-[#F0F8E8] text-[#64748B] hover:bg-[#FFFFFF]"
                }`}
              >
                <Home size={15} />
                <span>Home</span>
              </button>

              <button
                type="button"
                onClick={() => setAddressForm((prev) => ({ ...prev, type: "office" }))}
                className={`flex h-10 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  addressForm.type === "office"
                    ? "border-[#22499F] bg-[#FFFFFF] text-[#22499F] ring-2 ring-[#22499F]/20 font-extrabold"
                    : "border-[#E2E8F0] bg-[#F0F8E8] text-[#64748B] hover:bg-[#FFFFFF]"
                }`}
              >
                <Building2 size={15} />
                <span>Office</span>
              </button>
            </div>
          </div>

          {/* Street Address */}
          <div>
            <label className={`mb-1 block text-xs font-bold ${errors.address_line1 ? "text-rose-400" : "text-[#64748B]"}`}>
              Flat, Building, Street Address <span className="text-[#22499F]">*</span>
            </label>
            <input
              type="text"
              name="address_line1"
              autoComplete="address-line1"
              placeholder="e.g. Flat 302, Building 4, Station Road"
              value={addressForm.address_line1}
              onChange={handleAddressChange}
              required
              className={`h-11 w-full rounded-xl border px-3 text-xs sm:text-sm font-semibold text-[#1E293B] outline-none transition ${
                errors.address_line1
                  ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                  : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
              }`}
            />
            {errors.address_line1 && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                <AlertCircle size={12} className="shrink-0 text-rose-400" />
                <span>{errors.address_line1}</span>
              </p>
            )}
          </div>

          {/* Landmark / Area */}
          <div>
            <label className="mb-1 block text-xs font-bold text-[#64748B]">
              Landmark / Area <span className="text-[#64748B] font-medium">(Optional)</span>
            </label>
            <input
              type="text"
              name="address_line2"
              autoComplete="address-line2"
              placeholder="e.g. Near Ganpati Mandir, Opposite Bank"
              value={addressForm.address_line2}
              onChange={handleAddressChange}
              className="h-11 w-full rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] px-3 text-xs sm:text-sm font-semibold text-[#1E293B] outline-none transition focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
            />
          </div>

          {/* Delivery Region Selection (4 Zones) */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className={`block text-xs font-bold ${errors.city ? "text-rose-400" : "text-[#64748B]"}`}>
                Delivery Region <span className="text-[#22499F]">*</span>
              </label>
              <span className="text-[10px] font-semibold text-[#64748B]">
                Local delivery zones
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {DELIVERY_REGIONS.map((region) => {
                const isSelected = addressForm.city?.toLowerCase() === region.toLowerCase();

                return (
                  <button
                    key={region}
                    type="button"
                    onClick={() => {
                      setAddressForm((prev) => ({ ...prev, city: region }));
                      if (errors.city) {
                        setErrors((prev) => {
                          const updated = { ...prev };
                          delete updated.city;
                          return updated;
                        });
                      }
                      setMessage({ type: "", text: "" });
                    }}
                    className={`flex h-11 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold transition-all cursor-pointer active:scale-98 ${
                      isSelected
                        ? "border-[#22499F] bg-[#FFFFFF] text-[#22499F] shadow-xs ring-2 ring-[#22499F]/20 font-extrabold"
                        : errors.city
                        ? "border-rose-400 bg-rose-950/20 text-[#64748B]"
                        : "border-[#E2E8F0] bg-[#F0F8E8] text-[#64748B] hover:border-[#22499F]/40 hover:bg-[#FFFFFF]"
                    }`}
                  >
                    <MapPin size={14} className={isSelected ? "text-[#22499F]" : errors.city ? "text-rose-400" : "text-[#64748B]"} />
                    <span className="truncate">{region}</span>
                  </button>
                );
              })}
            </div>
            {errors.city && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                <AlertCircle size={12} className="shrink-0 text-rose-400" />
                <span>{errors.city}</span>
              </p>
            )}
            <p className="mt-2 text-[11.5px] sm:text-xs text-[#64748B] leading-relaxed">
              For delivery outside these 4 zones, please{" "}
              <Link
                to="/contact"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-[#22499F] underline hover:text-[#1B3B82] transition-colors"
              >
                contact the store
              </Link>
              .
            </p>
          </div>

          {/* State / Store Zone Badge */}
          <div className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] px-3.5 py-2.5 text-xs font-bold text-[#64748B]">
            <div className="flex items-center gap-1.5">
              <span className="text-[#1E293B]">Maharashtra</span>
              <span className="text-[11px] font-semibold text-[#64748B]">(MH)</span>
            </div>
            <span className="rounded bg-[#FFFFFF] border border-[#E2E8F0] px-2 py-0.5 text-[9px] font-extrabold text-[#22499F]">
              Store Delivery Zone
            </span>
          </div>

          {/* Cancel editing button if editing an existing address */}
          {addresses.length > 0 && editingAddressId && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsEditingAddress(false);
                  setEditingAddressId(null);
                }}
                className="text-xs font-bold text-[#64748B] hover:text-[#22499F] cursor-pointer"
              >
                Cancel Editing
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
