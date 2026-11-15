export function RegisterPasswordStep({
  email,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  error,
  loading,
  handleVerifyAndRegister,
  onResetToDetails,
}) {
  return (
    <form onSubmit={handleVerifyAndRegister} className="flex flex-col gap-4">
      <h1 className="text-2xl font-extrabold text-[#1E293B]">Create your password</h1>
      <p className="text-sm text-[#64748B]">Email verified. Set a password to sign in with {email} next time.</p>
      <p id="password-help" className="text-xs text-[#64748B]">Use 8–256 characters, including uppercase and lowercase letters, a number, and a symbol.</p>
      <label className="text-sm font-bold text-[#64748B]">Password
        <input
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          maxLength={256}
          aria-describedby="password-help"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] px-4 text-[#1E293B]"
        />
      </label>
      <label className="text-sm font-bold text-[#64748B]">Confirm password
        <input
          type="password"
          autoComplete="new-password"
          required
          maxLength={256}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] px-4 text-[#1E293B]"
        />
      </label>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="h-12 rounded-xl bg-[#22499F] font-bold text-[#FFFFFF] disabled:opacity-60 cursor-pointer"
      >
        {loading ? "Creating account..." : "Continue to delivery setup"}
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={onResetToDetails}
        className="text-sm text-[#64748B] hover:text-[#1E293B] cursor-pointer"
      >
        Change email or request a new code
      </button>
    </form>
  );
}
