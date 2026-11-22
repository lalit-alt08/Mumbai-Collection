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
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
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
  const location = useLocation();
  const { user, handleSessionExpired } = useAuth();

  // Stepper: 1 = Email Input, 2 = OTP Verification, 3 = New Password Setup
  const [step, setStep] = useState(1);

  // Form fields
  const [email, setEmail] = useState(() =>
    typeof location.state?.email === "string" ? location.state.email : ""
  );
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
      if (user && handleSessionExpired) {
        handleSessionExpired();
      }
      setSuccess(res?.message || "Password reset successfully! Redirecting to login...");
      setPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        navigate("/login", {
          replace: true,
          state: {
            from: location.state?.from,
            message: "Password reset successful! Please sign in with your new password.",
          },
        });
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
    <div className="flex w-full flex-1 flex-col items-center justify-start font-sans pt-3 sm:pt-6 md:pt-10 pb-8">
      <div className="auth-form-card mx-auto flex w-full max-w-md flex-col rounded-2xl border border-[#E2E8F0]/80 bg-[#FFFFFF] px-5 py-6 shadow-lg sm:p-8 md:max-w-[480px] md:rounded-[24px] md:px-10 md:py-12 md:shadow-lg">

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
              navigate("/login", {
                replace: true,
                state: { from: location.state?.from },
              });
            }
          }}
          className="mb-6 flex w-fit items-center gap-2 text-sm font-semibold text-[#64748B] transition hover:text-[#22499F] cursor-pointer"
        >
          <ArrowLeft size={18} />
          {step === 1
            ? "Back to Sign In"
            : step === 2
            ? "Back to Email"
            : "Back to Verification"}
        </button>

        {/* Stepper Progress Bar */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step
                    ? "w-8 bg-[#22499F]"
                    : s < step
                    ? "w-4 bg-emerald-400"
                    : "w-4 bg-[#E2E8F0]"
                }`}
              />
            ))}
          </div>
          <span className="text-xs font-semibold text-[#64748B]">
            Step {step} of 3
          </span>
        </div>

        {/* STEP 1: EMAIL INPUT */}
        {step === 1 && (
          <div>
            <div className="mb-6">
              <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E293B] md:text-[32px]">
                Forgot Password?
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[#64748B] md:text-[16px]">
                Enter your email address. If an email &amp; password account exists, we&apos;ll send a 6-digit verification code.
              </p>
            </div>

            <form onSubmit={handleEmailSubmit} className="flex flex-col gap-5">
              <div>
                <label className="mb-2 block text-[13px] font-bold text-[#64748B]">
                  Email Address
                </label>

                <div className="relative flex items-center">
                  <div className="absolute left-4 text-[#64748B]">
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
                    className={`h-[56px] w-full rounded-2xl border bg-[#F0F8E8] pl-12 pr-4 text-[15px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                      fieldError
                        ? "border-rose-500 focus:border-rose-500"
                        : "border-[#E2E8F0] focus:border-[#22499F]"
                    }`}
                    required
                    autoFocus
                  />
                </div>

                {fieldError && (
                  <p className="auth-field-error mt-2 text-sm font-semibold">{fieldError}</p>
                )}
              </div>

              {error && (
                <div role="alert" className="auth-error-banner rounded-xl border p-4 text-[13px] font-semibold">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#22499F] text-[16px] font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
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
              <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E293B] md:text-[32px]">
                Verify Your Email
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[#64748B] md:text-[16px]">
                If an email &amp; password account exists for{" "}
                <span className="font-semibold text-[#1E293B]">{email}</span>, we sent a 6-digit verification code.
              </p>
              <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-3.5 py-2.5 text-xs leading-relaxed text-[#475569] space-y-1.5">
                <p>
                  Didn&apos;t receive a code? If this account is linked to Google Sign-In, no store reset email is sent — use{" "}
                  <button
                    type="button"
                    onClick={() =>
                      navigate("/login", {
                        replace: true,
                        state: { from: location.state?.from },
                      })
                    }
                    className="font-bold text-[#22499F] hover:underline cursor-pointer"
                  >
                    Continue with Google
                  </button>{" "}
                  or change your password on your{" "}
                  <a
                    href="https://myaccount.google.com/security"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-[#22499F] hover:underline"
                  >
                    official Google Account page
                  </a>
                  .
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setError("");
                  setFieldError("");
                }}
                className="mt-1.5 text-xs font-semibold text-[#22499F] hover:underline cursor-pointer"
              >
                Change email address
              </button>
            </div>

            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-5">
              <div>
                <label className="mb-3 block text-[13px] font-bold text-[#64748B]">
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
                      className={`h-14 sm:h-16 w-full text-center text-xl sm:text-2xl font-bold rounded-2xl border bg-[#F0F8E8] text-[#1E293B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                        digit
                          ? "border-[#22499F] bg-[#FFFFFF]"
                          : fieldError || error
                          ? "border-rose-400"
                          : "border-[#E2E8F0] focus:border-[#22499F]"
                      }`}
                    />
                  ))}
                </div>

                {fieldError && (
                  <p className="mt-2 text-sm text-rose-400">{fieldError}</p>
                )}
              </div>

              {error && (
                <div role="alert" className="auth-error-banner rounded-xl border p-4 text-[13px] font-semibold">
                  {error}
                </div>
              )}

              {/* Resend Cooldown UI */}
              <div className="flex items-center justify-between text-xs text-[#64748B] px-1">
                <span>Didn't receive code?</span>
                {cooldown > 0 ? (
                  <span className="font-semibold text-[#64748B]">
                    Resend in {cooldown}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resendLoading}
                    className="flex items-center gap-1.5 font-bold text-[#22499F] hover:underline cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw size={13} className={resendLoading ? "animate-spin" : ""} />
                    {resendLoading ? "Resending..." : "Resend Code"}
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || otp.join("").length !== 6}
                className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#22499F] text-[16px] font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
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
              <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E293B] md:text-[32px]">
                Create New Password
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[#64748B] md:text-[16px]">
                Choose a strong new password for your Mumbai Collection account.
              </p>
            </div>

            <form onSubmit={handleResetPassword} className="flex flex-col gap-5">
              {/* New Password */}
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
                      setFieldError("");
                      setError("");
                    }}
                    className={`h-[56px] w-full rounded-2xl border bg-[#F0F8E8] pl-12 pr-12 text-[15px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                      fieldError && !validatePassword(password).isValid
                        ? "border-rose-400 focus:border-rose-400"
                        : "border-[#E2E8F0] focus:border-[#22499F]"
                    }`}
                    required
                    autoComplete="new-password"
                    autoFocus
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-4 text-[#64748B] transition-colors hover:text-[#22499F] cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>

                {/* Password Rule Checklist */}
                {password.length > 0 && (
                  <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl border border-[#E2E8F0]/60 bg-[#F0F8E8]/80 p-2.5 text-xs text-[#64748B]">
                    <span className={`flex items-center gap-1.5 ${passwordChecks.length ? "password-rule-passed text-emerald-600 font-semibold" : "text-[#64748B]"}`}>
                      <Check size={13} className={passwordChecks.length ? "opacity-100" : "opacity-30"} /> 8+ characters
                    </span>
                    <span className={`flex items-center gap-1.5 ${passwordChecks.uppercase ? "password-rule-passed text-emerald-600 font-semibold" : "text-[#64748B]"}`}>
                      <Check size={13} className={passwordChecks.uppercase ? "opacity-100" : "opacity-30"} /> Uppercase (A-Z)
                    </span>
                    <span className={`flex items-center gap-1.5 ${passwordChecks.lowercase ? "password-rule-passed text-emerald-600 font-semibold" : "text-[#64748B]"}`}>
                      <Check size={13} className={passwordChecks.lowercase ? "opacity-100" : "opacity-30"} /> Lowercase (a-z)
                    </span>
                    <span className={`flex items-center gap-1.5 ${passwordChecks.number ? "password-rule-passed text-emerald-600 font-semibold" : "text-[#64748B]"}`}>
                      <Check size={13} className={passwordChecks.number ? "opacity-100" : "opacity-30"} /> Number (0-9)
                    </span>
                    <span className={`flex items-center gap-1.5 col-span-2 ${passwordChecks.special ? "password-rule-passed text-emerald-600 font-semibold" : "text-[#64748B]"}`}>
                      <Check size={13} className={passwordChecks.special ? "opacity-100" : "opacity-30"} /> Special character (!@#$%^&*)
                    </span>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="mb-2 block text-[13px] font-bold text-[#64748B]">
                  Confirm New Password
                </label>

                <div className="relative flex items-center">
                  <div className="pointer-events-none absolute left-4 text-[#64748B]">
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
                    className={`h-[56px] w-full rounded-2xl border bg-[#F0F8E8] pl-12 pr-12 text-[15px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                      fieldError && password !== confirmPassword
                        ? "border-rose-500 focus:border-rose-500"
                        : "border-[#E2E8F0] focus:border-[#22499F]"
                    }`}
                    required
                    autoComplete="new-password"
                  />

                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    className="absolute right-4 text-[#64748B] transition-colors hover:text-[#22499F] cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              {fieldError && (
                <p className="auth-field-error text-sm font-semibold">{fieldError}</p>
              )}

              {error && (
                <div role="alert" className="auth-error-banner rounded-xl border p-4 text-[13px] font-semibold">
                  {error}
                </div>
              )}

              {success && (
                <div className="track-order-delivered flex items-center gap-3 rounded-xl border p-4 text-[13px] font-semibold">
                  <CheckCircle size={20} className="shrink-0" />
                  <span>{success}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !!success}
                className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#22499F] text-[16px] font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
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