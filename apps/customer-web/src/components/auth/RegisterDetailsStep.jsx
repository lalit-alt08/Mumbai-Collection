import { User, Mail, ArrowRight } from "lucide-react";
import GoogleAuthButton from "./GoogleAuthButton.jsx";

export function RegisterDetailsStep({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  firstNameError,
  setFirstNameError,
  lastNameError,
  setLastNameError,
  emailError,
  setEmailError,
  error,
  setError,
  loading,
  googleBusy = false,
  onGoogleBusyChange,
  handleSendOtp,
  navigate,
  location,
}) {
  return (
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
              <p className="auth-field-error mt-1 text-xs font-semibold">{firstNameError}</p>
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
                    ? "border-rose-500 focus:border-rose-500"
                    : "border-[#E2E8F0] focus:border-[#22499F]"
                }`}
                required
              />
            </div>
            {lastNameError && (
              <p className="auth-field-error mt-1 text-xs font-semibold">{lastNameError}</p>
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
                  ? "border-rose-500 focus:border-rose-500"
                  : "border-[#E2E8F0] focus:border-[#22499F]"
              }`}
              required
            />
          </div>
          {emailError && (
            <div className="mt-1 flex items-center justify-between">
              <p className="auth-field-error text-xs font-semibold">{emailError}</p>
              <button
                type="button"
                onClick={() => navigate("/login", { state: { from: location.state?.from, email: email.trim() } })}
                className="text-xs font-bold text-[#22499F] hover:underline cursor-pointer"
              >
                Sign in instead →
              </button>
            </div>
          )}
        </div>

        {/* General Error */}
        {error && (
          <div role="alert" className="auth-error-banner rounded-xl border p-3 text-[12.5px] font-semibold">
            {error}
          </div>
        )}

        {/* Continue / Send Code Button */}
        <button
          type="submit"
          disabled={loading || googleBusy}
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
          disabled={loading}
          onBusyChange={onGoogleBusyChange}
          onError={(msg) => setError(msg)}
        />
      </div>

      {/* Login */}
      <p className="mt-4 text-center text-[13px] text-[#64748B] sm:mt-5">
        Already have an account?
        <button
          type="button"
          onClick={() => navigate("/login", { state: { from: location.state?.from, email: email.trim() } })}
          className="ml-1.5 font-bold text-[#22499F] transition-colors hover:text-[#22499F] cursor-pointer"
        >
          Sign In
        </button>
      </p>
    </>
  );
}
