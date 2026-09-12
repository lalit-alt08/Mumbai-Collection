import {
  Mail,
  ArrowLeft,
  ArrowRight,
  Smartphone,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  RotateCw,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  forgotPassword,
  sendOtp,
  verifyOtp,
  resetPasswordOtp,
} from "../services/authService";

const isValidIndianPhone = (val) => {
  const digits = String(val || "").replace(/\D/g, "");
  return /^[6-9]\d{9}$/.test(digits);
};

function ForgotPassword() {
  const navigate = useNavigate();

  // Mode: "email" | "mobile"
  const [resetMode, setResetMode] = useState("email");

  // Email Flow State
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailGeneralError, setEmailGeneralError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");

  // Mobile SMS OTP Flow State
  // Steps: 1 = Enter Phone, 2 = Enter OTP, 3 = New Password, 4 = Success
  const [mobileStep, setMobileStep] = useState(1);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [cooldown, setCooldown] = useState(0);
  const [mobileLoading, setMobileLoading] = useState(false);
  const [mobileError, setMobileError] = useState("");
  const [mobileSuccess, setMobileSuccess] = useState("");

  // Cooldown countdown timer for OTP resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  // Handle Mode Switch
  const handleModeChange = (mode) => {
    setResetMode(mode);
    setEmailError("");
    setEmailGeneralError("");
    setEmailSuccess("");
    setMobileError("");
    setMobileSuccess("");
  };

  // ─────────────────────────────────────────────
  // EMAIL FLOW HANDLER
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // MOBILE FLOW HANDLERS
  // ─────────────────────────────────────────────

  // Step 1: Request OTP
  const handleSendMobileOtp = async (e) => {
    if (e) e.preventDefault();
    setMobileError("");
    setMobileSuccess("");

    const cleanPhone = phone.replace(/\D/g, "");
    if (!isValidIndianPhone(cleanPhone)) {
      setMobileError("Please enter a valid 10-digit Indian mobile number.");
      return;
    }

    try {
      setMobileLoading(true);
      const res = await sendOtp(cleanPhone, "reset_password");
      setMobileStep(2);
      setCooldown(60);
      setMobileSuccess(
        res.message || "For security, if this number is registered, an OTP has been sent."
      );
    } catch (err) {
      setMobileError(
        err.response?.data?.message ||
          "Unable to send verification code. Please try again."
      );
    } finally {
      setMobileLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyMobileOtp = async (e) => {
    e.preventDefault();
    setMobileError("");
    setMobileSuccess("");

    const cleanPhone = phone.replace(/\D/g, "");
    const cleanOtp = String(otp || "").trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      setMobileError("Please enter the 6-digit verification code.");
      return;
    }

    try {
      setMobileLoading(true);
      const res = await verifyOtp(cleanPhone, cleanOtp, "reset_password");
      if (res.success && res.reset_token) {
        setResetToken(res.reset_token);
        setMobileStep(3);
        setOtp("");
        setMobileSuccess("");
      } else {
        setMobileError(res.message || "Invalid or expired OTP. Please try again.");
      }
    } catch (err) {
      setMobileError(
        err.response?.data?.message || "Invalid or expired verification code."
      );
    } finally {
      setMobileLoading(false);
    }
  };

  // Step 3: Reset Password with Reset Token
  const handleResetPasswordSubmit = async (e) => {
    e.preventDefault();
    setMobileError("");
    setMobileSuccess("");

    if (!newPassword) {
      setMobileError("New password is required.");
      return;
    }

    if (newPassword.length < 8) {
      setMobileError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMobileError("Passwords do not match.");
      return;
    }

    const cleanPhone = phone.replace(/\D/g, "");

    try {
      setMobileLoading(true);
      const res = await resetPasswordOtp(cleanPhone, resetToken, newPassword);
      if (res.success) {
        // Clear sensitive credentials immediately
        setResetToken("");
        setNewPassword("");
        setConfirmPassword("");
        setMobileStep(4);
      } else {
        setMobileError(res.message || "Unable to reset password. Please try again.");
      }
    } catch (err) {
      setMobileError(
        err.response?.data?.message ||
          "We couldn't complete the password reset. Please try again."
      );
    } finally {
      setMobileLoading(false);
    }
  };

  return (
    <div className="bg-white font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center md:bg-[#F7F7FB]">
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[480px] md:rounded-[24px] md:bg-white md:px-10 md:py-12 md:shadow-[0_10px_40px_rgba(0,0,0,0.04)]">

        {/* Back Button */}
        <button
          type="button"
          onClick={() => {
            if (resetMode === "mobile" && mobileStep > 1 && mobileStep < 4) {
              setMobileStep((prev) => prev - 1);
              setMobileError("");
              setMobileSuccess("");
            } else {
              navigate("/login");
            }
          }}
          className="mb-6 flex w-fit items-center gap-2 text-sm font-semibold text-gray-600 transition hover:text-[#7C3AED]"
        >
          <ArrowLeft size={18} />
          {resetMode === "mobile" && mobileStep > 1 && mobileStep < 4
            ? "Previous Step"
            : "Back to Sign In"}
        </button>

        {/* Header */}
        {mobileStep !== 4 && (
          <div className="mb-6">
            <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E1E1E] md:text-[32px]">
              Forgot Password?
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-gray-500 md:text-[16px]">
              {resetMode === "email"
                ? "Enter your email address and we'll send you a link to reset your password."
                : mobileStep === 1
                ? "Enter your registered mobile number to receive a verification code."
                : mobileStep === 2
                ? "Enter the 6-digit code sent to your mobile phone."
                : "Create a new strong password for your account."}
            </p>
          </div>
        )}

        {/* Toggle between Email and Mobile (Only shown before completion) */}
        {mobileStep !== 4 && (
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1.5">
            <button
              type="button"
              onClick={() => handleModeChange("email")}
              className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-bold transition-all ${
                resetMode === "email"
                  ? "bg-white text-[#7C3AED] shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Mail size={16} />
              Via Email
            </button>

            <button
              type="button"
              onClick={() => handleModeChange("mobile")}
              className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-bold transition-all ${
                resetMode === "mobile"
                  ? "bg-white text-[#7C3AED] shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Smartphone size={16} />
              Via Mobile SMS
            </button>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            1. RESET VIA EMAIL FORM
        ───────────────────────────────────────────────────────────── */}
        {resetMode === "email" && (
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
        )}

        {/* ─────────────────────────────────────────────────────────────
            2. RESET VIA MOBILE SMS OTP FLOW
        ───────────────────────────────────────────────────────────── */}
        {resetMode === "mobile" && (
          <div>
            {/* STEP 1: Enter Mobile Number */}
            {mobileStep === 1 && (
              <form onSubmit={handleSendMobileOtp} className="flex flex-col gap-5">
                <div>
                  <label className="mb-2 block text-[13px] font-bold text-gray-700">
                    Mobile Number
                  </label>

                  <div className="relative flex items-center">
                    <span className="absolute left-4 text-[15px] font-semibold text-gray-500">
                      +91
                    </span>

                    <input
                      type="tel"
                      inputMode="numeric"
                      placeholder="Enter 10-digit number"
                      value={phone}
                      onChange={(e) => {
                        let digits = e.target.value.replace(/\D/g, "");
                        if (digits.length === 13 && (digits.startsWith("919") || digits.startsWith("910"))) {
                          digits = digits.slice(3);
                        } else if (digits.length === 12 && digits.startsWith("91")) {
                          digits = digits.slice(2);
                        } else if (digits.length === 11 && digits.startsWith("0")) {
                          digits = digits.slice(1);
                        }
                        const val = digits.slice(0, 10);
                        setPhone(val);
                        setMobileError("");
                        setMobileSuccess("");
                      }}
                      className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-14 pr-4 text-[15px] font-medium text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 ${
                        mobileError
                          ? "border-red-300 focus:border-red-400"
                          : "border-gray-200 focus:border-[#7C3AED]"
                      }`}
                      required
                      autoComplete="tel"
                    />
                  </div>
                </div>

                {mobileError && (
                  <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
                    {mobileError}
                  </div>
                )}

                {mobileSuccess && (
                  <div className="rounded-xl bg-green-50 p-4 text-[13px] font-medium text-green-700">
                    {mobileSuccess}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={mobileLoading || phone.length !== 10}
                  className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {mobileLoading ? "Sending Code..." : "Send Verification Code"}
                  {!mobileLoading && <ArrowRight size={20} />}
                </button>
              </form>
            )}

            {/* STEP 2: Enter 6-digit OTP */}
            {mobileStep === 2 && (
              <form onSubmit={handleVerifyMobileOtp} className="flex flex-col gap-5">
                <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-medium text-purple-700">
                        Code sent to
                      </p>
                      <p className="text-[15px] font-bold text-gray-900">
                        +91 {phone.slice(0, 5)} {phone.slice(5)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileStep(1);
                        setOtp("");
                        setMobileError("");
                      }}
                      className="text-[13px] font-semibold text-[#7C3AED] hover:underline"
                    >
                      Change
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[13px] font-bold text-gray-700">
                    6-Digit Verification Code
                  </label>

                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setOtp(val);
                      setMobileError("");
                    }}
                    className="h-[56px] w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-center font-mono text-[24px] font-bold tracking-[0.3em] text-gray-900 outline-none transition-all focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15"
                    autoFocus
                    required
                  />
                </div>

                {mobileError && (
                  <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
                    {mobileError}
                  </div>
                )}

                {mobileSuccess && (
                  <div className="rounded-xl bg-green-50 p-4 text-[13px] font-medium text-green-700">
                    {mobileSuccess}
                  </div>
                )}

                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-gray-500">Didn't receive the code?</span>
                  {cooldown > 0 ? (
                    <span className="font-semibold text-gray-400">
                      Resend in {cooldown}s
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSendMobileOtp}
                      disabled={mobileLoading}
                      className="flex items-center gap-1.5 font-bold text-[#7C3AED] hover:underline disabled:opacity-50"
                    >
                      <RotateCw size={14} />
                      Resend Code
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={mobileLoading || otp.length !== 6}
                  className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {mobileLoading ? "Verifying..." : "Verify Code"}
                  {!mobileLoading && <ArrowRight size={20} />}
                </button>
              </form>
            )}

            {/* STEP 3: Enter New Password */}
            {mobileStep === 3 && (
              <form onSubmit={handleResetPasswordSubmit} className="flex flex-col gap-5">
                <div>
                  <label className="mb-2 block text-[13px] font-bold text-gray-700">
                    New Password
                  </label>

                  <div className="relative flex items-center">
                    <div className="absolute left-4 text-gray-400">
                      <Lock size={18} strokeWidth={2} />
                    </div>

                    <input
                      type={showNewPassword ? "text" : "password"}
                      placeholder="At least 8 characters"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setMobileError("");
                      }}
                      className="h-[56px] w-full rounded-2xl border border-gray-200 bg-gray-50 pl-11 pr-12 text-[15px] text-gray-900 outline-none transition-all focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15"
                      autoFocus
                      required
                      autoComplete="new-password"
                    />

                    <button
                      type="button"
                      onClick={() => setShowNewPassword((p) => !p)}
                      className="absolute right-4 text-gray-400 hover:text-gray-600"
                    >
                      {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[13px] font-bold text-gray-700">
                    Confirm New Password
                  </label>

                  <div className="relative flex items-center">
                    <div className="absolute left-4 text-gray-400">
                      <Lock size={18} strokeWidth={2} />
                    </div>

                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Repeat new password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setMobileError("");
                      }}
                      className="h-[56px] w-full rounded-2xl border border-gray-200 bg-gray-50 pl-11 pr-12 text-[15px] text-gray-900 outline-none transition-all focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15"
                      required
                      autoComplete="new-password"
                    />

                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((p) => !p)}
                      className="absolute right-4 text-gray-400 hover:text-gray-600"
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {mobileError && (
                  <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
                    {mobileError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={mobileLoading || !newPassword || !confirmPassword}
                  className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {mobileLoading ? "Updating Password..." : "Update Password"}
                  {!mobileLoading && <ArrowRight size={20} />}
                </button>
              </form>
            )}

            {/* STEP 4: Success Screen */}
            {mobileStep === 4 && (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
                  <CheckCircle2 size={36} />
                </div>

                <h2 className="text-[24px] font-extrabold text-[#1E1E1E]">
                  Password Reset Complete!
                </h2>

                <p className="mt-2 text-[15px] leading-relaxed text-gray-500">
                  Your password has been successfully updated. You can now sign in with your new password.
                </p>

                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className="mt-8 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98]"
                >
                  Sign In to Your Account
                  <ArrowRight size={20} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer Link */}
        {mobileStep !== 4 && (
          <p className="mt-8 text-center text-[14px] text-gray-500">
            Remember your password?
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="ml-1.5 font-bold text-[#7C3AED] transition-colors hover:text-[#6C35E8]"
            >
              Sign In
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

export default ForgotPassword;