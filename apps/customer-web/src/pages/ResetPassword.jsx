import {
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  CheckCircle,
  ArrowLeft,
  Check,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { resetPassword } from "../services/authService";
import { validatePassword, getPasswordRuleChecks } from "../utils/passwordValidator.js";

function ResetPassword() {
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token"));

  useEffect(() => {
    window.history.replaceState({}, "", "/reset-password");
  }, []);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [loading, setLoading] = useState(false);

  const passwordChecks = getPasswordRuleChecks(password);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setPasswordError("");
    setConfirmPasswordError("");
    setError("");
    setSuccess("");

    if (!token) {
      setError("This password reset link is invalid.");
      return;
    }

    let hasError = false;

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setPasswordError(passwordValidation.message);
      hasError = true;
    }

    if (!confirmPassword) {
      setConfirmPasswordError("Please confirm your password.");
      hasError = true;
    } else if (password !== confirmPassword) {
      setConfirmPasswordError("Passwords do not match.");
      hasError = true;
    }

    if (hasError) {
      return;
    }

    try {
      setLoading(true);

      const response = await resetPassword(token, password);

      setSuccess(
        response.message ||
          "Password reset successfully. You can now login."
      );

      setPassword("");
      setConfirmPassword("");

      // Give the user a moment to see the success message
      setTimeout(() => {
        navigate("/login");
      }, 1800);
    } catch (err) {
      const message =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "This password reset link is invalid or has expired.";

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F0F8E8] font-sans">
      <div className="flex w-full flex-col px-6 pb-24 pt-8 md:w-[480px] md:rounded-[24px] md:bg-[#FFFFFF] md:border md:border-[#E2E8F0]/80 md:px-10 md:py-12 md:shadow-lg">

        {/* Back */}

        <button
          type="button"
          onClick={() => navigate("/login")}
          className="mb-8 flex w-fit items-center gap-2 text-sm font-semibold text-[#64748B] transition hover:text-[#22499F] cursor-pointer"
        >
          <ArrowLeft size={18} />
          Back to Sign In
        </button>

        {/* Heading */}

        <div className="mb-8">
          <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E293B] md:text-[32px]">
            Create New Password
          </h1>

          <p className="mt-2 text-[15px] leading-relaxed text-[#64748B] md:text-[16px]">
            Choose a new password for your Mumbai Collection account.
          </p>
        </div>

        {/* Invalid token */}

        {!token ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-5 text-sm font-medium text-rose-300">
              This password reset link is invalid or has expired.
            </div>
            <button
              type="button"
              onClick={() => navigate("/forgot-password")}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#22499F] text-[15px] font-bold text-[#FFFFFF] shadow-md transition-all hover:bg-[#1B3B82] active:scale-[0.98] cursor-pointer"
            >
              Reset with Email OTP
              <ArrowRight size={18} />
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5"
          >
            {/* Password */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#64748B]">
                New Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-[#64748B]">
                  <Lock size={20} strokeWidth={2} />
                </div>

                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError("");
                    setError("");
                  }}
                  className={`h-[56px] w-full rounded-2xl border bg-[#F0F8E8] pl-12 pr-12 text-[15px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                    passwordError
                      ? "border-rose-400 focus:border-rose-400"
                      : "border-[#E2E8F0] focus:border-[#22499F]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(!showPassword)
                  }
                  className="absolute right-4 text-[#64748B] transition-colors hover:text-[#22499F] cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff size={20} />
                  ) : (
                    <Eye size={20} />
                  )}
                </button>
              </div>

              {password.length > 0 && (
                <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl border border-[#E2E8F0]/60 bg-[#F0F8E8]/80 p-2.5 text-xs text-[#64748B]">
                  <span className={`flex items-center gap-1.5 ${passwordChecks.length ? "text-emerald-400 font-medium" : "text-[#64748B]"}`}>
                    <Check size={13} className={passwordChecks.length ? "opacity-100" : "opacity-30"} /> 8+ characters
                  </span>
                  <span className={`flex items-center gap-1.5 ${passwordChecks.uppercase ? "text-emerald-400 font-medium" : "text-[#64748B]"}`}>
                    <Check size={13} className={passwordChecks.uppercase ? "opacity-100" : "opacity-30"} /> Uppercase (A-Z)
                  </span>
                  <span className={`flex items-center gap-1.5 ${passwordChecks.lowercase ? "text-emerald-400 font-medium" : "text-[#64748B]"}`}>
                    <Check size={13} className={passwordChecks.lowercase ? "opacity-100" : "opacity-30"} /> Lowercase (a-z)
                  </span>
                  <span className={`flex items-center gap-1.5 ${passwordChecks.number ? "text-emerald-400 font-medium" : "text-[#64748B]"}`}>
                    <Check size={13} className={passwordChecks.number ? "opacity-100" : "opacity-30"} /> Number (0-9)
                  </span>
                  <span className={`flex items-center gap-1.5 col-span-2 ${passwordChecks.special ? "text-emerald-400 font-medium" : "text-[#64748B]"}`}>
                    <Check size={13} className={passwordChecks.special ? "opacity-100" : "opacity-30"} /> Special character (!@#$%^&*)
                  </span>
                </div>
              )}

              {passwordError && (
                <p className="mt-2 text-sm text-rose-400">
                  {passwordError}
                </p>
              )}
            </div>

            {/* Confirm Password */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#64748B]">
                Confirm New Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-[#64748B]">
                  <Lock size={20} strokeWidth={2} />
                </div>

                <input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setConfirmPasswordError("");
                    setError("");
                  }}
                  className={`h-[56px] w-full rounded-2xl border bg-[#F0F8E8] pl-12 pr-12 text-[15px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                    confirmPasswordError
                      ? "border-rose-400 focus:border-rose-400"
                      : "border-[#E2E8F0] focus:border-[#22499F]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowConfirmPassword(!showConfirmPassword)
                  }
                  className="absolute right-4 text-[#64748B] transition-colors hover:text-[#22499F] cursor-pointer"
                >
                  {showConfirmPassword ? (
                    <EyeOff size={20} />
                  ) : (
                    <Eye size={20} />
                  )}
                </button>
              </div>

              {confirmPasswordError && (
                <p className="mt-2 text-sm text-rose-400">
                  {confirmPasswordError}
                </p>
              )}
            </div>

            {/* General Error */}

            {error && (
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-4 text-[13px] font-medium text-rose-300">
                {error}
              </div>
            )}

            {/* Success */}

            {success && (
              <div className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-4 text-[13px] font-medium text-[#22499F]">
                <CheckCircle size={20} className="text-[#22499F]" />
                <span>{success}</span>
              </div>
            )}

            {/* Submit */}

            <button
              type="submit"
              disabled={loading || !!success}
              className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#22499F] text-[16px] font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
            >
              {loading ? "Updating..." : "Reset Password"}

              {!loading && !success && <ArrowRight size={20} />}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default ResetPassword;
