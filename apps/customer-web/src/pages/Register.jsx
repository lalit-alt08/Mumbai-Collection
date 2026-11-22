import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { register, sendOtp, verifyOtp, getCurrentUser } from "../services/authService";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { normalizePersonName, isValidPersonName } from "../utils/nameValidator.js";
import { validatePassword } from "../utils/passwordValidator.js";
import { executePostAuthNavigation } from "../utils/postAuthRedirect.js";
import { RegisterDetailsStep } from "../components/auth/RegisterDetailsStep.jsx";
import { RegisterOtpStep } from "../components/auth/RegisterOtpStep.jsx";
import { RegisterPasswordStep } from "../components/auth/RegisterPasswordStep.jsx";

function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    isAuthenticated,
    loading: authLoading,
    isReconnecting,
    login: loginUser,
    reconcileSupersededAuth,
    logout,
    logoutPending,
    handleSessionExpired,
    getAuthEpoch,
  } = useAuth();
  const { cart } = useCart();
  const isMountedRef = useRef(true);
  const authAttemptRef = useRef(0);
  const registrationCompletedRef = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
    if (loading || googleBusy) return;

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
        setEmailError(
          "An account with this email already exists. Please sign in with your password or Continue with Google."
        );
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

    const attemptId = ++authAttemptRef.current;
    const preAuthEpoch = typeof getAuthEpoch === "function" ? getAuthEpoch() : null;
    const isPreAuthActive = () =>
      isMountedRef.current &&
      authAttemptRef.current === attemptId &&
      (preAuthEpoch === null || getAuthEpoch() === preAuthEpoch);

    try {
      submittingRef.current = true;
      setLoading(true);

      if (step === "otp") {
        const verification = await verifyOtp(email.trim().toLowerCase(), cleanOtp, "register");
        if (!isPreAuthActive()) return;
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
      if (!isPreAuthActive()) {
        void reconcileSupersededAuth();
        return;
      }

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
      if (!isPreAuthActive()) {
        void reconcileSupersededAuth();
        return;
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

      const hasCartItems = Boolean(cart?.items?.length > 0);
      registrationCompletedRef.current = true;
      loginUser(confirmedUser);
      const expectedEpoch = typeof getAuthEpoch === "function" ? getAuthEpoch() : null;
      setPassword("");
      setConfirmPassword("");
      setRegistrationToken("");

      await executePostAuthNavigation({
        from: location.state?.from,
        hasCartItems,
        user: confirmedUser,
        firstName: cleanFirst,
        lastName: cleanLast,
        isNewUser: true,
        // A brand-new registration has no returning saved account cart; only
        // redirect to /profile-setup if the user came from /cart or added items.
        waitForAuthenticatedCart: null,
        isAttemptActive: () =>
          isMountedRef.current &&
          authAttemptRef.current === attemptId &&
          (expectedEpoch === null || getAuthEpoch() === expectedEpoch),
        handleSessionExpired,
        navigate,
        onUnauthorized: (msg) => setError(msg),
      });
    } catch (err) {
      if (!isPreAuthActive()) return;
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
      if (authAttemptRef.current === attemptId) {
        submittingRef.current = false;
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }
  };

  if ((authLoading || isReconnecting) && !registrationCompletedRef.current) {
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center bg-[#F0F8E8] text-sm font-semibold text-[#475569]">
        {isReconnecting ? "Reconnecting to your account..." : "Checking your account..."}
      </div>
    );
  }

  const isAlreadySignedIn =
    isAuthenticated &&
    Boolean(user?.id) &&
    !loading &&
    !submittingRef.current &&
    !registrationCompletedRef.current;

  if (isAlreadySignedIn) {
    return (
      <div className="bg-[#F0F8E8] font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center">
        <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-6 pb-24 sm:px-6 sm:pb-28 md:max-w-[480px] md:rounded-[24px] md:bg-[#FFFFFF] md:border md:border-[#E2E8F0]/80 md:px-10 md:py-10 md:shadow-lg">
          <div className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6 text-center shadow-xs md:border-0 md:p-0 md:shadow-none space-y-4">
            <h1 className="text-[24px] sm:text-[26px] font-extrabold tracking-tight text-[#1E293B]">
              Already Signed In
            </h1>
            <p className="text-[14.5px] leading-relaxed text-[#475569]">
              You are already signed in
              {user.email ? (
                <>
                  {" "}as <span className="font-semibold text-[#1E293B]">{user.email}</span>
                </>
              ) : null}
              .
            </p>
            {user.is_google_user && (
              <p className="text-sm text-[#475569]">Your account is linked to Google.</p>
            )}
            <div className="flex flex-col gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => navigate("/", { replace: true })}
                className="flex h-[50px] w-full items-center justify-center rounded-2xl bg-[#22499F] text-[15px] font-black text-[#FFFFFF] shadow-md transition hover:bg-[#1B3B82] active:scale-[0.98] cursor-pointer"
              >
                Go to Home
              </button>
              <button
                type="button"
                onClick={() => navigate("/account")}
                className="flex h-[48px] w-full items-center justify-center rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] text-[14.5px] font-bold text-[#1E293B] transition hover:border-[#22499F]/40 active:scale-[0.98] cursor-pointer"
              >
                My Account
              </button>
              <button
                type="button"
                disabled={signingOut}
                onClick={async () => {
                  try {
                    setSigningOut(true);
                    await logout();
                  } finally {
                    if (isMountedRef.current) setSigningOut(false);
                  }
                }}
                className="mt-1 text-[13px] font-semibold text-[#22499F] hover:underline disabled:opacity-60 cursor-pointer"
              >
                {signingOut ? "Signing out..." : "Sign out to create a different account"}
              </button>
              {logoutPending && (
                <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-950 space-y-2">
                  <p className="font-medium leading-relaxed">{logoutPending.message}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={signingOut}
                      onClick={async () => {
                        try {
                          setSigningOut(true);
                          await logout({ force: false });
                        } finally {
                          if (isMountedRef.current) setSigningOut(false);
                        }
                      }}
                      className="rounded-lg bg-[#22499F] px-3 py-1.5 font-bold text-white disabled:opacity-60 cursor-pointer"
                    >
                      Retry Sign Out
                    </button>
                    <button
                      type="button"
                      disabled={signingOut}
                      onClick={async () => {
                        try {
                          setSigningOut(true);
                          await logout({ force: true });
                        } finally {
                          if (isMountedRef.current) setSigningOut(false);
                        }
                      }}
                      className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold text-amber-950 disabled:opacity-60 cursor-pointer"
                    >
                      Sign Out on This Device
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#F0F8E8] font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center">
      <div className="auth-form-card mx-auto flex w-full max-w-md flex-col rounded-2xl border border-[#E2E8F0]/80 bg-[#FFFFFF] px-5 py-6 shadow-lg sm:p-8 md:max-w-[480px] md:rounded-[24px] md:px-10 md:py-8 md:shadow-lg">
        <div className="w-full">
          {step === "details" ? (
            <RegisterDetailsStep
              firstName={firstName}
              setFirstName={setFirstName}
              lastName={lastName}
              setLastName={setLastName}
              email={email}
              setEmail={setEmail}
              firstNameError={firstNameError}
              setFirstNameError={setFirstNameError}
              lastNameError={lastNameError}
              setLastNameError={setLastNameError}
              emailError={emailError}
              setEmailError={setEmailError}
              error={error}
              setError={setError}
              loading={loading}
              googleBusy={googleBusy}
              onGoogleBusyChange={setGoogleBusy}
              handleSendOtp={handleSendOtp}
              navigate={navigate}
              location={location}
            />
          ) : step === "password" ? (
            <RegisterPasswordStep
              email={email}
              password={password}
              setPassword={setPassword}
              confirmPassword={confirmPassword}
              setConfirmPassword={setConfirmPassword}
              error={error}
              loading={loading}
              handleVerifyAndRegister={handleVerifyAndRegister}
              onResetToDetails={() => {
                setStep("details");
                setRegistrationToken("");
                setPassword("");
                setConfirmPassword("");
                setError("");
              }}
            />
          ) : (
            <RegisterOtpStep
              email={email}
              otp={otp}
              setOtp={setOtp}
              otpError={otpError}
              setOtpError={setOtpError}
              error={error}
              setError={setError}
              infoMessage={infoMessage}
              countdown={countdown}
              resending={resending}
              loading={loading}
              otpInputRef={otpInputRef}
              handleVerifyAndRegister={handleVerifyAndRegister}
              handleResendOtp={handleResendOtp}
              onBackToDetails={() => {
                setStep("details");
                setError("");
                setOtpError("");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default Register;
