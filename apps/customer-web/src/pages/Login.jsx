import { Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import API_URL from "../config/api.js";
import { login } from "../services/authService";
import { useAuth } from "../context/AuthContext";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const { login: loginUser } = useAuth();

  const submittingRef = useRef(false);

  const [email, setEmail] = useState("");
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

      // Check whether profile + address information is complete
      const profileResponse = await axios.get(
        `${API_URL}/profile/complete`,
        {
          withCredentials: true,
        },
      );

      const profileComplete = profileResponse.data.complete === true;

      // Incomplete user → Profile Setup (forward destination state)
      if (!profileComplete) {
        navigate("/profile-setup", {
          replace: true,
          state: location.state,
        });

        return;
      }

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
        navigate(from, {
          replace: true,
        });
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
      } else {
        console.error("LOGIN ERROR:", err);
        setError("Unable to connect to the server. Please try again.");
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="bg-white font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center md:bg-[#F8F9F5]">
      {/* Login Form Container */}
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[480px] md:rounded-[24px] md:bg-white md:px-10 md:py-12 md:shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
        <div className="w-full">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E1E1E] md:text-[32px]">
              Sign In
            </h1>

            <p className="mt-2 text-[15px] text-gray-500 md:text-[16px]">
              Please enter your details to access your account.
            </p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            {/* Email Field */}
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
                  className="h-[56px] w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-[15px] text-gray-900 outline-none transition-all focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/15"
                  required
                />
              </div>

              {emailError && (
                <p className="mt-2 text-sm text-red-600">{emailError}</p>
              )}
            </div>

            {/* Password Field */}
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
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError("");
                    setError("");
                  }}
                  className="h-[56px] w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-12 text-[15px] text-gray-900 outline-none transition-all focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/15"
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

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="text-[13px] font-semibold text-[#FF8A00] hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8A00] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(255,138,0,0.25)] transition-all hover:bg-[#FF7300] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Signing in..." : "Sign In"}

              {!loading && <ArrowRight size={20} />}
            </button>
          </form>

          {/* Footer */}
          <p className="mt-8 text-center text-[14px] text-gray-500">
            Don't have an account?
            <button
              type="button"
              onClick={() => navigate("/register")}
              className="ml-1.5 font-bold text-[#FF7A00] transition-colors hover:text-[#e06b00]"
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
