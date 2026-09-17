import {
  Mail,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  RotateCw,
  User,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  forgotPassword,
  sendOtp,
  verifyOtp,
  resetPasswordOtp,
  parseOtpRateLimitError,
} from "../services/authService";

const isValidIndianPhone = (val) => {
  const digits = String(val || "").replace(/\D/g, "");
  return /^[6-9]\d{9}$/.test(digits);
};

function ForgotPassword() {
  const navigate = useNavigate();

  // Mode: "link" | "otp"
  const [resetMode, setResetMode] = useState("link");

  // Email Reset Link Flow State
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailGeneralError, setEmailGeneralError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");

  // Email OTP Flow State
  // Steps: 1 = Enter Identifier, 2 = Enter OTP, 3 = New Password, 4 = Success
  const [otpStep, setOtpStep] = useState(1);
  const [identifier, setIdentifier] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [cooldown, setCooldown] = useState(0);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpSuccess, setOtpSuccess] = useState("");

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
    setOtpError("");
    setOtpSuccess("");
  };

  // ─────────────────────────────────────────────
  // 1. EMAIL RESET LINK FLOW HANDLER
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
  // 2. EMAIL OTP FLOW HANDLERS
  // ─────────────────────────────────────────────

  // Step 1: Request OTP
  const handleSendEmailOtp = async (e) => {
    if (e) e.preventDefault();
    setOtpError("");
    setOtpSuccess("");

    const raw = identifier.trim();
    if (!raw) {
      setOtpError("Please enter your registered email address or mobile number.");
      return;
    }

    // Determine if it's a mobile number or email
    const cleanDigits = raw.replace(/\D/g, "");
    let cleanTarget = raw;
    if (cleanDigits.length === 10 && isValidIndianPhone(cleanDigits)) {
      cleanTarget = cleanDigits;
    } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      cleanTarget = raw.toLowerCase();
    } else if (cleanDigits.length > 0) {
      setOtpError("Please enter a valid 10-digit mobile number or email address.");
      return;
    } else {
      setOtpError("Please enter a valid email address.");
      return;
    }

    try {
      setOtpLoading(true);
      const res = await sendOtp(cleanTarget, "reset_password");
      setOtpStep(2);
      setCooldown(60);
      if (res.masked_email) {
        setMaskedEmail(res.masked_email);
      }
      setOtpSuccess(
        res.message || (res.masked_email ? `If an account exists, a verification code has been sent to ${res.masked_email}.` : "If an account exists, a verification code has been sent to your registered email.")
      );
    } catch (err) {
      const parsed = parseOtpRateLimitError(err);
      if (parsed.isRateLimited) {
        setOtpError(parsed.message);
        setCooldown(parsed.retryAfter);
      } else {
        setOtpError(parsed.message);
      }
    } finally {
      setOtpLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyEmailOtp = async (e) => {
    e.preventDefault();
    setOtpError("");
    setOtpSuccess("");

    const raw = identifier.trim();
    const cleanDigits = raw.replace(/\D/g, "");
    const cleanTarget = cleanDigits.length === 10 ? cleanDigits : raw.toLowerCase();
    const cleanOtp = String(otp || "").trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      setOtpError("Please enter the 6-digit verification code.");
      return;
    }

    try {
      setOtpLoading(true);
      const res = await verifyOtp(cleanTarget, cleanOtp, "reset_password");
      if (res.success && res.reset_token) {
        setResetToken(res.reset_token);
        setOtpStep(3);
        setOtp("");
        setOtpSuccess("");
      } else {
        setOtpError(res.message || "Invalid or expired verification code. Please try again.");
      }
    } catch (err) {
      setOtpError(
        err.response?.data?.message || "Invalid or expired verification code."
      );
    } finally {
      setOtpLoading(false);
    }
  };

  // Step 3: Reset Password with Reset Token
  const handleResetPasswordSubmit = async (e) => {
    e.preventDefault();
    setOtpError("");
    setOtpSuccess("");

    if (!newPassword) {
      setOtpError("New password is required.");
      return;
    }

    if (newPassword.length < 8) {
      setOtpError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setOtpError("Passwords do not match.");
      return;
    }

    const raw = identifier.trim();
    const cleanDigits = raw.replace(/\D/g, "");
    const cleanTarget = cleanDigits.length === 10 ? cleanDigits : raw.toLowerCase();

    try {
      setOtpLoading(true);
      const res = await resetPasswordOtp(cleanTarget, resetToken, newPassword);
      if (res.success) {
        // Clear sensitive credentials immediately
        setResetToken("");
        setNewPassword("");
        setConfirmPassword("");
        setOtpStep(4);
      } else {
        setOtpError(res.message || "Unable to reset password. Please try again.");
      }
    } catch (err) {
      setOtpError(
        err.response?.data?.message ||
          "We couldn't complete the password reset. Please try again."
      );
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <div className="bg-white font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center md:bg-[#F7F7FB]">
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[480px] md:rounded-[24px] md:bg-white md:px-10 md:py-12 md:shadow-[0_10px_40px_rgba(0,0,0,0.04)]">

        {/* Back Button */}
        <button
          type="button"
          onClick={() => {
            if (resetMode === "otp" && otpStep > 1 && otpStep < 4) {
              setOtpStep((prev) => prev - 1);
              setOtpError("");
              setOtpSuccess("");
            } else {
              navigate("/login");
            }
          }}
          className="mb-6 flex w-fit items-center gap-2 text-sm font-semibold text-gray-600 transition hover:text-[#7C3AED]"
        >
          <ArrowLeft size={18} />
          {resetMode === "otp" && otpStep > 1 && otpStep < 4
            ? "Previous Step"
            : "Back to Sign In"}
        </button>

        {/* Header */}
        {otpStep !== 4 && (
          <div className="mb-6">
            <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E1E1E] md:text-[32px]">
              Forgot Password?
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-gray-500 md:text-[16px]">
              {resetMode === "link"
                ? "Enter your email address and we'll send you a link to reset your password."
                : otpStep === 1
                ? "Enter your registered email address or mobile number to receive a verification code."
                : otpStep === 2
                ? "Enter the 6-digit verification code sent to your registered email."
                : "Create a new strong password for your account."}
            </p>
          </div>
        )}

        {/* Toggle between Reset Link and Email Code */}
        {otpStep !== 4 && (
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1.5">
            <button
              type="button"
              onClick={() => handleModeChange("link")}
              className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-bold transition-all ${
                resetMode === "link"
                  ? "bg-white text-[#7C3AED] shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Mail size={16} />
              Reset Link
            </button>

            <button
              type="button"
              onClick={() => handleModeChange("otp")}
              className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-bold transition-all ${
                resetMode === "otp"
                  ? "bg-white text-[#7C3AED] shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <ShieldCheck size={16} />
              Email Code (OTP)
            </button>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            1. RESET VIA EMAIL LINK FORM
        ───────────────────────────────────────────────────────────── */}
        {resetMode === "link" && (
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
            2. RESET VIA EMAIL OTP FLOW
        ───────────────────────────────────────────────────────────── */}
        {resetMode === "otp" && (
          <div>
            {/* STEP 1: Enter Email or Mobile */}
            {otpStep === 1 && (
              <form onSubmit={handleSendEmailOtp} className="flex flex-col gap-5">
                <div>
                  <label className="mb-2 block text-[13px] font-bold text-gray-700">
                    Email Address or Mobile Number
                  </label>

                  <div className="relative flex items-center">
                    <div className="absolute left-4 text-gray-400">
                      <User size={20} strokeWidth={2} />
                    </div>

                    <input
                      type="text"
                      placeholder="e.g. name@example.com or 9876543210"
                      value={identifier}
                      onChange={(e) => {
                        setIdentifier(e.target.value);
                        setOtpError("");
                        setOtpSuccess("");
                      }}
                      className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-4 text-[15px] font-medium text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 ${
                        otpError
                          ? "border-red-300 focus:border-red-400"
                          : "border-gray-200 focus:border-[#7C3AED]"
                      }`}
                      required
                      autoComplete="username"
                    />
                  </div>

                  <p className="mt-2 text-xs text-gray-500 font-medium">
                    A 6-digit verification code will be sent to your registered account email.
                  </p>
                </div>

                {otpError && (
                  <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
                    {otpError}
                  </div>
                )}

                {otpSuccess && (
                  <div className="rounded-xl bg-green-50 p-4 text-[13px] font-medium text-green-700">
                    {otpSuccess}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={otpLoading || !identifier.trim() || cooldown > 0}
                  className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {otpLoading ? "Sending Code..." : (cooldown > 0 ? `Please wait (${cooldown}s)` : "Send Verification Code")}
                  {!otpLoading && <ArrowRight size={20} />}
                </button>
              </form>
            )}

            {/* STEP 2: Enter 6-digit OTP */}
            {otpStep === 2 && (
              <form onSubmit={handleVerifyEmailOtp} className="flex flex-col gap-5">
                <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-medium text-purple-700">
                        Code sent to
                      </p>
                      <p className="text-[15px] font-bold text-gray-900">
                        {maskedEmail || "your registered email"}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setOtpStep(1);
                        setOtp("");
                        setOtpError("");
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
                      setOtpError("");
                    }}
                    className="h-[56px] w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-center font-mono text-[24px] font-bold tracking-[0.3em] text-gray-900 outline-none transition-all focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15"
                    autoFocus
                    required
                  />
                  <p className="mt-2 text-xs text-gray-500 font-medium">
                    Please check your registered email inbox and spam folder for the code.
                  </p>
                </div>

                {otpError && (
                  <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
                    {otpError}
                  </div>
                )}

                {otpSuccess && (
                  <div className="rounded-xl bg-green-50 p-4 text-[13px] font-medium text-green-700">
                    {otpSuccess}
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
                      onClick={handleSendEmailOtp}
                      disabled={otpLoading}
                      className="flex items-center gap-1.5 font-bold text-[#7C3AED] hover:underline disabled:opacity-50"
                    >
                      <RotateCw size={14} />
                      Resend Code
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={otpLoading || otp.length !== 6}
                  className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {otpLoading ? "Verifying..." : "Verify Code"}
                  {!otpLoading && <ArrowRight size={20} />}
                </button>
              </form>
            )}

            {/* STEP 3: Enter New Password */}
            {otpStep === 3 && (
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
                        setOtpError("");
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
                        setOtpError("");
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

                {otpError && (
                  <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
                    {otpError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={otpLoading || !newPassword || !confirmPassword}
                  className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {otpLoading ? "Updating Password..." : "Update Password"}
                  {!otpLoading && <ArrowRight size={20} />}
                </button>
              </form>
            )}

            {/* STEP 4: Success Screen */}
            {otpStep === 4 && (
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
        {otpStep !== 4 && (
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