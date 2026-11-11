import { User, Mail, ArrowRight, ArrowLeft, ShieldCheck, RefreshCw } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { register, sendOtp, verifyOtp, getCurrentUser } from "../services/authService";
import { useAuth } from "../context/AuthContext";
import { normalizePersonName, isValidPersonName } from "../utils/nameValidator.js";
import GoogleAuthButton from "../components/auth/GoogleAuthButton.jsx";
import { validatePassword } from "../utils/passwordValidator.js";
import { getSafeInternalPath } from "../utils/navigation.js";

function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login: loginUser } = useAuth();

  // Step state: "details" (names + email) | "otp" (verification code)
  const [step, setStep] = useState("details");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const submittingRef = useRef(false);

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
    if (submittingRef.current) return;

    setOtpError("");
    setError("");

    const cleanOtp = otp.trim().replace(/\D/g, "");
    if (step === "otp" && (!cleanOtp || cleanOtp.length !== 6)) {
      setOtpError("Please enter the 6-digit verification code.");
      return;
    }
    if (step === "password") {
      const validation = validatePassword(password);
      if (!validation.isValid || password !== confirmPassword) {
        setError(validation.isValid ? "Passwords do not match." : validation.message);
        return;
      }
    }

    try {
      submittingRef.current = true;
      setLoading(true);

      if (step === "otp") {
        const verification = await verifyOtp(email.trim().toLowerCase(), cleanOtp, "register");
        if (!verification?.registration_token) throw new Error("Email verification could not be confirmed.");
        setRegistrationToken(verification.registration_token);
        setOtp("");
        setInfoMessage("");
        setStep("password");
        return;
      }

      const cleanFirst = normalizePersonName(firstName);
      const cleanLast = normalizePersonName(lastName);
      const cleanFullName = `${cleanFirst} ${cleanLast}`;
      const cleanEmail = email.trim().toLowerCase();

      const regResponse = await register({
        first_name: cleanFirst,
        last_name: cleanLast,
        name: cleanFullName,
        email: cleanEmail,
        registration_token: registrationToken,
        password,
      });

      if (!regResponse?.user) {
        throw new Error("Registration succeeded but no active user session was returned. Please sign in.");
      }

      // If registration succeeded but the backend could not establish a session cookie:
      if (regResponse.session_established === false) {
        setPassword("");
        setConfirmPassword("");
        setRegistrationToken("");
        navigate("/login", {
          replace: true,
          state: {
            email: cleanEmail,
            from: location.state?.from,
            message: "Account created successfully! Please sign in with your password to continue.",
          },
        });
        return;
      }

      // Explicitly verify browser cookie acceptance via authenticated /auth/me
      let confirmedUser;
      try {
        const sessionCheck = await getCurrentUser();
        confirmedUser = sessionCheck?.success && sessionCheck?.user;
      } catch (_) {
        confirmedUser = null;
      }
      if (!confirmedUser || String(confirmedUser.id) !== String(regResponse.user.id)) {
        setPassword("");
        setConfirmPassword("");
        setRegistrationToken("");
        navigate("/login", {
          replace: true,
          state: {
            email: cleanEmail,
            from: location.state?.from,
            message: "Account created successfully! Please sign in with your password to continue.",
          },
        });
        return;
      }

      loginUser(confirmedUser);
      setPassword("");
      setConfirmPassword("");
      setRegistrationToken("");

      const safeReturn = getSafeInternalPath(location.state?.from, "/");
      navigate(safeReturn, { replace: true });
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
        if (step === "password") setError(backendMessage);
        else setOtpError(backendMessage);
      } else {
        setError(backendMessage);
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#F0F8E8] font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center">
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-2 pb-24 sm:px-6 sm:pb-28 md:max-w-[480px] md:rounded-[24px] md:bg-[#FFFFFF] md:border md:border-[#E2E8F0]/80 md:px-10 md:py-8 md:shadow-lg">
        <div className="w-full">
          {step === "details" ? (
            <>
              {/* Heading */}
              <div className="mb-3 sm:mb-4">
                <h1 className="text-[22px] font-extrabold tracking-tight text-[#1E293B] sm:text-[28px] md:text-[32px]">
                  Create Account
                </h1>
                <p className="mt-0.5 text-[13px] text-[#64748B] sm:text-[15px]">
                  Enter your details to get started with fast shopping.
                </p>
              </div>

              <form onSubmit={handleSendOtp} className="flex flex-col gap-2.5 sm:gap-3.5">
                {/* First Name & Last Name */}
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
                  {/* First Name */}
                  <div>
                    <label className="mb-1 block text-[12px] font-bold text-[#64748B] sm:text-[13px]">
                      First Name
                    </label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 text-[#64748B] sm:left-3.5">
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
                        className={`h-[44px] sm:h-[48px] md:h-[50px] w-full rounded-xl sm:rounded-2xl border bg-[#F0F8E8] pl-9 pr-3 text-[14px] sm:pl-10 sm:text-[15px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                          firstNameError
                            ? "border-rose-400 focus:border-rose-400"
                            : "border-[#E2E8F0] focus:border-[#22499F]"
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
                    <label className="mb-1 block text-[12px] font-bold text-[#64748B] sm:text-[13px]">
                      Last Name
                    </label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 text-[#64748B] sm:left-3.5">
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
                        className={`h-[44px] sm:h-[48px] md:h-[50px] w-full rounded-xl sm:rounded-2xl border bg-[#F0F8E8] pl-9 pr-3 text-[14px] sm:pl-10 sm:text-[15px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                          lastNameError
                            ? "border-rose-400 focus:border-rose-400"
                            : "border-[#E2E8F0] focus:border-[#22499F]"
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
                  <label className="mb-1 block text-[12px] font-bold text-[#64748B] sm:text-[13px]">
                    Email Address
                  </label>
                  <div className="relative flex items-center">
                    <div className="absolute left-3 text-[#64748B] sm:left-3.5">
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
                      className={`h-[44px] sm:h-[48px] md:h-[50px] w-full rounded-xl sm:rounded-2xl border bg-[#F0F8E8] pl-9 pr-3 text-[14px] sm:pl-10 sm:text-[15px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                        emailError
                          ? "border-rose-400 focus:border-rose-400"
                          : "border-[#E2E8F0] focus:border-[#22499F]"
                      }`}
                      required
                    />
                  </div>
                  {emailError && (
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-xs text-rose-400">{emailError}</p>
                      <button
                        type="button"
                        onClick={() => navigate("/login", { state: { from: location.state?.from } })}
                        className="text-xs font-bold text-[#22499F] hover:underline cursor-pointer"
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
                  className="mt-1 flex h-[44px] sm:h-[48px] md:h-[50px] w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl bg-[#22499F] text-[15px] font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
                >
                  {loading ? "Sending verification code..." : "Continue"}
                  {!loading && <ArrowRight size={17} />}
                </button>
              </form>

              {/* Divider */}
              <div className="relative my-5 sm:my-6 flex items-center justify-center">
                <div className="w-full border-t border-[#E2E8F0]/80" />
                <span className="absolute bg-[#F0F8E8] md:bg-[#FFFFFF] px-3 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
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
              <p className="mt-4 text-center text-[13px] text-[#64748B] sm:mt-5">
                Already have an account?
                <button
                  type="button"
                  onClick={() => navigate("/login", { state: { from: location.state?.from } })}
                  className="ml-1.5 font-bold text-[#22499F] transition-colors hover:text-[#22499F] cursor-pointer"
                >
                  Sign In
                </button>
              </p>
            </>
          ) : step === "password" ? (
            <form onSubmit={handleVerifyAndRegister} className="flex flex-col gap-4">
              <h1 className="text-2xl font-extrabold text-[#1E293B]">Create your password</h1>
              <p className="text-sm text-[#64748B]">Email verified. Set a password to sign in with {email} next time.</p>
              <p id="password-help" className="text-xs text-[#64748B]">Use 8–256 characters, including uppercase and lowercase letters, a number, and a symbol.</p>
              <label className="text-sm font-bold text-[#64748B]">Password
                <input type="password" autoComplete="new-password" autoFocus required maxLength={256}
                  aria-describedby="password-help" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 h-12 w-full rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] px-4 text-[#1E293B]" />
              </label>
              <label className="text-sm font-bold text-[#64748B]">Confirm password
                <input type="password" autoComplete="new-password" required maxLength={256}
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-2 h-12 w-full rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] px-4 text-[#1E293B]" />
              </label>
              {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
              <button type="submit" disabled={loading} className="h-12 rounded-xl bg-[#22499F] font-bold text-[#FFFFFF] disabled:opacity-60">
                {loading ? "Creating account..." : "Continue to delivery setup"}
              </button>
              <button type="button" disabled={loading} onClick={() => {
                setStep("details"); setRegistrationToken(""); setPassword(""); setConfirmPassword(""); setError("");
              }} className="text-sm text-[#64748B]">Change email or request a new code</button>
            </form>
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
                  className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#64748B] transition hover:text-[#22499F] cursor-pointer"
                >
                  <ArrowLeft size={14} /> Back to details
                </button>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#22499F]/10 text-[#22499F] border border-[#22499F]/30">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h1 className="text-[20px] font-extrabold tracking-tight text-[#1E293B] sm:text-[24px]">
                      Verify Your Email
                    </h1>
                    <p className="text-[12px] text-[#64748B] sm:text-[13px]">
                      Enter the 6-digit code sent to
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] px-3 py-2 text-xs">
                  <span className="font-semibold text-[#1E293B] truncate">{email}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setStep("details");
                      setError("");
                      setOtpError("");
                    }}
                    className="ml-2 shrink-0 font-bold text-[#22499F] hover:underline cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              </div>

              {infoMessage && (
                <div className="mb-3 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF]/50 p-2.5 text-center text-xs text-[#64748B]">
                  {infoMessage}
                </div>
              )}

              <form onSubmit={handleVerifyAndRegister} className="flex flex-col gap-3">
                {/* 6-Digit Code Input */}
                <div>
                  <label className="mb-1.5 block text-center text-[12px] font-bold text-[#64748B] sm:text-[13px]">
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
                      className={`h-[54px] w-full rounded-2xl border bg-[#F0F8E8] text-center font-mono text-[24px] font-black tracking-[8px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                        otpError
                          ? "border-rose-400 focus:border-rose-400"
                          : "border-[#E2E8F0] focus:border-[#22499F]"
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
                <div className="flex items-center justify-center text-xs text-[#64748B]">
                  {countdown > 0 ? (
                    <span>
                      Resend code in <strong className="text-[#1E293B] font-mono">{countdown}s</strong>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={resending}
                      onClick={handleResendOtp}
                      className="inline-flex items-center gap-1.5 font-bold text-[#22499F] hover:text-[#22499F] disabled:opacity-60 cursor-pointer"
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
                  className="mt-1 flex h-[48px] sm:h-[50px] w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl bg-[#22499F] text-[15px] font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
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
