import { User, Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { register } from "../services/authService";
import { useAuth } from "../context/AuthContext";

function Register() {
  const navigate = useNavigate();
  const { login: loginUser } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [error, setError] = useState("");

  const handleRegister = async (e) => {
    e.preventDefault();

    setNameError("");
    setEmailError("");
    setPasswordError("");
    setConfirmPasswordError("");
    setError("");

    let hasError = false;

    // Name validation
    if (!name.trim()) {
      setNameError("Name is required.");
      hasError = true;
    } else if (name.trim().length < 2) {
      setNameError("Name must be at least 2 characters.");
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

      const response = await register({
        name: name.trim(),
        email: email.trim(),
        password,
      });

      // Automatically log the newly registered user in
      loginUser(response.user);

      navigate("/profile-setup");
    } catch (err) {
      console.error(err);

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
    <div className="bg-white font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center md:bg-[#F8F9F5]">
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
            {/* Name */}

            <div>
              <label className="mb-2 block text-[13px] font-bold text-gray-700">
                Full Name
              </label>

              <div className="relative flex items-center">
                <div className="absolute left-4 text-gray-400">
                  <User size={20} strokeWidth={2} />
                </div>

                <input
                  type="text"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError("");
                    setError("");
                  }}
                  className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-4 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/15 ${
                    nameError
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-200 focus:border-[#FF8A00]"
                  }`}
                  required
                />
              </div>

              {nameError && (
                <p className="mt-2 text-sm text-red-600">{nameError}</p>
              )}
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
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                    setError("");
                  }}
                  className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-4 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/15 ${
                    emailError
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-200 focus:border-[#FF8A00]"
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
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError("");
                    setError("");
                  }}
                  className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-12 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/15 ${
                    passwordError
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-200 focus:border-[#FF8A00]"
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
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setConfirmPasswordError("");
                    setError("");
                  }}
                  className={`h-[56px] w-full rounded-2xl border bg-gray-50 pl-12 pr-12 text-[15px] text-gray-900 outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/15 ${
                    confirmPasswordError
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-200 focus:border-[#FF8A00]"
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
              className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8A00] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(255,138,0,0.25)] transition-all hover:bg-[#FF7300] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Creating account..." : "Create Account"}

              {!loading && <ArrowRight size={20} />}
            </button>
          </form>

          {/* Login */}

          <p className="mt-8 text-center text-[14px] text-gray-500">
            Already have an account?
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="ml-1.5 font-bold text-[#FF7A00] transition-colors hover:text-[#e06b00]"
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
