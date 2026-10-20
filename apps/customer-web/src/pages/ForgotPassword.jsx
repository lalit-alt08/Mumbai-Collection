import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Check,
  RefreshCw,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  sendPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPasswordWithOtp,
  parseOtpRateLimitError,
} from "../services/authService";
import {
  validatePassword,
  getPasswordRuleChecks,
} from "../utils/passwordValidator.js";

function ForgotPassword() {
  const navigate = useNavigate();

  // Stepper: 1 = Email Input, 2 = OTP Verification, 3 = New Password Setup
  const [step, setStep] = useState(1);

  // Form fields
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Visibility toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Status & Feedback
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [success, setSuccess] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // Refs for OTP digit inputs
  const otpRefs = useRef([]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Focus first OTP input when transitioning to step 2
  useEffect(() => {
    if (step === 2) {
      setTimeout(() => {
        otpRefs.current[0]?.focus();
      }, 100);
    }
  }, [step]);

  // Live password strength checks
  const passwordChecks = getPasswordRuleChecks(password);

  // STEP 1: Submit Email to get OTP
  const handleEmailSubmit = async (e) => {
    e?.preventDefault();
    setError("");
    setFieldError("");

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setFieldError("Email is required.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFieldError("Please enter a valid email address.");
      return;
    }

    try {
      setLoading(true);
      await sendPasswordResetOtp(trimmedEmail);
      // Start 60-second cooldown
      setCooldown(60);
      setOtp(["", "", "", "", "", ""]);
      setStep(2);
    } catch (err) {
      const parsed = parseOtpRateLimitError(err);
      if (parsed.isRateLimited) {
        setCooldown(parsed.retryAfter || 60);
        setError(parsed.message);
      } else {
        setError(
          typeof err.response?.data?.message === "string"
            ? err.response.data.message
            : "Unable to process your request. Please try again."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // STEP 2: Resend OTP
  const handleResendOtp = async () => {
    if (cooldown > 0 || resendLoading) return;
    setError("");
    setFieldError("");

    try {
      setResendLoading(true);
      await sendPasswordResetOtp(email.trim().toLowerCase());
      setCooldown(60);
      setOtp(["", "", "", "", "", ""]);
      otpRefs.current[0]?.focus();
    } catch (err) {
      const parsed = parseOtpRateLimitError(err);
      if (parsed.isRateLimited) {
        setCooldown(parsed.retryAfter || 60);
        setError(parsed.message);
      } else {
        setError(
          typeof err.response?.data?.message === "string"
            ? err.response.data.message
            : "Failed to resend code. Please try again."
        );
      }
    } finally {
      setResendLoading(false);
    }
  };

  // OTP Input handlers
  const handleOtpChange = (index, value) => {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      const updated = [...otp];
      updated[index] = "";
      setOtp(updated);
      setFieldError("");
      setError("");
      return;
    }

    // Support mobile keyboard autofill where all digits land in one input
    if (clean.length > 1) {
      const digits = clean.slice(0, 6).split("");
      const updated = [...otp];
      digits.forEach((d, i) => {
        if (i < 6) updated[i] = d;
      });
      setOtp(updated);
      setFieldError("");
      setError("");
      const nextIdx = Math.min(digits.length, 5);
      otpRefs.current[nextIdx]?.focus();
      return;
    }

    const digit = clean.slice(-1);
    const updated = [...otp];
    updated[index] = digit;
    setOtp(updated);
    setFieldError("");
    setError("");

    // Advance focus to next input
    if (index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      if (!otp[index] && index > 0) {
        otpRefs.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      otpRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      e.preventDefault();
      otpRefs.current[index + 1]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleVerifyOtp();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;

    const digits = pasted.slice(0, 6).split("");
    const updated = [...otp];
    digits.forEach((d, i) => {
      if (i < 6) updated[i] = d;
    });
    setOtp(updated);
    setFieldError("");
    setError("");

    const nextIdx = Math.min(digits.length, 5);
    otpRefs.current[nextIdx]?.focus();
  };

  // STEP 2: Verify OTP
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    setError("");
    setFieldError("");

    const fullCode = otp.join("");
    if (fullCode.length !== 6) {
      setFieldError("Please enter all 6 digits of the verification code.");
      return;
    }

    try {
      setLoading(true);
      const res = await verifyPasswordResetOtp(email.trim().toLowerCase(), fullCode);
      if (res?.reset_token) {
        setResetToken(res.reset_token);
        setStep(3);
      } else {
        setError("Verification succeeded, but no reset token was received. Please try again.");
      }
    } catch (err) {
      const msg =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Invalid or expired verification code.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // STEP 3: Submit New Password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");
    setFieldError("");

    const validation = validatePassword(password);
    if (!validation.isValid) {
      setFieldError(validation.message);
      return;
    }

    if (!confirmPassword) {
      setFieldError("Please confirm your new password.");
      return;
    }

    if (password !== confirmPassword) {
      setFieldError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      const res = await resetPasswordWithOtp(
        email.trim().toLowerCase(),
        resetToken,
        password
      );
      setSuccess(
        res?.message || "Password reset successfully! Redirecting to login..."
      );
      setPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        navigate("/login");
      }, 1800);
    } catch (err) {
      const msg =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Failed to reset password. Please request a new OTP.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#0B1425] font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center">
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[480px] md:rounded-[24px] md:bg-[#111F36] md:border md:border-[#1E3252]/80 md:px-10 md:py-12 md:shadow-lg">

        {/* Back Button */}
        <button
          type="button"
          onClick={() => {
            if (step === 2) {
              setStep(1);
              setError("");
              setFieldError("");
            } else if (step === 3) {
              setStep(2);
              setError("");
              setFieldError("");
            } else {
              navigate("/login");
            }
          }}
          className="mb-6 flex w-fit items-center gap-2 text-sm font-semibold text-[#8FA4BE] transition hover:text-[#42D6E8] cursor-pointer"
        >
          <ArrowLeft size={18} />
          {step === 1 ? "Back to Sign In" : step === 2 ? "Back to Email" : "Back to Verification"}
        </button>

        {/* Stepper Progress Bar */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step
                    ? "w-8 bg-[#42D6E8]"
                    : s < step
                    ? "w-4 bg-emerald-400"
                    : "w-4 bg-[#1E3252]"
                }`}
              />
            ))}
          </div>
          <span className="text-xs font-semibold text-[#6E84A3]">
            Step {step} of 3
          </span>
        </div>

        {/* STEP 1: EMAIL INPUT */}
        {step === 1 && (
          <div>
            <div className="mb-6">
              <h1 className="text-[28px] font-extrabold tracking-tight text-[#F1F5F9] md:text-[32px]">
                Forgot Password?
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[#8FA4BE] md:text-[16px]">
                Enter your registered email address and we'll send you a 6-digit verification code.
              </p>
            </div>

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
                      setFieldError("");
                      setError("");
                    }}
                    className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-12 pr-4 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                      fieldError
                        ? "border-rose-400 focus:border-rose-400"
                        : "border-[#1E3252] focus:border-[#42D6E8]"
                    }`}
                    required
                    autoFocus
                  />
                </div>

                {fieldError && (
                  <p className="mt-2 text-sm text-rose-400">{fieldError}</p>
                )}
              </div>

              {error && (
                <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-4 text-[13px] font-medium text-rose-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] text-[16px] font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
              >
                {loading ? "Sending Code..." : "Send Verification Code"}
                {!loading && <ArrowRight size={20} />}
              </button>
            </form>
          </div>
        )}

        {/* STEP 2: OTP VERIFICATION */}
        {step === 2 && (
          <div>
            <div className="mb-6">
              <h1 className="text-[28px] font-extrabold tracking-tight text-[#F1F5F9] md:text-[32px]">
                Verify Your Email
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[#8FA4BE] md:text-[16px]">
                We sent a 6-digit verification code to{" "}
                <span className="font-semibold text-[#F1F5F9]">{email}</span>.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setError("");
                  setFieldError("");
                }}
                className="mt-1.5 text-xs font-semibold text-[#42D6E8] hover:underline cursor-pointer"
              >
                Change email address
              </button>
            </div>

            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-5">
              <div>
                <label className="mb-3 block text-[13px] font-bold text-[#8FA4BE]">
                  6-Digit Verification Code
                </label>

                {/* 6 Digit Input Boxes */}
                <div className="grid grid-cols-6 gap-2 sm:gap-3">
                  {otp.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (otpRefs.current[idx] = el)}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      autoComplete={idx === 0 ? "one-time-code" : "off"}
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      onPaste={handleOtpPaste}
                      className={`h-14 sm:h-16 w-full text-center text-xl sm:text-2xl font-bold rounded-2xl border bg-[#080F1C] text-[#F1F5F9] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                        digit
                          ? "border-[#42D6E8] bg-[#0A1A2F]"
                          : fieldError || error
                          ? "border-rose-400"
                          : "border-[#1E3252] focus:border-[#42D6E8]"
                      }`}
                    />
                  ))}
                </div>

                {fieldError && (
                  <p className="mt-2 text-sm text-rose-400">{fieldError}</p>
                )}
              </div>

              {error && (
                <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-4 text-[13px] font-medium text-rose-300">
                  {error}
                </div>
              )}

              {/* Resend Cooldown UI */}
              <div className="flex items-center justify-between text-xs text-[#8FA4BE] px-1">
                <span>Didn't receive code?</span>
                {cooldown > 0 ? (
                  <span className="font-semibold text-[#6E84A3]">
                    Resend in {cooldown}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resendLoading}
                    className="flex items-center gap-1.5 font-bold text-[#42D6E8] hover:underline cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw size={13} className={resendLoading ? "animate-spin" : ""} />
                    {resendLoading ? "Resending..." : "Resend Code"}
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || otp.join("").length !== 6}
                className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] text-[16px] font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
              >
                {loading ? "Verifying..." : "Verify Code"}
                {!loading && <ArrowRight size={20} />}
              </button>
            </form>
          </div>
        )}

        {/* STEP 3: NEW PASSWORD SETUP */}
        {step === 3 && (
          <div>
            <div className="mb-6">
              <h1 className="text-[28px] font-extrabold tracking-tight text-[#F1F5F9] md:text-[32px]">
                Create New Password
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[#8FA4BE] md:text-[16px]">
                Choose a strong new password for your Mumbai Collection account.
              </p>
            </div>

            <form onSubmit={handleResetPassword} className="flex flex-col gap-5">
              {/* New Password */}
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
                      setFieldError("");
                      setError("");
                    }}
                    className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-12 pr-12 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                      fieldError && !validatePassword(password).isValid
                        ? "border-rose-400 focus:border-rose-400"
                        : "border-[#1E3252] focus:border-[#42D6E8]"
                    }`}
                    required
                    autoComplete="new-password"
                    autoFocus
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 text-[#6E84A3] transition-colors hover:text-[#42D6E8] cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>

                {/* Password Rule Checklist */}
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
                      setFieldError("");
                      setError("");
                    }}
                    className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-12 pr-12 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                      fieldError && password !== confirmPassword
                        ? "border-rose-400 focus:border-rose-400"
                        : "border-[#1E3252] focus:border-[#42D6E8]"
                    }`}
                    required
                    autoComplete="new-password"
                  />

                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 text-[#6E84A3] transition-colors hover:text-[#42D6E8] cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              {fieldError && (
                <p className="text-sm text-rose-400">{fieldError}</p>
              )}

              {error && (
                <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-4 text-[13px] font-medium text-rose-300">
                  {error}
                </div>
              )}

              {success && (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-800/80 bg-emerald-950/40 p-4 text-[13px] font-medium text-emerald-300">
                  <CheckCircle size={20} className="text-emerald-400 flex-shrink-0" />
                  <span>{success}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !!success}
                className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] text-[16px] font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
              >
                {loading ? "Updating Password..." : "Set New Password"}
                {!loading && !success && <ArrowRight size={20} />}
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}

export default ForgotPassword;