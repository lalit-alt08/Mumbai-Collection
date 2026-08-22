import { useState } from "react";
import { Navigate } from "react-router-dom";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Store,
  UserCheck,
} from "lucide-react";

import { useEmployeeAuth } from "../context/EmployeeAuthContext.jsx";

function Login() {
  const { user, loading, isEmployee, login } = useEmployeeAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0F172A]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-emerald-500" />
      </div>
    );
  }

  if (user && isEmployee) {
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
      } else if (err.response?.status === 403) {
        setError("Your account does not have employee access permissions.");
      } else if (err.response?.status === 429) {
        setError(
          err.response.data?.message ||
            "Too many login attempts. Please try again in a few minutes."
        );
      } else {
        setError(
          err.response?.data?.message ||
            err.message ||
            "Unable to sign in. Please check your connection and credentials."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0F172A] text-white p-4">
      {/* Ambient background glows */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute -bottom-40 -right-32 h-[500px] w-[500px] rounded-full bg-teal-500/10 blur-[140px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Brand Card */}
        <div className="rounded-3xl border border-slate-800 bg-[#1E293B]/90 p-8 md:p-10 shadow-2xl backdrop-blur-xl">
          {/* Logo & Title */}
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 shadow-[0_4px_20px_rgba(16,185,129,0.35)]">
              <Store size={26} className="text-white" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              Mumbai Collection
            </h1>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400 border border-emerald-500/20">
              <UserCheck size={13} />
              Employee & Dispatch Portal
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs font-medium text-rose-300 animate-in fade-in duration-200">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                Staff Email / Username
              </label>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@mumbaicollection.in"
                autoComplete="username"
                required
                className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 pr-11 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3.5 text-sm font-bold text-white shadow-[0_4px_20px_rgba(16,185,129,0.3)] hover:from-emerald-400 hover:to-teal-500 active:scale-[0.99] disabled:opacity-50 transition cursor-pointer"
            >
              {submitting ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <>
                  <LockKeyhole size={16} />
                  <span>Sign In to Shift</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-500">
            Mumbai Collection Vasai Store · Authorized Staff Only
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
