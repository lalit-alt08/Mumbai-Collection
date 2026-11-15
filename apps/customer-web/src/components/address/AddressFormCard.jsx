import { Link } from "react-router-dom";
import {
  Home,
  Building2,
  AlertCircle,
  MapPin,
  Loader2,
} from "lucide-react";

export function AddressFormCard({
  showForm,
  form,
  setForm,
  editingId,
  formError,
  setFormError,
  fieldErrors,
  setFieldErrors,
  isHomeAvailable,
  isOfficeAvailable,
  handleChange,
  handleSubmit,
  closeForm,
  saving,
  triggerHaptic,
  DELIVERY_REGIONS,
}) {
  if (!showForm) return null;

  return (
    <div className="mb-8 rounded-[28px] border border-[#E2E8F0] bg-[#FFFFFF]/95 backdrop-blur-xl p-5 shadow-[0_12px_40px_rgba(0,0,0,0.4)] sm:p-7 animate-[slideUp_0.25s_ease-out]">
      {/* FORM HEADER */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
          {form.type === "office" ? (
            <Building2 size={21} strokeWidth={2.2} />
          ) : (
            <Home size={21} strokeWidth={2.2} />
          )}
        </div>
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-extrabold text-[#1E293B] tracking-tight truncate">
            {editingId
              ? "Edit Address"
              : `Add ${form.type === "office" ? "Office" : "Home"} Address`}
          </h2>
        </div>
      </div>

      {/* FORM ERROR */}
      {formError && (
        <div className="mb-5 flex items-center gap-2 rounded-2xl border border-rose-900/60 bg-rose-950/40 p-3.5 text-xs sm:text-sm font-semibold text-rose-300">
          <AlertCircle size={16} className="shrink-0 text-rose-400" />
          <span>{formError}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4 sm:space-y-5"
      >
        {/* ADDRESS TYPE SELECTOR (Segmented Pill Switch) */}
        <div>
          <label className={`mb-2 block text-xs font-bold uppercase tracking-wider ${fieldErrors.type ? "text-rose-400" : "text-[#64748B]"}`}>
            Address Type <span className={fieldErrors.type ? "text-rose-400 font-black" : "text-[#22499F]"}>*</span>
          </label>

          <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-[#F0F8E8]/90 border border-[#E2E8F0] shadow-inner">
            {/* HOME OPTION */}
            {isHomeAvailable ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("light");
                  setForm((prev) => ({
                    ...prev,
                    type: "home",
                  }));
                  if (fieldErrors.type) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.type;
                      return next;
                    });
                  }
                  setFormError("");
                }}
                className={`flex h-11 items-center justify-center gap-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  form.type === "home"
                    ? "bg-[#FFFFFF] text-[#22499F] border border-[#22499F]/40 shadow-[0_2px_10px_rgba(0,0,0,0.3)] ring-1 ring-[#22499F]/30"
                    : fieldErrors.type
                    ? "border border-rose-400/40 text-rose-300 hover:bg-rose-950/20"
                    : "text-[#64748B] hover:text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                <Home size={17} strokeWidth={2.2} />
                <span>Home</span>
              </button>
            ) : (
              <div className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/5 px-2 text-xs font-semibold text-[#64748B]">
                <Home size={15} />
                <span>Home (Saved)</span>
              </div>
            )}

            {/* OFFICE OPTION */}
            {isOfficeAvailable ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("light");
                  setForm((prev) => ({
                    ...prev,
                    type: "office",
                  }));
                  if (fieldErrors.type) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.type;
                      return next;
                    });
                  }
                  setFormError("");
                }}
                className={`flex h-11 items-center justify-center gap-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  form.type === "office"
                    ? "bg-[#FFFFFF] text-[#22499F] border border-[#22499F]/40 shadow-[0_2px_10px_rgba(0,0,0,0.3)] ring-1 ring-[#22499F]/30"
                    : fieldErrors.type
                    ? "border border-rose-400/40 text-rose-300 hover:bg-rose-950/20"
                    : "text-[#64748B] hover:text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                <Building2 size={17} strokeWidth={2.2} />
                <span>Office</span>
              </button>
            ) : (
              <div className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/5 px-2 text-xs font-semibold text-[#64748B]">
                <Building2 size={15} />
                <span>Office (Saved)</span>
              </div>
            )}
          </div>
          {fieldErrors.type && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
              <AlertCircle size={13} className="shrink-0 text-rose-400" />
              <span>{fieldErrors.type}</span>
            </p>
          )}
        </div>

        {/* FIRST NAME + LAST NAME (Side-by-side grid) */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div>
            <label className={`mb-2 block text-xs font-bold uppercase tracking-wider ${fieldErrors.first_name ? "text-rose-400" : "text-[#64748B]"}`}>
              First Name <span className={fieldErrors.first_name ? "text-rose-400 font-black" : "text-[#22499F]"}>*</span>
            </label>

            <input
              name="first_name"
              autoComplete="given-name"
              value={form.first_name}
              onChange={handleChange}
              placeholder="e.g. Rahul"
              className={`h-12 w-full rounded-xl border px-3.5 text-sm font-medium outline-none transition-all ${
                fieldErrors.first_name
                  ? "border-rose-500 bg-rose-950/30 text-rose-200 placeholder-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                  : "border-[#E2E8F0] bg-[#F0F8E8]/80 text-[#1E293B] placeholder:text-[#64748B] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
              }`}
            />
            {fieldErrors.first_name && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
                <AlertCircle size={13} className="shrink-0 text-rose-400" />
                <span>{fieldErrors.first_name}</span>
              </p>
            )}
          </div>

          <div>
            <label className={`mb-2 block text-xs font-bold uppercase tracking-wider ${fieldErrors.last_name ? "text-rose-400" : "text-[#64748B]"}`}>
              Last Name <span className={fieldErrors.last_name ? "text-rose-400 font-black" : "text-[#22499F]"}>*</span>
            </label>

            <input
              name="last_name"
              autoComplete="family-name"
              value={form.last_name}
              onChange={handleChange}
              placeholder="e.g. Sharma"
              className={`h-12 w-full rounded-xl border px-3.5 text-sm font-medium outline-none transition-all ${
                fieldErrors.last_name
                  ? "border-rose-500 bg-rose-950/30 text-rose-200 placeholder-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                  : "border-[#E2E8F0] bg-[#F0F8E8]/80 text-[#1E293B] placeholder:text-[#64748B] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
              }`}
            />
            {fieldErrors.last_name && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
                <AlertCircle size={13} className="shrink-0 text-rose-400" />
                <span>{fieldErrors.last_name}</span>
              </p>
            )}
          </div>
        </div>

        {/* PHONE WITH COUNTRY CODE PILL */}
        <div>
          <label className={`mb-2 block text-xs font-bold uppercase tracking-wider ${fieldErrors.phone ? "text-rose-400" : "text-[#64748B]"}`}>
            Mobile Number <span className={fieldErrors.phone ? "text-rose-400 font-black" : "text-[#22499F]"}>*</span>
          </label>

          <div className="relative flex items-center">
            <div className="absolute left-3 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-[#E2E8F0] text-xs font-bold text-[#22499F] select-none">
              <span>+91</span>
            </div>
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="numeric"
              maxLength={16}
              value={form.phone}
              onChange={handleChange}
              placeholder="10-digit mobile number"
              className={`h-12 w-full rounded-xl border pl-18 pr-4 text-sm font-medium outline-none transition-all ${
                fieldErrors.phone
                  ? "border-rose-500 bg-rose-950/30 text-rose-200 placeholder-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                  : "border-[#E2E8F0] bg-[#F0F8E8]/80 text-[#1E293B] placeholder:text-[#64748B] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
              }`}
            />
          </div>
          {fieldErrors.phone && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
              <AlertCircle size={13} className="shrink-0 text-rose-400" />
              <span>{fieldErrors.phone}</span>
            </p>
          )}
        </div>

        {/* ADDRESS LINE 1 */}
        <div>
          <label className={`mb-2 block text-xs font-bold uppercase tracking-wider ${fieldErrors.address_line1 ? "text-rose-400" : "text-[#64748B]"}`}>
            Address Line 1 <span className={fieldErrors.address_line1 ? "text-rose-400 font-black" : "text-[#22499F]"}>*</span>
          </label>

          <input
            name="address_line1"
            autoComplete="address-line1"
            value={form.address_line1}
            onChange={handleChange}
            placeholder="Flat / House no., building, street"
            className={`h-12 w-full rounded-xl border px-3.5 text-sm font-medium outline-none transition-all ${
              fieldErrors.address_line1
                ? "border-rose-500 bg-rose-950/30 text-rose-200 placeholder-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                : "border-[#E2E8F0] bg-[#F0F8E8]/80 text-[#1E293B] placeholder:text-[#64748B] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
            }`}
          />
          {fieldErrors.address_line1 && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
              <AlertCircle size={13} className="shrink-0 text-rose-400" />
              <span>{fieldErrors.address_line1}</span>
            </p>
          )}
        </div>

        {/* ADDRESS LINE 2 */}
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#64748B]">
            Address Line 2
            <span className="ml-1 text-xs font-medium normal-case text-[#64748B]">
              (Optional)
            </span>
          </label>

          <input
            name="address_line2"
            autoComplete="address-line2"
            value={form.address_line2}
            onChange={handleChange}
            placeholder="Landmark, nearby place, or area details"
            className="h-12 w-full rounded-xl border border-[#E2E8F0] bg-[#F0F8E8]/80 px-3.5 text-sm font-medium text-[#1E293B] placeholder:text-[#64748B] outline-none transition-all focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
          />
        </div>

        {/* DELIVERY REGION (Balanced 2x2 Grid, No Cutoffs) */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className={`block text-xs font-bold uppercase tracking-wider ${fieldErrors.city ? "text-rose-400" : "text-[#64748B]"}`}>
              Delivery Region / Area <span className={fieldErrors.city ? "text-rose-400 font-black" : "text-[#22499F]"}>*</span>
            </label>
            <span className="text-[11px] font-semibold text-[#22499F]">
              Local delivery zones
            </span>
          </div>

          <div className={`grid grid-cols-2 gap-2 sm:gap-2.5 ${
            fieldErrors.city ? "p-1 rounded-2xl border border-dashed border-rose-400/50 bg-rose-950/20" : ""
          }`}>
            {DELIVERY_REGIONS.map((region) => {
              const isSelected = form.city?.toLowerCase() === region.toLowerCase();

              return (
                <button
                  key={region}
                  type="button"
                  onClick={() => {
                    triggerHaptic("light");
                    setForm((prev) => ({
                      ...prev,
                      city: region,
                    }));
                    if (fieldErrors.city) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.city;
                        return next;
                      });
                    }
                    setFormError("");
                  }}
                  className={`flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl border px-3 py-3 text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer active:scale-95 ${
                    isSelected
                      ? "border-[#22499F] bg-[#FFFFFF] text-[#22499F] shadow-[0_2px_10px_rgba(66,214,232,0.2)] ring-1 ring-[#22499F]/40"
                      : fieldErrors.city
                      ? "border-rose-400/50 bg-rose-950/30 text-rose-300"
                      : "border-[#E2E8F0] bg-[#F0F8E8]/80 text-[#64748B] hover:border-[#22499F]/40 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <MapPin size={15} className={isSelected ? "text-[#22499F]" : fieldErrors.city ? "text-rose-400" : "text-[#64748B]"} />
                  <span className="truncate">{region}</span>
                </button>
              );
            })}
          </div>
          {fieldErrors.city && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
              <AlertCircle size={13} className="shrink-0 text-rose-400" />
              <span>{fieldErrors.city}</span>
            </p>
          )}
          <p className="mt-2.5 text-xs font-medium text-[#64748B] leading-relaxed">
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

        {/* STATE (Permanently Locked To Maharashtra) */}
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#64748B]">
            State
          </label>

          <div className="flex h-11 w-full items-center justify-between rounded-xl border border-white/8 bg-[#F0F8E8]/60 px-3.5 text-xs font-bold text-[#64748B]">
            <div className="flex items-center gap-2">
              <span className="text-[#1E293B]">Maharashtra</span>
              <span className="text-[11px] font-semibold text-[#64748B]">(MH)</span>
            </div>
            <span className="rounded-md bg-[#FFFFFF] border border-[#E2E8F0] px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#22499F]">
              Store Zone
            </span>
          </div>
        </div>

        {/* FORM BUTTONS (Cancel + Primary CTA) */}
        <div className="flex items-center gap-2.5 sm:gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              closeForm();
            }}
            disabled={saving}
            className="h-12 px-5 sm:px-6 rounded-xl border border-[#E2E8F0] bg-white/5 text-sm font-bold text-[#64748B] transition hover:bg-white/10 hover:text-white disabled:opacity-50 cursor-pointer active:scale-95"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={saving}
            onClick={() => triggerHaptic("medium")}
            className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl bg-[#22499F] text-sm font-extrabold text-[#FFFFFF] shadow-[0_4px_16px_rgba(66,214,232,0.3)] transition hover:bg-[#1B3B82] active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
          >
            {saving && (
              <Loader2
                size={17}
                className="animate-spin text-[#FFFFFF]"
              />
            )}

            <span>
              {saving
                ? "Saving..."
                : editingId
                ? "Update Address"
                : "Save Address"}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
