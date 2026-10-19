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
    <div className="bg-[#0B1425] font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center">
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[480px] md:rounded-[24px] md:bg-[#111F36] md:border md:border-[#1E3252]/80 md:px-10 md:py-12 md:shadow-lg">

        {/* Back Button */}
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="mb-6 flex w-fit items-center gap-2 text-sm font-semibold text-[#8FA4BE] transition hover:text-[#42D6E8] cursor-pointer"
        >
          <ArrowLeft size={18} />
          Back to Sign In
        </button>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-[28px] font-extrabold tracking-tight text-[#F1F5F9] md:text-[32px]">
            Forgot Password?
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#8FA4BE] md:text-[16px]">
            Enter your email address and we'll send you a link to reset your password.
          </p>
        </div>

        {/* RESET VIA EMAIL LINK FORM */}
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-5">
          <div>
            <label className="mb-2 block text-[13px] font-bold text-[#8FA4BE]">
              Email Address
            </label>

            <div className="relative flex items-center">
              <div className="absolute left-4 text-[#6E84A3]">
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
                className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-12 pr-4 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                  emailError
                    ? "border-rose-400 focus:border-rose-400"
                    : "border-[#1E3252] focus:border-[#42D6E8]"
                }`}
                required
              />
            </div>

            {emailError && (
              <p className="mt-2 text-sm text-rose-400">{emailError}</p>
            )}
          </div>

          {emailGeneralError && (
            <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-4 text-[13px] font-medium text-rose-300">
              {emailGeneralError}
            </div>
          )}

          {emailSuccess && (
            <div className="rounded-xl border border-[#1E3252] bg-[#132B45] p-4 text-[13px] font-medium text-[#67E8F9]">
              {emailSuccess}
            </div>
          )}

          <button
            type="submit"
            disabled={emailLoading}
            className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] text-[16px] font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
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