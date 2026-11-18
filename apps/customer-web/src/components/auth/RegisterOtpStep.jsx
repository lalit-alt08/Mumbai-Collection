import { ArrowLeft, ShieldCheck, RefreshCw, ArrowRight } from "lucide-react";

export function RegisterOtpStep({
  email,
  otp,
  setOtp,
  otpError,
  setOtpError,
  error,
  setError,
  infoMessage,
  countdown,
  resending,
  loading,
  otpInputRef,
  handleVerifyAndRegister,
  handleResendOtp,
  onBackToDetails,
}) {
  return (
    <>
      {/* Step 2: OTP Verification */}
      <div className="mb-4 sm:mb-5">
        <button
          type="button"
          onClick={onBackToDetails}
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#64748B] transition hover:text-[#22499F] cursor-pointer"
        >
          <ArrowLeft size={14} /> Back to details
        </button>
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#22499F]/10 text-[#22499F] border border-[#22499F]/30">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h1 className="text-[20px] font-extrabold tracking-tight text-[#1E293B] sm:text-[24px]">
              Verify Your Email
            </h1>
            <p className="text-[12px] text-[#64748B] sm:text-[13px]">
              Enter the 6-digit code sent to
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] px-3 py-2 text-xs">
          <span className="font-semibold text-[#1E293B] truncate">{email}</span>
          <button
            type="button"
            onClick={onBackToDetails}
            className="ml-2 shrink-0 font-bold text-[#22499F] hover:underline cursor-pointer"
          >
            Change
          </button>
        </div>
      </div>

      {infoMessage && (
        <div className="mb-3 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF]/50 p-2.5 text-center text-xs text-[#64748B]">
          {infoMessage}
        </div>
      )}

      <form onSubmit={handleVerifyAndRegister} className="flex flex-col gap-3">
        {/* 6-Digit Code Input */}
        <div>
          <label className="mb-1.5 block text-center text-[12px] font-bold text-[#64748B] sm:text-[13px]">
            Enter 6-Digit Code
          </label>
          <div className="relative">
            <input
              ref={otpInputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="••••••"
              value={otp}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                setOtp(val);
                setOtpError("");
                setError("");
              }}
              className={`h-[54px] w-full rounded-2xl border bg-[#F0F8E8] text-center font-mono text-[24px] font-black tracking-[8px] text-[#1E293B] placeholder-[#64748B] outline-none transition-all focus:bg-[#F0F8E8] focus:ring-4 focus:ring-[#22499F]/15 ${
                otpError
                  ? "border-rose-400 focus:border-rose-400"
                  : "border-[#E2E8F0] focus:border-[#22499F]"
              }`}
              required
            />
          </div>
          {otpError && (
            <p className="auth-field-error mt-1.5 text-center text-xs font-semibold">
              {otpError}
            </p>
          )}
        </div>

        {/* Resend Code Section */}
        <div className="flex items-center justify-center text-xs text-[#64748B]">
          {countdown > 0 ? (
            <span>
              Resend code in <strong className="text-[#1E293B] font-mono">{countdown}s</strong>
            </span>
          ) : (
            <button
              type="button"
              disabled={resending}
              onClick={handleResendOtp}
              className="inline-flex items-center gap-1.5 font-bold text-[#22499F] hover:text-[#22499F] disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw size={13} className={resending ? "animate-spin" : ""} />
              {resending ? "Resending..." : "Resend Code"}
            </button>
          )}
        </div>

        {/* Error Banner */}
        {error && (
          <div role="alert" className="auth-error-banner rounded-xl border p-3 text-[12.5px] font-semibold">
            {error}
          </div>
        )}

        {/* Verify Button */}
        <button
          type="submit"
          disabled={loading || otp.length !== 6}
          className="mt-1 flex h-[48px] sm:h-[50px] w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl bg-[#22499F] text-[15px] font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
        >
          {loading ? "Verifying..." : "Verify & Continue"}
          {!loading && <ArrowRight size={17} />}
        </button>
      </form>
    </>
  );
}
