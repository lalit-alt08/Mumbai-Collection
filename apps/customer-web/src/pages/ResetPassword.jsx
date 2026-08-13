import {
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  CheckCircle,
  ArrowLeft,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../services/authService";

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

    if (!password) {
      setPasswordError("Password is required.");
      hasError = true;
    } else if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
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
      console.error(err);

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
    <div className="flex min-h-screen items-center justify-center bg-white font-sans md:bg-[#F8F9F5]">
      <div className="flex w-full flex-col px-6 pb-24 pt-8 md:w-[480px] md:rounded-[24px] md:bg-white md:px-10 md:py-12 md:shadow-[0_10px_40px_rgba(0,0,0,0.04)]">

        {/* Back */}

        <button
          type="button"
          onClick={() => navigate("/login")}
          className="mb-8 flex w-fit items-center gap-2 text-sm font-semibold text-gray-600 transition hover:text-[#FF8A00]"
        >
          <ArrowLeft size={18} />
          Back to Sign In
        </button>

        {/* Heading */}

        <div className="mb-8">
          <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E1E1E] md:text-[32px]">
            Create New Password
          </h1>

          <p className="mt-2 text-[15px] leading-relaxed text-gray-500 md:text-[16px]">
            Choose a new password for your Mumbai Collection account.
          </p>
        </div>

        {/* Invalid token */}

        {!token ? (
          <div className="rounded-2xl bg-red-50 p-5 text-sm font-medium text-red-600">
            This password reset link is invalid.
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5"
          >
            {/* Password */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-gray-700">
                New Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-gray-400">
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
                  className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-12 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/15 ${
                    passwordError
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-200 focus:border-[#FF8A00]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(!showPassword)
                  }
                  className="absolute right-4 text-gray-400 transition-colors hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff size={20} />
                  ) : (
                    <Eye size={20} />
                  )}
                </button>
              </div>

              {passwordError && (
                <p className="mt-2 text-sm text-red-600">
                  {passwordError}
                </p>
              )}
            </div>

            {/* Confirm Password */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-gray-700">
                Confirm New Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-gray-400">
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
                  className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-12 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/15 ${
                    confirmPasswordError
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-200 focus:border-[#FF8A00]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowConfirmPassword(!showConfirmPassword)
                  }
                  className="absolute right-4 text-gray-400 transition-colors hover:text-gray-600"
                >
                  {showConfirmPassword ? (
                    <EyeOff size={20} />
                  ) : (
                    <Eye size={20} />
                  )}
                </button>
              </div>

              {confirmPasswordError && (
                <p className="mt-2 text-sm text-red-600">
                  {confirmPasswordError}
                </p>
              )}
            </div>

            {/* General Error */}

            {error && (
              <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
                {error}
              </div>
            )}

            {/* Success */}

            {success && (
              <div className="flex items-center gap-3 rounded-xl bg-green-50 p-4 text-[13px] font-medium text-green-700">
                <CheckCircle size={20} />
                <span>{success}</span>
              </div>
            )}

            {/* Submit */}

            <button
              type="submit"
              disabled={loading || !!success}
              className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8A00] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(255,138,0,0.25)] transition-all hover:bg-[#FF7300] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
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