import { User, Mail, Lock, Eye, EyeOff, ArrowRight, Check } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { register, login as loginApi } from "../services/authService";
import { useAuth } from "../context/AuthContext";
import { normalizePersonName, isValidPersonName } from "../utils/nameValidator.js";
import { validatePassword, getPasswordRuleChecks } from "../utils/passwordValidator.js";


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

  const passwordChecks = getPasswordRuleChecks(password);

  const handleRegister = async (e) => {
    e.preventDefault();

    setFirstNameError("");
    setLastNameError("");
    setEmailError("");
    setPasswordError("");
    setConfirmPasswordError("");
    setError("");

    let hasError = false;

    const cleanFirst = normalizePersonName(firstName);
    const cleanLast = normalizePersonName(lastName);

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
    if (!email.trim()) {
      setEmailError("Email is required.");
      hasError = true;
    } else if (!/^(?!\.)(?!.*\.\.)[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)*\.[A-Z]{2,63}$/i.test(email.trim())) {
      setEmailError("Please enter a valid email address.");
      hasError = true;
    }

    // Password validation
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setPasswordError(passwordValidation.message);
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
      const cleanEmail = email.trim().toLowerCase();

      const regResponse = await register({
        first_name: cleanFirst,
        last_name: cleanLast,
        name: cleanFullName,
        email: cleanEmail,
        password,
      });

      if (regResponse?.user) {
        loginUser(regResponse.user);
      } else {
        const loginResponse = await loginApi(cleanEmail, password);
        loginUser(loginResponse.user);
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

  return (
    <div className="bg-[#0B1425] font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center">
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[480px] md:rounded-[24px] md:bg-[#111F36] md:border md:border-[#1E3252]/80 md:px-10 md:py-12 md:shadow-lg">
        <div className="w-full">
          {/* Heading */}

          <div className="mb-8">
            <h1 className="text-[28px] font-extrabold tracking-tight text-[#F1F5F9] md:text-[32px]">
              Create Account
            </h1>

            <p className="mt-2 text-[15px] text-[#8FA4BE] md:text-[16px]">
              Create your account to start shopping.
            </p>
          </div>

          <form onSubmit={handleRegister} className="flex flex-col gap-5">
            {/* First Name & Last Name */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* First Name */}
              <div>
                <label className="mb-2 block text-[13px] font-bold text-[#8FA4BE]">
                  First Name
                </label>

                <div className="relative flex items-center">
                  <div className="absolute left-4 text-[#6E84A3]">
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
                    className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-11 pr-4 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                      firstNameError
                        ? "border-rose-400 focus:border-rose-400"
                        : "border-[#1E3252] focus:border-[#42D6E8]"
                    }`}
                    required
                  />
                </div>

                {firstNameError && (
                  <p className="mt-2 text-sm text-rose-400">{firstNameError}</p>
                )}
              </div>

              {/* Last Name */}
              <div>
                <label className="mb-2 block text-[13px] font-bold text-[#8FA4BE]">
                  Last Name
                </label>

                <div className="relative flex items-center">
                  <div className="absolute left-4 text-[#6E84A3]">
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
                    className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-11 pr-4 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                      lastNameError
                        ? "border-rose-400 focus:border-rose-400"
                        : "border-[#1E3252] focus:border-[#42D6E8]"
                    }`}
                    required
                  />
                </div>

                {lastNameError && (
                  <p className="mt-2 text-sm text-rose-400">{lastNameError}</p>
                )}
              </div>
            </div>

            {/* Email */}

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
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                    setError("");
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

            {/* Password */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#8FA4BE]">
                Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-[#6E84A3]">
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
                  className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-12 pr-12 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                    passwordError
                      ? "border-rose-400 focus:border-rose-400"
                      : "border-[#1E3252] focus:border-[#42D6E8]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 text-[#6E84A3] transition-colors hover:text-[#42D6E8] cursor-pointer"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>

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

              {passwordError && (
                <p className="mt-2 text-sm text-rose-400">{passwordError}</p>
              )}
            </div>

            {/* Confirm Password */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#8FA4BE]">
                Confirm Password
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-[#6E84A3]">
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
                  className={`h-[56px] w-full rounded-2xl border bg-[#080F1C] pl-12 pr-12 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15 ${
                    confirmPasswordError
                      ? "border-rose-400 focus:border-rose-400"
                      : "border-[#1E3252] focus:border-[#42D6E8]"
                  }`}
                  required
                />

                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 text-[#6E84A3] transition-colors hover:text-[#42D6E8] cursor-pointer"
                >
                  {showConfirmPassword ? (
                    <EyeOff size={20} />
                  ) : (
                    <Eye size={20} />
                  )}
                </button>
              </div>

              {confirmPasswordError && (
                <p className="mt-2 text-sm text-rose-400">
                  {confirmPasswordError}
                </p>
              )}
            </div>

            {/* General Error */}

            {error && (
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-4 text-[13px] font-medium text-rose-300">
                {error}
              </div>
            )}

            {/* Register Button */}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] text-[16px] font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
            >
              {loading ? "Creating account..." : "Create Account"}

              {!loading && <ArrowRight size={20} />}
            </button>
          </form>

          {/* Login */}

          <p className="mt-8 text-center text-[14px] text-[#8FA4BE]">
            Already have an account?
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="ml-1.5 font-bold text-[#42D6E8] transition-colors hover:text-[#67E8F9] cursor-pointer"
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
