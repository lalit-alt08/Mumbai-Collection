import { useState } from "react";
import { Navigate } from "react-router-dom";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  Store,
} from "lucide-react";

import { useAdminAuth } from "../context/AdminAuthContext.jsx";

function Login() {
  const { user, loading, isAdmin, login } = useAdminAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0D0F11]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#FF8A00]" />
      </div>
    );
  }

  if (user && isAdmin) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    try {
      setSubmitting(true);
      await login(email.trim(), password);
    } catch (err) {
      if (err.response?.status === 401) {
        setError(err.response.data?.message || "Invalid email or password.");
      } else if (err.response?.status === 429) {
        setError(
          err.response.data?.message ||
            "Too many login attempts. Please try again later."
        );
      } else {
        setError(
          err.response?.data?.message ||
            "Unable to sign in. Please check your connection and try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0D0F11] text-white">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#FF8A00]/10 blur-[120px]" />
        <div className="absolute -bottom-40 -right-32 h-[500px] w-[500px] rounded-full bg-[#FF8A00]/8 blur-[140px]" />

        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "42px 42px",
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          {/* Brand */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF8A00] to-[#FFB347] shadow-[0_10px_35px_rgba(255,138,0,0.25)]">
              <Store size={26} strokeWidth={2.2} />
            </div>

            <h1 className="text-2xl font-black tracking-tight">
              Mumbai Collection
            </h1>

            <div className="mt-2 flex items-center justify-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs font-medium text-gray-400">
                Admin Control Center
              </span>
            </div>
          </div>

          {/* Card */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-2xl backdrop-blur-xl sm:p-8">
            {/* Header */}
            <div className="mb-7">
              <div className="mb-3 flex items-center gap-2 text-[#FF9A26]">
                <ShieldCheck size={17} />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em]">
                  Secure Access
                </span>
              </div>

              <h2 className="text-2xl font-bold tracking-tight">
                Welcome back
              </h2>

              <p className="mt-2 text-sm leading-6 text-gray-400">
                Sign in to manage orders, inventory, customers and store
                operations.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-xs font-bold text-gray-300"
                >
                  Email address
                </label>

                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-gray-500">
                    <span className="text-sm">@</span>
                  </div>

                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@example.com"
                    disabled={submitting}
                    className="h-12 w-full rounded-xl border border-white/10 bg-black/20 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-[#FF8A00]/60 focus:bg-black/30 focus:ring-4 focus:ring-[#FF8A00]/10 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="text-xs font-bold text-gray-300"
                  >
                    Password
                  </label>
                </div>

                <div className="relative">
                  <LockKeyhole
                    size={16}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"
                  />

                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    disabled={submitting}
                    className="h-12 w-full rounded-xl border border-white/10 bg-black/20 pl-11 pr-12 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-[#FF8A00]/60 focus:bg-black/30 focus:ring-4 focus:ring-[#FF8A00]/10 disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white/5 hover:text-gray-200"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff size={17} />
                    ) : (
                      <Eye size={17} />
                    )}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3">
                  <p className="text-xs font-medium leading-5 text-red-300">
                    {error}
                  </p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF8A00] text-sm font-bold text-white shadow-[0_8px_25px_rgba(255,138,0,0.18)] transition hover:bg-[#FF971A] hover:shadow-[0_10px_30px_rgba(255,138,0,0.25)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in to Admin
                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </>
                )}
              </button>
            </form>

            {/* Security footer */}
            <div className="mt-7 flex items-center justify-center gap-2 border-t border-white/10 pt-5">
              <ShieldCheck size={14} className="text-emerald-400" />
              <span className="text-[10px] font-medium text-gray-500">
                Protected administrator access
              </span>
            </div>
          </div>

          {/* Footer */}
          <p className="mt-6 text-center text-[10px] font-medium text-gray-600">
            Mumbai Collection • Admin Portal
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;