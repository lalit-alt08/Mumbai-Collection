import {
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Check,
  User,
  Loader2,
  CheckCircle2,
} from "lucide-react";

export function ProfileSecurityCard({
  needsPassword,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  showPassword,
  setShowPassword,
  showConfirmPassword,
  setShowConfirmPassword,
  passwordChecks,
  errors,
  setErrors,
  form,
  confirmPhone,
  handleChange,
  phoneChecking,
  phoneAvailable,
  verifyPhoneAvailability,
}) {
  return (
    <div className="rounded-[20px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-4.5 sm:p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[#E2E8F0]/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#22499F]/10 text-[#22499F] border border-[#22499F]/20">
            <Lock size={16} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-[#1E293B]">
              Account Security & Contact
            </h2>
            <p className="text-[11px] font-medium text-[#64748B]">
              {needsPassword ? "Set your account password and mobile number" : "Add your delivery contact number"}
            </p>
          </div>
        </div>
      </div>

      {/* A. Password Inputs (Entered first as requested) */}
      {needsPassword && (
        <>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Password Field */}
              <div>
                <label className={`mb-1 block text-xs font-bold ${errors.password ? "text-rose-400" : "text-[#64748B]"}`}>
                  Password <span className="text-[#22499F]">*</span>
                </label>
                <div className="relative">
                  <Lock
                    size={15}
                    className={`absolute left-3 top-1/2 -translate-y-1/2 ${errors.password ? "text-rose-400" : "text-[#64748B]"}`}
                  />
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="new-password"
                    placeholder="Create a strong password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) {
                        setErrors((prev) => {
                          const copy = { ...prev };
                          delete copy.password;
                          return copy;
                        });
                      }
                    }}
                    required
                    className={`h-11 w-full rounded-xl border pl-9 pr-10 text-xs sm:text-sm font-semibold text-[#1E293B] outline-none transition ${
                      errors.password
                        ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                        : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#22499F] cursor-pointer"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                    <AlertCircle size={12} className="shrink-0 text-rose-400" />
                    <span>{errors.password}</span>
                  </p>
                )}
              </div>

              {/* Confirm Password Field */}
              <div>
                <label className={`mb-1 block text-xs font-bold ${errors.confirm_password ? "text-rose-400" : "text-[#64748B]"}`}>
                  Confirm Password <span className="text-[#22499F]">*</span>
                </label>
                <div className="relative">
                  <Lock
                    size={15}
                    className={`absolute left-3 top-1/2 -translate-y-1/2 ${errors.confirm_password ? "text-rose-400" : "text-[#64748B]"}`}
                  />
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    name="confirm_password"
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (errors.confirm_password) {
                        setErrors((prev) => {
                          const copy = { ...prev };
                          delete copy.confirm_password;
                          return copy;
                        });
                      }
                    }}
                    required
                    className={`h-11 w-full rounded-xl border pl-9 pr-10 text-xs sm:text-sm font-semibold text-[#1E293B] outline-none transition ${
                      errors.confirm_password
                        ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                        : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#22499F] cursor-pointer"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.confirm_password && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                    <AlertCircle size={12} className="shrink-0 text-rose-400" />
                    <span>{errors.confirm_password}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Password Rules Checklist */}
            <div className="rounded-xl border border-[#E2E8F0]/60 bg-[#F0F8E8]/70 p-3 text-[11px] text-[#64748B] space-y-1.5">
              <span className="block font-bold text-[#64748B] text-[10px] uppercase tracking-wider">
                Password Requirements
              </span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <span className={`flex items-center gap-1 ${passwordChecks.length ? "text-emerald-400 font-bold" : "text-[#64748B]"}`}>
                  <Check size={12} className={passwordChecks.length ? "opacity-100" : "opacity-30"} /> 8+ characters
                </span>
                <span className={`flex items-center gap-1 ${passwordChecks.uppercase ? "text-emerald-400 font-bold" : "text-[#64748B]"}`}>
                  <Check size={12} className={passwordChecks.uppercase ? "opacity-100" : "opacity-30"} /> Uppercase (A-Z)
                </span>
                <span className={`flex items-center gap-1 ${passwordChecks.lowercase ? "text-emerald-400 font-bold" : "text-[#64748B]"}`}>
                  <Check size={12} className={passwordChecks.lowercase ? "opacity-100" : "opacity-30"} /> Lowercase (a-z)
                </span>
                <span className={`flex items-center gap-1 ${passwordChecks.number ? "text-emerald-400 font-bold" : "text-[#64748B]"}`}>
                  <Check size={12} className={passwordChecks.number ? "opacity-100" : "opacity-30"} /> Number (0-9)
                </span>
                <span className={`flex items-center gap-1 col-span-2 sm:col-span-2 ${passwordChecks.special ? "text-emerald-400 font-bold" : "text-[#64748B]"}`}>
                  <Check size={12} className={passwordChecks.special ? "opacity-100" : "opacity-30"} /> Special symbol (!@#$%^&*)
                </span>
              </div>
            </div>
          </div>

          {/* B. Divider */}
          <div className="border-t border-[#E2E8F0]/60 pt-3" />
        </>
      )}

      {/* C. Mobile Number & Confirm Mobile Number */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#22499F]/10 text-[#22499F] border border-[#22499F]/20">
            <User size={14} strokeWidth={2.2} />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-extrabold text-[#1E293B]">
              Delivery Contact Mobile
            </h3>
            <p className="text-[10px] font-medium text-[#64748B]">
              Used for order delivery updates & driver contact
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={`mb-1 block text-xs font-bold ${errors.phone ? "text-rose-400" : "text-[#64748B]"}`}>
              Mobile Number <span className="text-[#22499F]">*</span>
            </label>
            <div className="relative flex items-center w-full">
              <span
                className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold transition-colors ${
                  errors.phone ? "text-rose-400" : "text-[#64748B]"
                }`}
              >
                +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                name="phone"
                value={form.phone}
                onChange={handleChange}
                onBlur={() => {
                  if (form.phone.length === 10) {
                    verifyPhoneAvailability(form.phone);
                  }
                }}
                required
                className={`h-11 w-full rounded-xl border pl-11 pr-9 text-xs sm:text-sm font-semibold text-[#1E293B] outline-none transition ${
                  errors.phone
                    ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                    : phoneAvailable === true
                      ? "border-emerald-500/70 bg-[#F0F8E8] ring-1 ring-emerald-500/30 focus:border-emerald-400"
                      : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                }`}
              />
              {phoneChecking && (
                <Loader2
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#22499F]"
                />
              )}
              {!phoneChecking && phoneAvailable === true && !errors.phone && (
                <CheckCircle2
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400"
                />
              )}
            </div>
            {phoneChecking && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-[#22499F]">
                <Loader2 size={12} className="shrink-0 animate-spin text-[#22499F]" />
                <span>Checking number availability...</span>
              </p>
            )}
            {!phoneChecking && errors.phone && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                <AlertCircle size={12} className="shrink-0 text-rose-400" />
                <span>{errors.phone}</span>
              </p>
            )}
            {!phoneChecking && phoneAvailable === true && !errors.phone && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />
                <span>Mobile number is available</span>
              </p>
            )}
          </div>

          <div>
            <label className={`mb-1 block text-xs font-bold ${errors.confirm_phone ? "text-rose-400" : "text-[#64748B]"}`}>
              Confirm Mobile Number <span className="text-[#22499F]">*</span>
            </label>
            <div className="relative flex items-center w-full">
              <span
                className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold transition-colors ${
                  errors.confirm_phone ? "text-rose-400" : "text-[#64748B]"
                }`}
              >
                +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                name="confirm_phone"
                value={confirmPhone}
                onChange={handleChange}
                required
                aria-invalid={Boolean(errors.confirm_phone)}
                className={`h-11 w-full rounded-xl border pl-11 pr-3 text-xs sm:text-sm font-semibold text-[#1E293B] outline-none transition ${
                  errors.confirm_phone
                    ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                    : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                }`}
              />
            </div>
            {errors.confirm_phone && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                <AlertCircle size={12} className="shrink-0 text-rose-400" />
                <span>{errors.confirm_phone}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
