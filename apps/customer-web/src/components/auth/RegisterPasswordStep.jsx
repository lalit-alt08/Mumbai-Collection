import { useState } from "react";
import { Lock, Eye, EyeOff, Check, ArrowRight } from "lucide-react";
import { getPasswordRuleChecks } from "../../utils/passwordValidator.js";

export function RegisterPasswordStep({
  email,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  error,
  loading,
  handleVerifyAndRegister,
  onResetToDetails,
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const checks = getPasswordRuleChecks(password);

  return (
    <form onSubmit={handleVerifyAndRegister} className="flex flex-col gap-4">
      <div>
        <h1 className="text-[24px] sm:text-[28px] font-extrabold tracking-tight text-[#1E293B]">
          Create Your Password
        </h1>
        <p className="mt-1.5 text-[14px] sm:text-[15px] leading-relaxed text-[#475569]">
          Email verified for <span className="font-semibold text-[#1E293B]">{email}</span>. Set a strong password to finish creating your account.
        </p>
      </div>

      {/* Password Field */}
      <div>
        <label
          htmlFor="register-password"
          className="mb-1.5 block text-[13px] font-bold text-[#334155]"
        >
          Password
        </label>
        <div className="relative flex items-center">
          <div className="pointer-events-none absolute left-3.5 text-[#64748B]">
            <Lock size={18} strokeWidth={2} />
          </div>
          <input
            id="register-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            required
            maxLength={256}
            placeholder="Create a strong password"
            aria-describedby="password-help"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-[52px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] pl-11 pr-12 text-[15px] font-medium text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:border-[#22499F] focus:ring-4 focus:ring-[#22499F]/15"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3.5 text-[#64748B] transition-colors hover:text-[#22499F] cursor-pointer"
          >
            {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </div>

        {/* Password Checklist */}
        <div
          id="password-help"
          className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl border border-[#E2E8F0]/80 bg-[#FFFFFF] p-3 text-[12px] text-[#475569]"
        >
          <span className={`flex items-center gap-1.5 ${checks.length ? "password-rule-passed text-emerald-600 font-semibold" : ""}`}>
            <Check size={13} className={checks.length ? "opacity-100" : "opacity-35"} /> 8+ characters
          </span>
          <span className={`flex items-center gap-1.5 ${checks.uppercase ? "password-rule-passed text-emerald-600 font-semibold" : ""}`}>
            <Check size={13} className={checks.uppercase ? "opacity-100" : "opacity-35"} /> Uppercase (A-Z)
          </span>
          <span className={`flex items-center gap-1.5 ${checks.lowercase ? "password-rule-passed text-emerald-600 font-semibold" : ""}`}>
            <Check size={13} className={checks.lowercase ? "opacity-100" : "opacity-35"} /> Lowercase (a-z)
          </span>
          <span className={`flex items-center gap-1.5 ${checks.number ? "password-rule-passed text-emerald-600 font-semibold" : ""}`}>
            <Check size={13} className={checks.number ? "opacity-100" : "opacity-35"} /> Number (0-9)
          </span>
          <span className={`col-span-2 flex items-center gap-1.5 ${checks.special ? "password-rule-passed text-emerald-600 font-semibold" : ""}`}>
            <Check size={13} className={checks.special ? "opacity-100" : "opacity-35"} /> Special symbol (!@#$%^&*)
          </span>
        </div>
      </div>

      {/* Confirm Password Field */}
      <div>
        <label
          htmlFor="register-confirm-password"
          className="mb-1.5 block text-[13px] font-bold text-[#334155]"
        >
          Confirm Password
        </label>
        <div className="relative flex items-center">
          <div className="pointer-events-none absolute left-3.5 text-[#64748B]">
            <Lock size={18} strokeWidth={2} />
          </div>
          <input
            id="register-confirm-password"
            type={showConfirmPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            maxLength={256}
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="h-[52px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] pl-11 pr-12 text-[15px] font-medium text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:border-[#22499F] focus:ring-4 focus:ring-[#22499F]/15"
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword((prev) => !prev)}
            aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
            className="absolute right-3.5 text-[#64748B] transition-colors hover:text-[#22499F] cursor-pointer"
          >
            {showConfirmPassword ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="auth-error-banner rounded-xl border p-3.5 text-[13px] font-semibold">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-1 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#22499F] text-[15px] sm:text-[16px] font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] active:scale-[0.98] disabled:opacity-60 cursor-pointer"
      >
        <span>{loading ? "Creating Account..." : "Create Account"}</span>
        {!loading && <ArrowRight size={18} />}
      </button>

      <button
        type="button"
        disabled={loading}
        onClick={onResetToDetails}
        className="text-center text-[13.5px] font-semibold text-[#22499F] hover:underline cursor-pointer"
      >
        Change email or request a new code
      </button>
    </form>
  );
}
