import { User, Mail, ArrowRight, ArrowLeft, ShieldCheck, RefreshCw } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { register, sendOtp } from "../services/authService";
import { useAuth } from "../context/AuthContext";
import { normalizePersonName, isValidPersonName } from "../utils/nameValidator.js";
import GoogleAuthButton from "../components/auth/GoogleAuthButton.jsx";

function Register() {
  const navigate = useNavigate();
  const { login: loginUser } = useAuth();

  // Step state: "details" (names + email) | "otp" (verification code)
  const [step, setStep] = useState("details");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  const otpInputRef = useRef(null);

  // Countdown timer for OTP resend
  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  // Focus OTP input when transitioning to "otp" step
  useEffect(() => {
    if (step === "otp" && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [step]);

  const handleSendOtp = async (e) => {
    e.preventDefault();

    setFirstNameError("");
    setLastNameError("");
    setEmailError("");
    setError("");
    setInfoMessage("");

    let hasError = false;

    const cleanFirst = normalizePersonName(firstName);
    const cleanLast = normalizePersonName(lastName);
    const cleanEmail = email.trim().toLowerCase();

    // First Name validation
    if (!cleanFirst) {
      setFirstNameError("First name is required.");
      hasError = true;
    } else if (!isValidPersonName(cleanFirst)) {
      setFirstNameError("First name can only contain letters, spaces, hyphens, apostrophes, and periods.");
      hasError = true;
    }

    // Last Name validation
    if (!cleanLast) {
      setLastNameError("Last name is required.");
      hasError = true;
    } else if (!isValidPersonName(cleanLast)) {
      setLastNameError("Last name can only contain letters, spaces, hyphens, apostrophes, and periods.");
      hasError = true;
    }

    // Email validation
    if (!cleanEmail) {
      setEmailError("Email is required.");
      hasError = true;
    } else if (!/^(?!\.)(?!.*\.\.)[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)*\.[A-Z]{2,63}$/i.test(cleanEmail)) {
      setEmailError("Please enter a valid email address.");
      hasError = true;
    }

    if (hasError) return;

    try {
      setLoading(true);
      await sendOtp(cleanEmail, "register", {
        first_name: cleanFirst,
        last_name: cleanLast,
      });

      setStep("otp");
      setCountdown(60);
      setOtp("");
      setOtpError("");
      setInfoMessage(`We've sent a 6-digit verification code to ${cleanEmail}`);
    } catch (err) {
      const backendMessage =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : err.response?.data?.message?.message || "Unable to send verification code.";

      if (
        err.response?.status === 409 ||
        err.response?.data?.code === "email_exists" ||
        backendMessage.toLowerCase().includes("already exists")
      ) {
        setEmailError("An account with this email already exists.");
      } else {
        setError(backendMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0 || resending) return;

    try {
      setResending(true);
      setError("");
      setOtpError("");
      const cleanEmail = email.trim().toLowerCase();
      const cleanFirst = normalizePersonName(firstName);
      const cleanLast = normalizePersonName(lastName);

      await sendOtp(cleanEmail, "register", {
        first_name: cleanFirst,
        last_name: cleanLast,
      });

      setCountdown(60);
      setInfoMessage(`A fresh verification code has been sent to ${cleanEmail}`);
    } catch (err) {
      const backendMessage =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Unable to resend code. Please try again.";
      setError(backendMessage);
    } finally {
      setResending(false);
    }
  };

  const handleVerifyAndRegister = async (e) => {
    e.preventDefault();

    setOtpError("");
    setError("");

    const cleanOtp = otp.trim().replace(/\D/g, "");
    if (!cleanOtp || cleanOtp.length !== 6) {
      setOtpError("Please enter the 6-digit verification code.");
      return;
    }

    try {
      setLoading(true);

      const cleanFirst = normalizePersonName(firstName);
      const cleanLast = normalizePersonName(lastName);
      const cleanFullName = `${cleanFirst} ${cleanLast}`;
      const cleanEmail = email.trim().toLowerCase();

      const regResponse = await register({
        first_name: cleanFirst,
        last_name: cleanLast,
        name: cleanFullName,
        email: cleanEmail,
        otp: cleanOtp,
      });

      if (regResponse?.user) {
        loginUser(regResponse.user);
      }

      navigate("/profile-setup", {
        state: {
          first_name: cleanFirst,
          last_name: cleanLast,
          fromRegister: true,
        },
      });
    } catch (err) {
      const backendMessage =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : err.response?.data?.message?.message || "Invalid or expired verification code.";

      if (
        backendMessage.toLowerCase().includes("code") ||
        backendMessage.toLowerCase().includes("otp") ||
        backendMessage.toLowerCase().includes("expired")
      ) {
        setOtpError(backendMessage);
      } else {
        setError(backendMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#0B1425] font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center">
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-2 pb-24 sm:px-6 sm:pb-28 md:max-w-[480px] md:rounded-[24px] md:bg-[#111F36] md:border md:border-[#1E3252]/80 md:px-10 md:py-8 md:shadow-lg">
        <div className="w-full">
          {step === "details" ? (
            <>
              {/* Heading */}
              <div className="mb-3 sm:mb-4">
                <h1 className="text-[22px] font-extrabold tracking-tight text-[#F1F5F9] sm:text-[28px] md:text-[32px]">
                  Create Account
                </h1>
                <p className="mt-0.5 text-[13px] text-[#8FA4BE] sm:text-[15px]">
                  Enter your details to get started with fast shopping.
                </p>
              </div>

              <form onSubmit={handleSendOtp} className="flex flex-col gap-2.5 sm:gap-3.5">
                {/* First Name & Last Name */}
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
                  {/* First Name */}
                  <div>
                    <label className="mb-1 block text-[12px] font-bold text-[#8FA4BE] sm:text-[13px]">
                      First Name
                    </label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 text-[#6E84A3] sm:left-3.5">
                        <User size={16} strokeWidth={2} />
                      </div>
                      <input
                        type="text"
                        autoComplete="given-name"
                        placeholder="e.g. Rahul"
                        value={firstName}
                        onChange={(e) => {
                          setFirstName(e.target.value);
                          setFirstNameError("");
                          setError("");
                        }}
                        className={`h-[44px] sm:h-[48px] md:h-[50px] w-full rounded-xl sm:rounded-2xl border bg-[#080F1C] pl-9 pr-3 text-[14px] sm:pl-10 sm:text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                          firstNameError
                            ? "border-rose-400 focus:border-rose-400"
                            : "border-[#1E3252] focus:border-[#42D6E8]"
                        }`}
                        required
                      />
                    </div>
                    {firstNameError && (
                      <p className="mt-1 text-xs text-rose-400">{firstNameError}</p>
                    )}
                  </div>

                  {/* Last Name */}
                  <div>
                    <label className="mb-1 block text-[12px] font-bold text-[#8FA4BE] sm:text-[13px]">
                      Last Name
                    </label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 text-[#6E84A3] sm:left-3.5">
                        <User size={16} strokeWidth={2} />
                      </div>
                      <input
                        type="text"
                        autoComplete="family-name"
                        placeholder="e.g. Sharma"
                        value={lastName}
                        onChange={(e) => {
                          setLastName(e.target.value);
                          setLastNameError("");
                          setError("");
                        }}
                        className={`h-[44px] sm:h-[48px] md:h-[50px] w-full rounded-xl sm:rounded-2xl border bg-[#080F1C] pl-9 pr-3 text-[14px] sm:pl-10 sm:text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                          lastNameError
                            ? "border-rose-400 focus:border-rose-400"
                            : "border-[#1E3252] focus:border-[#42D6E8]"
                        }`}
                        required
                      />
                    </div>
                    {lastNameError && (
                      <p className="mt-1 text-xs text-rose-400">{lastNameError}</p>
                    )}
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="mb-1 block text-[12px] font-bold text-[#8FA4BE] sm:text-[13px]">
                    Email Address
                  </label>
                  <div className="relative flex items-center">
                    <div className="absolute left-3 text-[#6E84A3] sm:left-3.5">
                      <Mail size={16} strokeWidth={2} />
                    </div>
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setEmailError("");
                        setError("");
                      }}
                      className={`h-[44px] sm:h-[48px] md:h-[50px] w-full rounded-xl sm:rounded-2xl border bg-[#080F1C] pl-9 pr-3 text-[14px] sm:pl-10 sm:text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                        emailError
                          ? "border-rose-400 focus:border-rose-400"
                          : "border-[#1E3252] focus:border-[#42D6E8]"
                      }`}
                      required
                    />
                  </div>
                  {emailError && (
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-xs text-rose-400">{emailError}</p>
                      <button
                        type="button"
                        onClick={() => navigate("/login")}
                        className="text-xs font-bold text-[#42D6E8] hover:underline cursor-pointer"
                      >
                        Sign in instead →
                      </button>
                    </div>
                  )}
                </div>

                {/* General Error */}
                {error && (
                  <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-[12px] font-medium text-rose-300">
                    {error}
                  </div>
                )}

                {/* Continue / Send Code Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 flex h-[44px] sm:h-[48px] md:h-[50px] w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl bg-[#42D6E8] text-[15px] font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
                >
                  {loading ? "Sending verification code..." : "Continue"}
                  {!loading && <ArrowRight size={17} />}
                </button>
              </form>

              {/* Divider */}
              <div className="relative my-5 sm:my-6 flex items-center justify-center">
                <div className="w-full border-t border-[#1E3252]/80" />
                <span className="absolute bg-[#0B1425] md:bg-[#111F36] px-3 text-[11px] font-bold uppercase tracking-wider text-[#6E84A3]">
                  or sign up with Google
                </span>
              </div>

              {/* Google Sign Up */}
              <div>
                <GoogleAuthButton
                  mode="signup"
                  onError={(msg) => setError(msg)}
                />
              </div>

              {/* Login */}
              <p className="mt-4 text-center text-[13px] text-[#8FA4BE] sm:mt-5">
                Already have an account?
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className="ml-1.5 font-bold text-[#42D6E8] transition-colors hover:text-[#67E8F9] cursor-pointer"
                >
                  Sign In
                </button>
              </p>
            </>
          ) : (
            <>
              {/* Step 2: OTP Verification */}
              <div className="mb-4 sm:mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setStep("details");
                    setError("");
                    setOtpError("");
                  }}
                  className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#8FA4BE] transition hover:text-[#42D6E8] cursor-pointer"
                >
                  <ArrowLeft size={14} /> Back to details
                </button>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#42D6E8]/10 text-[#42D6E8] border border-[#42D6E8]/30">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h1 className="text-[20px] font-extrabold tracking-tight text-[#F1F5F9] sm:text-[24px]">
                      Verify Your Email
                    </h1>
                    <p className="text-[12px] text-[#8FA4BE] sm:text-[13px]">
                      Enter the 6-digit code sent to
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between rounded-xl border border-[#1E3252] bg-[#080F1C] px-3 py-2 text-xs">
                  <span className="font-semibold text-[#F1F5F9] truncate">{email}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setStep("details");
                      setError("");
                      setOtpError("");
                    }}
                    className="ml-2 shrink-0 font-bold text-[#42D6E8] hover:underline cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              </div>

              {infoMessage && (
                <div className="mb-3 rounded-xl border border-[#1E3252] bg-[#132B45]/50 p-2.5 text-center text-xs text-[#8FA4BE]">
                  {infoMessage}
                </div>
              )}

              <form onSubmit={handleVerifyAndRegister} className="flex flex-col gap-3">
                {/* 6-Digit Code Input */}
                <div>
                  <label className="mb-1.5 block text-center text-[12px] font-bold text-[#8FA4BE] sm:text-[13px]">
                    Enter 6-Digit Code
                  </label>
                  <div className="relative">
                    <input
                      ref={otpInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      autoComplete="one-time-code"
                      placeholder="••••••"
                      value={otp}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setOtp(val);
                        setOtpError("");
                        setError("");
                      }}
                      className={`h-[54px] w-full rounded-2xl border bg-[#080F1C] text-center font-mono text-[24px] font-black tracking-[8px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                        otpError
                          ? "border-rose-400 focus:border-rose-400"
                          : "border-[#1E3252] focus:border-[#42D6E8]"
                      }`}
                      required
                    />
                  </div>
                  {otpError && (
                    <p className="mt-1.5 text-center text-xs font-medium text-rose-400">
                      {otpError}
                    </p>
                  )}
                </div>

                {/* Resend Code Section */}
                <div className="flex items-center justify-center text-xs text-[#8FA4BE]">
                  {countdown > 0 ? (
                    <span>
                      Resend code in <strong className="text-[#F1F5F9] font-mono">{countdown}s</strong>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={resending}
                      onClick={handleResendOtp}
                      className="inline-flex items-center gap-1.5 font-bold text-[#42D6E8] hover:text-[#67E8F9] disabled:opacity-60 cursor-pointer"
                    >
                      <RefreshCw size={13} className={resending ? "animate-spin" : ""} />
                      {resending ? "Resending..." : "Resend Code"}
                    </button>
                  )}
                </div>

                {/* Error Banner */}
                {error && (
                  <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-[12px] font-medium text-rose-300">
                    {error}
                  </div>
                )}

                {/* Verify Button */}
                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="mt-1 flex h-[48px] sm:h-[50px] w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl bg-[#42D6E8] text-[15px] font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                >
                  {loading ? "Verifying..." : "Verify & Continue"}
                  {!loading && <ArrowRight size={17} />}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Register;
