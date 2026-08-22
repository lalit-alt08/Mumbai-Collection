import { Mail, ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { forgotPassword } from "../services/authService";

function ForgotPassword() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setEmailError("");
    setError("");
    setSuccess("");

    if (!email.trim()) {
      setEmailError("Email is required.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email address.");
      return;
    }

    try {
      setLoading(true);

      const response = await forgotPassword(email.trim());

      setSuccess(
        response.message ||
          "If an account exists with this email, a password reset link has been sent."
      );

      setEmail("");
    } catch (err) {
      console.error(err);

      setError(
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Unable to process your request. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white font-sans md:flex md:min-h-[calc(100vh-140px)] md:items-center md:justify-center md:bg-[#F7F7FB]">
      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-10 pt-4 md:max-w-[480px] md:rounded-[24px] md:bg-white md:px-10 md:py-12 md:shadow-[0_10px_40px_rgba(0,0,0,0.04)]">

        <button
          type="button"
          onClick={() => navigate("/login")}
          className="mb-8 flex w-fit items-center gap-2 text-sm font-semibold text-gray-600 transition hover:text-[#7C3AED]"
        >
          <ArrowLeft size={18} />
          Back to Sign In
        </button>

        <div className="mb-8">
          <h1 className="text-[28px] font-extrabold tracking-tight text-[#1E1E1E] md:text-[32px]">
            Forgot Password?
          </h1>

          <p className="mt-2 text-[15px] leading-relaxed text-gray-500 md:text-[16px]">
            Enter your email address and we'll send you a link to reset your
            password.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-5"
        >
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
                  setSuccess("");
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
              <p className="mt-2 text-sm text-red-600">
                {emailError}
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 p-4 text-[13px] font-medium text-red-600">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-xl bg-green-50 p-4 text-[13px] font-medium text-green-700">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Sending..." : "Send Reset Link"}

            {!loading && <ArrowRight size={20} />}
          </button>
        </form>

        <p className="mt-8 text-center text-[14px] text-gray-500">
          Remember your password?

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
  );
}

export default ForgotPassword;