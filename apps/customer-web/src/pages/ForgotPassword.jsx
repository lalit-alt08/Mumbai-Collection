import {
  Mail,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { forgotPassword } from "../services/authService";

function ForgotPassword() {
  const navigate = useNavigate();

  // Email Reset Link Flow State
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailGeneralError, setEmailGeneralError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setEmailError("");
    setEmailGeneralError("");
    setEmailSuccess("");

    if (!email.trim()) {
      setEmailError("Email is required.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email address.");
      return;
    }

    try {
      setEmailLoading(true);
      const response = await forgotPassword(email.trim());
      setEmailSuccess(
        response.message ||
          "If an account exists with this email, a password reset link has been sent."
      );
      setEmail("");
    } catch (err) {
      setEmailGeneralError(
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Unable to process your request. Please try again."
      );
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div className="bg-white font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center md:bg-[#F7F7FB]">
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[480px] md:rounded-[24px] md:bg-white md:px-10 md:py-12 md:shadow-[0_10px_40px_rgba(0,0,0,0.04)]">

        {/* Back Button */}
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="mb-6 flex w-fit items-center gap-2 text-sm font-semibold text-gray-600 transition hover:text-[#7C3AED]"
        >
          <ArrowLeft size={18} />
          Back to Sign In
        </button>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E1E1E] md:text-[32px]">
            Forgot Password?
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-gray-500 md:text-[16px]">
            Enter your email address and we'll send you a link to reset your password.
          </p>
        </div>

        {/* RESET VIA EMAIL LINK FORM */}
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-5">
          <div>
            <label className="mb-2 block text-[13px] font-bold text-gray-700">
              Email Address
            </label>

            <div className="relative flex items-center">
              <div className="absolute left-4 text-gray-400">
                <Mail size={20} strokeWidth={2} />
              </div>

              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError("");
                  setEmailGeneralError("");
                  setEmailSuccess("");
                }}
                className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-4 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 ${
                  emailError
                    ? "border-red-300 focus:border-red-400"
                    : "border-gray-200 focus:border-[#7C3AED]"
                }`}
                required
              />
            </div>

            {emailError && (
              <p className="mt-2 text-sm text-red-600">{emailError}</p>
            )}
          </div>

          {emailGeneralError && (
            <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
              {emailGeneralError}
            </div>
          )}

          {emailSuccess && (
            <div className="rounded-xl bg-green-50 p-4 text-[13px] font-medium text-green-700">
              {emailSuccess}
            </div>
          )}

          <button
            type="submit"
            disabled={emailLoading}
            className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {emailLoading ? "Sending..." : "Send Reset Link"}
            {!emailLoading && <ArrowRight size={20} />}
          </button>
        </form>

      </div>
    </div>
  );
}

export default ForgotPassword;