import { User, Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { register, login as loginApi, googleLogin as googleLoginService } from "../services/authService";
import { useAuth } from "../context/AuthContext";


function Register() {
  const navigate = useNavigate();
  const { login: loginUser } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [error, setError] = useState("");

  const handleRegister = async (e) => {
    e.preventDefault();

    setFirstNameError("");
    setLastNameError("");
    setEmailError("");
    setPasswordError("");
    setConfirmPasswordError("");
    setError("");

    let hasError = false;

    // First Name validation
    if (!firstName.trim()) {
      setFirstNameError("First name is required.");
      hasError = true;
    } else if (firstName.trim().length < 2) {
      setFirstNameError("First name must be at least 2 characters.");
      hasError = true;
    }

    // Last Name validation
    if (!lastName.trim()) {
      setLastNameError("Last name is required.");
      hasError = true;
    } else if (lastName.trim().length < 2) {
      setLastNameError("Last name must be at least 2 characters.");
      hasError = true;
    }

    // Email validation
    if (!email.trim()) {
      setEmailError("Email is required.");
      hasError = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email address.");
      hasError = true;
    }

    // Password validation
    if (!password) {
      setPasswordError("Password is required.");
      hasError = true;
    } else if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      hasError = true;
    }

    // Confirm password
    if (!confirmPassword) {
      setConfirmPasswordError("Please confirm your password.");
      hasError = true;
    } else if (password !== confirmPassword) {
      setConfirmPasswordError("Passwords do not match.");
      hasError = true;
    }

    if (hasError) {
      return;
    }

    try {
      setLoading(true);

      const cleanFirst = firstName.trim();
      const cleanLast = lastName.trim();
      const cleanFullName = `${cleanFirst} ${cleanLast}`;

      await register({
        first_name: cleanFirst,
        last_name: cleanLast,
        name: cleanFullName,
        email: email.trim(),
        password,
      });

      // Automatically authenticate and issue fresh session cookies for the new user
      const loginResponse = await loginApi(email.trim(), password);

      loginUser(loginResponse.user);

      navigate("/profile-setup");
    } catch (err) {
      const backendMessage =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : err.response?.data?.message?.message ||
            "Unable to create your account.";

      if (
        err.response?.status === 409 ||
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

  const submittingRef = useRef(false);

  useEffect(() => {
    const handleStart = () => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setLoading(true);
      setError("");
    };
    const handleError = (e) => {
      setError(e.detail);
      setLoading(false);
      submittingRef.current = false;
    };
    const handleEnd = () => {
      setLoading(false);
      submittingRef.current = false;
    };

    window.addEventListener("google-auth-start", handleStart);
    window.addEventListener("google-auth-error", handleError);
    window.addEventListener("google-auth-end", handleEnd);

    // Tell GlobalGoogleLogin that the portal target is mounted
    window.dispatchEvent(new CustomEvent("google-login-ready"));

    return () => {
      window.removeEventListener("google-auth-start", handleStart);
      window.removeEventListener("google-auth-error", handleError);
      window.removeEventListener("google-auth-end", handleEnd);
    };
  }, []);

  return (
    <div className="bg-white font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center md:bg-[#F7F7FB]">
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[480px] md:rounded-[24px] md:bg-white md:px-10 md:py-12 md:shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
        <div className="w-full">
          {/* Heading */}

          <div className="mb-8">
            <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E1E1E] md:text-[32px]">
              Create Account
            </h1>

            <p className="mt-2 text-[15px] text-gray-500 md:text-[16px]">
              Create your account to start shopping.
            </p>
          </div>

          <form onSubmit={handleRegister} className="flex flex-col gap-5">
            {/* First Name & Last Name */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* First Name */}
              <div>
                <label className="mb-2 block text-[13px] font-bold text-gray-700">
                  First Name
                </label>

                <div className="relative flex items-center">
                  <div className="absolute left-4 text-gray-400">
                    <User size={18} strokeWidth={2} />
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
                    className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-11 pr-4 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 ${
                      firstNameError
                        ? "border-red-300 focus:border-red-400"
                        : "border-gray-200 focus:border-[#7C3AED]"
                    }`}
                    required
                  />
                </div>

                {firstNameError && (
                  <p className="mt-2 text-sm text-red-600">{firstNameError}</p>
                )}
              </div>

              {/* Last Name */}
              <div>
                <label className="mb-2 block text-[13px] font-bold text-gray-700">
                  Last Name
                </label>

                <div className="relative flex items-center">
                  <div className="absolute left-4 text-gray-400">
                    <User size={18} strokeWidth={2} />
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
                    className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-11 pr-4 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 ${
                      lastNameError
                        ? "border-red-300 focus:border-red-400"
                        : "border-gray-200 focus:border-[#7C3AED]"
                    }`}
                    required
                  />
                </div>

                {lastNameError && (
                  <p className="mt-2 text-sm text-red-600">{lastNameError}</p>
                )}
              </div>
            </div>

            {/* Email */}

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
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                    setError("");
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

            {/* Password */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-gray-700">
                Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-gray-400">
                  <Lock size={20} strokeWidth={2} />
                </div>

                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError("");
                    setError("");
                  }}
                  className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-12 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 ${
                    passwordError
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-200 focus:border-[#7C3AED]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 text-gray-400 transition-colors hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>

              {passwordError && (
                <p className="mt-2 text-sm text-red-600">{passwordError}</p>
              )}
            </div>

            {/* Confirm Password */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-gray-700">
                Confirm Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-gray-400">
                  <Lock size={20} strokeWidth={2} />
                </div>

                <input
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setConfirmPasswordError("");
                    setError("");
                  }}
                  className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-12 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 ${
                    confirmPasswordError
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-200 focus:border-[#7C3AED]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 text-gray-400 transition-colors hover:text-gray-600"
                >
                  {showConfirmPassword ? (
                    <EyeOff size={20} />
                  ) : (
                    <Eye size={20} />
                  )}
                </button>
              </div>

              {confirmPasswordError && (
                <p className="mt-2 text-sm text-red-600">
                  {confirmPasswordError}
                </p>
              )}
            </div>

            {/* General Error */}

            {error && (
              <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
                {error}
              </div>
            )}

            {/* Register Button */}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Creating account..." : "Create Account"}

              {!loading && <ArrowRight size={20} />}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-center">
            <div className="h-px w-full bg-gray-200"></div>
            <span className="px-4 text-[13px] font-medium text-gray-400">OR</span>
            <div className="h-px w-full bg-gray-200"></div>
          </div>

          <div className="mt-6 flex justify-center" id="google-login-portal-target">
          </div>

          {/* Login */}

          <p className="mt-8 text-center text-[14px] text-gray-500">
            Already have an account?
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="ml-1.5 font-bold text-[#7C3AED] transition-colors hover:text-[#6C35E8]"
            >
              Sign In
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;
