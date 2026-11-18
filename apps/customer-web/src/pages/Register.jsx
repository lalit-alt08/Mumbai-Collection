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
  const { login: loginUser, handleSessionExpired, getAuthEpoch } = useAuth();
  const { cart, waitForAuthenticatedCart } = useCart();
  const isMountedRef = useRef(true);
  const authAttemptRef = useRef(0);

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
      if (!isPreAuthActive()) return;

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
      if (!isPreAuthActive()) return;

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
        waitForAuthenticatedCart,
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

  return (
    <div className="bg-[#F0F8E8] font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center">
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-2 pb-24 sm:px-6 sm:pb-28 md:max-w-[480px] md:rounded-[24px] md:bg-[#FFFFFF] md:border md:border-[#E2E8F0]/80 md:px-10 md:py-8 md:shadow-lg">
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
