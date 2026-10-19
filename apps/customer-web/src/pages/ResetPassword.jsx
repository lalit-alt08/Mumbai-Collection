import {
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  CheckCircle,
  ArrowLeft,
  Check,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../services/authService";
import { validatePassword, getPasswordRuleChecks } from "../utils/passwordValidator.js";

function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = searchParams.get("token");

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
    <div className="flex min-h-screen items-center justify-center bg-[#0B1425] font-sans">
      <div className="flex w-full flex-col px-6 pb-24 pt-8 md:w-[480px] md:rounded-[24px] md:bg-[#111F36] md:border md:border-[#1E3252]/80 md:px-10 md:py-12 md:shadow-lg">

        {/* Back */}

        <button
          type="button"
          onClick={() => navigate("/login")}
          className="mb-8 flex w-fit items-center gap-2 text-sm font-semibold text-[#8FA4BE] transition hover:text-[#42D6E8] cursor-pointer"
        >
          <ArrowLeft size={18} />
          Back to Sign In
        </button>

        {/* Heading */}

        <div className="mb-8">
          <h1 className="text-[28px] font-extrabold tracking-tight text-[#F1F5F9] md:text-[32px]">
            Create New Password
          </h1>

          <p className="mt-2 text-[15px] leading-relaxed text-[#8FA4BE] md:text-[16px]">
            Choose a new password for your Mumbai Collection account.
          </p>
        </div>

        {/* Invalid token */}

        {!token ? (
          <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-5 text-sm font-medium text-rose-300">
            This password reset link is invalid.
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5"
          >
            {/* Password */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#8FA4BE]">
                New Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-[#6E84A3]">
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
                  className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-12 pr-12 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                    passwordError
                      ? "border-rose-400 focus:border-rose-400"
                      : "border-[#1E3252] focus:border-[#42D6E8]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(!showPassword)
                  }
                  className="absolute right-4 text-[#6E84A3] transition-colors hover:text-[#42D6E8] cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff size={20} />
                  ) : (
                    <Eye size={20} />
                  )}
                </button>
              </div>

              {password.length > 0 && (
                <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl border border-[#1E3252]/60 bg-[#080F1C]/80 p-2.5 text-xs text-[#8FA4BE]">
                  <span className={`flex items-center gap-1.5 ${passwordChecks.length ? "text-emerald-400 font-medium" : "text-[#6E84A3]"}`}>
                    <Check size={13} className={passwordChecks.length ? "opacity-100" : "opacity-30"} /> 8+ characters
                  </span>
                  <span className={`flex items-center gap-1.5 ${passwordChecks.uppercase ? "text-emerald-400 font-medium" : "text-[#6E84A3]"}`}>
                    <Check size={13} className={passwordChecks.uppercase ? "opacity-100" : "opacity-30"} /> Uppercase (A-Z)
                  </span>
                  <span className={`flex items-center gap-1.5 ${passwordChecks.lowercase ? "text-emerald-400 font-medium" : "text-[#6E84A3]"}`}>
                    <Check size={13} className={passwordChecks.lowercase ? "opacity-100" : "opacity-30"} /> Lowercase (a-z)
                  </span>
                  <span className={`flex items-center gap-1.5 ${passwordChecks.number ? "text-emerald-400 font-medium" : "text-[#6E84A3]"}`}>
                    <Check size={13} className={passwordChecks.number ? "opacity-100" : "opacity-30"} /> Number (0-9)
                  </span>
                  <span className={`flex items-center gap-1.5 col-span-2 ${passwordChecks.special ? "text-emerald-400 font-medium" : "text-[#6E84A3]"}`}>
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
              <label className="mb-2 block text-[13px] font-bold text-[#8FA4BE]">
                Confirm New Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-[#6E84A3]">
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
                  className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-12 pr-12 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                    confirmPasswordError
                      ? "border-rose-400 focus:border-rose-400"
                      : "border-[#1E3252] focus:border-[#42D6E8]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowConfirmPassword(!showConfirmPassword)
                  }
                  className="absolute right-4 text-[#6E84A3] transition-colors hover:text-[#42D6E8] cursor-pointer"
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
              <div className="flex items-center gap-3 rounded-xl border border-[#1E3252] bg-[#132B45] p-4 text-[13px] font-medium text-[#67E8F9]">
                <CheckCircle size={20} className="text-[#42D6E8]" />
                <span>{success}</span>
              </div>
            )}

            {/* Submit */}

            <button
              type="submit"
              disabled={loading || !!success}
              className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] text-[16px] font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
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