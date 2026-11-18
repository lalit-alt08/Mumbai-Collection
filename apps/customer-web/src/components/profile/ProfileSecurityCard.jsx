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
    <div className="rounded-[20px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[#E2E8F0]/60 pb-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#22499F]/10 text-[#22499F] border border-[#22499F]/20">
            <Lock size={17} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-[15.5px] sm:text-base font-extrabold text-[#1E293B] leading-snug">
              Account Security &amp; Contact
            </h2>
            <p className="text-[12.5px] sm:text-[13px] font-medium text-[#475569]">
              {needsPassword ? "Set your account password and mobile number" : "Add your delivery contact number"}
            </p>
          </div>
        </div>
      </div>

      {/* A. Password Inputs (Entered first as requested) */}
      {needsPassword && (
        <>
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              {/* Password Field */}
              <div>
                <label className={`mb-1.5 block text-[13px] font-bold ${errors.password ? "auth-field-error" : "text-[#334155]"}`}>
                  Password <span className="text-[#22499F]">*</span>
                </label>
                <div className="relative">
                  <Lock
                    size={16}
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${errors.password ? "auth-field-error" : "text-[#64748B]"}`}
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
                    className={`h-12 w-full rounded-xl border pl-10 pr-11 text-[15px] font-medium text-[#1E293B] placeholder-[#64748B] outline-none transition ${
                      errors.password
                        ? "border-rose-500 bg-[#F0F8E8] ring-1 ring-rose-500/40 focus:border-rose-500"
                        : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#22499F] cursor-pointer"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold auth-field-error">
                    <AlertCircle size={13} className="shrink-0" />
                    <span>{errors.password}</span>
                  </p>
                )}
              </div>

              {/* Confirm Password Field */}
              <div>
                <label className={`mb-1.5 block text-[13px] font-bold ${errors.confirm_password ? "auth-field-error" : "text-[#334155]"}`}>
                  Confirm Password <span className="text-[#22499F]">*</span>
                </label>
                <div className="relative">
                  <Lock
                    size={16}
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${errors.confirm_password ? "auth-field-error" : "text-[#64748B]"}`}
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
                    className={`h-12 w-full rounded-xl border pl-10 pr-11 text-[15px] font-medium text-[#1E293B] placeholder-[#64748B] outline-none transition ${
                      errors.confirm_password
                        ? "border-rose-500 bg-[#F0F8E8] ring-1 ring-rose-500/40 focus:border-rose-500"
                        : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#22499F] cursor-pointer"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.confirm_password && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold auth-field-error">
                    <AlertCircle size={13} className="shrink-0" />
                    <span>{errors.confirm_password}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Password Rules Checklist */}
            <div className="rounded-xl border border-[#E2E8F0]/70 bg-[#F0F8E8]/70 p-3 text-[12px] text-[#475569] space-y-2">
              <span className="block font-bold text-[#475569] text-[11px] uppercase tracking-wider">
                Password Requirements
              </span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <span className={`flex items-center gap-1.5 ${passwordChecks.length ? "text-emerald-600 font-bold" : "text-[#475569]"}`}>
                  <Check size={13} className={passwordChecks.length ? "opacity-100" : "opacity-35"} /> 8+ characters
                </span>
                <span className={`flex items-center gap-1.5 ${passwordChecks.uppercase ? "text-emerald-600 font-bold" : "text-[#475569]"}`}>
                  <Check size={13} className={passwordChecks.uppercase ? "opacity-100" : "opacity-35"} /> Uppercase (A-Z)
                </span>
                <span className={`flex items-center gap-1.5 ${passwordChecks.lowercase ? "text-emerald-600 font-bold" : "text-[#475569]"}`}>
                  <Check size={13} className={passwordChecks.lowercase ? "opacity-100" : "opacity-35"} /> Lowercase (a-z)
                </span>
                <span className={`flex items-center gap-1.5 ${passwordChecks.number ? "text-emerald-600 font-bold" : "text-[#475569]"}`}>
                  <Check size={13} className={passwordChecks.number ? "opacity-100" : "opacity-35"} /> Number (0-9)
                </span>
                <span className={`flex items-center gap-1.5 col-span-2 sm:col-span-2 ${passwordChecks.special ? "text-emerald-600 font-bold" : "text-[#475569]"}`}>
                  <Check size={13} className={passwordChecks.special ? "opacity-100" : "opacity-35"} /> Special symbol (!@#$%^&*)
                </span>
              </div>
            </div>
          </div>

          {/* B. Divider */}
          <div className="border-t border-[#E2E8F0]/60 pt-3" />
        </>
      )}

      {/* C. Mobile Number & Confirm Mobile Number */}
      <div className="space-y-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#22499F]/10 text-[#22499F] border border-[#22499F]/20">
            <User size={15} strokeWidth={2.2} />
          </div>
          <div>
            <h3 className="text-[14px] font-extrabold text-[#1E293B] leading-snug">
              Delivery Contact Mobile
            </h3>
            <p className="text-[12px] sm:text-[12.5px] font-medium text-[#475569]">
              Used for order delivery updates &amp; driver contact
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div>
            <label className={`mb-1.5 block text-[13px] font-bold ${errors.phone ? "auth-field-error" : "text-[#334155]"}`}>
              Mobile Number <span className="text-[#22499F]">*</span>
            </label>
            <div className="relative flex items-center w-full">
              <span
                className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] font-bold transition-colors ${
                  errors.phone ? "auth-field-error" : "text-[#475569]"
                }`}
              >
                +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                name="phone"
                placeholder="10-digit mobile number"
                value={form.phone}
                onChange={handleChange}
                onBlur={() => {
                  if (form.phone.length === 10) {
                    verifyPhoneAvailability(form.phone);
                  }
                }}
                required
                className={`h-12 w-full rounded-xl border pl-12 pr-10 text-[15px] font-medium text-[#1E293B] placeholder-[#64748B] outline-none transition ${
                  errors.phone
                    ? "border-rose-500 bg-[#F0F8E8] ring-1 ring-rose-500/40 focus:border-rose-500"
                    : phoneAvailable === true
                      ? "border-emerald-600/70 bg-[#F0F8E8] ring-1 ring-emerald-500/30 focus:border-emerald-500"
                      : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                }`}
              />
              {phoneChecking && (
                <Loader2
                  size={16}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-[#22499F]"
                />
              )}
              {!phoneChecking && phoneAvailable === true && !errors.phone && (
                <CheckCircle2
                  size={16}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-600"
                />
              )}
            </div>
            {phoneChecking && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#22499F]">
                <Loader2 size={13} className="shrink-0 animate-spin text-[#22499F]" />
                <span>Checking number availability...</span>
              </p>
            )}
            {!phoneChecking && errors.phone && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold auth-field-error">
                <AlertCircle size={13} className="shrink-0" />
                <span>{errors.phone}</span>
              </p>
            )}
            {!phoneChecking && phoneAvailable === true && !errors.phone && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600">
                <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
                <span>Mobile number is available</span>
              </p>
            )}
          </div>

          <div>
            <label className={`mb-1.5 block text-[13px] font-bold ${errors.confirm_phone ? "auth-field-error" : "text-[#334155]"}`}>
              Confirm Mobile Number <span className="text-[#22499F]">*</span>
            </label>
            <div className="relative flex items-center w-full">
              <span
                className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] font-bold transition-colors ${
                  errors.confirm_phone ? "auth-field-error" : "text-[#475569]"
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
                placeholder="Re-enter mobile number"
                value={confirmPhone}
                onChange={handleChange}
                required
                aria-invalid={Boolean(errors.confirm_phone)}
                className={`h-12 w-full rounded-xl border pl-12 pr-3.5 text-[15px] font-medium text-[#1E293B] placeholder-[#64748B] outline-none transition ${
                  errors.confirm_phone
                    ? "border-rose-500 bg-[#F0F8E8] ring-1 ring-rose-500/40 focus:border-rose-500"
                    : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                }`}
              />
            </div>
            {errors.confirm_phone && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold auth-field-error">
                <AlertCircle size={13} className="shrink-0" />
                <span>{errors.confirm_phone}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
