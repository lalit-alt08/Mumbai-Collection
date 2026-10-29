import { Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import API_URL from "../config/api.js";
import { login } from "../services/authService";
import { useAuth } from "../context/AuthContext";
import GoogleAuthButton from "../components/auth/GoogleAuthButton.jsx";


function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const { login: loginUser } = useAuth();

  const submittingRef = useRef(false);

  const [email, setEmail] = useState(location.state?.email || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();

    // Prevent duplicate login requests
    if (submittingRef.current) {
      return;
    }

    setEmailError("");
    setPasswordError("");
    setError("");

    let hasError = false;

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

    if (hasError) {
      return;
    }

    try {
      submittingRef.current = true;
      setLoading(true);
      setError("");

      // Login
      const response = await login(email, password);

      // Save logged-in user
      loginUser(response.user);

      /*
       * Existing/complete user.
       *
       * If the user was redirected to login from a
       * protected page, return them to that page.
       *
       * Otherwise, normal login goes to Home.
       */
      const from = location.state?.from;

      if (from) {
        navigate(from, { replace: true });
      } else {
        navigate("/", {
          replace: true,
        });
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setError(err.response.data?.message || "Invalid email or password.");
      } else if (err.response?.status === 429) {
        setError(
          err.response.data?.message ||
            "Too many login attempts. Please try again later.",
        );
      } else if (err.response?.status === 400 || err.response?.status === 403 || err.response?.status === 409) {
        setError(err.response.data?.message || "Login request rejected.");
      } else if (err.response?.status === 503) {
        setError("Authentication service is temporarily unavailable. Please retry in a moment.");
      } else {
        setError("Unable to connect to the server. Please try again.");
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="bg-[#0B1425] font-sans md:flex md:min-h-[calc(100vh-80px)] md:items-center md:justify-center md:py-8 lg:py-12">
      {/* Login Form Container */}
      <div className="mx-auto my-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[460px] md:rounded-[24px] md:bg-[#111F36] md:border md:border-[#1E3252]/80 md:px-8 md:py-8 md:shadow-2xl">
        <div className="w-full">
          {/* Header */}
          <div className="mb-6 md:mb-5">
            <h1 className="text-[28px] font-extrabold tracking-tight text-[#F1F5F9] md:text-[30px]">
              Sign In
            </h1>

            <p className="mt-2 text-[15px] text-[#8FA4BE] md:text-[15px]">
              Please enter your details to access your account.
            </p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-5 md:gap-4">
            {/* Email Field */}
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
                  className="h-[56px] md:h-[50px] w-full rounded-2xl border border-[#1E3252] bg-[#080F1C] pl-12 pr-4 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:border-[#42D6E8] focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15"
                  required
                />
              </div>

              {emailError && (
                <p className="mt-2 text-sm text-rose-400">{emailError}</p>
              )}
            </div>

            {/* Password Field */}
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
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError("");
                    setError("");
                  }}
                  className="h-[56px] md:h-[50px] w-full rounded-2xl border border-[#1E3252] bg-[#080F1C] pl-12 pr-12 text-[15px] text-[#F1F5F9] placeholder-[#6E84A3] outline-none transition-all focus:border-[#42D6E8] focus:bg-[#080F1C] focus:ring-4 focus:ring-[#42D6E8]/15"
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

              {passwordError && (
                <p className="mt-2 text-sm text-rose-400">{passwordError}</p>
              )}

              <div className="mt-2.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="text-[13px] font-semibold text-[#42D6E8] hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-4 text-[13px] font-medium text-rose-300">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 md:mt-2 flex h-[56px] md:h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] text-[16px] font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
            >
              {loading ? "Signing in..." : "Sign In"}

              {!loading && <ArrowRight size={20} />}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-5 md:my-4 flex items-center justify-center">
            <div className="w-full border-t border-[#1E3252]/80" />
            <span className="absolute bg-[#0B1425] md:bg-[#111F36] px-3 text-[11px] font-bold uppercase tracking-wider text-[#6E84A3]">
              or sign in with Google
            </span>
          </div>

          {/* Google Sign In */}
          <div>
            <GoogleAuthButton
              mode="signin"
              onError={(msg) => setError(msg)}
            />
          </div>

          {/* Footer */}
          <p className="mt-6 md:mt-5 text-center text-[14px] text-[#8FA4BE]">
            Don't have an account?
            <button
              type="button"
              onClick={() => navigate("/register")}
              className="ml-1.5 font-bold text-[#42D6E8] transition-colors hover:text-[#67E8F9] cursor-pointer"
            >
              Create one now
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
